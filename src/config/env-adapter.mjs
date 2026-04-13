/**
 * Environment Variable → Config Adapter
 *
 * Bridges the legacy env-var-based configuration into the new customer config
 * schema. This is the BACKWARD COMPATIBILITY layer — it reads from env.*
 * and produces a partial config matching customerConfigDefaults shape.
 *
 * This allows the existing clodo.dev deployment to continue working
 * WITHOUT a KV-stored customer config. As customers migrate to KV-stored
 * configs, this adapter becomes irrelevant.
 *
 * Mapping:
 *   env.SITE_URL             → site.siteUrl
 *   env.SITE_URL (parsed)    → site.domain, site.name
 *   env.PAGESPEED_API_KEY    → (stays in env — secret)
 *   env.NOTIFY_EMAIL         → notifications.channels.email.enabled
 *   env.WEBMASTER_EMAIL      → notifications.channels.email.recipient
 *   env.NOTIFICATION_FREQUENCY → notifications.frequency
 *   env.EMAIL_PROVIDER       → email.provider
 *   env.AI_ENGINE_URL        → ai.engineUrl
 *   env.ANALYTICS_RETENTION_DAYS → pipeline.retentionDays
 *   env.CACHE_TTL_SECONDS       → pipeline.cacheTtlSeconds
 *   env.EXTRACTION_TIMEOUT      → pipeline.extractionTimeout
 *   env.AI_ANALYSIS_ENABLED     → pipeline.aiAnalysisEnabled
 */

// ─── Domain Extraction ───────────────────────────────────────────────────────

/**
 * Extract bare domain from a GSC siteUrl.
 *   'sc-domain:example.com' → 'example.com'
 *   'https://example.com/'  → 'example.com'
 *   'example.com'           → 'example.com'
 */
export function extractDomain(siteUrl) {
  if (!siteUrl) {
    return '';
  }

  let domain = siteUrl;

  // sc-domain: prefix
  if (domain.startsWith('sc-domain:')) {
    domain = domain.replace('sc-domain:', '');
  }

  // URL prefix
  domain = domain.replace(/^https?:\/\//, '');

  // Trailing slash / path
  domain = domain.split('/')[0];

  // Port
  domain = domain.split(':')[0];

  return domain.toLowerCase();
}

/**
 * Convert a GSC siteUrl to an HTTPS URL.
 *   'sc-domain:example.com' → 'https://example.com'
 *   'https://example.com'   → 'https://example.com'
 */
export function siteUrlToHttps(siteUrl) {
  if (!siteUrl) {
    return '';
  }
  if (siteUrl.startsWith('http://') || siteUrl.startsWith('https://')) {
    return siteUrl.replace(/\/$/, '');
  }
  if (siteUrl.startsWith('sc-domain:')) {
    return 'https://' + siteUrl.replace('sc-domain:', '');
  }
  return 'https://' + siteUrl;
}

/**
 * Derive a display name from a domain.
 *   'example-store.com' → 'Example Store'
 *   'clodo.dev'          → 'Clodo'
 */
function domainToName(domain) {
  if (!domain) {
    return '';
  }
  // Take the first part before the TLD
  const parts = domain.split('.');
  const name = parts[0];
  // convert hyphens to spaces and title-case
  return name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ─── Main Adapter ────────────────────────────────────────────────────────────

/**
 * Build a partial customer config from environment variables.
 * Only includes fields that are actually set in env.
 * The caller should merge this with defaults.
 *
 * @param {Object} env - Cloudflare Worker env object
 * @param {string} [siteId] - Optional siteId override
 * @returns {Object} Partial config matching customerConfigDefaults shape
 */
export function buildConfigFromEnv(env, siteId) {
  if (!env) {
    return {};
  }

  const rawSiteUrl = env.SITE_URL || '';
  const domain = extractDomain(rawSiteUrl);

  const config = {};

  // ── Site Identity ───────────────────────────────────────────────
  config.site = {
    id: siteId || domain || 'default-site',
    domain: domain,
    siteUrl: rawSiteUrl,
    name: domainToName(domain),
  };

  // ── Credentials ─────────────────────────────────────────────────
  config.credentials = {
    gscAuthMethod: env.GOOGLE_SEARCH_CONSOLE_AUTH_METHOD || 'oauth',
  };

  // ── Data Sources ────────────────────────────────────────────────
  // Infer from available credentials
  config.dataSources = {
    gsc: Boolean(
      env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID || env.GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_KEY
    ),
    bing: Boolean(env.BING_WEBMASTER_API_KEY),
    pagespeed: Boolean(env.PAGESPEED_API_KEY),
    cloudflare: false, // Would need CF analytics token
    shopify: false,
    contentAudit: true,
  };

  // ── Notifications ───────────────────────────────────────────────
  config.notifications = {
    frequency: env.NOTIFICATION_FREQUENCY || 'daily',
    channels: {
      email: {
        enabled: env.NOTIFY_EMAIL === 'true',
        recipient: env.WEBMASTER_EMAIL || '',
      },
      whatsapp: {
        enabled: env.NOTIFY_WHATSAPP === 'true',
        phoneNumber: env.WEBMASTER_WHATSAPP || '',
      },
      slack: {
        enabled: env.NOTIFY_SLACK === 'true',
        webhookUrl: env.SLACK_WEBHOOK_URL || '',
        channel: env.SLACK_CHANNEL || '#analytics',
      },
      push: {
        enabled: env.NOTIFY_PUSH === 'true',
        endpointUrl: env.PUSH_GATEWAY_URL || '',
      },
    },
  };

  config.communications = {
    email: {
      senderDisplayName: env.EMAIL_FROM_NAME || '',
      replyToAddress: env.EMAIL_REPLY_TO || env.NOTIFICATION_REPLY_TO || '',
      footerText: env.EMAIL_FOOTER_TEXT || '',
      suppressPlatformFooter: env.SUPPRESS_VENDOR_EMAIL_FOOTER === 'true',
    },
    inApp: {
      suppressVendorMessages: env.SUPPRESS_VENDOR_MESSAGES === 'true',
      setupBannerTitle: env.SETUP_BANNER_TITLE || '',
      setupBannerBody: env.SETUP_BANNER_BODY || '',
      welcomeHeadline: env.WELCOME_BANNER_HEADLINE || '',
      dismissLabel: env.BANNER_DISMISS_LABEL || '',
      supportCtaLabel: env.SUPPORT_CTA_LABEL || '',
    },
    webhooks: {
      publicSenderName: env.PUBLIC_SENDER_NAME || env.EMAIL_FROM_NAME || '',
      publicBaseUrl: env.APP_URL || env.PUBLIC_URL || '',
      eventNamespace: env.PUBLIC_EVENT_NAMESPACE || 'partner',
      eventNameMode: env.PUBLIC_EVENT_NAME_MODE || 'partner_safe',
      hideVendorMetadata: env.HIDE_VENDOR_METADATA !== 'false',
    },
    push: {
      enabled: env.NOTIFY_PUSH === 'true',
      provider: env.PUSH_PROVIDER || 'none',
      senderName: env.PUSH_SENDER_NAME || env.EMAIL_FROM_NAME || '',
      iconUrl: env.PUSH_ICON_URL || '',
      deepLinkBaseUrl: env.APP_URL || env.PUBLIC_URL || '',
      mobileAppId: env.MOBILE_APP_ID || '',
      topicPrefix: env.PUSH_TOPIC_PREFIX || '',
    },
  };

  // ── Email ───────────────────────────────────────────────────────
  if (env.EMAIL_PROVIDER) {
    config.email = {
      provider: env.EMAIL_PROVIDER,
    };
  }

  // ── Pipeline ────────────────────────────────────────────────────
  config.pipeline = {};
  if (env.ANALYTICS_RETENTION_DAYS) {
    config.pipeline.retentionDays = parseInt(env.ANALYTICS_RETENTION_DAYS, 10);
  }
  if (env.CACHE_TTL_SECONDS) {
    config.pipeline.cacheTtlSeconds = parseInt(env.CACHE_TTL_SECONDS, 10);
  }
  if (env.EXTRACTION_TIMEOUT) {
    config.pipeline.extractionTimeout = parseInt(env.EXTRACTION_TIMEOUT, 10);
  }
  if (env.AI_ANALYSIS_ENABLED !== undefined) {
    config.pipeline.aiAnalysisEnabled = env.AI_ANALYSIS_ENABLED === 'true';
  }

  // ── AI Engine ───────────────────────────────────────────────────
  if (env.AI_ENGINE_URL) {
    config.ai = {
      engineUrl: env.AI_ENGINE_URL,
      useServiceBinding: Boolean(env.AI_ENGINE), // If service binding exists, prefer it
    };
  }

  // Clean up empty sections
  if (Object.keys(config.pipeline).length === 0) {
    delete config.pipeline;
  }

  return config;
}
