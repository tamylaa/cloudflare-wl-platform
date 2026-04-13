/**
 * Billing Adapter — provider-agnostic billing interface.
 *
 * Abstracts Stripe (and future providers) behind a single interface so that
 * payment-handler.mjs contains zero provider-specific fetch calls.
 *
 * ADDING A NEW PROVIDER:
 *   1. Write a createXxxAdapter(env) function below.
 *   2. Add a branch in createBillingAdapter for the provider key.
 *   3. Set env.BILLING_PROVIDER = 'xxx' in wrangler.toml.
 */

import { PAYMENT_URLS, CIRCUIT_BREAKER_DEFAULTS } from '../config/api-constants.mjs';
import { getCircuitBreaker } from '../utils/circuit-breaker.mjs';
import { createLogger, toStructuredConsole } from '../platform/logger.mjs';
import { SERVICE_NAMES } from '../config/service-names.mjs';

const log = toStructuredConsole(
    createLogger({ service: SERVICE_NAMES.PAYMENT_HANDLER, component: 'billing-adapter', logInTest: true })
);

// ─── JSDoc Typedefs ───────────────────────────────────────────────────────────

/**
 * @typedef {Object} CheckoutSessionParams
 * @property {string} email
 * @property {number} amount           — Amount in smallest currency unit (paise / cents)
 * @property {string} currency         — ISO 4217 lowercase ('usd', 'inr')
 * @property {string} name             — Line-item product name shown to user
 * @property {string} description      — Line-item description shown to user
 * @property {Object.<string, string>} metadata — Key/value pairs attached to the session
 * @property {string} returnUrl        — Base URL for success/cancel redirects
 */

/**
 * @typedef {Object} PortalSessionParams
 * @property {string} customerId  — Provider customer ID (e.g. Stripe cus_xxx)
 * @property {string} returnUrl   — URL to send customer back to after portal actions
 */

/**
 * @typedef {Object} IBillingAdapter
 * @property {(params: CheckoutSessionParams) => Promise<{url: string, id: string}>} createCheckoutSession
 * @property {(params: PortalSessionParams) => Promise<{url: string}>} createPortalSession
 */

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Returns the configured billing adapter for the current request.
 * Reads env.BILLING_PROVIDER (defaults to 'stripe').
 *
 * @param {Object} env
 * @returns {IBillingAdapter}
 */
export function createBillingAdapter(env) {
    const provider = env.BILLING_PROVIDER ?? 'stripe';
    if (provider === 'stripe') return createStripeAdapter(env);
    throw new Error(`Unknown billing provider: ${provider}`);
}

// ─── Stripe Implementation ────────────────────────────────────────────────────

/**
 * @param {Object} env
 * @returns {IBillingAdapter}
 */
function createStripeAdapter(env) {
    const stripeBreaker = getCircuitBreaker('stripe-api', {
        threshold: CIRCUIT_BREAKER_DEFAULTS.FAILURE_THRESHOLD,
        resetTimeoutMs: CIRCUIT_BREAKER_DEFAULTS.RESET_TIMEOUT_MS,
    });

    return {
        /**
         * Create a Stripe Checkout session.
         * Moved verbatim from createStripeCheckout() in payment-handler.mjs.
         *
         * @param {CheckoutSessionParams} params
         * @returns {Promise<{url: string, id: string}>}
         */
        async createCheckoutSession({ email, amount, currency, name, description, metadata, returnUrl }) {
            const stripeKey = env.STRIPE_SECRET_KEY;
            if (!stripeKey) {
                throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY secret.');
            }

            const body = [
                'mode=payment',
                `customer_email=${encodeURIComponent(email)}`,
                `line_items[0][price_data][currency]=${currency}`,
                `line_items[0][price_data][unit_amount]=${amount}`,
                `line_items[0][price_data][product_data][name]=${encodeURIComponent(name)}`,
                `line_items[0][quantity]=1`,
                `success_url=${encodeURIComponent(returnUrl + '?payment=success')}`,
                `cancel_url=${encodeURIComponent(returnUrl + '?payment=cancelled')}`,
                ...Object.entries(metadata).map(([k, v]) => `metadata[${k}]=${encodeURIComponent(v)}`),
            ].join('&');

            const resp = await stripeBreaker.execute(() =>
                fetch(`${PAYMENT_URLS.STRIPE_API}/checkout/sessions`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${stripeKey}`,
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body,
                })
            );

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                log.error('[Stripe] Checkout error:', JSON.stringify(err));
                throw new Error(err?.error?.message || 'Failed to create checkout session');
            }
            return resp.json();
        },

        /**
         * Create a Stripe Customer Portal session.
         * Moved verbatim from the inline fetch in handlePortal() in payment-handler.mjs.
         *
         * @param {PortalSessionParams} params
         * @returns {Promise<{url: string}>}
         */
        async createPortalSession({ customerId, returnUrl }) {
            const stripeKey = env.STRIPE_SECRET_KEY;
            if (!stripeKey) {
                throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY secret.');
            }

            const resp = await stripeBreaker.execute(() =>
                fetch(`${PAYMENT_URLS.STRIPE_API}/billing_portal/sessions`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${stripeKey}`,
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: `customer=${customerId}&return_url=${encodeURIComponent(returnUrl)}`,
                })
            );

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err?.error?.message || 'Failed to create portal session');
            }
            return resp.json();
        },
    };
}
