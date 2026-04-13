import { describe, it, expect } from 'vitest';
import {
  resolveCommunications,
  resolvePublicEventName,
  resolveInAppMessagePolicy,
  sanitizeWebhookPayload,
  buildPushNotificationDescriptor,
  PUSH_PROVIDER,
  IN_APP_MESSAGE_STYLE,
  PLATFORM_MESSAGE_CATEGORY,
  WEBHOOK_EVENT_NAME_MODE,
} from '../../src/config/communications.mjs';
import { buildEmailTemplateContext } from '../../src/email/email-sender.mjs';

// ─── Prompt 1: buildEmailTemplateContext ──────────────────────────────────────

describe('buildEmailTemplateContext', () => {
  it('assembles sender identity, brand tokens, and template copy', () => {
    const tenant = {
      config: {
        emailSender: {
          fromName: 'Acme Team',
          fromAddress: 'hello@acme.com',
          replyToAddress: 'support@acme.com',
          subjectPrefix: '[Acme]',
        },
      },
    };
    const brand = {
      productName: 'Acme Platform',
      logoUrl: 'https://cdn.acme.com/logo.png',
      primaryColor: '#FF5733',
      emailHeaderGradient: 'linear-gradient(135deg, #FF5733, #C70039)',
    };
    const config = {
      communications: {
        email: {
          footerText: 'Acme Inc. All rights reserved.',
          suppressPlatformFooter: true,
          templates: {
            onboarding: {
              subject: 'Welcome to {{productName}}',
              headline: 'You are in!',
              ctaLabel: 'Get started',
            },
          },
        },
      },
      domainBranding: { supportEmail: 'support@acme.com', sendingDomain: 'mail.acme.com' },
    };

    const ctx = buildEmailTemplateContext(tenant, config, brand, 'onboarding', {
      recipientEmail: 'user@example.com',
      ctaUrl: 'https://app.acme.com/onboard',
    });

    expect(ctx.fromName).toBe('Acme Team');
    expect(ctx.fromAddress).toBe('hello@acme.com');
    expect(ctx.replyTo).toBe('support@acme.com');
    expect(ctx.sendingDomain).toBe('acme.com'); // derived from fromAddress
    expect(ctx.subject).toBe('[Acme] Welcome to {{productName}}');
    expect(ctx.headline).toBe('You are in!');
    expect(ctx.ctaLabel).toBe('Get started');
    expect(ctx.ctaUrl).toBe('https://app.acme.com/onboard');
    expect(ctx.logoUrl).toBe('https://cdn.acme.com/logo.png');
    expect(ctx.primaryColor).toBe('#FF5733');
    expect(ctx.footerText).toBe('Acme Inc. All rights reserved.');
    expect(ctx.suppressPlatformFooter).toBe(true);
    expect(ctx.supportEmail).toBe('support@acme.com');
    expect(ctx.recipientEmail).toBe('user@example.com');
    expect(ctx.templateKey).toBe('onboarding');
  });

  it('derives sendingDomain from domainBranding when fromAddress is absent', () => {
    const ctx = buildEmailTemplateContext(null, {
      domainBranding: { sendingDomain: 'alerts.partner.com' },
    }, {}, 'alerts');
    expect(ctx.sendingDomain).toBe('alerts.partner.com');
  });

  it('falls back gracefully when tenant and brand are absent', () => {
    const ctx = buildEmailTemplateContext(null, {}, {}, 'billing');
    expect(ctx.fromName).toBe('Notifications');
    expect(ctx.templateKey).toBe('billing');
    expect(ctx.suppressPlatformFooter).toBe(false);
  });
});

// ─── Prompt 2: resolveInAppMessagePolicy ─────────────────────────────────────

describe('resolveInAppMessagePolicy', () => {
  it('shouldSuppressMessage returns false when suppressVendorMessages is off', () => {
    const policy = resolveInAppMessagePolicy({
      communications: { inApp: { suppressVendorMessages: false } },
    });
    expect(policy.shouldSuppressMessage({ category: PLATFORM_MESSAGE_CATEGORY.VENDOR_BRANDING })).toBe(false);
    expect(policy.suppressAll).toBe(false);
  });

  it('suppresses all suppressible categories when suppressVendorMessages=true', () => {
    const policy = resolveInAppMessagePolicy({
      communications: { inApp: { suppressVendorMessages: true } },
    });
    expect(policy.shouldSuppressMessage({ category: PLATFORM_MESSAGE_CATEGORY.VENDOR_BRANDING })).toBe(true);
    expect(policy.shouldSuppressMessage({ category: PLATFORM_MESSAGE_CATEGORY.UPGRADE_PROMPT })).toBe(true);
    expect(policy.shouldSuppressMessage({ category: PLATFORM_MESSAGE_CATEGORY.ONBOARDING_HINT })).toBe(true);
    expect(policy.suppressAll).toBe(true);
  });

  it('SUPPRESSED bannerStyle also suppresses all suppressible categories', () => {
    const policy = resolveInAppMessagePolicy({
      communications: { inApp: { bannerStyle: IN_APP_MESSAGE_STYLE.SUPPRESSED } },
    });
    expect(policy.shouldSuppressMessage({ category: PLATFORM_MESSAGE_CATEGORY.PLATFORM_ANNOUNCEMENT })).toBe(true);
    expect(policy.bannerStyle).toBe(IN_APP_MESSAGE_STYLE.SUPPRESSED);
  });

  it('never suppresses LEGAL_NOTICE regardless of suppression settings', () => {
    const policy = resolveInAppMessagePolicy({
      communications: { inApp: { suppressVendorMessages: true } },
    });
    expect(policy.shouldSuppressMessage({ category: PLATFORM_MESSAGE_CATEGORY.LEGAL_NOTICE })).toBe(false);
  });

  it('exposes customized copy fields', () => {
    const policy = resolveInAppMessagePolicy({
      communications: {
        inApp: {
          welcomeHeadline: 'Welcome to Acme!',
          setupBannerTitle: 'Set up your workspace',
          supportCtaLabel: 'Contact Acme Support',
        },
      },
    });
    expect(policy.copy.welcomeHeadline).toBe('Welcome to Acme!');
    expect(policy.copy.setupBannerTitle).toBe('Set up your workspace');
    expect(policy.copy.supportCtaLabel).toBe('Contact Acme Support');
  });
});

// ─── Prompt 3: sanitizeWebhookPayload ────────────────────────────────────────

describe('sanitizeWebhookPayload', () => {
  it('rewrites event and type to partner-safe names', () => {
    const comms = resolveCommunications({
      webhooks: { eventNameMode: WEBHOOK_EVENT_NAME_MODE.PARTNER_SAFE, eventNamespace: 'acme' },
    });
    const result = sanitizeWebhookPayload(
      { event: 'outbound.email_sent', type: 'user.signup', userId: '123' },
      comms
    );
    expect(result.event).toBe('acme.message.sent');
    expect(result.type).toBe('acme.account.created');
    expect(result.userId).toBe('123');
  });

  it('strips known vendor metadata keys when hideVendorMetadata=true', () => {
    const comms = resolveCommunications({
      webhooks: { hideVendorMetadata: true },
    });
    const result = sanitizeWebhookPayload(
      {
        event: 'digest.sent',
        workerId: 'cf-worker-abc',
        internalTraceId: 'trace-xyz',
        cfRay: '7abc-IAD',
        userId: 'user-42',
      },
      comms
    );
    expect(result.workerId).toBeUndefined();
    expect(result.internalTraceId).toBeUndefined();
    expect(result.cfRay).toBeUndefined();
    expect(result.userId).toBe('user-42');
  });

  it('strips values that match vendor platform URL patterns', () => {
    const comms = resolveCommunications({ webhooks: { hideVendorMetadata: true } });
    const result = sanitizeWebhookPayload(
      { callbackUrl: 'https://my-worker.workers.dev/hook', userId: 'u1' },
      comms
    );
    expect(result.callbackUrl).toBeUndefined();
    expect(result.userId).toBe('u1');
  });

  it('injects partner publicSenderName and publicBaseUrl into sanitized payload', () => {
    const comms = resolveCommunications({
      webhooks: {
        publicSenderName: 'Acme Webhooks',
        publicBaseUrl: 'https://hooks.acme.com',
      },
    });
    const result = sanitizeWebhookPayload({ event: 'trial.expiring' }, comms);
    expect(result.sender).toBe('Acme Webhooks');
    expect(result.baseUrl).toBe('https://hooks.acme.com');
  });

  it('preserves canonical event names when mode=canonical', () => {
    const comms = resolveCommunications({
      webhooks: { eventNameMode: WEBHOOK_EVENT_NAME_MODE.CANONICAL },
    });
    const result = sanitizeWebhookPayload({ event: 'outbound.email_sent' }, comms);
    expect(result.event).toBe('outbound.email_sent');
  });
});

// ─── Prompt 4: buildPushNotificationDescriptor ───────────────────────────────

describe('buildPushNotificationDescriptor', () => {
  const pushConfig = {
    enabled: true,
    provider: PUSH_PROVIDER.FCM,
    senderName: 'Acme Alerts',
    iconUrl: 'https://cdn.acme.com/icon.png',
    deepLinkBaseUrl: 'https://app.acme.com',
    topicPrefix: 'acme',
    mobileAppId: 'com.acme.app',
  };
  const brand = {
    productName: 'Acme Platform',
    faviconUrl: 'https://cdn.acme.com/favicon.ico',
    siteUrl: 'https://app.acme.com',
  };

  it('assembles a fully branded push descriptor', () => {
    const descriptor = buildPushNotificationDescriptor(pushConfig, brand, {
      title: 'Weekly Report Ready',
      body: 'Your Acme analytics digest is ready to view.',
      url: 'https://app.acme.com/reports/42',
      topic: 'digest',
    });

    expect(descriptor.provider).toBe(PUSH_PROVIDER.FCM);
    expect(descriptor.senderName).toBe('Acme Alerts');
    expect(descriptor.title).toBe('Weekly Report Ready');
    expect(descriptor.body).toBe('Your Acme analytics digest is ready to view.');
    expect(descriptor.icon).toBe('https://cdn.acme.com/icon.png');
    expect(descriptor.url).toBe('https://app.acme.com/reports/42');
    expect(descriptor.topic).toBe('acme.digest');
    expect(descriptor.ready).toBe(true);
  });

  it('is not ready when push is disabled', () => {
    const descriptor = buildPushNotificationDescriptor(
      { ...pushConfig, enabled: false },
      brand,
      { title: 'Alert' }
    );
    expect(descriptor.ready).toBe(false);
  });

  it('is not ready when provider is none', () => {
    const descriptor = buildPushNotificationDescriptor(
      { ...pushConfig, provider: PUSH_PROVIDER.NONE },
      brand,
      { title: 'Alert' }
    );
    expect(descriptor.ready).toBe(false);
  });

  it('falls back to brand icon when push iconUrl is absent', () => {
    const descriptor = buildPushNotificationDescriptor(
      { ...pushConfig, iconUrl: '' },
      brand,
      { title: 'Alert' }
    );
    expect(descriptor.icon).toBe('https://cdn.acme.com/favicon.ico');
  });

  it('carries arbitrary data payload through untouched', () => {
    const descriptor = buildPushNotificationDescriptor(pushConfig, brand, {
      title: 'Alert',
      data: { reportId: 'rpt-99', tenantId: 'acme' },
    });
    expect(descriptor.data.reportId).toBe('rpt-99');
    expect(descriptor.data.tenantId).toBe('acme');
  });

  it('includes FCM providerHints', () => {
    const descriptor = buildPushNotificationDescriptor(pushConfig, brand, {
      title: 'Alert',
      androidChannelId: 'acme-alerts',
    });
    expect(descriptor.providerHints.fcmAndroidChannelId).toBe('acme-alerts');
    expect(descriptor.providerHints.ttlSeconds).toBe(86400);
  });
});
