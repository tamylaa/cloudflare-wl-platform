/**
 * API & Integration Layer — white-label unit tests
 *
 * Covers five question areas:
 *   Q1  buildApiDocsDescriptor      — docs identity + vendor-leak detection
 *   Q2  resolveApiRateLimitPolicy   — per-tenant quota + platform defaults
 *       checkMonthlyCap             — monthly budget enforcement
 *   Q3  resolveWebhookDeliveryTargets — endpoint registry validation
 *       resolveWebhookEventSchema     — canonical + partner-custom events
 *   Q4  resolveIntegrationCatalog   — partner-curated marketplace filter
 *   Q5  resolveEmbedPolicy          — CSP frame-ancestors descriptor
 *       buildEmbedBrandingDescriptor — branding context inside embed
 */

import { describe, it, expect } from 'vitest';
import {
  buildApiDocsDescriptor,
  resolveApiRateLimitPolicy,
  checkMonthlyCap,
  resolveWebhookDeliveryTargets,
  resolveWebhookEventSchema,
  resolveIntegrationCatalog,
  resolveEmbedPolicy,
  buildEmbedBrandingDescriptor,
  API_DOCS_MODE,
  EMBED_MODE,
  INTEGRATION_VISIBILITY,
  PLATFORM_RATE_LIMIT_DEFAULTS,
} from '../../src/config/api-integration.mjs';

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeConfig(overrides = {}) {
  return {
    branding: { productName: 'AcmeSEO', primaryColor: '#3B5BDB', logoUrl: 'https://cdn.acme.com/logo.svg', ...overrides.branding },
    domainRouting: { appHostname: 'app.acme.com', appOrigin: 'https://app.acme.com', ...overrides.domainRouting },
    quotas: { apiRequestsPerMinute: 120, monthlyAiCalls: 0, ...overrides.quotas },
    communications: { webhooks: { eventNamespace: 'acme', ...overrides.communicationsWebhooks } },
    embed: { allowedEmbedOrigins: [], ...overrides.embed },
    apiIntegration: {
      docsMode: API_DOCS_MODE.DISABLED,
      customDocsUrl: '',
      docsProductName: '',
      webhookTargets: [],
      customEventTypes: [],
      webhookNamespace: '',
      integrationCatalog: {},
      customIntegrations: [],
      embedMode: EMBED_MODE.DISABLED,
      ...overrides.apiIntegration,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Q1 — API Documentation Identity
// ─────────────────────────────────────────────────────────────────────────────

describe('buildApiDocsDescriptor — Q1', () => {
  it('returns disabled mode when docsMode is disabled', () => {
    const desc = buildApiDocsDescriptor(makeConfig());
    expect(desc.mode).toBe(API_DOCS_MODE.DISABLED);
    expect(desc.ready).toBe(false);
    expect(desc.docsUrl).toBe('');
  });

  it('returns ready descriptor for custom domain mode', () => {
    const config = makeConfig({
      apiIntegration: {
        docsMode: API_DOCS_MODE.CUSTOM_DOMAIN,
        customDocsUrl: 'https://docs.acme.com',
        docsProductName: 'AcmeSEO API',
      },
    });
    const desc = buildApiDocsDescriptor(config);
    expect(desc.mode).toBe(API_DOCS_MODE.CUSTOM_DOMAIN);
    expect(desc.docsUrl).toBe('https://docs.acme.com');
    expect(desc.productName).toBe('AcmeSEO API');
    expect(desc.ready).toBe(true);
    expect(desc.vendorLeak).toBe(false);
  });

  it('falls back to branding.productName when docsProductName is empty', () => {
    const config = makeConfig({
      apiIntegration: {
        docsMode: API_DOCS_MODE.CUSTOM_DOMAIN,
        customDocsUrl: 'https://docs.acme.com',
        docsProductName: '',
      },
    });
    const desc = buildApiDocsDescriptor(config);
    expect(desc.productName).toBe('AcmeSEO');
  });

  it('flags vendorLeak when customDocsUrl is a workers.dev domain', () => {
    const config = makeConfig({
      apiIntegration: {
        docsMode: API_DOCS_MODE.CUSTOM_DOMAIN,
        customDocsUrl: 'https://my-platform.workers.dev/docs',
      },
    });
    const desc = buildApiDocsDescriptor(config);
    expect(desc.vendorLeak).toBe(true);
    expect(desc.ready).toBe(false);
    expect(desc.vendorLeakReason).toMatch(/vendor-platform domain/);
  });

  it('flags vendorLeak when customDocsUrl is a pages.dev domain', () => {
    const config = makeConfig({
      apiIntegration: {
        docsMode: API_DOCS_MODE.CUSTOM_DOMAIN,
        customDocsUrl: 'https://my-docs.pages.dev',
      },
    });
    const desc = buildApiDocsDescriptor(config);
    expect(desc.vendorLeak).toBe(true);
  });

  it('not ready when docsMode is custom but no URL provided', () => {
    const config = makeConfig({
      apiIntegration: { docsMode: API_DOCS_MODE.CUSTOM_DOMAIN, customDocsUrl: '', docsProductName: 'X' },
    });
    const desc = buildApiDocsDescriptor(config);
    expect(desc.ready).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Q2 — Per-Tenant Rate Limit Policy
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveApiRateLimitPolicy — Q2', () => {
  it('uses tenant quota when set', () => {
    const config = makeConfig({ quotas: { apiRequestsPerMinute: 200, oauthRequestsPerMinute: 60 } });
    const policy = resolveApiRateLimitPolicy(config);
    expect(policy.apiRequestsPerMinute).toBe(200);
    expect(policy.oauthRequestsPerMinute).toBe(60);
    expect(policy.source.apiRequestsPerMinute).toBe('tenant');
  });

  it('falls back to platform defaults when tenant quota is 0', () => {
    const config = makeConfig({ quotas: { apiRequestsPerMinute: 0 } });
    const policy = resolveApiRateLimitPolicy(config);
    expect(policy.apiRequestsPerMinute).toBe(PLATFORM_RATE_LIMIT_DEFAULTS.apiRequestsPerMinute);
    expect(policy.source.apiRequestsPerMinute).toBe('platform');
  });

  it('platform defaults can be overridden at startup', () => {
    const config = makeConfig({ quotas: { apiRequestsPerMinute: 0 } });
    const policy = resolveApiRateLimitPolicy(config, { apiRequestsPerMinute: 300 });
    expect(policy.apiRequestsPerMinute).toBe(300);
  });

  it('monthly budgets are 0 (unlimited) by default', () => {
    const config = makeConfig({ quotas: { monthlyAiCalls: 0 } });
    const policy = resolveApiRateLimitPolicy(config);
    expect(policy.monthlyAiCalls).toBe(0);
    expect(policy.source.monthlyAiCalls).toBe('platform');
  });

  it('tenant monthly cap overrides platform unlimited', () => {
    const config = makeConfig({ quotas: { monthlyAiCalls: 5000 } });
    const policy = resolveApiRateLimitPolicy(config);
    expect(policy.monthlyAiCalls).toBe(5000);
    expect(policy.source.monthlyAiCalls).toBe('tenant');
  });

  it('returns frozen object', () => {
    const policy = resolveApiRateLimitPolicy(makeConfig());
    expect(Object.isFrozen(policy)).toBe(true);
  });
});

describe('checkMonthlyCap — Q2', () => {
  it('allows when cap is 0 (unlimited)', () => {
    expect(checkMonthlyCap(99999, 0).allowed).toBe(true);
    expect(checkMonthlyCap(99999, 0).exceeded).toBe(false);
  });

  it('blocks when current reaches cap', () => {
    expect(checkMonthlyCap(1000, 1000).allowed).toBe(false);
    expect(checkMonthlyCap(1000, 1000).exceeded).toBe(true);
  });

  it('allows when current is below cap', () => {
    expect(checkMonthlyCap(500, 1000).allowed).toBe(true);
  });

  it('handles negative current gracefully', () => {
    const r = checkMonthlyCap(-5, 100);
    expect(r.current).toBe(0);
    expect(r.allowed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Q3 — White-label Webhook Delivery Targets & Event Schema
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveWebhookDeliveryTargets — Q3', () => {
  it('returns empty array when no targets configured', () => {
    expect(resolveWebhookDeliveryTargets(makeConfig())).toEqual([]);
  });

  it('includes valid HTTPS target', () => {
    const config = makeConfig({
      apiIntegration: {
        webhookTargets: [
          { id: 'wh-1', url: 'https://hooks.acme.com/events', events: ['account.created'], enabled: true },
        ],
      },
    });
    const targets = resolveWebhookDeliveryTargets(config);
    expect(targets).toHaveLength(1);
    expect(targets[0].url).toBe('https://hooks.acme.com/events');
    expect(targets[0].events).toEqual(['account.created']);
  });

  it('excludes non-HTTPS target URL', () => {
    const config = makeConfig({
      apiIntegration: {
        webhookTargets: [
          { id: 'bad', url: 'http://insecure.example.com/hook', events: ['*'] },
        ],
      },
    });
    const targets = resolveWebhookDeliveryTargets(config);
    expect(targets).toHaveLength(0);
  });

  it('defaults retryStrategy to exponential', () => {
    const config = makeConfig({
      apiIntegration: {
        webhookTargets: [{ url: 'https://hooks.acme.com/ev' }],
      },
    });
    const targets = resolveWebhookDeliveryTargets(config);
    expect(targets[0].retryStrategy).toBe('exponential');
  });

  it('caps retryMaxAttempts at 10', () => {
    const config = makeConfig({
      apiIntegration: {
        webhookTargets: [{ url: 'https://hooks.acme.com/ev', retryMaxAttempts: 99 }],
      },
    });
    const targets = resolveWebhookDeliveryTargets(config);
    expect(targets[0].retryMaxAttempts).toBe(10);
  });

  it('defaults enabled to true when not specified', () => {
    const config = makeConfig({
      apiIntegration: { webhookTargets: [{ url: 'https://hooks.acme.com/ev' }] },
    });
    expect(resolveWebhookDeliveryTargets(config)[0].enabled).toBe(true);
  });
});

describe('resolveWebhookEventSchema — Q3', () => {
  it('includes all canonical platform events', () => {
    const { events } = resolveWebhookEventSchema(makeConfig());
    const names = events.map((e) => e.name);
    expect(names).toContain('account.created');
    expect(names).toContain('message.sent');
    expect(names).toContain('billing.plan_upgraded');
  });

  it('uses namespace from communications.webhooks.eventNamespace', () => {
    const { namespace } = resolveWebhookEventSchema(makeConfig());
    expect(namespace).toBe('acme');
  });

  it('adds partner custom events with namespace prefix', () => {
    const config = makeConfig({
      apiIntegration: {
        customEventTypes: [{ name: 'report_generated', description: 'A PDF report was created' }],
      },
    });
    const { events } = resolveWebhookEventSchema(config);
    const custom = events.filter((e) => e.custom);
    expect(custom).toHaveLength(1);
    expect(custom[0].name).toMatch(/acme\.report_generated/);
    expect(custom[0].description).toBe('A PDF report was created');
  });

  it('deduplicates custom events that collide with canonical names', () => {
    const config = makeConfig({
      apiIntegration: {
        customEventTypes: [{ name: 'account.created', description: 'dup' }],
      },
    });
    const { events } = resolveWebhookEventSchema(config);
    const matches = events.filter((e) => e.name === 'account.created');
    expect(matches).toHaveLength(1);
    expect(matches[0].custom).toBe(false);
  });

  it('sanitizes custom event names to safe chars', () => {
    const config = makeConfig({
      apiIntegration: {
        customEventTypes: [{ name: 'USER SIGNED UP', description: '' }],
      },
    });
    const { events } = resolveWebhookEventSchema(config);
    const custom = events.filter((e) => e.custom);
    expect(custom[0].name).not.toMatch(/\s/);
    expect(custom[0].name).not.toMatch(/[A-Z]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Q4 — Integration Marketplace Catalog
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveIntegrationCatalog — Q4', () => {
  it('returns all platform integrations as enabled by default', () => {
    const catalog = resolveIntegrationCatalog(makeConfig());
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.every((e) => e.visibility !== INTEGRATION_VISIBILITY.DISABLED)).toBe(true);
  });

  it('applies partner display name override', () => {
    const config = makeConfig({
      apiIntegration: {
        integrationCatalog: {
          'stripe': { displayName: 'Acme Payments', visibility: 'enabled' },
        },
      },
    });
    const catalog = resolveIntegrationCatalog(config);
    const entry = catalog.find((e) => e.id === 'stripe');
    expect(entry.name).toBe('Acme Payments');
  });

  it('hides disabled integrations', () => {
    const config = makeConfig({
      apiIntegration: {
        integrationCatalog: {
          'zapier': { visibility: 'disabled' },
        },
      },
    });
    const catalog = resolveIntegrationCatalog(config);
    expect(catalog.find((e) => e.id === 'zapier')).toBeUndefined();
  });

  it('includes custom partner integrations', () => {
    const config = makeConfig({
      apiIntegration: {
        customIntegrations: [
          { id: 'acme-crm', name: 'Acme CRM', category: 'crm', visibility: 'enabled', description: 'Partner CRM' },
        ],
      },
    });
    const catalog = resolveIntegrationCatalog(config);
    const custom = catalog.find((e) => e.id === 'acme-crm');
    expect(custom).toBeDefined();
    expect(custom.custom).toBe(true);
    expect(custom.name).toBe('Acme CRM');
  });

  it('custom integration with no visibility defaults to enabled', () => {
    const config = makeConfig({
      apiIntegration: {
        customIntegrations: [{ id: 'my-tool', name: 'My Tool' }],
      },
    });
    const catalog = resolveIntegrationCatalog(config);
    const entry = catalog.find((e) => e.id === 'my-tool');
    expect(entry).toBeDefined();
    expect(entry.visibility).toBe(INTEGRATION_VISIBILITY.ENABLED);
  });

  it('coming_soon entries are included (not filtered out)', () => {
    const config = makeConfig({
      apiIntegration: {
        integrationCatalog: { 'github': { visibility: 'coming_soon' } },
      },
    });
    const catalog = resolveIntegrationCatalog(config);
    const entry = catalog.find((e) => e.id === 'github');
    expect(entry).toBeDefined();
    expect(entry.visibility).toBe(INTEGRATION_VISIBILITY.COMING_SOON);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Q5 — Embeddable Component / iFrame Policy
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveEmbedPolicy — Q5', () => {
  it('disables embedding by default', () => {
    const policy = resolveEmbedPolicy(makeConfig());
    expect(policy.mode).toBe(EMBED_MODE.DISABLED);
    expect(policy.frameAncestors).toBe("'none'");
    expect(policy.ready).toBe(false);
  });

  it('produces frame-ancestors with allowlist origins', () => {
    const config = makeConfig({
      embed: { allowedEmbedOrigins: ['https://app.acme.com', 'https://portal.acme.com'] },
      apiIntegration: { embedMode: EMBED_MODE.ALLOWLIST },
    });
    const policy = resolveEmbedPolicy(config);
    expect(policy.frameAncestors).toContain('https://app.acme.com');
    expect(policy.frameAncestors).toContain('https://portal.acme.com');
    expect(policy.ready).toBe(true);
  });

  it('cspHeaderValue is correct Content-Security-Policy directive', () => {
    const config = makeConfig({
      embed: { allowedEmbedOrigins: ['https://app.acme.com'] },
      apiIntegration: { embedMode: EMBED_MODE.ALLOWLIST },
    });
    const policy = resolveEmbedPolicy(config);
    expect(policy.cspHeaderValue).toMatch(/^frame-ancestors /);
  });

  it("allowlist mode with no origins defaults frame-ancestors to 'none'", () => {
    const config = makeConfig({
      embed: { allowedEmbedOrigins: [] },
      apiIntegration: { embedMode: EMBED_MODE.ALLOWLIST },
    });
    const policy = resolveEmbedPolicy(config);
    expect(policy.frameAncestors).toBe("'none'");
    expect(policy.ready).toBe(false);
    expect(policy.warnings.some((w) => w.includes('no allowedEmbedOrigins'))).toBe(true);
  });

  it("'any' mode produces frame-ancestors * and warns", () => {
    const config = makeConfig({
      apiIntegration: { embedMode: EMBED_MODE.ANY },
    });
    const policy = resolveEmbedPolicy(config);
    expect(policy.frameAncestors).toBe('*');
    expect(policy.warnings.some((w) => w.includes("'any'"))).toBe(true);
  });

  it('strips vendor-platform origins from allowedOrigins', () => {
    const config = makeConfig({
      embed: { allowedEmbedOrigins: ['https://app.acme.com', 'https://my-app.workers.dev'] },
      apiIntegration: { embedMode: EMBED_MODE.ALLOWLIST },
    });
    const policy = resolveEmbedPolicy(config);
    expect(policy.allowedOrigins).not.toContain('https://my-app.workers.dev');
    expect(policy.warnings.some((w) => w.includes('vendor-platform domain'))).toBe(true);
  });

  it('warns on http:// origins but does not remove them', () => {
    const config = makeConfig({
      embed: { allowedEmbedOrigins: ['http://app.acme.com'] },
      apiIntegration: { embedMode: EMBED_MODE.ALLOWLIST },
    });
    const policy = resolveEmbedPolicy(config);
    // http:// origins pass the filter (just a warning, not removed)
    expect(policy.allowedOrigins).toContain('http://app.acme.com');
    expect(policy.warnings.some((w) => w.includes('http://'))).toBe(true);
  });
});

describe('buildEmbedBrandingDescriptor — Q5', () => {
  it('returns all partner branding fields', () => {
    const config = makeConfig({
      branding: {
        productName: 'AcmeSEO',
        primaryColor: '#3B5BDB',
        secondaryColor: '#228BE6',
        logoUrl: 'https://cdn.acme.com/logo.svg',
        faviconUrl: 'https://cdn.acme.com/fav.ico',
      },
    });
    const desc = buildEmbedBrandingDescriptor(config);
    expect(desc.productName).toBe('AcmeSEO');
    expect(desc.primaryColor).toBe('#3B5BDB');
    expect(desc.logoUrl).toBe('https://cdn.acme.com/logo.svg');
    expect(desc.faviconUrl).toBe('https://cdn.acme.com/fav.ico');
  });

  it('returns origin from domainRouting', () => {
    const config = makeConfig({ domainRouting: { appOrigin: 'https://app.acme.com' } });
    const desc = buildEmbedBrandingDescriptor(config);
    expect(desc.origin).toBe('https://app.acme.com');
  });

  it('returns frozen object', () => {
    const desc = buildEmbedBrandingDescriptor(makeConfig());
    expect(Object.isFrozen(desc)).toBe(true);
  });

  it('embedMode reflects config.apiIntegration.embedMode', () => {
    const config = makeConfig({ apiIntegration: { embedMode: EMBED_MODE.ALLOWLIST } });
    const desc = buildEmbedBrandingDescriptor(config);
    expect(desc.embedMode).toBe(EMBED_MODE.ALLOWLIST);
  });
});
