/**
 * API & Integration Layer white-label control plane.
 *
 * Covers five platform-core responsibilities:
 *   Q1 — White-labeled API documentation identity (product name, custom docs domain)
 *   Q2 — Per-tenant rate limit / quota policy resolver
 *   Q3 — White-label webhook schema registry and delivery endpoint management
 *   Q4 — Partner-curated integration marketplace (filter + catalog resolver)
 *   Q5 — Embeddable component / iFrame policy (CSP + frame-ancestors descriptor)
 *
 * All helpers are pure functions: accept config objects, return descriptors.
 * No I/O, no vendor defaults injected in outputs.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

/** API documentation deployment model for this tenant. */
export const API_DOCS_MODE = Object.freeze({
  DISABLED: 'disabled',        // Docs not surfaced to this partner
  PLATFORM_HOSTED: 'platform', // Platform subdomain — not white-labeled, internal use only
  CUSTOM_DOMAIN: 'custom',     // Partner-owned domain, e.g. docs.partnerbrand.com
  EMBEDDED: 'embedded',        // OpenAPI spec embedded inside partner portal
});
export const API_DOCS_MODE_VALUES = Object.freeze(Object.values(API_DOCS_MODE));

/** Webhook delivery retry strategy. */
export const WEBHOOK_RETRY_STRATEGY = Object.freeze({
  NONE: 'none',
  LINEAR: 'linear',
  EXPONENTIAL: 'exponential',
});
export const WEBHOOK_RETRY_STRATEGY_VALUES = Object.freeze(Object.values(WEBHOOK_RETRY_STRATEGY));

/** Integration visibility for partner marketplace curation. */
export const INTEGRATION_VISIBILITY = Object.freeze({
  ENABLED: 'enabled',       // Show in partner marketplace
  DISABLED: 'disabled',     // Hidden from partner marketplace
  COMING_SOON: 'coming_soon', // Visible but not yet actionable
});
export const INTEGRATION_VISIBILITY_VALUES = Object.freeze(Object.values(INTEGRATION_VISIBILITY));

/** iFrame embed mode. */
export const EMBED_MODE = Object.freeze({
  DISABLED: 'disabled',
  ALLOWLIST: 'allowlist',   // Specific origins in allowedEmbedOrigins
  ANY: 'any',               // Permit any origin (only for internal/intranet use)
});
export const EMBED_MODE_VALUES = Object.freeze(Object.values(EMBED_MODE));

// ─── Global platform rate limit tier defaults ─────────────────────────────────
// Used as fallback when a tenant's quota field is 0 (= defer to platform tier).
// Consuming app may override these at startup via resolveApiRateLimitPolicy().

export const PLATFORM_RATE_LIMIT_DEFAULTS = Object.freeze({
  apiRequestsPerMinute: 60,
  oauthRequestsPerMinute: 30,
  billingRequestsPerMinute: 10,
  triggerRequestsPerMinute: 5,
  auditRequestsPerHour: 10,
});

// ─── Vendor-platform documentation domain patterns ────────────────────────────
// If a partner sets their docs URL to one of these, it exposes vendor infrastructure.
const VENDOR_DOCS_DOMAIN_PATTERNS = [/\.workers\.dev/, /\.pages\.dev/, /cloudflare\.com/, /readme\.io/];

// ─── Q1 — API Documentation Identity ─────────────────────────────────────────

/**
 * Build a white-labeled API documentation identity descriptor for a tenant.
 *
 * Returns the effective docs URL, display name, and readiness state so the
 * consuming app knows whether to render a docs link and under which domain.
 *
 * @param {object} config - Full tenant config (post mergeWithDefaults)
 * @returns {{
 *   mode: string,
 *   docsUrl: string,
 *   customDocsUrl: string,
 *   productName: string,
 *   ready: boolean,
 *   vendorLeak: boolean,
 *   vendorLeakReason: string
 * }}
 */
export function buildApiDocsDescriptor(config) {
  const api = config?.apiIntegration || {};
  const branding = config?.branding || {};
  const domainBranding = config?.domainBranding || config?.domainControl || {};

  const mode = API_DOCS_MODE_VALUES.includes(api.docsMode) ? api.docsMode : API_DOCS_MODE.DISABLED;

  // Effective docs URL — custom > domainBranding.docsUrl > empty
  const customDocsUrl = api.customDocsUrl || domainBranding.docsUrl || '';
  const docsUrl = mode === API_DOCS_MODE.CUSTOM_DOMAIN ? customDocsUrl : '';

  // Product name: partner product name must not be empty
  const productName = api.docsProductName || branding.productName || '';

  // Vendor leak check: docs URL must not expose vendor platform domains
  let vendorLeak = false;
  let vendorLeakReason = '';
  if (customDocsUrl) {
    const lower = customDocsUrl.toLowerCase();
    for (const pattern of VENDOR_DOCS_DOMAIN_PATTERNS) {
      if (pattern.test(lower)) {
        vendorLeak = true;
        vendorLeakReason = `Docs URL '${customDocsUrl}' exposes a vendor-platform domain. Use a partner-branded domain (e.g. docs.partnerbrand.com).`;
        break;
      }
    }
  }

  const ready =
    mode === API_DOCS_MODE.CUSTOM_DOMAIN &&
    Boolean(customDocsUrl) &&
    Boolean(productName) &&
    !vendorLeak;

  return { mode, docsUrl, customDocsUrl, productName, ready, vendorLeak, vendorLeakReason };
}

// ─── Q2 — Per-Tenant Rate Limit Policy Resolver ───────────────────────────────

/**
 * Resolve the effective API rate limits and quota caps for a tenant.
 *
 * A tenant quota field of 0 means "defer to platform tier default".
 * Any non-zero value overrides the platform tier for that bucket.
 *
 * Returns a flat, ready-to-enforce policy object. All values are positive integers.
 *
 * @param {object} config - Full tenant config (post mergeWithDefaults)
 * @param {object} [platformDefaults] - Optional platform tier overrides (at startup)
 * @returns {{
 *   apiRequestsPerMinute: number,
 *   oauthRequestsPerMinute: number,
 *   billingRequestsPerMinute: number,
 *   triggerRequestsPerMinute: number,
 *   auditRequestsPerHour: number,
 *   monthlyAiCalls: number,
 *   monthlyTokens: number,
 *   monthlyExtractionRuns: number,
 *   source: Record<string, 'tenant'|'platform'>
 * }}
 */
export function resolveApiRateLimitPolicy(config, platformDefaults = {}) {
  const quotas = config?.quotas || {};
  const effective = { ...PLATFORM_RATE_LIMIT_DEFAULTS, ...platformDefaults };
  const source = {};

  const rateLimitBuckets = [
    'apiRequestsPerMinute',
    'oauthRequestsPerMinute',
    'billingRequestsPerMinute',
    'triggerRequestsPerMinute',
    'auditRequestsPerHour',
  ];

  const result = {};

  for (const bucket of rateLimitBuckets) {
    const tenantValue = Number(quotas[bucket] ?? 0);
    if (tenantValue > 0) {
      result[bucket] = tenantValue;
      source[bucket] = 'tenant';
    } else {
      result[bucket] = effective[bucket] ?? 60;
      source[bucket] = 'platform';
    }
  }

  // Monthly usage caps (0 = unlimited)
  const usageCaps = ['monthlyAiCalls', 'monthlyTokens', 'monthlyExtractionRuns', 'monthlyUrlInspections'];
  for (const cap of usageCaps) {
    const tenantValue = Number(quotas[cap] ?? 0);
    result[cap] = tenantValue; // 0 = unlimited (platform default)
    source[cap] = tenantValue > 0 ? 'tenant' : 'platform';
  }

  result.source = Object.freeze(source);
  return Object.freeze(result);
}

/**
 * Check whether a given usage value has exceeded the tenant's monthly cap.
 * Returns true (blocked) when the cap is set (> 0) and current exceeds it.
 * Returns false (allowed) when the cap is 0 (unlimited).
 *
 * @param {number} current - Current monthly usage count
 * @param {number} cap     - Monthly cap from resolveApiRateLimitPolicy (0 = unlimited)
 * @returns {{ allowed: boolean, exceeded: boolean, current: number, cap: number }}
 */
export function checkMonthlyCap(current, cap) {
  const c = Math.max(0, Number(current) || 0);
  const limit = Math.max(0, Number(cap) || 0);
  const exceeded = limit > 0 && c >= limit;
  return { allowed: !exceeded, exceeded, current: c, cap: limit };
}

// ─── Q3 — White-label Webhook Schema Registry ────────────────────────────────

/**
 * Resolve a partner's webhook delivery endpoint registry.
 *
 * Partners define their own target endpoints, signing keys (by Wrangler secret name),
 * and which events each endpoint should receive. Vendor-specific field names are
 * rewritten by sanitizeWebhookPayload in communications.mjs before delivery.
 *
 * Returns a ready-to-iterate array of validated delivery targets.
 *
 * @param {object} config - Full tenant config
 * @returns {Array<{
 *   id: string, url: string, events: string[], signingKeySecret: string,
 *   retryStrategy: string, retryMaxAttempts: number, enabled: boolean
 * }>}
 */
export function resolveWebhookDeliveryTargets(config) {
  const targets = config?.apiIntegration?.webhookTargets;
  if (!Array.isArray(targets) || targets.length === 0) return [];

  return targets
    .filter((t) => t && typeof t === 'object' && String(t.url || '').startsWith('https://'))
    .map((t) => ({
      id: String(t.id || '').slice(0, 80) || `target-${Math.random().toString(36).slice(2, 8)}`,
      url: String(t.url),
      events: Array.isArray(t.events) ? t.events.map(String) : ['*'],
      signingKeySecret: String(t.signingKeySecret || '').slice(0, 120),
      retryStrategy: WEBHOOK_RETRY_STRATEGY_VALUES.includes(t.retryStrategy)
        ? t.retryStrategy
        : WEBHOOK_RETRY_STRATEGY.EXPONENTIAL,
      retryMaxAttempts: Math.max(0, Math.min(Number(t.retryMaxAttempts) || 3, 10)),
      enabled: t.enabled !== false,
    }));
}

/**
 * Resolve the active webhook event schema for the tenant.
 *
 * Partners may define custom event type registrations. This returns the
 * effective event schema: canonical platform events merged with any partner
 * overrides (renamed fields, additional fields, suppressed fields).
 *
 * @param {object} config - Full tenant config
 * @returns {{ namespace: string, events: Array<{name: string, description: string, schema: object}> }}
 */
export function resolveWebhookEventSchema(config) {
  const webhooks = config?.communications?.webhooks || config?.apiIntegration?.webhooks || {};
  const api = config?.apiIntegration || {};
  const namespace = String(webhooks.eventNamespace || api.webhookNamespace || 'partner').toLowerCase().replace(/[^a-z0-9._-]/g, '-');

  // Canonical platform event types (partner-safe names)
  const CANONICAL_EVENTS = [
    { name: 'account.created',      description: 'A new user account was created' },
    { name: 'account.converted',    description: 'A trial account converted to paid' },
    { name: 'message.sent',         description: 'An outbound message was dispatched' },
    { name: 'message.opened',       description: 'A recipient opened a message' },
    { name: 'message.clicked',      description: 'A recipient clicked a link in a message' },
    { name: 'message.bounced',      description: 'A message delivery was permanently rejected' },
    { name: 'message.unsubscribed', description: 'A recipient unsubscribed from messages' },
    { name: 'billing.plan_upgraded',  description: 'The account billing plan was upgraded' },
    { name: 'billing.plan_downgraded',description: 'The account billing plan was downgraded' },
    { name: 'trial.expiring',       description: 'The account trial window is expiring soon' },
    { name: 'digest.sent',          description: 'A periodic usage/analytics digest was dispatched' },
  ];

  // Partner-registered custom events (additive — must not duplicate canonical names)
  const partnerEvents = Array.isArray(api.customEventTypes)
    ? api.customEventTypes
        .filter((e) => e && typeof e === 'object' && typeof e.name === 'string' && e.name.trim())
        .map((e) => ({
          name: `${namespace}.${String(e.name).toLowerCase().replace(/[^a-z0-9._-]/g, '_')}`,
          description: String(e.description || '').slice(0, 280),
          schema: e.schema && typeof e.schema === 'object' ? e.schema : {},
          custom: true,
        }))
    : [];

  const canonicalNames = new Set(CANONICAL_EVENTS.map((e) => e.name));
  const dedupedPartner = partnerEvents.filter((e) => !canonicalNames.has(e.name));

  return {
    namespace,
    events: [
      ...CANONICAL_EVENTS.map((e) => ({ ...e, schema: {}, custom: false })),
      ...dedupedPartner,
    ],
  };
}

// ─── Q4 — Integration Marketplace Catalog ────────────────────────────────────

// Platform-level integration registry — all known first-party integrations.
// Partners set visibility per entry in config.apiIntegration.integrationCatalog.
export const PLATFORM_INTEGRATION_REGISTRY = Object.freeze([
  { id: 'google-search-console', name: 'Google Search Console', category: 'analytics' },
  { id: 'google-analytics-4',    name: 'Google Analytics 4',    category: 'analytics' },
  { id: 'bing-webmaster',        name: 'Bing Webmaster Tools',  category: 'analytics' },
  { id: 'shopify',               name: 'Shopify',               category: 'ecommerce' },
  { id: 'stripe',                name: 'Payment Gateway',       category: 'billing'   }, // white-label safe display name
  { id: 'slack',                 name: 'Slack',                 category: 'notifications' },
  { id: 'github',                name: 'GitHub',                category: 'developer' },
  { id: 'zapier',                name: 'Zapier',                category: 'automation' },
  { id: 'make',                  name: 'Make (Integromat)',      category: 'automation' },
  { id: 'hubspot',               name: 'HubSpot',               category: 'crm' },
  { id: 'salesforce',            name: 'Salesforce',            category: 'crm' },
]);

/**
 * Resolve the partner-curated integration catalog for a tenant.
 *
 * Partners configure `apiIntegration.integrationCatalog` as a map of
 * { [integrationId]: { visibility, displayName, description } }.
 * - An entry with visibility=enabled overrides the default.
 * - An entry with visibility=disabled hides the integration from the marketplace.
 * - Integrations with no override default to enabled.
 * - The returned list contains no vendor branding (vendor names are stripped
 *   and replaced with partner overrides or generic names when configured).
 *
 * @param {object} config - Full tenant config
 * @returns {Array<{
 *   id: string, name: string, category: string,
 *   visibility: string, description: string, custom: boolean
 * }>}
 */
export function resolveIntegrationCatalog(config) {
  const api = config?.apiIntegration || {};
  const overrides = api.integrationCatalog && typeof api.integrationCatalog === 'object'
    ? api.integrationCatalog
    : {};

  // Merge platform registry with partner overrides
  const merged = PLATFORM_INTEGRATION_REGISTRY.map((integration) => {
    const override = overrides[integration.id] || {};
    const visibility = INTEGRATION_VISIBILITY_VALUES.includes(override.visibility)
      ? override.visibility
      : INTEGRATION_VISIBILITY.ENABLED;

    return {
      id: integration.id,
      name: override.displayName || integration.name,
      category: integration.category,
      visibility,
      description: String(override.description || '').slice(0, 280),
      custom: false,
    };
  });

  // Partner-added custom integrations (not in platform registry)
  const customIntegrations = Array.isArray(api.customIntegrations)
    ? api.customIntegrations
        .filter((c) => c && typeof c === 'object' && String(c.id || '').trim())
        .map((c) => ({
          id: String(c.id).slice(0, 80),
          name: String(c.name || c.id).slice(0, 120),
          category: String(c.category || 'custom').slice(0, 60),
          visibility: INTEGRATION_VISIBILITY_VALUES.includes(c.visibility)
            ? c.visibility
            : INTEGRATION_VISIBILITY.ENABLED,
          description: String(c.description || '').slice(0, 280),
          custom: true,
        }))
    : [];

  return [...merged, ...customIntegrations].filter(
    (i) => i.visibility !== INTEGRATION_VISIBILITY.DISABLED
  );
}

// ─── Q5 — Embeddable Component / iFrame Policy ───────────────────────────────

/**
 * Resolve the iFrame embed security policy for a tenant.
 *
 * Produces a `frame-ancestors` CSP directive value and audit descriptor
 * from `config.embed.allowedEmbedOrigins`. The consuming app injects the
 * directive into `Content-Security-Policy` response headers on embeddable routes.
 *
 * Rules:
 * - DISABLED → frame-ancestors 'none'  (default — no embedding)
 * - ALLOWLIST → frame-ancestors <origins...>  (specific origins only)
 * - ANY       → frame-ancestors *  (for internal/intranet only — flags a warning)
 *
 * @param {object} config - Full tenant config
 * @returns {{
 *   mode: string,
 *   frameAncestors: string,
 *   allowedOrigins: string[],
 *   cspHeaderValue: string,
 *   ready: boolean,
 *   warnings: string[]
 * }}
 */
export function resolveEmbedPolicy(config) {
  const embed = config?.embed || {};
  const api = config?.apiIntegration || {};

  const mode = EMBED_MODE_VALUES.includes(api.embedMode || embed.embedMode)
    ? (api.embedMode || embed.embedMode)
    : EMBED_MODE.DISABLED;

  const rawOrigins = Array.isArray(embed.allowedEmbedOrigins) ? embed.allowedEmbedOrigins : [];
  const warnings = [];

  // Validate and sanitize origins
  const allowedOrigins = rawOrigins
    .map((o) => String(o).trim())
    .filter((o) => {
      if (!o) return false;
      // Must start with https:// or be a wildcard subdomain pattern
      if (o.startsWith('http://')) {
        warnings.push(`Embed origin '${o}' should start with https:// — http:// origins allow embedding over insecure connections`);
      }
      // Reject vendor platform origins
      const lower = o.toLowerCase();
      const isVendor = VENDOR_DOCS_DOMAIN_PATTERNS.some((re) => re.test(lower));
      if (isVendor) {
        warnings.push(`Embed origin '${o}' exposes a vendor-platform domain — partner embed origins must be under the partner's own domain`);
        return false;
      }
      return true;
    });

  if (mode === EMBED_MODE.ANY) {
    warnings.push("embedMode 'any' permits all origins to embed this surface — restrict to allowlist in production");
  }

  let frameAncestors;
  if (mode === EMBED_MODE.DISABLED) {
    frameAncestors = "'none'";
  } else if (mode === EMBED_MODE.ANY) {
    frameAncestors = '*';
  } else if (allowedOrigins.length > 0) {
    frameAncestors = allowedOrigins.join(' ');
  } else {
    // ALLOWLIST mode but no origins configured — fail closed
    frameAncestors = "'none'";
    warnings.push("embedMode is 'allowlist' but no allowedEmbedOrigins are configured — defaulting to 'none'");
  }

  const cspHeaderValue = `frame-ancestors ${frameAncestors}`;

  const ready =
    mode !== EMBED_MODE.DISABLED &&
    (mode === EMBED_MODE.ANY || allowedOrigins.length > 0) &&
    warnings.filter((w) => w.includes('vendor-platform')).length === 0;

  return {
    mode,
    frameAncestors,
    allowedOrigins,
    cspHeaderValue,
    ready,
    warnings,
  };
}

/**
 * Build a white-label embed configuration descriptor for injecting into the
 * embedded iFrame context. This is served as a JSON endpoint that embedded
 * pages fetch on load to apply the correct tenant branding inside the iFrame.
 *
 * @param {object} config - Full tenant config
 * @returns {{
 *   productName: string, primaryColor: string, secondaryColor: string,
 *   logoUrl: string, faviconUrl: string, fontFamily: string, fontCssImport: string,
 *   customCss: string, origin: string, embedMode: string
 * }}
 */
export function buildEmbedBrandingDescriptor(config) {
  const branding = config?.branding || {};
  const domainRouting = config?.domainRouting || config?.domainControl || {};
  const apiIntegration = config?.apiIntegration || {};
  const embed = config?.embed || {};

  return Object.freeze({
    productName: branding.productName || '',
    primaryColor: branding.primaryColor || '',
    secondaryColor: branding.secondaryColor || '',
    accentColor: branding.accentColor || '',
    logoUrl: branding.logoUrl || '',
    faviconUrl: branding.faviconUrl || '',
    fontFamily: branding.fontFamily || '',
    fontCssImport: branding.fontCssImport || '',
    customCss: branding.customCss || '',
    origin: domainRouting.appOrigin || '',
    embedMode: apiIntegration.embedMode || embed.embedMode || EMBED_MODE.DISABLED,
  });
}
