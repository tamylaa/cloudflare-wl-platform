/**
 * Email sender integration with SendGrid / Brevo / Mailgun
 * Sends formatted email notifications to webmaster
 */

import { getCircuitBreaker } from '../utils/circuit-breaker.mjs';

/**
 * Resolve the effective sender identity for an outbound email.
 *
 * Priority chain (first truthy fromAddress wins):
 *   1. tenant.config.emailSender.fromAddress (per-tenant schema field)
 *   2. tenant brand productName + platform env address (tenant brand name only)
 *   3. env.EMAIL_FROM_NAME + env.EMAIL_FROM_ADDRESS / env.EMAIL_FROM (platform env)
 *   4. Hard fallback ("Notifications" + noreply@localhost)
 *
 * @param {Object|null} tenant - Tenant object (may have .config.emailSender and .getBrand())
 * @param {Object|null} env - Cloudflare Worker environment bindings
 * @returns {{ fromName: string, fromAddress: string, replyTo: string|null, subjectPrefix: string }}
 */
export function resolveSenderIdentity(tenant, env) {
  const es = tenant?.config?.emailSender;
  if (es?.fromAddress) {
    return {
      fromName: es.fromName || es.fromAddress,
      fromAddress: es.fromAddress,
      replyTo: es.replyToAddress || null,
      subjectPrefix: es.subjectPrefix || '',
    };
  }

  const productName = tenant?.getBrand?.()?.productName;
  const platformAddress = env?.EMAIL_FROM_ADDRESS || env?.EMAIL_FROM || '';
  if (productName && platformAddress) {
    return {
      fromName: productName,
      fromAddress: platformAddress,
      replyTo: null,
      subjectPrefix: '',
    };
  }

  if (env?.EMAIL_FROM_NAME && platformAddress) {
    return {
      fromName: env.EMAIL_FROM_NAME,
      fromAddress: platformAddress,
      replyTo: null,
      subjectPrefix: '',
    };
  }

  return {
    fromName: 'Notifications',
    fromAddress: platformAddress || '',
    replyTo: null,
    subjectPrefix: '',
  };
}

/**
 * Resolve an email circuit breaker instance.
 * Prefers explicitly supplied breaker and otherwise lazily creates a named
 * breaker per provider when enabled.
 *
 * @param {Object} config
 * @returns {Object|null}
 */
export function resolveEmailCircuitBreaker(config = {}) {
  if (config?.circuitBreaker && typeof config.circuitBreaker.execute === 'function') {
    return config.circuitBreaker;
  }

  if (config?.enableCircuitBreaker === false) {
    return null;
  }

  if (!config?.provider) {
    return null;
  }

  const breakerName =
    String(config.circuitBreakerName || `email-${String(config.provider).toLowerCase()}`).trim() ||
    'email-provider';
  const breakerOptions =
    config?.circuitBreakerOptions && typeof config.circuitBreakerOptions === 'object'
      ? config.circuitBreakerOptions
      : undefined;

  return getCircuitBreaker(breakerName, breakerOptions);
}

/**
 * Send email notification with error boundaries and circuit breaker support.
 *
 * Returns a result object instead of throwing. This allows graceful error handling
 * in the consuming application. If the application wants to queue failed sends for retry,
 * it can inspect the result and store it.
 *
 * @param {Object} config - Email configuration
 * @param {string} config.provider - 'sendgrid' | 'brevo' | 'mailgun' | 'resend'
 * @param {string} config.apiKey - Provider API key
 * @param {string} [config.fromAddress] - Sender email address
 * @param {string} [config.fromName] - Sender display name
 * @param {string} [config.subject] - Email subject line
 * @param {Object} [config.circuitBreaker] - Optional circuit breaker (from utils/circuit-breaker.mjs)
 * @param {string} recipientEmail - Email to send to
 * @param {string} htmlBody - HTML email body
 * @param {string} textBody - Plain text email body
 * @param {Object} env - Cloudflare environment
 * @param {Object|null} [tenant] - Optional tenant object for per-tenant sender identity
 *
 * @returns {Promise<{ success: boolean, provider: string, messageId?: string, error?: string, retryable?: boolean }>}
 */
export async function sendEmailNotification(config, recipientEmail, htmlBody, textBody, env, tenant = null) {
  // Validate minimal config
  if (!config?.provider) {
    return { success: false, error: 'No email provider configured', retryable: false };
  }

  if (!recipientEmail || !recipientEmail.includes('@')) {
    return { success: false, error: `Invalid recipient email: ${recipientEmail}`, retryable: false };
  }

  const senderConfig = {
    fromAddress: config.fromAddress || '',
    fromName: config.fromName || '',
    subject: config.subject || '',
    replyTo: config.replyTo || '',
  };

  // Apply per-tenant sender identity — overrides config-level fromAddress/fromName/replyTo
  const identity = resolveSenderIdentity(tenant, env);
  if (identity.fromAddress && identity.fromAddress !== 'noreply@localhost') {
    senderConfig.fromName = identity.fromName || senderConfig.fromName;
    senderConfig.fromAddress = identity.fromAddress;
    if (identity.replyTo) senderConfig.replyTo = identity.replyTo;
  }

  // Prepend tenant subjectPrefix when set
  if (identity.subjectPrefix && senderConfig.subject) {
    senderConfig.subject = `${identity.subjectPrefix} ${senderConfig.subject}`;
  }

  if (!senderConfig.fromAddress) {
    return {
      success: false,
      provider: config.provider,
      error:
        'No fromAddress configured. Refusing to send without an explicit sender identity.',
      retryable: false,
    };
  }

  const circuitBreaker = resolveEmailCircuitBreaker(config);

  // Define the send operation
  const sendOperation = async () => {
    switch (config.provider.toLowerCase()) {
      case 'sendgrid':
        return await sendViaSendGrid(
          config.apiKey,
          recipientEmail,
          htmlBody,
          textBody,
          senderConfig
        );
      case 'brevo':
        return await sendViaBrevo(config.apiKey, recipientEmail, htmlBody, textBody, senderConfig);
      case 'mailgun':
        return await sendViaMailgun(
          config.apiKey,
          config.domain,
          recipientEmail,
          htmlBody,
          textBody,
          senderConfig
        );
      case 'resend':
        return await sendViaResend(config.apiKey, recipientEmail, htmlBody, textBody, senderConfig);
      default:
        throw new Error(`Unknown email provider: ${config.provider}`);
    }
  };

  // Execute with optional circuit breaker
  try {
    if (circuitBreaker) {
      // Use circuit breaker if provided — prevents cascading failures
      return await circuitBreaker.execute(sendOperation, async () => {
        console.warn(`[EmailSender] Circuit breaker OPEN — returning failure without attempting send`);
        return {
          success: false,
          provider: config.provider,
          error: 'Circuit breaker is open — provider temporarily unavailable',
          retryable: true, // Retry when circuit resets
        };
      });
    } else {
      return await sendOperation();
    }
  } catch (error) {
    // Log error with context for debugging
    const errorMsg = error?.message || String(error);
    const isRetryable = 
      error?.code === 'ECONNREFUSED' || 
      error?.code === 'ETIMEDOUT' ||
      error?.message?.includes('429') ||
      error?.message?.includes('5xx') ||
      error?.message?.includes('timeout');
    
    console.error(
      `[EmailSender] Send failed for ${config.provider}`,
      {
        provider: config.provider,
        recipient: recipientEmail,
        error: errorMsg,
        retryable: isRetryable,
      }
    );
    
    return {
      success: false,
      provider: config.provider,
      error: errorMsg,
      retryable: isRetryable, // Consuming app can query this to decide on retry/queue
    };
  }
}

/**
 * Send via SendGrid API
 */
async function sendViaSendGrid(apiKey, recipientEmail, htmlBody, textBody, sender = {}) {
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: recipientEmail }],
          subject: sender.subject || 'Analytics Report',
        },
      ],
      from: {
        email: sender.fromAddress,
        name: sender.fromName || 'Analytics',
      },
      ...(sender.replyTo ? { reply_to: { email: sender.replyTo, name: sender.fromName || 'Analytics' } } : {}),
      content: [
        { type: 'text/plain', value: textBody },
        { type: 'text/html', value: htmlBody },
      ],
      trackingSettings: {
        clickTracking: { enable: true },
        openTracking: { enable: true },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`SendGrid error (${response.status}): ${response.statusText}${body ? ' — ' + body : ''}`);
  }

  return { success: true, provider: 'sendgrid', messageId: response.headers.get('X-Message-Id') };
}

/**
 * Send via Brevo API
 */
async function sendViaBrevo(apiKey, recipientEmail, htmlBody, textBody, sender = {}) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: [{ email: recipientEmail }],
      sender: {
        name: sender.fromName || 'Analytics',
        email: sender.fromAddress,
      },
      subject: sender.subject || 'Analytics Report',
      ...(sender.replyTo ? { replyTo: { email: sender.replyTo, name: sender.fromName || 'Analytics' } } : {}),
      htmlContent: htmlBody,
      textContent: textBody,
      tags: sender.tags || ['analytics', 'notification'],
      trackingEnabled: true,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Brevo error (${response.status}): ${response.statusText}${errorBody ? ' — ' + errorBody : ''}`);
  }

  const data = await response.json();
  return { success: true, provider: 'brevo', messageId: data.messageId };
}

/**
 * Send via Mailgun API
 */
async function sendViaMailgun(apiKey, domain, recipientEmail, htmlBody, textBody, sender = {}) {
  const formData = new FormData();
  formData.append(
    'from',
    `${sender.fromName || 'Analytics'} <${sender.fromAddress}>`
  );
  formData.append('to', recipientEmail);
  formData.append('subject', sender.subject || 'Analytics Report');
  formData.append('text', textBody);
  formData.append('html', htmlBody);
  if (sender.replyTo) {
    formData.append('h:Reply-To', sender.replyTo);
  }
  formData.append('o:tracking', 'yes');
  formData.append('o:tracking-clicks', 'yes');
  formData.append('o:tracking-opens', 'yes');

  const response = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`api:${apiKey}`)}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Mailgun error (${response.status}): ${response.statusText}${body ? ' — ' + body : ''}`);
  }

  const data = await response.json();
  return { success: true, provider: 'mailgun', messageId: data.id };
}

/**
 * Send via Resend API (modern, simple alternative)
 */
async function sendViaResend(apiKey, recipientEmail, htmlBody, textBody, sender = {}) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${sender.fromName || 'Analytics'} <${sender.fromAddress}>`,
      to: recipientEmail,
      subject: sender.subject || 'Analytics Report',
      ...(sender.replyTo ? { reply_to: sender.replyTo } : {}),
      html: htmlBody,
      text: textBody,
      tags: [
        { name: 'category', value: 'analytics' },
        { name: 'type', value: 'recommendations' },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Resend error (${response.status}): ${response.statusText}${body ? ' — ' + body : ''}`);
  }

  const data = await response.json();
  return { success: true, provider: 'resend', messageId: data.id };
}

// ─── Prompt 1: Unified Email Template Context Assembler ───────────────────────

/**
 * Build a complete email rendering context object by merging:
 *   - Per-tenant sender identity (fromAddress, fromName, replyTo, subjectPrefix)
 *   - Brand visual tokens (logo, colors, productName, tagline, footer gradient)
 *   - Template copy overrides (subject, headline, introText, ctaLabel, footerNote)
 *   - Sending domain / suppression flags from communications config
 *
 * Consuming app passes this context directly to any i18n-safe email template
 * engine (Handlebars, Nunjucks, MJML, etc.) — no vendor branding will appear
 * if the tenant has fully configured their white-label fields.
 *
 * @param {object|null} tenant       - Resolved tenant (from tenant-context)
 * @param {object} config            - Full merged customer config (post mergeWithDefaults)
 * @param {object} brand             - Resolved brand object (from brand-engine)
 * @param {string} templateKey       - One of: 'onboarding' | 'passwordReset' | 'billing' | 'alerts'
 * @param {object} [overrides]       - Call-site overrides: { subject, recipientEmail, ctaUrl, ... }
 * @returns {object}
 */
export function buildEmailTemplateContext(tenant, config = {}, brand = {}, templateKey = 'alerts', overrides = {}) {
  const identity = resolveSenderIdentity(tenant, null);

  const commsEmail = config?.communications?.email || {};
  const templateOverride = commsEmail?.templates?.[templateKey] || {};

  // Sending domain: explicit emailSender.fromAddress domain → config.domainBranding.sendingDomain →
  // brand appOrigin domain → empty (caller must provide)
  const senderAddress = identity.fromAddress || '';
  const sendingDomain = (() => {
    if (senderAddress.includes('@')) {
      return senderAddress.split('@')[1] || '';
    }
    if (config?.domainBranding?.sendingDomain) {
      return config.domainBranding.sendingDomain;
    }
    if (config?.domainControl?.sendingDomain) {
      return config.domainControl.sendingDomain;
    }
    return '';
  })();

  const subjectBase = templateOverride.subject || overrides.subject || '';
  const subjectPrefix = identity.subjectPrefix
    ? `${identity.subjectPrefix} `
    : (commsEmail.templates?.[templateKey]?.subject ? '' : '');

  return Object.freeze({
    // Sender identity
    fromName: identity.fromName || brand?.productName || 'Notifications',
    fromAddress: identity.fromAddress || '',
    replyTo: identity.replyTo || commsEmail.replyToAddress || '',
    sendingDomain,
    subjectPrefix,

    // Assembled subject (prefix + template override + call-site override)
    subject: subjectBase ? `${subjectPrefix}${subjectBase}` : '',

    // Visual brand tokens
    productName: brand?.productName || '',
    tagline: brand?.tagline || '',
    logoUrl: brand?.resolvedLogoUrl || brand?.logoUrl || '',
    faviconUrl: brand?.faviconUrl || '',
    primaryColor: brand?.primaryColor || '#3b82f6',
    secondaryColor: brand?.secondaryColor || '#8b5cf6',
    accentColor: brand?.accentColor || '#14b8a6',
    emailHeaderGradient: brand?.emailHeaderGradient || 'linear-gradient(135deg, #3b82f6, #8b5cf6)',

    // Template copy (tenant overrides → schema defaults)
    templateKey,
    headline: templateOverride.headline || overrides.headline || '',
    introText: templateOverride.introText || overrides.introText || '',
    ctaLabel: templateOverride.ctaLabel || overrides.ctaLabel || '',
    ctaUrl: overrides.ctaUrl || '',
    footerNote: templateOverride.footerNote || overrides.footerNote || '',
    preheader: templateOverride.preheader || overrides.preheader || '',

    // Shared footer copy
    footerText: commsEmail.footerText || '',
    legalFooterText: commsEmail.legalFooterText || '',
    suppressPlatformFooter: commsEmail.suppressPlatformFooter === true,

    // Support / branding links
    supportEmail: config?.domainBranding?.supportEmail || config?.domainControl?.supportEmail || '',
    supportPortalUrl: config?.domainBranding?.supportPortalUrl || config?.domainControl?.supportPortalUrl || '',
    passwordResetUrl: config?.authIdentity?.passwordResetUrl || overrides.passwordResetUrl || '',
    unsubscribeUrl: overrides.unsubscribeUrl || '',

    // Recipient (call-site must supply)
    recipientEmail: overrides.recipientEmail || '',
    recipientName: overrides.recipientName || '',
  });
}

export default {
  sendEmailNotification,
  resolveSenderIdentity,
  resolveEmailCircuitBreaker,
  buildEmailTemplateContext,
  sendViaSendGrid,
  sendViaBrevo,
  sendViaMailgun,
  sendViaResend,
};
