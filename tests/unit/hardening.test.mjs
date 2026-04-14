/**
 * Hardening regression tests — covers the 5 platform-core fixes applied after
 * the critical assessment:
 *
 *   Fix #1 — aggregateTenantUsage fast-path (counter vs. scan)
 *   Fix #2 — consumeTenantRateLimitKv (KV-backed cross-isolate rate limiting)
 *   Fix #4 — validator severity: vendor domain leaks are errors, not warnings
 *   Fix #5 — schema versioning: SCHEMA_VERSION, migrateConfig
 *   Fix #6 — webhook sanitizer two-pass: key denylist first, value scan scoped to trace keys
 */

import { describe, it, expect } from 'vitest';
import { aggregateTenantUsage, recordTenantUsageEvent, USAGE_EVENT_TYPE } from '../../src/config/billing-reseller.mjs';
import { consumeTenantRateLimitKv } from '../../src/tenancy/tenant-quota.mjs';
import { validateConfig } from '../../src/config/config-validator.mjs';
import { SCHEMA_VERSION, migrateConfig, mergeWithDefaults } from '../../src/config/customer-config.schema.mjs';
import { sanitizeWebhookPayload } from '../../src/config/communications.mjs';

// ─── Mock KV ─────────────────────────────────────────────────────────────────

function makeMockKv(store = {}) {
    return {
        async put(key, value) { store[key] = value; },
        async get(key) { return store[key] ?? null; },
        async list({ prefix = '', limit = 500 } = {}) {
            const keys = Object.keys(store)
                .filter((k) => k.startsWith(prefix))
                .slice(0, limit)
                .map((name) => ({ name }));
            return { keys, list_complete: true };
        },
    };
}

function validBaseConfig(overrides = {}) {
    return mergeWithDefaults({
        site: { id: 'acme', domain: 'acme.com', siteUrl: 'https://acme.com', name: 'Acme' },
        ...overrides,
    });
}

// ─── Fix #1: aggregateTenantUsage fast-path vs. reconcile ────────────────────

describe('Fix #1 — aggregateTenantUsage counter fast-path', () => {
    it('fast path reads from counter keys and is O(type-count) not O(event-count)', async () => {
        const nowMs = Date.now();
        const store = {};
        const env = { KV_CONFIG: makeMockKv(store) };

        await recordTenantUsageEvent(env, 'h-tenant', { type: 'ai_call', quantity: 7, nowMs });
        await recordTenantUsageEvent(env, 'h-tenant', { type: 'ai_call', quantity: 3, nowMs });

        // Fast path should not touch event-record keys (only counter keys)
        const agg = await aggregateTenantUsage(env, 'h-tenant', { nowMs });
        expect(agg.source).toBe('counter');
        expect(agg.totals[USAGE_EVENT_TYPE.AI_CALL]).toBe(10);
    });

    it('reconcile path does full scan and returns source=scan', async () => {
        const nowMs = Date.now();
        const store = {};
        const env = { KV_CONFIG: makeMockKv(store) };
        await recordTenantUsageEvent(env, 'h-tenant2', { type: 'extraction_run', quantity: 2, nowMs });

        const agg = await aggregateTenantUsage(env, 'h-tenant2', { nowMs, reconcile: true });
        expect(agg.source).toBe('scan');
        expect(agg.totals[USAGE_EVENT_TYPE.EXTRACTION_RUN]).toBe(2);
        expect(agg.eventCount).toBe(1);
    });

    it('counter key accumulates across multiple writes for same type', async () => {
        const nowMs = Date.now();
        const store = {};
        const env = { KV_CONFIG: makeMockKv(store) };
        await recordTenantUsageEvent(env, 'h-tenant3', { type: 'api_request', quantity: 10, nowMs });
        await recordTenantUsageEvent(env, 'h-tenant3', { type: 'api_request', quantity: 5, nowMs });
        await recordTenantUsageEvent(env, 'h-tenant3', { type: 'api_request', quantity: 1, nowMs });

        const agg = await aggregateTenantUsage(env, 'h-tenant3', { nowMs });
        expect(agg.totals[USAGE_EVENT_TYPE.API_REQUEST]).toBe(16);
    });
});

// ─── Fix #2: consumeTenantRateLimitKv ────────────────────────────────────────

describe('Fix #2 — consumeTenantRateLimitKv KV-backed rate limit', () => {
    it('allows requests within the window limit', async () => {
        const store = {};
        const env = { KV_CONFIG: makeMockKv(store) };
        const result = await consumeTenantRateLimitKv(env, 'rl-tenant', 'apiRequestsPerMinute', {
            policy: { rateLimits: { apiRequestsPerMinute: 5 }, windowsMs: { apiRequestsPerMinute: 60000 } },
        });
        expect(result.allowed).toBe(true);
        expect(result.source).toBe('kv');
        expect(result.used).toBe(1);
    });

    it('blocks requests that exceed the window limit', async () => {
        const store = {};
        const env = { KV_CONFIG: makeMockKv(store) };
        const opts = { policy: { rateLimits: { apiRequestsPerMinute: 2 }, windowsMs: { apiRequestsPerMinute: 60000 } } };

        await consumeTenantRateLimitKv(env, 'rl-tenant-b', 'apiRequestsPerMinute', opts);
        await consumeTenantRateLimitKv(env, 'rl-tenant-b', 'apiRequestsPerMinute', opts);
        const third = await consumeTenantRateLimitKv(env, 'rl-tenant-b', 'apiRequestsPerMinute', opts);

        expect(third.allowed).toBe(false);
        expect(third.used).toBe(3);
        expect(third.retryAfterMs).toBeGreaterThan(0);
    });

    it('falls back to in-process limiter when KV is unavailable', async () => {
        const result = await consumeTenantRateLimitKv({}, 'rl-tenant-c', 'apiRequestsPerMinute', {
            policy: { rateLimits: { apiRequestsPerMinute: 10 }, windowsMs: { apiRequestsPerMinute: 60000 } },
        });
        expect(result.allowed).toBe(true);
        expect(result.source).toBe('process');
    });

    it('returns unlimited=true when limit is 0', async () => {
        const store = {};
        const env = { KV_CONFIG: makeMockKv(store) };
        const result = await consumeTenantRateLimitKv(env, 'rl-tenant-d', 'apiRequestsPerMinute', {
            policy: { rateLimits: { apiRequestsPerMinute: 0 }, windowsMs: { apiRequestsPerMinute: 60000 } },
        });
        expect(result.unlimited).toBe(true);
        expect(result.allowed).toBe(true);
    });
});

// ─── Fix #4: validator severity ──────────────────────────────────────────────

describe('Fix #4 — validator severity: vendor domain leaks are errors', () => {
    it('loginHostname on vendors.dev is an error, not a warning', () => {
        const config = validBaseConfig({
            authIdentity: { loginHostname: 'auth.my-company.workers.dev' },
        });
        const { errors, warnings } = validateConfig(config);
        expect(errors.some((e) => e.field === 'authIdentity.loginHostname')).toBe(true);
        expect(warnings.some((w) => w.field === 'authIdentity.loginHostname')).toBe(false);
    });

    it('loginHostname on auth0.com is an error', () => {
        const config = validBaseConfig({
            authIdentity: { loginHostname: 'tenant.auth0.com' },
        });
        const { errors } = validateConfig(config);
        expect(errors.some((e) => e.field === 'authIdentity.loginHostname')).toBe(true);
    });

    it('clean custom loginHostname does not error', () => {
        const config = validBaseConfig({
            authIdentity: { loginHostname: 'login.partner.com' },
        });
        const { errors } = validateConfig(config);
        expect(errors.some((e) => e.field === 'authIdentity.loginHostname')).toBe(false);
    });

    it('publicBaseUrl on workers.dev is an error', () => {
        const config = validBaseConfig({
            communications: { webhooks: { publicBaseUrl: 'https://my-worker.my-account.workers.dev' } },
        });
        const { errors, warnings } = validateConfig(config);
        expect(errors.some((e) => e.field === 'communications.webhooks.publicBaseUrl')).toBe(true);
        expect(warnings.some((w) => w.field === 'communications.webhooks.publicBaseUrl')).toBe(false);
    });

    it('billingSupportLabel containing "stripe" is an error', () => {
        const config = validBaseConfig({
            billingReseller: { billingSupportLabel: 'Powered by Stripe' },
        });
        const { errors, warnings } = validateConfig(config);
        expect(errors.some((e) => e.field === 'billingReseller.billingSupportLabel')).toBe(true);
        expect(warnings.some((w) => w.field === 'billingReseller.billingSupportLabel')).toBe(false);
    });

    it('clean billing label does not error', () => {
        const config = validBaseConfig({
            billingReseller: { billingSupportLabel: 'Partner Billing' },
        });
        const { errors } = validateConfig(config);
        expect(errors.some((e) => e.field === 'billingReseller.billingSupportLabel')).toBe(false);
    });
});

// ─── Fix #5: schema versioning ───────────────────────────────────────────────

describe('Fix #5 — schema versioning and migrateConfig', () => {
    it('SCHEMA_VERSION is a positive integer', () => {
        expect(typeof SCHEMA_VERSION).toBe('number');
        expect(SCHEMA_VERSION).toBeGreaterThan(0);
    });

    it('mergeWithDefaults stamps schemaVersion on the returned config', () => {
        const config = mergeWithDefaults({
            site: { id: 'x', domain: 'x.com', siteUrl: 'https://x.com', name: 'X' },
        });
        expect(config.schemaVersion).toBe(SCHEMA_VERSION);
    });

    it('migrateConfig stamps v1 on a legacy config with no schemaVersion', () => {
        const legacy = { site: { id: 'old', domain: 'old.com' } };
        const result = migrateConfig(legacy);
        expect(result.migratedFrom).toBe(0);
        expect(result.migratedTo).toBe(1);
        expect(result.didMigrate).toBe(true);
        expect(result.config.schemaVersion).toBe(1);
        expect(result.steps).toHaveLength(1);
    });

    it('migrateConfig is idempotent on a current-version config', () => {
        const current = { site: { id: 'cur' }, schemaVersion: SCHEMA_VERSION };
        const result = migrateConfig(current);
        expect(result.didMigrate).toBe(false);
        expect(result.migratedFrom).toBe(SCHEMA_VERSION);
        expect(result.migratedTo).toBe(SCHEMA_VERSION);
        expect(result.steps).toHaveLength(0);
    });
});

// ─── Fix #6: webhook two-pass sanitizer ──────────────────────────────────────

describe('Fix #6 — webhook sanitizer two-pass: key denylist then scoped value scan', () => {
    it('strips vendor metadata keys unconditionally (Pass 1)', () => {
        const raw = { event: 'user.signup', cfRay: 'abc123', workerId: 'w-xyz', customField: 'hello' };
        const result = sanitizeWebhookPayload(raw, { webhooks: { hideVendorMetadata: true } });
        expect(result.cfRay).toBeUndefined();
        expect(result.workerId).toBeUndefined();
        expect(result.customField).toBe('hello');
    });

    it('strips vendor URL values from known trace/meta keys (Pass 2, scoped)', () => {
        const raw = {
            event: 'user.signup',
            source: 'https://my-worker.workers.dev/handler',   // should be stripped (scan key)
            origin: 'https://app.pages.dev',                   // should be stripped (scan key)
            productDescription: 'Powered by Cloudflare tech',  // should NOT be stripped (not a scan key)
        };
        const result = sanitizeWebhookPayload(raw, { webhooks: { hideVendorMetadata: true } });
        expect(result.source).toBeUndefined();
        expect(result.origin).toBeUndefined();
        // 'productDescription' is not in the scan-candidate key set — must be preserved
        expect(result.productDescription).toBe('Powered by Cloudflare tech');
    });

    it('preserves business data fields whose values happen to contain vendor terms', () => {
        const raw = {
            event: 'billing.plan_upgraded',
            planNote: 'Hosted on Cloudflare infrastructure',  // business field — must be preserved
            requestId: 'abc123-xyz789',                       // not a Ray ID pattern — must be preserved
        };
        const result = sanitizeWebhookPayload(raw, { webhooks: { hideVendorMetadata: true } });
        expect(result.planNote).toBe('Hosted on Cloudflare infrastructure');
        expect(result.requestId).toBe('abc123-xyz789');
    });

    it('strips Cloudflare Ray ID from traceId/rayId fields (Pass 2 trace keys)', () => {
        const raw = {
            event: 'api_request',
            traceId: 'a1b2c3d4e5f60000-a1b2c3d4e5f60000',  // matches Ray ID pattern
            spanId: 'normal-span-id',
        };
        const result = sanitizeWebhookPayload(raw, { webhooks: { hideVendorMetadata: true } });
        expect(result.traceId).toBeUndefined();
        expect(result.spanId).toBe('normal-span-id');
    });
});
