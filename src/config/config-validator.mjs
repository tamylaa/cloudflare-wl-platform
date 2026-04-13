/**
 * Customer Configuration Validator
 *
 * Validates a customer config object against the schema.
 * Returns structured errors with field paths and human-readable messages.
 *
 * Design:
 *   - Validates AFTER merge with defaults (so only explicitly set values are checked for type)
 *   - Required fields must be non-empty strings
 *   - Enum fields must match allowed values
 *   - Numeric fields must be within sane ranges
 *   - Warns (but doesn't fail) on suspicious values
 *
 * Usage:
 *   import { validateConfig } from './config-validator.mjs';
 *   const { valid, errors, warnings } = validateConfig(config);
 */

import { REQUIRED_FIELDS } from './customer-config.schema.mjs';
import {
  AUTH_AUDIT_EXPORT_FORMAT_VALUES,
  AUTH_SESSION_SAME_SITE_VALUES,
  AUTH_SSO_MODE_VALUES,
  MFA_ENFORCEMENT_MODE_VALUES,
} from './auth-identity.mjs';
import {
  BILLING_PORTAL_MODE_VALUES,
  BILLING_RESELLER_MODE_VALUES,
  BILLING_VENDOR_VISIBILITY_VALUES,
  DOWNSTREAM_INVOICE_FORMAT_VALUES,
  RESELLER_MARGIN_MODE_VALUES,
} from './billing-reseller.mjs';
import {
  IN_APP_MESSAGE_STYLE_VALUES,
  PUSH_PROVIDER_VALUES,
  TOOLTIP_TONE_VALUES,
  WEBHOOK_EVENT_NAME_MODE_VALUES,
} from './communications.mjs';
import { enforceBrandingSecurityPolicy } from './branding-security-policy.mjs';
import { DATA_RESIDENCY_REGION_VALUES } from './mobile.mjs';

// ─── Field-Level Validators ─────────────────────────────────────────────────

const VALID_PLATFORMS = ['shopify', 'wordpress', 'webflow', 'wix', 'custom'];
const VALID_AUTH_METHODS = ['service_account', 'oauth'];
const VALID_THEMES = ['light', 'dark'];
const VALID_EMAIL_PROVIDERS = ['brevo', 'sendgrid', 'mailgun', 'resend'];
const VALID_FREQUENCIES = ['daily', 'weekly', 'none'];
const VALID_PAGESPEED_STRATEGIES = ['mobile', 'desktop', 'both'];
const VALID_SHOPIFY_TIERS = ['starter', 'growth', 'pro'];
const VALID_DOMAIN_CONTROL_STATUSES = ['unconfigured', 'pending_dns', 'provisioning', 'active', 'error'];
const VALID_EMAIL_AUTH_STATUSES = ['unconfigured', 'pending_dns', 'verifying', 'active', 'error'];
const VALID_TENANT_HIERARCHY_ROLES = ['standalone', 'master', 'subtenant'];
const VALID_DATA_ISOLATION_MODES = ['strict', 'master_controlled', 'shared_aggregates'];
const VALID_CROSS_TENANT_LEARNING_MODES = ['disabled', 'anonymized_aggregates', 'explicit_opt_in'];
const VALID_OPERATIONS_ENVIRONMENTS = ['production', 'sandbox'];
const VALID_AUDIT_LOG_SIEM_FORMATS = ['jsonl', 'cef'];
const VALID_DATA_RESIDENCY_REGIONS = DATA_RESIDENCY_REGION_VALUES;
const VALID_AUTH_SSO_MODES = AUTH_SSO_MODE_VALUES;
const VALID_MFA_ENFORCEMENT_MODES = MFA_ENFORCEMENT_MODE_VALUES;
const VALID_SESSION_COOKIE_SAME_SITE = AUTH_SESSION_SAME_SITE_VALUES;
const VALID_AUTH_AUDIT_EXPORT_FORMATS = AUTH_AUDIT_EXPORT_FORMAT_VALUES;
const VALID_IN_APP_MESSAGE_STYLES = IN_APP_MESSAGE_STYLE_VALUES;
const VALID_TOOLTIP_TONES = TOOLTIP_TONE_VALUES;
const VALID_WEBHOOK_EVENT_NAME_MODES = WEBHOOK_EVENT_NAME_MODE_VALUES;
const VALID_PUSH_PROVIDERS = PUSH_PROVIDER_VALUES;
const VALID_BILLING_RESELLER_MODES = BILLING_RESELLER_MODE_VALUES;
const VALID_BILLING_VENDOR_VISIBILITY = BILLING_VENDOR_VISIBILITY_VALUES;
const VALID_BILLING_PORTAL_MODES = BILLING_PORTAL_MODE_VALUES;
const VALID_RESELLER_MARGIN_MODES = RESELLER_MARGIN_MODE_VALUES;
const VALID_DOWNSTREAM_INVOICE_FORMATS = DOWNSTREAM_INVOICE_FORMAT_VALUES;
const VALID_LANGUAGES = /^[a-z]{2}(-[A-Z]{2})?$/;
const VALID_COUNTRIES = /^[A-Z]{2}$/;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve a dot-path on an object: getPath(obj, 'site.domain') → obj.site.domain
 */
function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

/**
 * Check if a value is a non-empty string.
 */
function isNonEmptyString(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

// ─── Main Validator ──────────────────────────────────────────────────────────

/**
 * Validate a complete (post-merge) customer config.
 *
 * @param {Object} config - Complete config (after mergeWithDefaults)
 * @returns {{ valid: boolean, errors: Array<{field: string, message: string}>, warnings: Array<{field: string, message: string}> }}
 */
export function validateConfig(config) {
  const errors = [];
  const warnings = [];

  if (!config || typeof config !== 'object') {
    return {
      valid: false,
      errors: [{ field: '', message: 'Config must be a non-null object' }],
      warnings: [],
    };
  }

  // ── Required fields ─────────────────────────────────────────────
  for (const path of REQUIRED_FIELDS) {
    const val = getPath(config, path);
    if (!isNonEmptyString(val)) {
      errors.push({ field: path, message: `Required field '${path}' is missing or empty` });
    }
  }

  // ── site.siteUrl format ─────────────────────────────────────────
  if (config.site?.siteUrl) {
    const url = config.site.siteUrl;
    if (
      !url.startsWith('sc-domain:') &&
      !url.startsWith('http://') &&
      !url.startsWith('https://')
    ) {
      errors.push({
        field: 'site.siteUrl',
        message: `siteUrl must start with 'sc-domain:', 'http://', or 'https://' — got '${url}'`,
      });
    }
  }

  // ── site.domain format ──────────────────────────────────────────
  if (config.site?.domain) {
    const d = config.site.domain;
    if (d.includes('://') || d.includes('/')) {
      errors.push({
        field: 'site.domain',
        message: `domain should be bare (e.g. 'example.com'), not a URL — got '${d}'`,
      });
    }
  }

  // ── domainControl hostname / URL format ─────────────────────────
  if (config.domainControl?.appHostname) {
    const host = config.domainControl.appHostname;
    if (host.includes('://') || host.includes('/')) {
      errors.push({
        field: 'domainControl.appHostname',
        message: `appHostname should be a bare hostname (e.g. 'app.example.com'), not a URL — got '${host}'`,
      });
    }
  }

  for (const field of ['appOrigin', 'docsUrl', 'helpCenterUrl', 'supportPortalUrl']) {
    const value = config.domainControl?.[field];
    if (value && !String(value).startsWith('http://') && !String(value).startsWith('https://')) {
      warnings.push({
        field: `domainControl.${field}`,
        message: `${field} should be a full http/https URL — got '${value}'`,
      });
    }
  }

  if (config.domainControl?.supportEmail && !String(config.domainControl.supportEmail).includes('@')) {
    warnings.push({
      field: 'domainControl.supportEmail',
      message: `supportEmail should be a valid mailbox address — got '${config.domainControl.supportEmail}'`,
    });
  }

  // ── domainRouting / domainBranding format ─────────────────────
  if (config.domainRouting?.appHostname) {
    const host = config.domainRouting.appHostname;
    if (host.includes('://') || host.includes('/')) {
      errors.push({
        field: 'domainRouting.appHostname',
        message: `domainRouting.appHostname should be a bare hostname (e.g. 'app.example.com'), not a URL — got '${host}'`,
      });
    }
  }

  if (config.domainRouting?.dnsTarget) {
    const dnsTarget = String(config.domainRouting.dnsTarget);
    if (dnsTarget.includes('://') || dnsTarget.includes('/')) {
      warnings.push({
        field: 'domainRouting.dnsTarget',
        message: `domainRouting.dnsTarget should be a bare hostname/CNAME target — got '${dnsTarget}'`,
      });
    }
  }

  for (const field of ['appOrigin']) {
    const value = config.domainRouting?.[field];
    if (value && !String(value).startsWith('http://') && !String(value).startsWith('https://')) {
      warnings.push({
        field: `domainRouting.${field}`,
        message: `${field} should be a full http/https URL — got '${value}'`,
      });
    }
  }

  for (const field of ['docsUrl', 'helpCenterUrl', 'supportPortalUrl', 'statusPageUrl', 'incidentReportingUrl', 'onboardingUrl']) {
    const value = config.domainBranding?.[field];
    if (value && !String(value).startsWith('http://') && !String(value).startsWith('https://')) {
      warnings.push({
        field: `domainBranding.${field}`,
        message: `${field} should be a full http/https URL — got '${value}'`,
      });
    }
  }

  if (config.domainBranding?.supportEmail && !String(config.domainBranding.supportEmail).includes('@')) {
    warnings.push({
      field: 'domainBranding.supportEmail',
      message: `supportEmail should be a valid mailbox address — got '${config.domainBranding.supportEmail}'`,
    });
  }

  if (config.domainBranding?.sendingDomain) {
    const sendingDomain = String(config.domainBranding.sendingDomain);
    if (sendingDomain.includes('://') || sendingDomain.includes('/')) {
      warnings.push({
        field: 'domainBranding.sendingDomain',
        message: `sendingDomain should be a bare email domain (e.g. 'updates.example.com') — got '${sendingDomain}'`,
      });
    }
  }

  if (config.tenantIsolation?.tenantRole === 'subtenant' && !config.tenantIsolation?.masterTenantId) {
    warnings.push({
      field: 'tenantIsolation.masterTenantId',
      message: 'Sub-tenant mode should specify a masterTenantId to preserve clear ownership boundaries.',
    });
  }

  if (!config.tenantIsolation?.organizationId) {
    warnings.push({
      field: 'tenantIsolation.organizationId',
      message: 'organizationId should be set to preserve tenant-to-organization ownership boundaries.',
    });
  }

  if (config.tenantIsolation?.dataIsolationMode !== 'strict') {
    warnings.push({
      field: 'tenantIsolation.dataIsolationMode',
      message: 'Non-strict data isolation modes increase cross-tenant blast radius and should be approved explicitly.',
    });
  }

  if (
    config.tenantIsolation?.crossTenantLearningMode &&
    config.tenantIsolation.crossTenantLearningMode !== 'disabled' &&
    config.tenantIsolation?.requireExplicitConsent === false
  ) {
    warnings.push({
      field: 'tenantIsolation.requireExplicitConsent',
      message: 'Cross-tenant learning should normally require explicit consent from each participating tenant.',
    });
  }

  const quotaConfig = config.quotas || {};
  const rateLimitFields = [
    'apiRequestsPerMinute',
    'oauthRequestsPerMinute',
    'billingRequestsPerMinute',
    'triggerRequestsPerMinute',
    'auditRequestsPerHour',
  ];
  const hasExplicitRateLimit = rateLimitFields.some(
    (field) => Number(quotaConfig?.[field] || 0) > 0
  );
  if (!hasExplicitRateLimit) {
    warnings.push({
      field: 'quotas',
      message: 'No per-tenant rate limits are configured; noisy-neighbour mitigation may rely only on global defaults.',
    });
  }

  if (config.operations?.environment === 'production') {
    if (!config.domainRouting?.appHostname) {
      warnings.push({
        field: 'domainRouting.appHostname',
        message: 'Production tenants should set domainRouting.appHostname for self-service domain routing.',
      });
    }
    if (!config.branding?.productName) {
      warnings.push({
        field: 'branding.productName',
        message: 'Production tenants should set a branded productName during provisioning.',
      });
    }
  }

  if (!Array.isArray(config.authIdentity?.roleDefinitions) || config.authIdentity.roleDefinitions.length === 0) {
    warnings.push({
      field: 'authIdentity.roleDefinitions',
      message: 'No role definitions found. Automated tenant provisioning should seed default roles.',
    });
  }

  if (config.compliance?.auditLogExportEnabled && !config.compliance?.auditLogWebhookUrl) {
    warnings.push({
      field: 'compliance.auditLogWebhookUrl',
      message: 'Audit log export is enabled but no SIEM webhook URL is configured.',
    });
  }

  if (config.authIdentity?.sessionCookieDomain) {
    const cookieDomain = String(config.authIdentity.sessionCookieDomain);
    if (cookieDomain.includes('://') || cookieDomain.includes('/')) {
      errors.push({
        field: 'authIdentity.sessionCookieDomain',
        message: `sessionCookieDomain should be a bare hostname/domain — got '${cookieDomain}'`,
      });
    }
  }

  for (const field of ['oidcDiscoveryUrl', 'samlEntryPoint', 'passwordResetUrl', 'mfaHelpUrl']) {
    const value = config.authIdentity?.[field];
    if (value && !String(value).startsWith('http://') && !String(value).startsWith('https://')) {
      warnings.push({
        field: `authIdentity.${field}`,
        message: `${field} should be a full http/https URL — got '${value}'`,
      });
    }
  }

  for (const field of ['publicBaseUrl']) {
    const value = config.communications?.webhooks?.[field];
    if (value && !String(value).startsWith('http://') && !String(value).startsWith('https://')) {
      warnings.push({
        field: `communications.webhooks.${field}`,
        message: `${field} should be a full http/https URL — got '${value}'`,
      });
    }
  }

  for (const field of ['iconUrl', 'deepLinkBaseUrl']) {
    const value = config.communications?.push?.[field];
    if (value && !String(value).startsWith('http://') && !String(value).startsWith('https://')) {
      warnings.push({
        field: `communications.push.${field}`,
        message: `${field} should be a full http/https URL — got '${value}'`,
      });
    }
  }

  if (config.communications?.push?.enabled) {
    if (!config.communications?.push?.provider || config.communications.push.provider === 'none') {
      warnings.push({
        field: 'communications.push.provider',
        message: 'Push is enabled but no delivery provider has been selected.',
      });
    }
    if (!config.communications?.push?.senderName || !config.communications?.push?.iconUrl) {
      warnings.push({
        field: 'communications.push',
        message: 'Push branding should include both a sender name and icon URL for partner-facing delivery.',
      });
    }
  }

  if (config.billingReseller?.partnerPortalUrl) {
    const portalUrl = String(config.billingReseller.partnerPortalUrl);
    if (!portalUrl.startsWith('http://') && !portalUrl.startsWith('https://')) {
      warnings.push({
        field: 'billingReseller.partnerPortalUrl',
        message: `partnerPortalUrl should be a full http/https URL — got '${portalUrl}'`,
      });
    }
  }

  if (config.billingReseller?.portalMode === 'external' && !config.billingReseller?.partnerPortalUrl) {
    warnings.push({
      field: 'billingReseller.partnerPortalUrl',
      message: 'External partner billing portal mode should provide a partnerPortalUrl.',
    });
  }

  if (
    config.billingReseller?.vendorVisibility === 'hidden' &&
    config.billingReseller?.portalMode === 'platform'
  ) {
    warnings.push({
      field: 'billingReseller.portalMode',
      message: 'Hidden vendor visibility usually requires an external or manually managed partner portal.',
    });
  }

  if (
    config.billingReseller?.usageReportingEnabled &&
    ![
      config.billingReseller?.usagePricing?.baseMonthlyCents,
      config.billingReseller?.usagePricing?.aiCallCents,
      config.billingReseller?.usagePricing?.ai1kTokenCents,
    ].some((value) => Number(value) > 0) &&
    config.billingReseller?.resellerMarginMode !== 'custom_pricebook'
  ) {
    warnings.push({
      field: 'billingReseller.usagePricing',
      message: 'Usage reporting is enabled but no wholesale pricing basis has been configured yet.',
    });
  }

  if (
    config.billingReseller?.resellerMarginMode === 'custom_pricebook' &&
    !config.billingReseller?.activePriceBookId
  ) {
    warnings.push({
      field: 'billingReseller.activePriceBookId',
      message: 'Custom price-book margin mode should reference an active D1-backed price book record.',
    });
  }

  if (config.authIdentity?.ssoMode === 'oidc') {
    if (!config.authIdentity?.oidcDiscoveryUrl) {
      warnings.push({
        field: 'authIdentity.oidcDiscoveryUrl',
        message: 'OIDC mode should specify a discovery URL for per-tenant SSO bootstrap.',
      });
    }
    if (!config.authIdentity?.oidcClientIdSecret) {
      warnings.push({
        field: 'authIdentity.oidcClientIdSecret',
        message: 'OIDC mode should specify the Wrangler secret name that holds the client ID.',
      });
    }
  }

  if (config.authIdentity?.ssoMode === 'saml') {
    if (!config.authIdentity?.samlEntryPoint) {
      warnings.push({
        field: 'authIdentity.samlEntryPoint',
        message: 'SAML mode should specify the IdP entry point / SSO URL.',
      });
    }
    if (!config.authIdentity?.samlEntityId) {
      warnings.push({
        field: 'authIdentity.samlEntityId',
        message: 'SAML mode should specify a tenant entity ID / audience value.',
      });
    }
  }

  if (
    config.authIdentity?.sessionCookieSameSite === 'none' &&
    config.authIdentity?.sessionCookieSecureOnly === false
  ) {
    warnings.push({
      field: 'authIdentity.sessionCookieSecureOnly',
      message: 'SameSite=None cookies must remain secure-only in production; local HTTP requests should be downgraded to SameSite=Lax.',
    });
  }

  const brandingPolicy = enforceBrandingSecurityPolicy(config.branding || {}, { mode: 'config' });
  for (const finding of [...brandingPolicy.errors, ...brandingPolicy.warnings]) {
    const fieldPath = finding.field ? `branding.${finding.field}` : 'branding';
    warnings.push({
      field: fieldPath,
      message: finding.message,
    });
  }

  if (
    config.branding?.customJsSandboxCapabilities !== undefined &&
    !Array.isArray(config.branding.customJsSandboxCapabilities)
  ) {
    warnings.push({
      field: 'branding.customJsSandboxCapabilities',
      message: 'customJsSandboxCapabilities should be an array of iframe sandbox capability strings.',
    });
  }

  if (Array.isArray(config.branding?.customJsSandboxCapabilities)) {
    for (const capability of config.branding.customJsSandboxCapabilities) {
      if (typeof capability !== 'string' || !/^allow-[a-z-]+$/i.test(capability)) {
        warnings.push({
          field: 'branding.customJsSandboxCapabilities',
          message: `Invalid sandbox capability '${capability}'. Expected values like 'allow-scripts'.`,
        });
        break;
      }
    }
  }

  if (config.authIdentity?.roleDefinitions !== undefined) {
    if (!Array.isArray(config.authIdentity.roleDefinitions)) {
      errors.push({
        field: 'authIdentity.roleDefinitions',
        message: 'roleDefinitions must be an array of role objects.',
      });
    } else {
      for (const role of config.authIdentity.roleDefinitions) {
        if (!role || typeof role !== 'object' || !isNonEmptyString(role.id)) {
          errors.push({
            field: 'authIdentity.roleDefinitions',
            message: 'Each roleDefinition requires a non-empty id.',
          });
          break;
        }
        if (role.permissions !== undefined && !Array.isArray(role.permissions)) {
          errors.push({
            field: `authIdentity.roleDefinitions.${role.id}.permissions`,
            message: 'Role permissions must be an array of permission identifiers.',
          });
          break;
        }
      }
    }
  }

  if (config.authIdentity?.customPermissions !== undefined && !Array.isArray(config.authIdentity.customPermissions)) {
    errors.push({
      field: 'authIdentity.customPermissions',
      message: 'customPermissions must be an array of permission identifiers.',
    });
  }

  // ── Enum validations ────────────────────────────────────────────
  const enumChecks = [
    { field: 'site.platform', value: config.site?.platform, allowed: VALID_PLATFORMS },
    {
      field: 'credentials.gscAuthMethod',
      value: config.credentials?.gscAuthMethod,
      allowed: VALID_AUTH_METHODS,
    },
    { field: 'branding.theme', value: config.branding?.theme, allowed: VALID_THEMES },
    { field: 'email.provider', value: config.email?.provider, allowed: VALID_EMAIL_PROVIDERS },
    {
      field: 'domainControl.domainStatus',
      value: config.domainControl?.domainStatus,
      allowed: VALID_DOMAIN_CONTROL_STATUSES,
    },
    {
      field: 'domainControl.sslStatus',
      value: config.domainControl?.sslStatus,
      allowed: VALID_DOMAIN_CONTROL_STATUSES,
    },
    {
      field: 'domainControl.emailAuthStatus',
      value: config.domainControl?.emailAuthStatus,
      allowed: VALID_EMAIL_AUTH_STATUSES,
    },
    {
      field: 'domainRouting.domainStatus',
      value: config.domainRouting?.domainStatus,
      allowed: VALID_DOMAIN_CONTROL_STATUSES,
    },
    {
      field: 'domainRouting.sslStatus',
      value: config.domainRouting?.sslStatus,
      allowed: VALID_DOMAIN_CONTROL_STATUSES,
    },
    {
      field: 'domainBranding.emailAuthStatus',
      value: config.domainBranding?.emailAuthStatus,
      allowed: VALID_EMAIL_AUTH_STATUSES,
    },
    {
      field: 'notifications.frequency',
      value: config.notifications?.frequency,
      allowed: VALID_FREQUENCIES,
    },
    {
      field: 'tenantIsolation.tenantRole',
      value: config.tenantIsolation?.tenantRole,
      allowed: VALID_TENANT_HIERARCHY_ROLES,
    },
    {
      field: 'tenantIsolation.dataIsolationMode',
      value: config.tenantIsolation?.dataIsolationMode,
      allowed: VALID_DATA_ISOLATION_MODES,
    },
    {
      field: 'tenantIsolation.crossTenantLearningMode',
      value: config.tenantIsolation?.crossTenantLearningMode,
      allowed: VALID_CROSS_TENANT_LEARNING_MODES,
    },
    {
      field: 'authIdentity.ssoMode',
      value: config.authIdentity?.ssoMode,
      allowed: VALID_AUTH_SSO_MODES,
    },
    {
      field: 'authIdentity.mfaEnforcement',
      value: config.authIdentity?.mfaEnforcement,
      allowed: VALID_MFA_ENFORCEMENT_MODES,
    },
    {
      field: 'authIdentity.sessionCookieSameSite',
      value: config.authIdentity?.sessionCookieSameSite,
      allowed: VALID_SESSION_COOKIE_SAME_SITE,
    },
    {
      field: 'authIdentity.auditExportFormat',
      value: config.authIdentity?.auditExportFormat,
      allowed: VALID_AUTH_AUDIT_EXPORT_FORMATS,
    },
    {
      field: 'communications.inApp.bannerStyle',
      value: config.communications?.inApp?.bannerStyle,
      allowed: VALID_IN_APP_MESSAGE_STYLES,
    },
    {
      field: 'communications.inApp.tooltipTone',
      value: config.communications?.inApp?.tooltipTone,
      allowed: VALID_TOOLTIP_TONES,
    },
    {
      field: 'communications.webhooks.eventNameMode',
      value: config.communications?.webhooks?.eventNameMode,
      allowed: VALID_WEBHOOK_EVENT_NAME_MODES,
    },
    {
      field: 'communications.push.provider',
      value: config.communications?.push?.provider,
      allowed: VALID_PUSH_PROVIDERS,
    },
    {
      field: 'billingReseller.mode',
      value: config.billingReseller?.mode,
      allowed: VALID_BILLING_RESELLER_MODES,
    },
    {
      field: 'billingReseller.vendorVisibility',
      value: config.billingReseller?.vendorVisibility,
      allowed: VALID_BILLING_VENDOR_VISIBILITY,
    },
    {
      field: 'billingReseller.portalMode',
      value: config.billingReseller?.portalMode,
      allowed: VALID_BILLING_PORTAL_MODES,
    },
    {
      field: 'billingReseller.resellerMarginMode',
      value: config.billingReseller?.resellerMarginMode,
      allowed: VALID_RESELLER_MARGIN_MODES,
    },
    {
      field: 'billingReseller.downstreamInvoiceFormat',
      value: config.billingReseller?.downstreamInvoiceFormat,
      allowed: VALID_DOWNSTREAM_INVOICE_FORMATS,
    },
    {
      field: 'operations.environment',
      value: config.operations?.environment,
      allowed: VALID_OPERATIONS_ENVIRONMENTS,
    },
    {
      field: 'compliance.auditLogSiemFormat',
      value: config.compliance?.auditLogSiemFormat,
      allowed: VALID_AUDIT_LOG_SIEM_FORMATS,
    },
    {
      field: 'compliance.dataResidencyRegion',
      value: config.compliance?.dataResidencyRegion,
      allowed: VALID_DATA_RESIDENCY_REGIONS,
    },
    {
      field: 'pipeline.pagespeedStrategy',
      value: config.pipeline?.pagespeedStrategy,
      allowed: VALID_PAGESPEED_STRATEGIES,
    },
  ];

  // Shopify tier only matters when platform is Shopify
  if (config.site?.platform === 'shopify' && config.shopify?.planTier) {
    enumChecks.push({
      field: 'shopify.planTier',
      value: config.shopify.planTier,
      allowed: VALID_SHOPIFY_TIERS,
    });
  }

  for (const { field, value, allowed } of enumChecks) {
    if (value !== undefined && value !== '' && !allowed.includes(value)) {
      errors.push({
        field,
        message: `Invalid value '${value}' for ${field}. Allowed: ${allowed.join(', ')}`,
      });
    }
  }

  // ── Language / Country format ────────────────────────────────────
  if (config.site?.language && !VALID_LANGUAGES.test(config.site.language)) {
    warnings.push({
      field: 'site.language',
      message: `Language '${config.site.language}' doesn't look like ISO 639-1 (e.g. 'en', 'de', 'fr-CA')`,
    });
  }
  if (config.site?.country && !VALID_COUNTRIES.test(config.site.country)) {
    warnings.push({
      field: 'site.country',
      message: `Country '${config.site.country}' doesn't look like ISO 3166-1 alpha-2 (e.g. 'US', 'DE', 'GB')`,
    });
  }

  // ── Numeric range validations ───────────────────────────────────
  const numericChecks = [
    {
      field: 'thresholds.minImpressions',
      value: config.thresholds?.minImpressions,
      min: 0,
      max: 100000,
    },
    { field: 'thresholds.minClicks', value: config.thresholds?.minClicks, min: 0, max: 10000 },
    { field: 'thresholds.ctrThreshold', value: config.thresholds?.ctrThreshold, min: 0, max: 1 },
    {
      field: 'thresholds.positionThreshold',
      value: config.thresholds?.positionThreshold,
      min: 1,
      max: 100,
    },
    {
      field: 'thresholds.anomalyPositionDrop',
      value: config.thresholds?.anomalyPositionDrop,
      min: 1,
      max: 50,
    },
    {
      field: 'thresholds.anomalyTrafficSurge',
      value: config.thresholds?.anomalyTrafficSurge,
      min: 1.1,
      max: 100,
    },
    {
      field: 'thresholds.anomalyCtrCollapse',
      value: config.thresholds?.anomalyCtrCollapse,
      min: 0.01,
      max: 1,
    },
    { field: 'pipeline.retentionDays', value: config.pipeline?.retentionDays, min: 7, max: 3650 },
    {
      field: 'pipeline.cacheTtlSeconds',
      value: config.pipeline?.cacheTtlSeconds,
      min: 0,
      max: 86400,
    },
    {
      field: 'pipeline.extractionTimeout',
      value: config.pipeline?.extractionTimeout,
      min: 1000,
      max: 300000,
    },
    {
      field: 'pipeline.urlInspectionBudget',
      value: config.pipeline?.urlInspectionBudget,
      min: 1,
      max: 2000,
    },
    {
      field: 'pipeline.contentAuditMaxPages',
      value: config.pipeline?.contentAuditMaxPages,
      min: 1,
      max: 100,
    },
    {
      field: 'pipeline.contentAuditRefreshDays',
      value: config.pipeline?.contentAuditRefreshDays,
      min: 1,
      max: 30,
    },
    {
      field: 'pipeline.pagespeedConcurrency',
      value: config.pipeline?.pagespeedConcurrency,
      min: 1,
      max: 10,
    },
    {
      field: 'billingReseller.defaultMarkupPercent',
      value: config.billingReseller?.defaultMarkupPercent,
      min: 0,
      max: 100,
    },
    {
      field: 'billingReseller.fixedMarkupCents',
      value: config.billingReseller?.fixedMarkupCents,
      min: 0,
      max: 100000,
    },
    {
      field: 'billingReseller.usagePricing.baseMonthlyCents',
      value: config.billingReseller?.usagePricing?.baseMonthlyCents,
      min: 0,
      max: 1000000,
    },
    {
      field: 'billingReseller.usagePricing.aiCallCents',
      value: config.billingReseller?.usagePricing?.aiCallCents,
      min: 0,
      max: 10000,
    },
    {
      field: 'billingReseller.usagePricing.ai1kTokenCents',
      value: config.billingReseller?.usagePricing?.ai1kTokenCents,
      min: 0,
      max: 10000,
    },
    {
      field: 'operations.slaUptimeTarget',
      value: config.operations?.slaUptimeTarget,
      min: 90,
      max: 100,
    },
    {
      field: 'operations.slaResponseTimeMs',
      value: config.operations?.slaResponseTimeMs,
      min: 100,
      max: 120000,
    },
    {
      field: 'compliance.auditLogRetentionDays',
      value: config.compliance?.auditLogRetentionDays,
      min: 7,
      max: 3650,
    },
    {
      field: 'quotas.apiRequestsPerMinute',
      value: config.quotas?.apiRequestsPerMinute,
      min: 0,
      max: 100000,
    },
    {
      field: 'quotas.oauthRequestsPerMinute',
      value: config.quotas?.oauthRequestsPerMinute,
      min: 0,
      max: 100000,
    },
    {
      field: 'quotas.billingRequestsPerMinute',
      value: config.quotas?.billingRequestsPerMinute,
      min: 0,
      max: 100000,
    },
    {
      field: 'quotas.triggerRequestsPerMinute',
      value: config.quotas?.triggerRequestsPerMinute,
      min: 0,
      max: 100000,
    },
    {
      field: 'quotas.auditRequestsPerHour',
      value: config.quotas?.auditRequestsPerHour,
      min: 0,
      max: 500000,
    },
    {
      field: 'quotas.monthlyAiCalls',
      value: config.quotas?.monthlyAiCalls,
      min: 0,
      max: 100000000,
    },
    {
      field: 'quotas.monthlyTokens',
      value: config.quotas?.monthlyTokens,
      min: 0,
      max: 100000000000,
    },
    {
      field: 'quotas.monthlyExtractionRuns',
      value: config.quotas?.monthlyExtractionRuns,
      min: 0,
      max: 1000000,
    },
    {
      field: 'quotas.monthlyUrlInspections',
      value: config.quotas?.monthlyUrlInspections,
      min: 0,
      max: 10000000,
    },
    {
      field: 'quotas.contentAuditMaxPages',
      value: config.quotas?.contentAuditMaxPages,
      min: 0,
      max: 10000,
    },
  ];

  for (const { field, value, min, max } of numericChecks) {
    if (value !== undefined && value !== null) {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push({ field, message: `${field} must be a number — got ${typeof value}` });
      } else if (value < min || value > max) {
        warnings.push({
          field,
          message: `${field} = ${value} is outside recommended range [${min}, ${max}]`,
        });
      }
    }
  }

  // ── Scoring weights ─────────────────────────────────────────────
  if (config.scoring) {
    const weights = [
      config.scoring.positionWeight,
      config.scoring.ctrWeight,
      config.scoring.impressionsWeight,
      config.scoring.trendWeight,
      config.scoring.contentQualityWeight,
    ].filter((w) => typeof w === 'number');

    const sum = weights.reduce((a, b) => a + b, 0);
    if (weights.length > 0 && (sum < 0.5 || sum > 1.5)) {
      warnings.push({
        field: 'scoring',
        message: `Scoring weights sum to ${sum.toFixed(2)} — expected ~1.0. Results may be skewed.`,
      });
    }

    for (const w of weights) {
      if (w < 0 || w > 1) {
        errors.push({
          field: 'scoring',
          message: `Individual scoring weight must be 0-1, got ${w}`,
        });
      }
    }
  }

  // ── Email format (basic) ────────────────────────────────────────
  if (config.email?.fromAddress && !config.email.fromAddress.includes('@')) {
    errors.push({
      field: 'email.fromAddress',
      message: `fromAddress doesn't look like an email: '${config.email.fromAddress}'`,
    });
  }
  if (config.notifications?.channels?.email?.recipient) {
    const r = config.notifications.channels.email.recipient;
    if (r && !r.includes('@')) {
      errors.push({
        field: 'notifications.channels.email.recipient',
        message: `Email recipient doesn't look like an email: '${r}'`,
      });
    }
  }
  if (config.communications?.email?.replyToAddress) {
    const replyTo = config.communications.email.replyToAddress;
    if (replyTo && !replyTo.includes('@')) {
      warnings.push({
        field: 'communications.email.replyToAddress',
        message: `replyToAddress doesn't look like an email: '${replyTo}'`,
      });
    }
  }

  // ── Shopify cross-validation ────────────────────────────────────
  if (config.site?.platform === 'shopify') {
    if (!config.shopify?.shopDomain) {
      warnings.push({
        field: 'shopify.shopDomain',
        message: 'Platform is Shopify but shopify.shopDomain is not set',
      });
    }
    if (!config.dataSources?.shopify) {
      warnings.push({
        field: 'dataSources.shopify',
        message: 'Platform is Shopify but dataSources.shopify is not enabled',
      });
    }
  }

  // ── CSS color format (basic) ────────────────────────────────────
  const colorFields = [
    'branding.primaryColor',
    'branding.secondaryColor',
    'branding.accentColor',
    'branding.accentHoverColor',
    'branding.accentBgColor',
    'branding.successColor',
    'branding.errorColor',
    'branding.warningColor',
  ];
  for (const field of colorFields) {
    const val = getPath(config, field);
    if (
      val &&
      typeof val === 'string' &&
      val.length > 0 &&
      !val.startsWith('#') &&
      !val.startsWith('rgb') &&
      !val.startsWith('hsl')
    ) {
      warnings.push({
        field,
        message: `Color '${val}' doesn't look like a CSS color (expected #hex, rgb(), or hsl())`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ─── Quick Helpers ───────────────────────────────────────────────────────────

/**
 * Validate and throw if config is invalid.
 * Use in startup paths where invalid config should crash.
 *
 * @param {Object} config
 * @throws {Error} If config has validation errors
 */
export function assertValidConfig(config) {
  const result = validateConfig(config);
  if (!result.valid) {
    const errorMessages = result.errors.map((e) => `  - ${e.field}: ${e.message}`).join('\n');
    throw new Error(`Invalid customer configuration:\n${errorMessages}`);
  }
  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      console.warn(`[Config Warning] ${w.field}: ${w.message}`);
    }
  }
  return config;
}
