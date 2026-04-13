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
