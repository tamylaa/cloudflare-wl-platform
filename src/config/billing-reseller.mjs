/**
 * Billing Reseller Helpers
 *
 * Centralizes partner-managed billing, white-label portal routing,
 * markup policy, and downstream usage reporting controls.
 */

import { PLATFORM_DEFAULTS } from '../brand/brand-engine.mjs';
import { normalizeUrl } from '../tenancy/domain-control.mjs';

export const BILLING_RESELLER_MODE = Object.freeze({
    DIRECT: 'direct',
    RESELLER: 'reseller',
    HYBRID: 'hybrid',
});

export const BILLING_VENDOR_VISIBILITY = Object.freeze({
    VISIBLE: 'visible',
    CO_BRANDED: 'co_branded',
    HIDDEN: 'hidden',
});

export const BILLING_PORTAL_MODE = Object.freeze({
    PLATFORM: 'platform',
    EXTERNAL: 'external',
    MANUAL: 'manual',
});

export const RESELLER_MARGIN_MODE = Object.freeze({
    NONE: 'none',
    FIXED_PCT: 'fixed_pct',
    FIXED_CENTS: 'fixed_cents',
    CUSTOM_PRICEBOOK: 'custom_pricebook',
});

export const DOWNSTREAM_INVOICE_FORMAT = Object.freeze({
    NONE: 'none',
    CSV: 'csv',
    JSON: 'json',
    PDF: 'pdf',
});

export const BILLING_RESELLER_MODE_VALUES = Object.freeze(Object.values(BILLING_RESELLER_MODE));
export const BILLING_VENDOR_VISIBILITY_VALUES = Object.freeze(
    Object.values(BILLING_VENDOR_VISIBILITY)
);
export const BILLING_PORTAL_MODE_VALUES = Object.freeze(Object.values(BILLING_PORTAL_MODE));
export const RESELLER_MARGIN_MODE_VALUES = Object.freeze(Object.values(RESELLER_MARGIN_MODE));
export const DOWNSTREAM_INVOICE_FORMAT_VALUES = Object.freeze(
    Object.values(DOWNSTREAM_INVOICE_FORMAT)
);

function safeString(value = '', max = 500) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeEmail(value = '') {
    return safeString(value, 160).toLowerCase();
}

function toNonNegativeInt(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) && num >= 0 ? Math.round(num) : fallback;
}

function clampPercent(value, fallback = 0) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return fallback;
    }
    return Math.max(0, Math.min(100, num));
}

/**
 * Normalize partner/reseller billing config into a stable shape.
 */
export function resolveBillingReseller(config = {}, brand = {}) {
    const effectiveBrand = { ...(PLATFORM_DEFAULTS || {}), ...(brand || {}) };
    const usagePricing = config?.usagePricing || {};

    return {
        mode: BILLING_RESELLER_MODE_VALUES.includes(config?.mode)
            ? config.mode
            : BILLING_RESELLER_MODE.DIRECT,
        vendorVisibility: BILLING_VENDOR_VISIBILITY_VALUES.includes(config?.vendorVisibility)
            ? config.vendorVisibility
            : BILLING_VENDOR_VISIBILITY.VISIBLE,
        portalMode: BILLING_PORTAL_MODE_VALUES.includes(config?.portalMode)
            ? config.portalMode
            : BILLING_PORTAL_MODE.PLATFORM,
        partnerPortalUrl: normalizeUrl(config?.partnerPortalUrl || config?.portalUrl || ''),
        partnerSupportEmail: normalizeEmail(
            config?.partnerSupportEmail || config?.supportEmail || effectiveBrand.supportEmail || ''
        ),
        billingSupportLabel: safeString(
            config?.billingSupportLabel || effectiveBrand.productName || 'Billing',
            120
        ),
        activePriceBookId: safeString(config?.activePriceBookId, 120),
        resellerMarginMode: RESELLER_MARGIN_MODE_VALUES.includes(config?.resellerMarginMode)
            ? config.resellerMarginMode
            : RESELLER_MARGIN_MODE.NONE,
        defaultMarkupPercent: clampPercent(config?.defaultMarkupPercent, 0),
        fixedMarkupCents: toNonNegativeInt(config?.fixedMarkupCents, 0),
        usageReportingEnabled: Boolean(config?.usageReportingEnabled),
        downstreamInvoiceFormat: DOWNSTREAM_INVOICE_FORMAT_VALUES.includes(
            config?.downstreamInvoiceFormat
        )
            ? config.downstreamInvoiceFormat
            : DOWNSTREAM_INVOICE_FORMAT.NONE,
        invoiceMemo: safeString(config?.invoiceMemo, 280),
        notes: safeString(config?.notes, 500),
        usagePricing: {
            baseMonthlyCents: toNonNegativeInt(usagePricing?.baseMonthlyCents, 0),
            includedAiCalls: toNonNegativeInt(usagePricing?.includedAiCalls, 0),
            includedTokens: toNonNegativeInt(usagePricing?.includedTokens, 0),
            aiCallCents: toNonNegativeInt(usagePricing?.aiCallCents, 0),
            ai1kTokenCents: toNonNegativeInt(usagePricing?.ai1kTokenCents, 0),
        },
    };
}

// ─── Prompt 1: Partner Pricing Policy Descriptor ─────────────────────────────

export const PARTNER_PRICING_MODEL = Object.freeze({
    FLAT: 'flat',           // Single fixed price per billing period
    PER_SEAT: 'per_seat',   // Unit price × number of active seats
    PER_USAGE: 'per_usage', // Metered: base + overage per unit
    TIERED: 'tiered',       // Stepped tiers with per-unit prices per tier
    CUSTOM: 'custom',       // Custom price-book — resolved at runtime
});
export const PARTNER_PRICING_MODEL_VALUES = Object.freeze(Object.values(PARTNER_PRICING_MODEL));

/**
 * Resolve a partner-facing pricing policy descriptor from the billing reseller config.
 *
 * This object drives checkout page copy and price computation — it contains only
 * white-labeled partner values; no Stripe/Chargebee/sub-processor names appear.
 *
 * @param {object} config - config.billingReseller (post-merge)
 * @param {object} [brand] - resolved brand object
 * @returns {object}
 */
export function resolvePartnerPricingPolicy(config = {}, brand = {}) {
    const resolved = resolveBillingReseller(config, brand);
    const pricingModel = PARTNER_PRICING_MODEL_VALUES.includes(config?.pricingModel)
        ? config.pricingModel
        : PARTNER_PRICING_MODEL.FLAT;

    const seatPriceCents = toNonNegativeInt(config?.seatPriceCents, 0);
    const seatCount = toNonNegativeInt(config?.seatCount, 1);

    const tiers = Array.isArray(config?.pricingTiers)
        ? config.pricingTiers
            .filter((t) => t && typeof t === 'object')
            .map((t) => Object.freeze({
                upTo: toNonNegativeInt(t.upTo, 0),    // 0 = infinity / unlimited
                unitCents: toNonNegativeInt(t.unitCents, 0),
                flatFeeCents: toNonNegativeInt(t.flatFeeCents, 0),
                label: safeString(t.label, 80),
            }))
        : [];

    return Object.freeze({
        pricingModel,
        vendorVisibility: resolved.vendorVisibility,
        // White-label presentation fields
        productLabel: safeString(config?.productLabel || brand?.productName || '', 120),
        priceDisplayLabel: safeString(config?.priceDisplayLabel || '', 80),
        billingCycleLabel: safeString(config?.billingCycleLabel || 'month', 40),
        currencyCode: safeString(config?.currencyCode || 'USD', 3).toUpperCase(),
        // Flat / per-seat
        baseMonthlyCents: resolved.usagePricing.baseMonthlyCents,
        seatPriceCents,
        seatCount,
        // Tiered
        tiers: Object.freeze(tiers),
        // Usage overage (applies to per_usage and tiered with usage caps)
        usagePricing: resolved.usagePricing,
        // Active price-book reference (custom model)
        activePriceBookId: resolved.activePriceBookId,
        // Reseller identity — never expose underlying provider brand
        partnerSupportEmail: resolved.partnerSupportEmail,
        billingSupportLabel: resolved.billingSupportLabel,
        partnerPortalUrl: resolved.partnerPortalUrl,
    });
}

/**
 * Compute the partner-facing invoice amount (in cents) for a given billing period.
 * Applies the pricingModel from resolvePartnerPricingPolicy.
 *
 * @param {ReturnType<typeof resolvePartnerPricingPolicy>} policy
 * @param {{ seats?: number, usage?: object }} actuals - Actual usage for the period
 * @returns {{ subtotalCents: number, lineItems: Array<{label: string, unitCents: number, quantity: number, totalCents: number}> }}
 */
export function computePartnerInvoiceAmount(policy, actuals = {}) {
    const seats = Math.max(0, toNonNegativeInt(actuals?.seats, policy.seatCount || 1));
    const lineItems = [];

    if (policy.pricingModel === PARTNER_PRICING_MODEL.PER_SEAT) {
        const total = policy.seatPriceCents * seats;
        lineItems.push({ label: policy.priceDisplayLabel || 'Seat', unitCents: policy.seatPriceCents, quantity: seats, totalCents: total });
    } else if (policy.pricingModel === PARTNER_PRICING_MODEL.PER_USAGE) {
        lineItems.push({ label: 'Base fee', unitCents: policy.baseMonthlyCents, quantity: 1, totalCents: policy.baseMonthlyCents });
        const aiCalls = toNonNegativeInt(actuals?.usage?.aiCalls, 0);
        const includedAiCalls = toNonNegativeInt(policy.usagePricing?.includedAiCalls, 0);
        const overage = Math.max(0, aiCalls - includedAiCalls);
        if (overage > 0 && policy.usagePricing?.aiCallCents > 0) {
            lineItems.push({ label: 'AI calls (overage)', unitCents: policy.usagePricing.aiCallCents, quantity: overage, totalCents: overage * policy.usagePricing.aiCallCents });
        }
    } else if (policy.pricingModel === PARTNER_PRICING_MODEL.TIERED && policy.tiers.length > 0) {
        const totalUnits = toNonNegativeInt(actuals?.usage?.totalUnits, seats);
        let remaining = totalUnits;
        let prevUpTo = 0;
        for (const tier of policy.tiers) {
            if (remaining <= 0) break;
            const cap = tier.upTo === 0 ? remaining : Math.min(remaining, tier.upTo - prevUpTo);
            const units = Math.max(0, cap);
            const total = tier.flatFeeCents + units * tier.unitCents;
            lineItems.push({ label: tier.label || `Tier ${tier.upTo || '∞'}`, unitCents: tier.unitCents, quantity: units, totalCents: total });
            remaining -= units;
            prevUpTo = tier.upTo || prevUpTo;
        }
    } else {
        // FLAT
        lineItems.push({ label: policy.priceDisplayLabel || 'Subscription', unitCents: policy.baseMonthlyCents, quantity: 1, totalCents: policy.baseMonthlyCents });
    }

    const subtotalCents = lineItems.reduce((sum, li) => sum + li.totalCents, 0);
    return Object.freeze({ subtotalCents, lineItems: Object.freeze(lineItems) });
}

// ─── Prompt 2: White-label Billing Portal Descriptor ─────────────────────────

// Known sub-processor brand strings that must not surface in partner-facing portal metadata
const VENDOR_BRAND_TERMS = Object.freeze([
    'stripe', 'chargebee', 'recurly', 'paddle', 'braintree', 'adyen',
    'paypal', 'square', 'zuora', 'chargify', 'billsby',
]);

function containsVendorBrandTerm(value = '') {
    const lower = String(value || '').toLowerCase();
    return VENDOR_BRAND_TERMS.some((term) => lower.includes(term));
}

/**
 * Build a white-label billing portal redirect/rendering descriptor.
 * The consuming app uses this to construct the portal page — vendor brand
 * references are absent when all white-label fields are configured.
 *
 * @param {object} config  - config.billingReseller (post-merge)
 * @param {object} [brand] - resolved brand object
 * @returns {object}
 */
export function resolveBillingPortalDescriptor(config = {}, brand = {}) {
    const resolved = resolveBillingReseller(config, brand);

    const portalUrl = resolved.partnerPortalUrl || '';
    const supportEmail = resolved.partnerSupportEmail || '';
    const supportLabel = resolved.billingSupportLabel || brand?.productName || 'Billing Support';
    const logoUrl = safeString(brand?.resolvedLogoUrl || brand?.logoUrl || '', 2000);
    const primaryColor = safeString(brand?.primaryColor || '#3b82f6', 32);
    const productName = safeString(brand?.productName || '', 120);

    // Detect if any visible label leaks a vendor brand
    const vendorLeaks = [];
    if (containsVendorBrandTerm(supportLabel)) vendorLeaks.push('billingSupportLabel');
    if (containsVendorBrandTerm(productName)) vendorLeaks.push('branding.productName');

    return Object.freeze({
        portalMode: resolved.portalMode,
        portalUrl,
        // White-labeled presentation
        productName,
        logoUrl,
        primaryColor,
        supportLabel,
        supportEmail,
        invoiceMemo: resolved.invoiceMemo,
        downstreamInvoiceFormat: resolved.downstreamInvoiceFormat,
        // Readiness
        ready: resolved.portalMode === BILLING_PORTAL_MODE.EXTERNAL
            ? Boolean(portalUrl)
            : resolved.portalMode === BILLING_PORTAL_MODE.PLATFORM,
        // Vendor leak warnings — consuming app should surface these during config validation
        vendorLeaks: Object.freeze(vendorLeaks),
        hasVendorLeaks: vendorLeaks.length > 0,
    });
}

// ─── Prompt 3: Reseller Margin / Markup Computation ──────────────────────────

/**
 * Compute the partner's wholesale cost and reseller margin for a given amount.
 *
 * @param {number} wholesaleCents - Platform wholesale cost (in cents)
 * @param {object} config         - config.billingReseller (post-merge)
 * @returns {{ wholesaleCents, marginCents, endClientCents, effectiveMarkupPercent }}
 */
export function computeResellerMargin(wholesaleCents, config = {}) {
    const resolved = resolveBillingReseller(config);
    const wholesale = Math.max(0, toNonNegativeInt(wholesaleCents, 0));

    let marginCents = 0;

    switch (resolved.resellerMarginMode) {
        case RESELLER_MARGIN_MODE.FIXED_PCT:
            marginCents = Math.round(wholesale * (resolved.defaultMarkupPercent / 100));
            break;
        case RESELLER_MARGIN_MODE.FIXED_CENTS:
            marginCents = resolved.fixedMarkupCents;
            break;
        case RESELLER_MARGIN_MODE.CUSTOM_PRICEBOOK:
            // Custom price-book: margin is caller-supplied via wholesale vs invoiced delta;
            // we return 0 margin here — the consuming app resolves the pricebook externally.
            marginCents = 0;
            break;
        case RESELLER_MARGIN_MODE.NONE:
        default:
            marginCents = 0;
    }

    const endClientCents = wholesale + marginCents;
    const effectiveMarkupPercent = wholesale > 0
        ? parseFloat(((marginCents / wholesale) * 100).toFixed(4))
        : 0;

    return Object.freeze({
        wholesaleCents: wholesale,
        marginCents,
        endClientCents,
        effectiveMarkupPercent,
        resellerMarginMode: resolved.resellerMarginMode,
        activePriceBookId: resolved.activePriceBookId,
    });
}

// ─── Prompt 4: Usage-Based Metering & Downstream Invoice Builder ─────────────

const USAGE_EVENT_KEY_PREFIX = 'usage-event:';
const USAGE_AGGREGATE_KEY_PREFIX = 'usage-agg:';
const USAGE_DEFAULT_TTL_SECONDS = 95 * 24 * 60 * 60; // 95 days — covers a full billing month + buffer

function getUsageKv(env = {}) {
    return env.KV_CONFIG || env.KV_ANALYTICS || null;
}

function normalizeUsageSiteId(siteId = '') {
    return String(siteId ?? '').trim().toLowerCase().replace(/[^a-z0-9._:-]/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
}

function billingPeriodKey(nowMs = Date.now()) {
    const d = new Date(nowMs);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const USAGE_EVENT_TYPE = Object.freeze({
    AI_CALL: 'ai_call',
    TOKEN_CONSUMED: 'token_consumed',
    EXTRACTION_RUN: 'extraction_run',
    URL_INSPECTION: 'url_inspection',
    CONTENT_AUDIT_PAGE: 'content_audit_page',
    SEAT_ACTIVE: 'seat_active',
    API_REQUEST: 'api_request',
    CUSTOM: 'custom',
});
export const USAGE_EVENT_TYPE_VALUES = Object.freeze(Object.values(USAGE_EVENT_TYPE));

/**
 * Record a single tenant usage event to KV.
 * Events are namespaced by siteId + billing period so aggregation is O(page count).
 *
 * @param {object} env
 * @param {string} siteId
 * @param {{ type: string, quantity?: number, meta?: object, nowMs?: number }} event
 */
export async function recordTenantUsageEvent(env, siteId, event = {}) {
    const kv = getUsageKv(env);
    if (!kv?.put) return null;

    const normalizedSiteId = normalizeUsageSiteId(siteId);
    if (!normalizedSiteId) return null;

    const nowMs = Number(event.nowMs) || Date.now();
    const period = billingPeriodKey(nowMs);
    const type = USAGE_EVENT_TYPE_VALUES.includes(event.type) ? event.type : USAGE_EVENT_TYPE.CUSTOM;
    const quantity = Math.max(0, toNonNegativeInt(event.quantity, 1));
    const eventId = `${nowMs.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const payload = {
        eventId,
        siteId: normalizedSiteId,
        period,
        type,
        quantity,
        meta: event.meta && typeof event.meta === 'object' ? event.meta : {},
        recordedAt: new Date(nowMs).toISOString(),
    };

    const key = `${USAGE_EVENT_KEY_PREFIX}${normalizedSiteId}:${period}:${eventId}`;
    await kv.put(key, JSON.stringify(payload), { expirationTtl: USAGE_DEFAULT_TTL_SECONDS });
    return payload;
}

/**
 * Aggregate all usage events for a tenant in a given billing period.
 * Returns per-type totals suitable for downstream invoice construction.
 *
 * @param {object} env
 * @param {string} siteId
 * @param {{ period?: string, nowMs?: number }} options
 * @returns {{ siteId, period, totals: Record<string, number>, eventCount: number }}
 */
export async function aggregateTenantUsage(env, siteId, options = {}) {
    const kv = getUsageKv(env);
    const normalizedSiteId = normalizeUsageSiteId(siteId);
    const period = options.period || billingPeriodKey(Number(options.nowMs) || Date.now());

    const totals = Object.fromEntries(USAGE_EVENT_TYPE_VALUES.map((t) => [t, 0]));
    let eventCount = 0;

    if (!kv?.list || !normalizedSiteId) {
        return Object.freeze({ siteId: normalizedSiteId, period, totals: Object.freeze(totals), eventCount });
    }

    const prefix = `${USAGE_EVENT_KEY_PREFIX}${normalizedSiteId}:${period}:`;
    let cursor;
    do {
        const listed = await kv.list({ prefix, cursor, limit: 500 });
        for (const entry of listed?.keys || []) {
            if (!entry?.name) continue;
            try {
                const raw = await kv.get(entry.name);
                if (!raw) continue;
                const evt = JSON.parse(raw);
                const t = evt.type || USAGE_EVENT_TYPE.CUSTOM;
                totals[t] = (totals[t] || 0) + Math.max(0, toNonNegativeInt(evt.quantity, 1));
                eventCount++;
            } catch { /* corrupt entry — skip */ }
        }
        cursor = listed?.list_complete === false ? listed.cursor : null;
    } while (cursor);

    return Object.freeze({ siteId: normalizedSiteId, period, totals: Object.freeze({ ...totals }), eventCount });
}

/**
 * Build a structured downstream invoice record from aggregated usage.
 * The resulting object can be serialized as JSON, CSV, or PDF metadata —
 * no sub-processor brand names appear when the partner has configured
 * their white-label billing fields.
 *
 * @param {object} usageAggregate  - Output of aggregateTenantUsage()
 * @param {object} billingConfig   - config.billingReseller (post-merge)
 * @param {object} [brand]         - Resolved brand object
 * @param {object} [overrides]     - { invoiceNumber, issuedAt, dueAt, notes }
 * @returns {object}               - Structured invoice record
 */
export function buildDownstreamInvoiceRecord(usageAggregate = {}, billingConfig = {}, brand = {}, overrides = {}) {
    const resolved = resolveBillingReseller(billingConfig, brand);
    const pricing = resolved.usagePricing;
    const totals = usageAggregate?.totals || {};
    const period = usageAggregate?.period || billingPeriodKey();
    const siteId = usageAggregate?.siteId || '';

    // Compute individual line items
    const lineItems = [];

    if (pricing.baseMonthlyCents > 0) {
        lineItems.push({ label: 'Base subscription', quantity: 1, unitCents: pricing.baseMonthlyCents, totalCents: pricing.baseMonthlyCents });
    }

    const aiCalls = toNonNegativeInt(totals[USAGE_EVENT_TYPE.AI_CALL], 0);
    const includedAiCalls = toNonNegativeInt(pricing.includedAiCalls, 0);
    const aiOverage = Math.max(0, aiCalls - includedAiCalls);
    if (aiOverage > 0 && pricing.aiCallCents > 0) {
        lineItems.push({ label: 'AI calls (overage)', quantity: aiOverage, unitCents: pricing.aiCallCents, totalCents: aiOverage * pricing.aiCallCents });
    }

    const tokens = toNonNegativeInt(totals[USAGE_EVENT_TYPE.TOKEN_CONSUMED], 0);
    const includedTokens = toNonNegativeInt(pricing.includedTokens, 0);
    const tokenOverage = Math.max(0, tokens - includedTokens);
    if (tokenOverage > 0 && pricing.ai1kTokenCents > 0) {
        const kTokens = Math.ceil(tokenOverage / 1000);
        lineItems.push({ label: 'Tokens (per 1k overage)', quantity: kTokens, unitCents: pricing.ai1kTokenCents, totalCents: kTokens * pricing.ai1kTokenCents });
    }

    const subtotalCents = lineItems.reduce((s, li) => s + li.totalCents, 0);

    // Apply reseller margin on top of the wholesale subtotal
    const margin = computeResellerMargin(subtotalCents, billingConfig);

    const nowMs = Date.now();
    return Object.freeze({
        invoiceNumber: safeString(overrides.invoiceNumber || `INV-${siteId}-${period}`, 80),
        siteId,
        period,
        issuedAt: overrides.issuedAt || new Date(nowMs).toISOString(),
        dueAt: overrides.dueAt || new Date(nowMs + 30 * 24 * 60 * 60 * 1000).toISOString(),
        // White-labeled billing identity
        billerName: safeString(brand?.productName || resolved.billingSupportLabel || '', 120),
        billerEmail: resolved.partnerSupportEmail,
        invoiceMemo: safeString(overrides.notes || resolved.invoiceMemo, 280),
        currencyCode: safeString(billingConfig?.currencyCode || 'USD', 3).toUpperCase(),
        // Line items
        lineItems: Object.freeze(lineItems),
        subtotalCents,
        marginCents: margin.marginCents,
        totalCents: margin.endClientCents,
        effectiveMarkupPercent: margin.effectiveMarkupPercent,
        // Usage snapshot for reconciliation
        usageTotals: Object.freeze({ ...totals }),
        eventCount: toNonNegativeInt(usageAggregate?.eventCount, 0),
        // Format hint for serializer
        format: DOWNSTREAM_INVOICE_FORMAT_VALUES.includes(resolved.downstreamInvoiceFormat)
            ? resolved.downstreamInvoiceFormat
            : DOWNSTREAM_INVOICE_FORMAT.JSON,
    });
}
