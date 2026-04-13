/**
 * Customer Configuration Schema
 *
 * The single source of truth for ALL customer-specific configuration.
 * Every value that differs between deployments lives here.
 *
 * Design principles:
 *   1. Everything configurable, nothing hardcoded
 *   2. Sensible defaults for every optional field
 *   3. Secrets reference names, not values (actual secrets stored via `wrangler secret`)
 *   4. Schema is the contract — if it's not here, it's not configurable
 *   5. Backward compatible — missing fields fall back to defaults
 *
 * Usage:
 *   import { customerConfigDefaults, mergeWithDefaults } from './customer-config.schema.mjs';
 *   const config = mergeWithDefaults(storedConfig);
 */

// ─── Schema Definition with Defaults ─────────────────────────────────────────

import { PLATFORM_DEFAULTS } from '../brand/brand-engine.mjs';
import { DOMAIN_CONTROL_STATUS, EMAIL_AUTH_STATUS } from '../tenancy/domain-control.mjs';
import {
  CROSS_TENANT_LEARNING_MODE,
  DATA_ISOLATION_MODE,
  TENANT_HIERARCHY_ROLE,
} from './tenant-isolation.mjs';
import {
  AUTH_AUDIT_EXPORT_FORMAT,
  AUTH_SESSION_SAME_SITE,
  AUTH_SSO_MODE,
  DEFAULT_AUTH_ROLE_DEFINITIONS,
  MFA_ENFORCEMENT_MODE,
} from './auth-identity.mjs';
import {
  BILLING_PORTAL_MODE,
  BILLING_RESELLER_MODE,
  BILLING_VENDOR_VISIBILITY,
  DOWNSTREAM_INVOICE_FORMAT,
  RESELLER_MARGIN_MODE,
} from './billing-reseller.mjs';
import {
  IN_APP_MESSAGE_STYLE,
  PUSH_PROVIDER,
  TOOLTIP_TONE,
  WEBHOOK_EVENT_NAME_MODE,
} from './communications.mjs';
import {
  DATA_RESIDENCY_REGION,
  MOBILE_APP_PLATFORM,
  PWA_DISPLAY_MODE,
  PWA_ORIENTATION,
} from './mobile.mjs';

export const customerConfigDefaults = Object.freeze({
  // ── Site Identity ──────────────────────────────────────────────────
  // Who is this customer? What domain are we analyzing?
  site: {
    id: '', // Unique ID: 'store-abc123' (required)
    domain: '', // Bare domain: 'example-store.com' (required)
    siteUrl: '', // GSC property: 'sc-domain:example-store.com' (required)
    name: '', // Display name: 'Example Store' (required)
    description: '', // For AI context: 'Premium handcrafted widgets store'
    platform: 'custom', // 'shopify' | 'wordpress' | 'webflow' | 'wix' | 'custom'
    industry: '', // 'ecommerce-fashion', 'saas', 'local-bakery', etc.
    language: 'en', // Primary content language (ISO 639-1)
    country: 'US', // Primary market (ISO 3166-1 alpha-2)
  },

  // ── Credentials Configuration ──────────────────────────────────────
  // How do we authenticate to data sources?
  // Actual secrets stored as Wrangler secrets, not in config.
  // This section defines WHICH auth method to use and which secret names to look up.
  credentials: {
    gscAuthMethod: 'service_account', // 'service_account' | 'oauth'
    // Secret names (resolved from env at runtime):
    // - GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_KEY (service_account)
    // - GOOGLE_SEARCH_CONSOLE_CLIENT_ID, _CLIENT_SECRET, _REFRESH_TOKEN (oauth)
    // - BING_WEBMASTER_API_KEY
    // - PAGESPEED_API_KEY
    // - EMAIL_API_KEY
    // - AI_ENGINE_TOKEN
    // - ADMIN_TOKEN
  },

  // ── OAuth Configuration ────────────────────────────────────────────
  // Multi-tenant OAuth apps for Google, Microsoft, etc.
  // Each provider can have multiple apps (test vs prod vs regional).
  // Actual credentials stored as Wrangler Secrets.
  //
  // Usage pattern:
  //   1. Customer initiates OAuth flow → /api/oauth/google/initiate?provider=gsc
  //   2. System reads oauth.google.gsc config + env secrets
  //   3. Redirects to Google consent screen
  //   4. Google redirects back → /api/oauth/callback?code=...&state=...
  //   5. Tokens encrypted and stored per-tenant in KV
  oauth: {
    // Google OAuth apps (can have multiple for test/prod)
    google: {
      // GSC (Google Search Console) OAuth app
      gsc: {
        enabled: true,
        clientIdSecret: 'GOOGLE_CLIENT_ID', // Wrangler secret name for client ID
        clientSecretSecret: 'GOOGLE_CLIENT_SECRET', // Wrangler secret name for client secret
        // Refresh tokens stored encrypted in KV per-tenant
        // Access tokens auto-fetched on first use & cached for 3600s
        scopes: ['https://www.googleapis.com/auth/webmasters.readonly', 'openid', 'email'],
      },
      // Gmail API (optional, for future email integration)
      gmail: {
        enabled: false,
        clientIdSecret: 'GOOGLE_CLIENT_ID',
        clientSecretSecret: 'GOOGLE_CLIENT_SECRET',
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      },
      // Google Drive (optional, for content backups)
      drive: {
        enabled: false,
        clientIdSecret: 'GOOGLE_CLIENT_ID',
        clientSecretSecret: 'GOOGLE_CLIENT_SECRET',
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      },
    },
    // Microsoft OAuth (for future Bing Webmaster Tools / Microsoft Graph)
    microsoft: {
      enabled: false,
      // Future support for Microsoft services
    },
  },

  // ── Branding ───────────────────────────────────────────────────────
  // Visual customization for dashboard, share pages, emails, and exports.
  branding: {
    productName: PLATFORM_DEFAULTS.productName, // Dashboard title / product name
    tagline: PLATFORM_DEFAULTS.tagline, // Short helper line across UI/email headers
    logoGlyph: '◉', // Unicode glyph used as logo
    logoUrl: '', // URL or data URI to logo image (overrides glyph)
    faviconUrl: '', // URL or data URI for browser tab icon
    ogImageUrl: '', // URL or data URI for Open Graph preview image
    primaryColor: '#3b82f6', // Primary CTA colour
    secondaryColor: '#8b5cf6', // Secondary / gradient colour
    accentColor: '#14b8a6', // Accent badges, chips, highlights
    accentHoverColor: '#2563eb', // Hover state
    accentBgColor: '#eff6ff', // Light accent background
    successColor: '#10b981', // Positive indicators
    errorColor: '#ef4444', // Error / destructive state
    theme: 'light', // 'light' | 'dark'
    fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif",
    fontCssImport: '', // Google Fonts CSS URL
    fontUrl: '', // Uploaded/custom font URL or data URI
    customCss: '', // Optional tenant CSS override
    customJs: '', // Optional tenant JS enhancement
    allowUnsafeCustomJs: false, // Explicit opt-in for trusted custom JS on public surfaces
    customJsSandboxCapabilities: ['allow-scripts'], // Allowed iframe sandbox capabilities for custom JS isolation
    customJsCspPolicy: PLATFORM_DEFAULTS.customJsCspPolicy, // Trusted custom JS should still run under explicit CSP
    emailHeaderGradient: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
    // ── Labels (used in HTML templates) ──
    dashboardTitle: '', // <title> and <h1> — set by consuming application
    dashboardSubtitle: '', // Sub-heading (empty = domain auto-filled)
    emailHeading: '', // Email report heading — set by consuming application
    reportFooter: '', // Footer text in exported reports — set by consuming application
    userAgent: '', // HTTP User-Agent for crawling — set by consuming application
  },

  // ── Mobile & PWA White-Label ───────────────────────────────────────
  // Controls all partner-branded mobile surfaces: PWA web app manifest,
  // splash/icon assets, push notification identity, and native app store
  // metadata. All fields must be vendor-neutral when populated.
  mobile: {
    // PWA web app manifest fields
    platform: MOBILE_APP_PLATFORM.NONE,    // deployment model for this tenant
    pwaEnabled: false,                     // serve /manifest.webmanifest and inject meta tags
    pwaName: '',                           // maps to manifest "name" — branded app name
    pwaShortName: '',                      // maps to manifest "short_name" (≤12 chars)
    pwaDescription: '',                    // maps to manifest "description"
    pwaThemeColor: '',                     // <meta name="theme-color"> + manifest theme_color
    pwaBackgroundColor: '',                // manifest background_color (splash background)
    pwaDisplayMode: PWA_DISPLAY_MODE.STANDALONE,
    pwaOrientation: PWA_ORIENTATION.ANY,
    pwaStartUrl: '/',                      // manifest start_url
    pwaScope: '/',                         // manifest scope
    // Icon / splash assets (partner CDN URLs — do not embed vendor logos)
    pwaIconUrl192: '',                     // 192×192 PNG app icon URL
    pwaIconUrl512: '',                     // 512×512 PNG maskable app icon URL
    pwaSplashScreenUrl: '',                // Apple splash screen image URL
    // Apple-specific PWA meta tags
    appleWebAppTitle: '',                  // apple-mobile-web-app-title (default: pwaName)
    appleWebAppStatusBarStyle: 'default',  // 'default' | 'black' | 'black-translucent'
    appleWebAppCapable: false,             // apple-mobile-web-app-capable
    // Push notification branding (vendor-neutral sender identity)
    pushSenderName: '',                    // Notification sender name shown to device OS
    pushIconUrl: '',                       // Notification icon (overrides branding.logoUrl)
    pushBadgeUrl: '',                      // Monochrome badge icon for Android
    pushVapidPublicKey: '',                // VAPID public key (stored as Wrangler secret name)
    // Native / cross-platform app store identity
    appStoreId: '',                        // Apple App Store app ID (numeric)
    playStoreId: '',                       // Google Play package name (e.g. 'com.acme.app')
    appStoreName: '',                      // Display name in app store listings
    appStoreDeveloper: '',                 // Developer account name (partner's own account)
    appStoreIconUrl: '',                   // App store icon (partner CDN — not vendor CDN)
    notes: '',
  },

  // ── Domain & Delivery Control ─────────────────────────────────────
  // Instance-level hostnames and email-domain state for true white-label.
  //
  // Preferred layout (new code should read from these two sub-keys):
  //   domainRouting   — routing-identity fields (middleware/request-resolution time)
  //   domainBranding  — brand/support config fields (handler/render time)
  //
  // @deprecated domainControl — flat key kept for backward compatibility with stored
  //   configs. New callers should use domainRouting + domainBranding. Migration shim
  //   in mergeWithDefaults handles configs that only have the flat key.
  //
  /** @deprecated Use domainRouting + domainBranding instead. Kept for backward compat. */
  domainControl: {
    appHostname: '', // e.g. 'app.clientbrand.com'
    appOrigin: '', // e.g. 'https://app.clientbrand.com'
    docsUrl: '', // e.g. 'https://help.clientbrand.com'
    helpCenterUrl: '', // optional branded knowledge-base URL
    supportPortalUrl: '', // optional branded support desk URL
    supportEmail: '', // e.g. 'support@clientbrand.com'
    statusPageUrl: '', // partner's branded uptime/status page (no vendor refs)
    incidentReportingUrl: '', // partner's incident reporting URL surfaced to clients
    onboardingUrl: '', // partner-branded onboarding / quickstart guide URL
    sendingDomain: '', // e.g. 'updates.clientbrand.com'
    dnsTarget: '', // DNS target or CNAME shown to operators
    domainStatus: DOMAIN_CONTROL_STATUS.UNCONFIGURED,
    sslStatus: DOMAIN_CONTROL_STATUS.UNCONFIGURED,
    emailAuthStatus: EMAIL_AUTH_STATUS.UNCONFIGURED,
    notes: '', // operator notes / rollout status
  },

  // ── Domain Routing Identity ───────────────────────────────────────
  // Routing-identity fields: checked at middleware/request-resolution time,
  // before the app handler runs. Must be fast and stateless.
  domainRouting: {
    appHostname: '', // e.g. 'app.clientbrand.com'
    appOrigin: '', // e.g. 'https://app.clientbrand.com'
    domainStatus: DOMAIN_CONTROL_STATUS.UNCONFIGURED,
    sslStatus: DOMAIN_CONTROL_STATUS.UNCONFIGURED,
    dnsTarget: '', // DNS CNAME destination shown to operators
  },

  // ── Domain Branding & Support Config ─────────────────────────────
  // Brand/support config fields: used at render time inside handlers.
  domainBranding: {
    docsUrl: '', // e.g. 'https://help.clientbrand.com'
    helpCenterUrl: '', // optional branded knowledge-base URL
    supportPortalUrl: '', // optional branded support desk URL
    supportEmail: '', // e.g. 'support@clientbrand.com'
    statusPageUrl: '', // partner's branded uptime/status page (no vendor refs)
    incidentReportingUrl: '', // partner's incident reporting URL surfaced to clients
    onboardingUrl: '', // partner-branded onboarding / quickstart guide URL
    sendingDomain: '', // e.g. 'updates.clientbrand.com'
    emailAuthStatus: EMAIL_AUTH_STATUS.UNCONFIGURED,
    notes: '', // operator notes / rollout status
  },

  // ── Tenant Hierarchy & Privacy Policy ─────────────────────────────
  // Governs master/sub-tenant relationships and whether learning may be shared.
  tenantIsolation: {
    organizationId: '', // e.g. 'acme-group'
    tenantRole: TENANT_HIERARCHY_ROLE.STANDALONE, // 'standalone' | 'master' | 'subtenant'
    masterTenantId: '', // parent/master tenant ID when role === 'subtenant'
    subtenantIds: [], // approved child tenant IDs when role === 'master'
    dataIsolationMode: DATA_ISOLATION_MODE.STRICT, // default to hard boundaries
    crossTenantLearningMode: CROSS_TENANT_LEARNING_MODE.DISABLED,
    allowBenchmarking: false, // allow anonymized rollups/benchmarking across approved tenants
    requireExplicitConsent: true,
    notes: '',
  },

  // ── Auth & Identity Control ───────────────────────────────────────
  // Tenant-level enterprise auth posture, SSO readiness, and RBAC scaffolding.
  authIdentity: {
    ssoMode: AUTH_SSO_MODE.DISABLED, // 'disabled' | 'oidc' | 'saml'
    oidcDiscoveryUrl: '', // Well-known discovery URL for OIDC tenants
    oidcClientIdSecret: '', // Wrangler secret name for the OIDC client ID
    oidcClientSecretSecret: '', // Wrangler secret name for the OIDC client secret
    samlEntryPoint: '', // IdP SSO URL for SAML tenants
    samlEntityId: '', // SP/tenant entity ID used during SAML federation
    samlCertificateSecret: '', // Wrangler secret name for the SAML signing cert
    loginHostname: '', // Optional dedicated login hostname, e.g. 'login.clientbrand.com'
    loginHelpText: '', // White-label helper copy for login / recovery surfaces
    passwordResetUrl: '', // Tenant-branded reset/recovery URL
    mfaHelpUrl: '', // Optional branded MFA enrollment/help URL
    mfaEnforcement: MFA_ENFORCEMENT_MODE.OPTIONAL, // 'optional' | 'required'
    sessionCookieDomain: '', // Optional shared cookie domain for branded subdomains
    sessionCookieSameSite: AUTH_SESSION_SAME_SITE.LAX, // 'strict' | 'lax' | 'none'
    sessionCookieSecureOnly: true,
    roleDefinitions: DEFAULT_AUTH_ROLE_DEFINITIONS,
    customPermissions: [],
    auditExportFormat: AUTH_AUDIT_EXPORT_FORMAT.JSONL, // SIEM-friendly default
    notes: '',
  },

  // ── Email Sender Identity ──────────────────────────────────────────
  // Who do emails appear to come from?
  email: {
    fromAddress: '', // From address (MUST be set per customer)
    fromName: '', // Sender display name (MUST be set per customer)
    subjectPrefix: '📊', // Emoji prefix for subjects
    subjectTemplate: '{prefix} {frequency} Report - {siteName}',
    provider: 'brevo', // 'brevo' | 'sendgrid' | 'mailgun' | 'resend'
    // API key stored as Wrangler secret: EMAIL_API_KEY

    // Tenant-level sender identity override — takes priority over platform env vars.
    // All fields are optional; leave empty to fall back to platform defaults.
    emailSender: {
      fromName: '', // e.g. "Acme Support" — display name in recipient inbox
      /** Must pass SPF/DKIM for the configured sending domain. Leave empty to use platform sender. */
      fromAddress: '', // e.g. "support@acme.com"
      subjectPrefix: '', // e.g. "[Acme]" — prepended to all outbound subject lines
      replyToAddress: '', // optional reply-to override (e.g. "noreply@acme.com")
    },
  },

  // ── Notifications ──────────────────────────────────────────────────
  // How and where to send alerts and reports.
  notifications: {
    frequency: 'weekly', // 'daily' | 'weekly' | 'none'
    channels: {
      email: {
        enabled: true,
        recipient: '', // Webmaster email address
      },
      whatsapp: {
        enabled: false,
        phoneNumber: '', // E.164 format: +1234567890
      },
      slack: {
        enabled: false,
        webhookUrl: '', // Slack incoming webhook URL
        channel: '#analytics', // Channel name
      },
      push: {
        enabled: false,
        endpointUrl: '', // Optional push gateway / broker endpoint
      },
    },
  },

  // ── Communications & White-Label Messaging ────────────────────────
  // Controls copy, suppression, event naming, and push branding.
  communications: {
    email: {
      senderDisplayName: '',
      replyToAddress: '',
      footerText: '',
      legalFooterText: '',
      suppressPlatformFooter: false,
      templates: {
        onboarding: {
          enabled: true,
          subject: '',
          preheader: '',
          headline: '',
          introText: '',
          ctaLabel: '',
          footerNote: '',
        },
        passwordReset: {
          enabled: true,
          subject: '',
          preheader: '',
          headline: '',
          introText: '',
          ctaLabel: '',
          footerNote: '',
        },
        billing: {
          enabled: true,
          subject: '',
          preheader: '',
          headline: '',
          introText: '',
          ctaLabel: '',
          footerNote: '',
        },
        alerts: {
          enabled: true,
          subject: '',
          preheader: '',
          headline: '',
          introText: '',
          ctaLabel: '',
          footerNote: '',
        },
      },
    },
    inApp: {
      suppressVendorMessages: false,
      bannerStyle: IN_APP_MESSAGE_STYLE.BRAND,
      tooltipTone: TOOLTIP_TONE.GUIDED,
      setupBannerTitle: '',
      setupBannerBody: '',
      welcomeHeadline: '',
      dismissLabel: '',
      supportCtaLabel: '',
    },
    webhooks: {
      eventNameMode: WEBHOOK_EVENT_NAME_MODE.PARTNER_SAFE,
      eventNamespace: 'partner',
      publicSenderName: '',
      publicBaseUrl: '',
      hideVendorMetadata: true,
    },
    push: {
      enabled: false,
      provider: PUSH_PROVIDER.NONE,
      senderName: '',
      iconUrl: '',
      deepLinkBaseUrl: '',
      mobileAppId: '',
      topicPrefix: '',
      notes: '',
    },
  },

  // ── Billing & Reseller Control ───────────────────────────────────
  // White-label partner billing policy, portal routing, and downstream usage reporting.
  billingReseller: {
    mode: BILLING_RESELLER_MODE.DIRECT,
    vendorVisibility: BILLING_VENDOR_VISIBILITY.VISIBLE,
    portalMode: BILLING_PORTAL_MODE.PLATFORM,
    partnerPortalUrl: '',
    partnerSupportEmail: '',
    billingSupportLabel: '',
    activePriceBookId: '',
    resellerMarginMode: RESELLER_MARGIN_MODE.NONE,
    defaultMarkupPercent: 0,
    fixedMarkupCents: 0,
    usageReportingEnabled: false,
    downstreamInvoiceFormat: DOWNSTREAM_INVOICE_FORMAT.NONE,
    invoiceMemo: '',
    usagePricing: {
      baseMonthlyCents: 0,
      includedAiCalls: 0,
      includedTokens: 0,
      aiCallCents: 0,
      ai1kTokenCents: 0,
    },
    notes: '',
  },

  // ── Schedule ───────────────────────────────────────────────────────
  // Cron timing (informational — actual crons set in wrangler.toml).
  schedule: {
    timezone: 'UTC',
    dailyCron: '0 9 * * *', // Daily extraction
    weeklyCron: '0 3 * * 7', // Weekly lifecycle
    monthlyCron: '0 4 1 * *', // Monthly cleanup
  },

  // ── Embed & iFrame Policy ──────────────────────────────────────────
  // Controls which external origins may embed this tenant's dashboard/share
  // cockpit inside an iframe. Empty array = no embedding allowed (default).
  // Entries must be exact origins: 'https://app.partner.com'
  // Wildcard subdomains: 'https://*.partner.com'
  // The main dashboard and /my/* routes always use 'frame-ancestors none'
  // regardless of this setting. Only public share (/s/:token) routes and
  // explicitly opted-in surfaces respect allowedEmbedOrigins.
  embed: {
    allowedEmbedOrigins: [], // e.g. ['https://app.partner.com', 'https://*.acme.com']
  },

  // ── Operations & SLA ──────────────────────────────────────────────
  // Per-tenant SLA commitments, environment classification, and
  // partner-visible incident reporting config. Never reference vendor
  // infrastructure in statusPageUrl / incidentReportingUrl.
  operations: {
    environment: 'production',     // 'production' | 'sandbox'
    slaUptimeTarget: 99.9,         // SLA uptime % commitment (e.g. 99.9 = 99.9%)
    slaResponseTimeMs: 5000,       // Response-time SLA target (ms)
    maintenanceWindowCron: '',     // e.g. '0 3 * * 0' (Sunday 03:00 UTC)
    alertEmail: '',                // Ops alert email for SLA breach notifications
  },

  // ── Compliance & Data Residency ────────────────────────────────────
  // Per-tenant data residency election, DPA presentation, audit log
  // export config, and security posture evidence links. Partners present
  // their own DPA to end clients — vendor references must not appear.
  compliance: {
    // Data residency
    dataResidencyRegion: DATA_RESIDENCY_REGION.GLOBAL, // elected storage/processing region
    dataResidencyEnforced: false,  // whether infra has confirmed enforcement
    dataResidencyNotes: '',        // operator notes for contractual confirmations
    // DPA & legal
    dpaUrl: '',                    // partner-branded DPA URL presented to end clients
    dpaVersion: '',                // e.g. '2026-01'
    dpaAcceptedAt: '',             // ISO timestamp when partner last accepted upstream DPA
    privacyPolicyUrl: '',          // override for partner's end-client privacy policy URL
    // Audit log export
    auditLogRetentionDays: 90,     // how long config/admin audit entries are retained
    auditLogExportEnabled: false,  // whether /api/compliance/audit-export is active
    auditLogSiemFormat: 'jsonl',   // 'jsonl' | 'cef' — CEF = ArcSight/Splunk compatible
    auditLogWebhookUrl: '',        // push audit events to partner SIEM endpoint
    // Security posture evidence (shared under NDA for partner sales)
    securityPostureUrl: '',        // partner-branded security overview / trust page URL
    penTestReportUrl: '',          // URL to latest pen test summary (gated, NDA-protected)
    soc2ReportUrl: '',             // SOC 2 Type II report URL for partner access
    certificationNotes: '',        // ISO 27001 cert status, scope notes, NDA conditions
    // Incident comms
    incidentNotificationEmail: '', // who receives DPA breach / compliance incident notices
    notes: '',
  },

  // ── Rate Limits & Quotas ───────────────────────────────────────────
  // Per-tenant API rate limits and monthly usage quotas.
  // When a field is 0 (default), the global platform tier applies.
  // Operators set these to enforce different caps for different client tiers.
  quotas: {
    // API rate limits (per IP per window, overrides global tier when > 0)
    apiRequestsPerMinute: 0,       // /api/* — global default: 60
    oauthRequestsPerMinute: 0,     // /api/oauth/* — global default: 30
    billingRequestsPerMinute: 0,   // /my/billing/* — global default: 10
    triggerRequestsPerMinute: 0,   // /trigger — global default: 5
    auditRequestsPerHour: 0,       // /audit — global default: 10

    // Monthly usage caps (0 = unlimited / platform default)
    monthlyAiCalls: 0,             // AI analysis calls per calendar month
    monthlyTokens: 0,              // AI tokens consumed per calendar month
    monthlyExtractionRuns: 0,      // Pipeline extraction runs per month
    monthlyUrlInspections: 0,      // GSC URL inspection budget per month

    // Per-request limits
    contentAuditMaxPages: 0,       // Max pages per content audit run (0 = pipeline default)
  },
});

// ─── Required Fields ─────────────────────────────────────────────────────────

/** Fields that MUST be provided — no valid deployment without these. */
export const REQUIRED_FIELDS = ['site.id', 'site.domain', 'site.siteUrl', 'site.name'];

// ─── Deep Merge Utility ──────────────────────────────────────────────────────

/**
 * Deep merge source into target. Source values override target.
 * Arrays are replaced, not concatenated.
 *
 * @param {Object} target - Base object (defaults)
 * @param {Object} source - Overrides (customer config)
 * @returns {Object} Merged config
 */
export function deepMerge(target, source) {
  if (!source || typeof source !== 'object') {
    return target;
  }
  if (!target || typeof target !== 'object') {
    return source;
  }

  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(targetVal, sourceVal);
    } else {
      result[key] = sourceVal;
    }
  }

  return result;
}

// ─── Merge With Defaults ─────────────────────────────────────────────────────

/**
 * Merge a partial customer config with the defaults.
 * Any field not specified in customerConfig falls back to the default.
 *
 * @param {Object} customerConfig - Partial config from KV or file
 * @returns {Object} Complete config with all fields populated
 */
export function mergeWithDefaults(customerConfig) {
  // Deep-clone defaults first so callers can safely mutate the result
  // without polluting the frozen defaults (which are shallow-frozen).
  const clonedDefaults = JSON.parse(JSON.stringify(customerConfigDefaults));
  const merged = deepMerge(clonedDefaults, customerConfig);

  // Backward-compat migration shim:
  // If a stored config has the flat `domainControl` key but no `domainRouting`/`domainBranding`
  // keys, populate the new sub-keys from the flat key so that new callers get correct data
  // without requiring a data migration.
  if (merged.domainControl && typeof merged.domainControl === 'object') {
    const dc = merged.domainControl;
    // Only back-fill if the new keys weren't explicitly set in the stored config
    if (!customerConfig?.domainRouting) {
      merged.domainRouting = deepMerge(merged.domainRouting || {}, {
        appHostname: dc.appHostname || '',
        appOrigin: dc.appOrigin || '',
        domainStatus: dc.domainStatus || '',
        sslStatus: dc.sslStatus || '',
        dnsTarget: dc.dnsTarget || '',
      });
    }
    if (!customerConfig?.domainBranding) {
      merged.domainBranding = deepMerge(merged.domainBranding || {}, {
        docsUrl: dc.docsUrl || '',
        helpCenterUrl: dc.helpCenterUrl || '',
        supportPortalUrl: dc.supportPortalUrl || '',
        supportEmail: dc.supportEmail || '',
        statusPageUrl: dc.statusPageUrl || '',
        incidentReportingUrl: dc.incidentReportingUrl || '',
        onboardingUrl: dc.onboardingUrl || '',
        sendingDomain: dc.sendingDomain || '',
        emailAuthStatus: dc.emailAuthStatus || '',
        notes: dc.notes || '',
      });
    }
  }

  return merged;
}
