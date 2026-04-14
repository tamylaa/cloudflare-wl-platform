import { describe, it, expect } from 'vitest';
import {
    BILLING_RESELLER_MODE,
    BILLING_VENDOR_VISIBILITY,
    BILLING_PORTAL_MODE,
    RESELLER_MARGIN_MODE,
    DOWNSTREAM_INVOICE_FORMAT,
    PARTNER_PRICING_MODEL,
    USAGE_EVENT_TYPE,
    resolveBillingReseller,
    resolvePartnerPricingPolicy,
    computePartnerInvoiceAmount,
    resolveBillingPortalDescriptor,
    computeResellerMargin,
    recordTenantUsageEvent,
    aggregateTenantUsage,
    buildDownstreamInvoiceRecord,
} from '../../src/config/billing-reseller.mjs';

// ─── Mock KV ─────────────────────────────────────────────────────────────────

function makeMockKv(store = {}) {
    return {
        async put(key, value) { store[key] = value; },
        async get(key) { return store[key] ?? null; },
        async list({ prefix = '', cursor, limit = 500 } = {}) {
            const keys = Object.keys(store)
                .filter((k) => k.startsWith(prefix))
                .slice(0, limit)
                .map((name) => ({ name }));
            return { keys, list_complete: true };
        },
    };
}

// ─── Prompt 1: Partner Pricing Policy ────────────────────────────────────────

describe('resolvePartnerPricingPolicy', () => {
    it('returns FLAT model with sensible defaults when no config given', () => {
        const policy = resolvePartnerPricingPolicy({}, {});
        expect(policy.pricingModel).toBe(PARTNER_PRICING_MODEL.FLAT);
        expect(policy.vendorVisibility).toBe(BILLING_VENDOR_VISIBILITY.VISIBLE);
        expect(policy.tiers).toEqual([]);
    });

    it('reflects PER_SEAT model and exposes seatPriceCents', () => {
        const policy = resolvePartnerPricingPolicy(
            { pricingModel: 'per_seat', seatPriceCents: 500, seatCount: 10 },
            { productName: 'ResellCo' }
        );
        expect(policy.pricingModel).toBe(PARTNER_PRICING_MODEL.PER_SEAT);
        expect(policy.seatPriceCents).toBe(500);
        expect(policy.seatCount).toBe(10);
        expect(policy.productLabel).toBe('ResellCo');
    });

    it('reflects TIERED model with tier array', () => {
        const config = {
            pricingModel: 'tiered',
            pricingTiers: [
                { upTo: 10, unitCents: 100, flatFeeCents: 0, label: 'Starter' },
                { upTo: 0, unitCents: 80, flatFeeCents: 2000, label: 'Growth' },
            ],
        };
        const policy = resolvePartnerPricingPolicy(config, {});
        expect(policy.pricingModel).toBe(PARTNER_PRICING_MODEL.TIERED);
        expect(policy.tiers).toHaveLength(2);
        expect(policy.tiers[0].label).toBe('Starter');
    });

    it('vendor visibility is HIDDEN when configured', () => {
        const policy = resolvePartnerPricingPolicy({ vendorVisibility: 'hidden' }, {});
        expect(policy.vendorVisibility).toBe(BILLING_VENDOR_VISIBILITY.HIDDEN);
    });
});

describe('computePartnerInvoiceAmount', () => {
    it('FLAT: single subscription line item', () => {
        const policy = resolvePartnerPricingPolicy({ usagePricing: { baseMonthlyCents: 2000 } }, {});
        const result = computePartnerInvoiceAmount(policy, {});
        expect(result.subtotalCents).toBe(2000);
        expect(result.lineItems).toHaveLength(1);
        expect(result.lineItems[0].label).toBe('Subscription');
    });

    it('PER_SEAT: multiplies seatPrice × actual seats', () => {
        const policy = resolvePartnerPricingPolicy(
            { pricingModel: 'per_seat', seatPriceCents: 1000, seatCount: 5 },
            {}
        );
        const result = computePartnerInvoiceAmount(policy, { seats: 8 });
        expect(result.subtotalCents).toBe(8000);
        expect(result.lineItems[0].quantity).toBe(8);
    });

    it('PER_USAGE: charges overage AI calls above included threshold', () => {
        const policy = resolvePartnerPricingPolicy({
            pricingModel: 'per_usage',
            usagePricing: { baseMonthlyCents: 1000, includedAiCalls: 100, aiCallCents: 5 },
        }, {});
        const result = computePartnerInvoiceAmount(policy, { usage: { aiCalls: 150 } });
        // base + 50 overage × 5
        expect(result.subtotalCents).toBe(1000 + 50 * 5);
        expect(result.lineItems).toHaveLength(2);
    });

    it('TIERED: applies stepped tier pricing', () => {
        const policy = resolvePartnerPricingPolicy({
            pricingModel: 'tiered',
            pricingTiers: [
                { upTo: 10, unitCents: 100, flatFeeCents: 0, label: 'T1' },
                { upTo: 0, unitCents: 80, flatFeeCents: 0, label: 'T2' },
            ],
        }, {});
        const result = computePartnerInvoiceAmount(policy, { usage: { totalUnits: 15 } });
        // 10 × 100 + 5 × 80
        expect(result.subtotalCents).toBe(10 * 100 + 5 * 80);
    });
});

// ─── Prompt 2: White-label Billing Portal Descriptor ─────────────────────────

describe('resolveBillingPortalDescriptor', () => {
    it('ready=true for EXTERNAL portal with a URL', () => {
        const desc = resolveBillingPortalDescriptor(
            { portalMode: 'external', partnerPortalUrl: 'https://billing.partner.com' },
            {}
        );
        expect(desc.ready).toBe(true);
        expect(desc.portalUrl).toBe('https://billing.partner.com');
    });

    it('ready=false for EXTERNAL portal without a URL', () => {
        const desc = resolveBillingPortalDescriptor({ portalMode: 'external' }, {});
        expect(desc.ready).toBe(false);
    });

    it('ready=true for PLATFORM portal mode (built-in)', () => {
        const desc = resolveBillingPortalDescriptor({ portalMode: 'platform' }, {});
        expect(desc.ready).toBe(true);
    });

    it('flags vendor brand leak in billingSupportLabel', () => {
        const desc = resolveBillingPortalDescriptor(
            { billingSupportLabel: 'Powered by Stripe Billing' },
            {}
        );
        expect(desc.hasVendorLeaks).toBe(true);
        expect(desc.vendorLeaks).toContain('billingSupportLabel');
    });

    it('no vendor leak when partner name is clean', () => {
        const desc = resolveBillingPortalDescriptor(
            { billingSupportLabel: 'ResellCo Billing' },
            { productName: 'ResellCo' }
        );
        expect(desc.hasVendorLeaks).toBe(false);
        expect(desc.vendorLeaks).toHaveLength(0);
    });

    it('invoice format is forwarded to descriptor', () => {
        const desc = resolveBillingPortalDescriptor(
            { downstreamInvoiceFormat: 'csv', portalMode: 'manual' },
            {}
        );
        expect(desc.downstreamInvoiceFormat).toBe(DOWNSTREAM_INVOICE_FORMAT.CSV);
    });
});

// ─── Prompt 3: Reseller Margin Computation ───────────────────────────────────

describe('computeResellerMargin', () => {
    it('NONE mode returns zero margin', () => {
        const result = computeResellerMargin(1000, { resellerMarginMode: 'none' });
        expect(result.marginCents).toBe(0);
        expect(result.endClientCents).toBe(1000);
    });

    it('FIXED_PCT applies percentage correctly', () => {
        const result = computeResellerMargin(1000, { resellerMarginMode: 'fixed_pct', defaultMarkupPercent: 20 });
        expect(result.marginCents).toBe(200);
        expect(result.endClientCents).toBe(1200);
        expect(result.effectiveMarkupPercent).toBe(20);
    });

    it('FIXED_CENTS applies fixed cent amount', () => {
        const result = computeResellerMargin(1000, { resellerMarginMode: 'fixed_cents', fixedMarkupCents: 300 });
        expect(result.marginCents).toBe(300);
        expect(result.endClientCents).toBe(1300);
    });

    it('CUSTOM_PRICEBOOK returns zero margin (caller must resolve externally)', () => {
        const result = computeResellerMargin(1000, { resellerMarginMode: 'custom_pricebook', activePriceBookId: 'pb_123' });
        expect(result.marginCents).toBe(0);
        expect(result.activePriceBookId).toBe('pb_123');
    });

    it('clamps wholesale to non-negative', () => {
        const result = computeResellerMargin(-500, { resellerMarginMode: 'fixed_pct', defaultMarkupPercent: 10 });
        expect(result.wholesaleCents).toBe(0);
        expect(result.marginCents).toBe(0);
    });
});

// ─── Prompt 4: Usage-based Metering & Downstream Invoice ─────────────────────

describe('recordTenantUsageEvent', () => {
    it('writes an event to KV and returns the payload', async () => {
        const store = {};
        const env = { KV_CONFIG: makeMockKv(store) };
        const result = await recordTenantUsageEvent(env, 'tenant-a', { type: 'ai_call', quantity: 3 });
        expect(result).not.toBeNull();
        expect(result.type).toBe(USAGE_EVENT_TYPE.AI_CALL);
        expect(result.quantity).toBe(3);
        expect(result.siteId).toBe('tenant-a');
        expect(Object.keys(store)).toHaveLength(1);
    });

    it('returns null when KV is unavailable', async () => {
        const result = await recordTenantUsageEvent({}, 'tenant-a', { type: 'ai_call', quantity: 1 });
        expect(result).toBeNull();
    });

    it('defaults unknown event type to custom', async () => {
        const store = {};
        const env = { KV_CONFIG: makeMockKv(store) };
        const result = await recordTenantUsageEvent(env, 'tenant-a', { type: 'not_a_thing', quantity: 1 });
        expect(result.type).toBe(USAGE_EVENT_TYPE.CUSTOM);
    });
});

describe('aggregateTenantUsage', () => {
    it('aggregates per-type counts from KV events', async () => {
        const nowMs = Date.now();
        const store = {};
        const env = { KV_CONFIG: makeMockKv(store) };
        await recordTenantUsageEvent(env, 'tenant-b', { type: 'ai_call', quantity: 5, nowMs });
        await recordTenantUsageEvent(env, 'tenant-b', { type: 'ai_call', quantity: 3, nowMs });
        await recordTenantUsageEvent(env, 'tenant-b', { type: 'token_consumed', quantity: 1000, nowMs });

        const agg = await aggregateTenantUsage(env, 'tenant-b', { nowMs });
        expect(agg.totals[USAGE_EVENT_TYPE.AI_CALL]).toBe(8);
        expect(agg.totals[USAGE_EVENT_TYPE.TOKEN_CONSUMED]).toBe(1000);
        expect(agg.eventCount).toBe(3);
    });

    it('returns zero totals when no events exist', async () => {
        const env = { KV_CONFIG: makeMockKv() };
        const agg = await aggregateTenantUsage(env, 'tenant-c', {});
        expect(agg.totals[USAGE_EVENT_TYPE.AI_CALL]).toBe(0);
        expect(agg.eventCount).toBe(0);
    });
});

describe('buildDownstreamInvoiceRecord', () => {
    it('produces correct totals and white-labeled biller identity', async () => {
        const nowMs = Date.now();
        const store = {};
        const env = { KV_CONFIG: makeMockKv(store) };
        await recordTenantUsageEvent(env, 'tenant-d', { type: 'ai_call', quantity: 150, nowMs });
        const agg = await aggregateTenantUsage(env, 'tenant-d', { nowMs });

        const billingConfig = {
            resellerMarginMode: 'fixed_pct',
            defaultMarkupPercent: 10,
            usageReportingEnabled: true,
            downstreamInvoiceFormat: 'json',
            usagePricing: {
                baseMonthlyCents: 2000,
                includedAiCalls: 100,
                aiCallCents: 5,
            },
        };
        const brand = { productName: 'PartnerCo', partnerSupportEmail: 'billing@partner.com' };

        const invoice = buildDownstreamInvoiceRecord(agg, billingConfig, brand);

        // Base 2000 + 50 overage × 5 = 2250 wholesale
        expect(invoice.subtotalCents).toBe(2250);
        // 10% margin → 225 → total 2475
        expect(invoice.marginCents).toBe(225);
        expect(invoice.totalCents).toBe(2475);
        // White-labeled identity
        expect(invoice.billerName).toBe('PartnerCo');
        expect(invoice.format).toBe(DOWNSTREAM_INVOICE_FORMAT.JSON);
        expect(invoice.lineItems.length).toBeGreaterThanOrEqual(2);
        expect(invoice.usageTotals[USAGE_EVENT_TYPE.AI_CALL]).toBe(150);
    });

    it('returns no-op invoice when usage is zero and no base pricing', async () => {
        const agg = { siteId: 'tenant-e', period: '2026-04', totals: {}, eventCount: 0 };
        const invoice = buildDownstreamInvoiceRecord(agg, {}, {});
        expect(invoice.subtotalCents).toBe(0);
        expect(invoice.totalCents).toBe(0);
        expect(invoice.lineItems).toHaveLength(0);
    });
});
