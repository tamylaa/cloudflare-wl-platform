/**
 * Partner Ops & Support white-label control plane.
 *
 * Covers five platform-core responsibilities:
 *   Q1 — Partner admin portal: dedicated, partner-branded reseller management hub
 *   Q2 — White-label support experience: help centre, tickets, status page
 *   Q3 — Sandbox / staging environment per partner, isolated from production
 *   Q4 — SLA-backed uptime guarantees + vendor-neutral incident reporting
 *   Q5 — White-label partner documentation identity
 *
 * All helpers are pure functions: accept config objects, return descriptors.
 * No I/O, no vendor defaults injected into any output surface.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

/** Deployment environment classification for a tenant config. */
export const PARTNER_ENV = Object.freeze({
  PRODUCTION: 'production',
  SANDBOX:    'sandbox',
  STAGING:    'staging',
  PREVIEW:    'preview',
});
export const PARTNER_ENV_VALUES = Object.freeze(Object.values(PARTNER_ENV));

/** SLA tier — determines penalty and notification obligations. */
export const SLA_TIER = Object.freeze({
  NONE:         'none',         // No contractual SLA commitment
  STANDARD:     'standard',     // Best-effort, no financial penalty
  BUSINESS:     'business',     // 99.9% with notification obligations
  ENTERPRISE:   'enterprise',   // 99.95% with credit obligations
  MISSION_CRITICAL: 'mission_critical', // 99.99% with penalty clauses
});
export const SLA_TIER_VALUES = Object.freeze(Object.values(SLA_TIER));

/** Partner documentation publishing model. */
export const PARTNER_DOCS_MODE = Object.freeze({
  DISABLED:  'disabled',    // No docs surfaced
  BRANDED:   'branded',     // Published under partner brand (custom domain)
  UNBRANDED: 'unbranded',   // Generic / white-label content, no vendor attribution
  PRIVATE:   'private',     // Partner-internal only (behind auth)
});
export const PARTNER_DOCS_MODE_VALUES = Object.freeze(Object.values(PARTNER_DOCS_MODE));

/** Support ticket system model. */
export const SUPPORT_SYSTEM = Object.freeze({
  DISABLED:    'disabled',    // Partner does not surface a ticketing link
  EMAIL_ONLY:  'email_only',  // Support via email alias only
  CUSTOM_PORTAL: 'custom_portal', // Partner-hosted or white-labeled support portal
  EXTERNAL:    'external',    // External system (HelpScout, Zendesk) with custom domain
});
export const SUPPORT_SYSTEM_VALUES = Object.freeze(Object.values(SUPPORT_SYSTEM));

// ─── Vendor domain patterns ──────────────────────────────────────────────────
// Any partner-visible URL that matches these leaks vendor infrastructure.
const VENDOR_DOMAIN_PATTERNS = [
  /\.workers\.dev/,
  /\.pages\.dev/,
  /cloudflare\.com/,
  /clodo\.io/,
  /readme\.io/,
  /statuspage\.io/,   // Atlassian StatusPage — leaks vendor ops
  /atlassian\.com/,
  /zendesk\.com/,     // Zendesk — leaks support vendor
  /helpscout\.net/,
  /freshdesk\.com/,
  /intercom\.io/,
  /crisp\.chat/,
];

// Vendor brand terms that must not appear in partner-visible support identity fields
const VENDOR_BRAND_TERMS = [
  'cloudflare', 'workers', 'clodo', 'anthropic', 'claude', 'zendesk', 'statuspage',
];

function isVendorUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  return VENDOR_DOMAIN_PATTERNS.some((re) => re.test(lower));
}

function containsVendorBrandTerm(str) {
  if (!str || typeof str !== 'string') return null;
  const lower = str.toLowerCase();
  return VENDOR_BRAND_TERMS.find((t) => lower.includes(t)) || null;
}

// ─── Q1 — Partner Admin Portal ───────────────────────────────────────────────

/**
 * Build a descriptor for the partner admin portal — the dedicated hub where
 * resellers manage all their end-client tenants, configure branding, view
 * usage dashboards, and handle billing.
 *
 * The portal must be accessible at a partner-branded URL, not the platform
 * vendor's domain. Capabilities are derived from which config sections are set.
 *
 * @param {object} config - Full tenant config (post mergeWithDefaults)
 * @returns {{
 *   enabled: boolean,
 *   portalUrl: string,
 *   productName: string,
 *   capabilities: string[],
 *   ready: boolean,
 *   vendorLeak: boolean,
 *   vendorLeakReason: string
 * }}
 */
export function buildAdminPortalDescriptor(config) {
  const ops = config?.partnerOps || {};
  const branding = config?.branding || {};

  const enabled = Boolean(ops.adminPortalEnabled);
  const portalUrl = String(ops.adminPortalUrl || '').trim();
  const productName = String(ops.adminPortalProductName || branding.productName || '').trim();

  // Derive which management capabilities are actively configured
  const capabilities = [];
  if (config?.tenantIsolation?.organizationId) capabilities.push('tenant_management');
  if (config?.billing?.reseller?.mode && config.billing.reseller.mode !== 'disabled') capabilities.push('billing_management');
  if (config?.branding?.productName) capabilities.push('branding_configuration');
  if (config?.quotas) capabilities.push('usage_dashboard');
  if (config?.compliance?.auditLogExportEnabled) capabilities.push('audit_log_export');
  if (config?.partnerOps?.slaUptimePct) capabilities.push('sla_monitoring');

  // Vendor-leak check: portal URL must not be a vendor-platform domain
  let vendorLeak = false;
  let vendorLeakReason = '';
  if (portalUrl && isVendorUrl(portalUrl)) {
    vendorLeak = true;
    vendorLeakReason = `adminPortalUrl '${portalUrl}' exposes a vendor-platform domain. The partner admin portal must be accessed via a partner-owned domain.`;
  }
  const termLeak = containsVendorBrandTerm(productName);
  if (termLeak) {
    vendorLeak = true;
    vendorLeakReason = vendorLeakReason || `adminPortalProductName contains vendor brand term '${termLeak}'.`;
  }

  const ready = enabled && Boolean(portalUrl) && Boolean(productName) && !vendorLeak;

  return { enabled, portalUrl, productName, capabilities, ready, vendorLeak, vendorLeakReason };
}

// ─── Q2 — White-label Support Experience ─────────────────────────────────────

/**
 * Build a descriptor for the partner's white-labeled support experience.
 *
 * All three surfaces (help centre, ticket portal, status page) must be
 * under partner-owned domains. If any URL is a vendor domain, the descriptor
 * flags a vendor-leak so the consuming app can block provisioning.
 *
 * @param {object} config - Full tenant config
 * @returns {{
 *   helpCenterUrl: string,
 *   ticketSystemUrl: string,
 *   statusPageUrl: string,
 *   supportEmail: string,
 *   supportBrand: string,
 *   ticketSystem: string,
 *   vendorLeaks: Array<{ field: string, reason: string }>,
 *   fullyWhiteLabeled: boolean
 * }}
 */
export function buildSupportExperienceDescriptor(config) {
  const ops = config?.partnerOps || {};
  const branding = config?.branding || {};
  const domainBranding = config?.domainBranding || config?.domainControl || {};

  const helpCenterUrl   = String(ops.helpCenterUrl   || domainBranding.helpCenterUrl   || '').trim();
  const ticketSystemUrl = String(ops.ticketSystemUrl || domainBranding.supportPortalUrl || '').trim();
  const statusPageUrl   = String(ops.statusPageUrl   || '').trim();
  const supportEmail    = String(ops.supportEmail    || '').trim();
  const supportBrand    = String(ops.supportBrand    || branding.productName || '').trim();
  const ticketSystem    = SUPPORT_SYSTEM_VALUES.includes(ops.ticketSystem)
    ? ops.ticketSystem
    : SUPPORT_SYSTEM.DISABLED;

  const vendorLeaks = [];

  const urlFields = [
    ['partnerOps.helpCenterUrl',   helpCenterUrl],
    ['partnerOps.ticketSystemUrl', ticketSystemUrl],
    ['partnerOps.statusPageUrl',   statusPageUrl],
  ];
  for (const [field, url] of urlFields) {
    if (url && isVendorUrl(url)) {
      vendorLeaks.push({
        field,
        reason: `'${url}' exposes a vendor-platform or vendor-support domain. All end-client support surfaces must be under the partner's own domain.`,
      });
    }
  }

  const vendorTerm = containsVendorBrandTerm(supportBrand);
  if (vendorTerm) {
    vendorLeaks.push({
      field: 'partnerOps.supportBrand',
      reason: `supportBrand '${supportBrand}' contains vendor brand term '${vendorTerm}'. The support team name shown to end clients must use the partner's brand.`,
    });
  }

  const fullyWhiteLabeled =
    vendorLeaks.length === 0 &&
    Boolean(helpCenterUrl) &&
    Boolean(statusPageUrl) &&
    Boolean(supportBrand);

  return {
    helpCenterUrl,
    ticketSystemUrl,
    statusPageUrl,
    supportEmail,
    supportBrand,
    ticketSystem,
    vendorLeaks,
    fullyWhiteLabeled,
  };
}

// ─── Q3 — Sandbox / Staging Environment ──────────────────────────────────────

/**
 * Resolve the sandbox environment descriptor for a partner.
 *
 * A sandbox environment must:
 *   - Use a distinct URL from production (never share the prod domain)
 *   - Be fully isolated from production data (KV namespace, D1 database)
 *   - Not expose vendor platform domains in the sandbox URL
 *   - Allow feature flags and branding tests without risk to live tenants
 *
 * @param {object} config - Full tenant config
 * @returns {{
 *   environment: string,
 *   isSandbox: boolean,
 *   sandboxEnabled: boolean,
 *   sandboxUrl: string,
 *   dataIsolated: boolean,
 *   featureFlagsEnabled: boolean,
 *   vendorLeak: boolean,
 *   vendorLeakReason: string,
 *   ready: boolean,
 *   warnings: string[]
 * }}
 */
export function resolveSandboxEnvironmentDescriptor(config) {
  const ops = config?.partnerOps || {};
  const domainRouting = config?.domainRouting || config?.domainControl || {};

  const environment = PARTNER_ENV_VALUES.includes(ops.environment)
    ? ops.environment
    : PARTNER_ENV.PRODUCTION;

  const isSandbox = environment !== PARTNER_ENV.PRODUCTION;
  const sandboxEnabled = Boolean(ops.sandboxEnabled);
  const sandboxUrl = String(ops.sandboxUrl || '').trim();
  const prodUrl = String(domainRouting.appOrigin || domainRouting.appHostname || '').trim();
  const dataIsolated = ops.sandboxDataIsolated !== false; // default true — fail safe
  const featureFlagsEnabled = Boolean(ops.featureFlagsEnabled);

  const warnings = [];
  let vendorLeak = false;
  let vendorLeakReason = '';

  if (sandboxEnabled) {
    if (!sandboxUrl) {
      warnings.push('partnerOps.sandboxUrl is not set — sandbox must have a distinct URL from production.');
    } else {
      // Must differ from prod URL
      const normalizedSandbox = sandboxUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const normalizedProd = prodUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (normalizedSandbox && normalizedProd && normalizedSandbox === normalizedProd) {
        warnings.push(`partnerOps.sandboxUrl '${sandboxUrl}' must be different from the production URL '${prodUrl}' — sandbox and production must never share the same origin.`);
      }
      if (isVendorUrl(sandboxUrl)) {
        vendorLeak = true;
        vendorLeakReason = `sandboxUrl '${sandboxUrl}' exposes a vendor-platform domain. Sandbox environments must use a partner-owned subdomain (e.g. sandbox.partnerbrand.com).`;
      }
    }
    if (!dataIsolated) {
      warnings.push('partnerOps.sandboxDataIsolated is false — sandbox must use a completely separate KV namespace and database. Shared data between sandbox and production risks contaminating live tenant data.');
    }
  } else if (!sandboxEnabled && environment === PARTNER_ENV.PRODUCTION) {
    warnings.push('No sandbox environment is configured. Partners should maintain at least one isolated sandbox for testing branding changes, feature flags, and integration wiring before deploying to production tenants.');
  }

  const ready = sandboxEnabled && Boolean(sandboxUrl) && dataIsolated && !vendorLeak;

  return {
    environment,
    isSandbox,
    sandboxEnabled,
    sandboxUrl,
    dataIsolated,
    featureFlagsEnabled,
    vendorLeak,
    vendorLeakReason,
    ready,
    warnings,
  };
}

/**
 * Guard that rejects production-route execution when the config
 * is flagged as a sandbox environment.
 *
 * Call this at the Worker entry point on any route that mutates production data
 * (write to KV, trigger billing, send real emails) to prevent sandbox
 * misconfiguration from affecting live tenants.
 *
 * @param {object} config - Full tenant config
 * @returns {{ safe: boolean, environment: string, reason: string }}
 */
export function assertNotSandboxConfig(config) {
  const ops = config?.partnerOps || {};
  const environment = PARTNER_ENV_VALUES.includes(ops.environment)
    ? ops.environment
    : PARTNER_ENV.PRODUCTION;

  if (environment !== PARTNER_ENV.PRODUCTION) {
    return {
      safe: false,
      environment,
      reason: `Refusing to execute production-path operation: config.partnerOps.environment is '${environment}'. Use the production config for live tenant operations.`,
    };
  }
  return { safe: true, environment, reason: '' };
}

// ─── Q4 — SLA Policy & Vendor-Neutral Incident Reporting ─────────────────────

/**
 * Resolve the SLA policy descriptor for a tenant.
 *
 * Produces the authoritative uptime target, response-time SLA, maintenance
 * window, and incident-reporting surface. The incident page URL must be
 * partner-owned — any reference to vendor infrastructure in client-visible
 * incident reports is a white-label breach.
 *
 * @param {object} config - Full tenant config
 * @returns {{
 *   slaTier: string,
 *   uptimePct: number,
 *   responseTimeMs: number,
 *   maintenanceWindowCron: string,
 *   incidentPageUrl: string,
 *   alertEmail: string,
 *   vendorLeak: boolean,
 *   vendorLeakReason: string,
 *   ready: boolean
 * }}
 */
export function resolveSlaPolicyDescriptor(config) {
  const ops = config?.partnerOps || {};
  const legacyOps = config?.operations || {};

  const slaTier = SLA_TIER_VALUES.includes(ops.slaTier)
    ? ops.slaTier
    : SLA_TIER.NONE;

  // Accept from partnerOps first, fall back to legacy operations block
  const uptimePct = Number(ops.slaUptimePct || legacyOps.slaUptimeTarget || 0);
  const responseTimeMs = Number(ops.slaResponseTimeMs || legacyOps.slaResponseTimeMs || 0);
  const maintenanceWindowCron = String(ops.maintenanceWindowCron ?? legacyOps.maintenanceWindowCron ?? '').trim();
  const incidentPageUrl = String(ops.incidentPageUrl || '').trim();
  const alertEmail = String(ops.alertEmail ?? legacyOps.alertEmail ?? '').trim();

  let vendorLeak = false;
  let vendorLeakReason = '';
  if (incidentPageUrl && isVendorUrl(incidentPageUrl)) {
    vendorLeak = true;
    vendorLeakReason = `incidentPageUrl '${incidentPageUrl}' exposes a vendor-platform or third-party status-page domain. Partner incident pages must be served under the partner's own domain so end clients never see vendor infrastructure.`;
  }

  // Ready when a real SLA tier is set and the incident page is configured + partner-owned
  const ready =
    slaTier !== SLA_TIER.NONE &&
    uptimePct > 0 &&
    Boolean(incidentPageUrl) &&
    !vendorLeak;

  return {
    slaTier,
    uptimePct,
    responseTimeMs,
    maintenanceWindowCron,
    incidentPageUrl,
    alertEmail,
    vendorLeak,
    vendorLeakReason,
    ready,
  };
}

/**
 * Generate a vendor-neutral incident report label for partner-facing status
 * communications. Strips any vendor infrastructure references and replaces
 * them with the partner's own product/infrastructure terminology.
 *
 * @param {object} config - Full tenant config
 * @param {{ title: string, body: string, severity: 'minor'|'major'|'critical' }} raw
 * @returns {{ title: string, body: string, severity: string, productName: string }}
 */
export function buildIncidentReportDescriptor(config, raw = {}) {
  const branding = config?.branding || {};
  const productName = String(branding.productName || 'Platform').trim();

  const vendorPattern = /\b(cloudflare|workers\.dev|pages\.dev|clodo|anthropic|d1\b|r2\b|durable objects?)\b/gi;
  const redactTerm = (str) => String(str || '').replace(vendorPattern, `${productName} infrastructure`);

  const severity = ['minor', 'major', 'critical'].includes(raw.severity) ? raw.severity : 'minor';

  return {
    title: redactTerm(raw.title || ''),
    body: redactTerm(raw.body || ''),
    severity,
    productName,
  };
}

// ─── Q5 — White-label Partner Documentation ──────────────────────────────────

/**
 * Build a white-labeled partner documentation identity descriptor.
 *
 * Partners host their own onboarding, branding-setup, tenant-management, and
 * API integration guides. Docs may be:
 *   - Published under the partner's brand on their own domain (BRANDED)
 *   - Generic / unbranded (UNBRANDED) — no vendor attribution anywhere
 *   - Partner-internal only (PRIVATE) — behind authentication
 *
 * @param {object} config - Full tenant config
 * @returns {{
 *   mode: string,
 *   docsUrl: string,
 *   productName: string,
 *   sections: string[],
 *   branded: boolean,
 *   vendorLeak: boolean,
 *   vendorLeakReason: string,
 *   ready: boolean
 * }}
 */
export function buildPartnerDocsDescriptor(config) {
  const ops = config?.partnerOps || {};
  const branding = config?.branding || {};

  const mode = PARTNER_DOCS_MODE_VALUES.includes(ops.partnerDocsMode)
    ? ops.partnerDocsMode
    : PARTNER_DOCS_MODE.DISABLED;

  const docsUrl = String(ops.partnerDocsUrl || '').trim();
  const productName = String(ops.partnerDocsProductName || branding.productName || '').trim();
  const branded = mode === PARTNER_DOCS_MODE.BRANDED;

  // Determine which documentation sections are ready (configured)
  const sections = [];
  if (ops.docsHasOnboarding !== false && mode !== PARTNER_DOCS_MODE.DISABLED) sections.push('onboarding');
  if (ops.docsHasBrandingSetup  !== false && mode !== PARTNER_DOCS_MODE.DISABLED) sections.push('branding_setup');
  if (ops.docsHasTenantManagement !== false && mode !== PARTNER_DOCS_MODE.DISABLED) sections.push('tenant_management');
  if (ops.docsHasApiIntegration !== false && mode !== PARTNER_DOCS_MODE.DISABLED) sections.push('api_integration');

  // Vendor-leak checks
  let vendorLeak = false;
  let vendorLeakReason = '';
  if (docsUrl && isVendorUrl(docsUrl)) {
    vendorLeak = true;
    vendorLeakReason = `partnerDocsUrl '${docsUrl}' exposes a vendor-platform domain. Partner documentation must be published on a partner-owned domain (e.g. docs.partnerbrand.com).`;
  }
  const termLeak = containsVendorBrandTerm(productName);
  if (termLeak) {
    vendorLeak = true;
    vendorLeakReason = vendorLeakReason || `partnerDocsProductName contains vendor brand term '${termLeak}'.`;
  }

  const ready =
    mode !== PARTNER_DOCS_MODE.DISABLED &&
    Boolean(docsUrl) &&
    Boolean(productName) &&
    !vendorLeak;

  return { mode, docsUrl, productName, sections, branded, vendorLeak, vendorLeakReason, ready };
}

/**
 * Run a full partner ops white-label audit against a config.
 *
 * Runs all five Q-descriptors and aggregates errors + warnings into a single
 * audit result. Use this in the partner provisioning flow before issuing
 * a production certificate of readiness.
 *
 * @param {object} config - Full tenant config (post mergeWithDefaults)
 * @returns {{ pass: boolean, errors: string[], warnings: string[] }}
 */
export function assertPartnerOpsWhiteLabel(config) {
  const errors = [];
  const warnings = [];

  const portal = buildAdminPortalDescriptor(config);
  if (!portal.enabled) warnings.push('Q1: No partner admin portal configured (partnerOps.adminPortalEnabled is false).');
  if (portal.vendorLeak) errors.push(`Q1: ${portal.vendorLeakReason}`);

  const support = buildSupportExperienceDescriptor(config);
  for (const leak of support.vendorLeaks) errors.push(`Q2: ${leak.reason}`);
  if (!support.helpCenterUrl) warnings.push('Q2: partnerOps.helpCenterUrl is not set — end clients have no white-labeled help centre.');
  if (!support.statusPageUrl) warnings.push('Q2: partnerOps.statusPageUrl is not set — end clients cannot check service status under the partner brand.');
  if (!support.supportBrand) warnings.push('Q2: partnerOps.supportBrand is not set — support communications default to unbranded platform identity.');

  const sandbox = resolveSandboxEnvironmentDescriptor(config);
  if (sandbox.vendorLeak) errors.push(`Q3: ${sandbox.vendorLeakReason}`);
  for (const w of sandbox.warnings) warnings.push(`Q3: ${w}`);

  const sla = resolveSlaPolicyDescriptor(config);
  if (sla.vendorLeak) errors.push(`Q4: ${sla.vendorLeakReason}`);
  if (sla.slaTier === SLA_TIER.NONE) warnings.push('Q4: No SLA tier is configured (partnerOps.slaTier is "none"). Partners offering uptime guarantees must commit to a named tier.');
  if (!sla.incidentPageUrl) warnings.push('Q4: partnerOps.incidentPageUrl is not set — partners with SLA commitments must provide a partner-branded incident status page.');

  const docs = buildPartnerDocsDescriptor(config);
  if (docs.vendorLeak) errors.push(`Q5: ${docs.vendorLeakReason}`);
  if (docs.mode === PARTNER_DOCS_MODE.DISABLED) warnings.push('Q5: Partner documentation is disabled (partnerOps.partnerDocsMode). Consider publishing unbranded onboarding guides to accelerate partner self-service.');

  return { pass: errors.length === 0, errors, warnings };
}
