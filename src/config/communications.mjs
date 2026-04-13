/**
 * Communications & Notifications white-label control plane.
 *
 * Centralizes tenant-configurable email template overrides, in-app message
 * suppression/customization, public webhook/event naming, and push branding.
 */

import { PLATFORM_DEFAULTS } from '../brand/brand-engine.mjs';

export const IN_APP_MESSAGE_STYLE = Object.freeze({
    BRAND: 'brand',
    MINIMAL: 'minimal',
    SUPPRESSED: 'suppressed',
});
export const IN_APP_MESSAGE_STYLE_VALUES = Object.freeze(Object.values(IN_APP_MESSAGE_STYLE));

export const TOOLTIP_TONE = Object.freeze({
    GUIDED: 'guided',
    CONCISE: 'concise',
    NEUTRAL: 'neutral',
});
export const TOOLTIP_TONE_VALUES = Object.freeze(Object.values(TOOLTIP_TONE));

export const WEBHOOK_EVENT_NAME_MODE = Object.freeze({
    PARTNER_SAFE: 'partner_safe',
    CANONICAL: 'canonical',
});
export const WEBHOOK_EVENT_NAME_MODE_VALUES = Object.freeze(Object.values(WEBHOOK_EVENT_NAME_MODE));

export const PUSH_PROVIDER = Object.freeze({
    NONE: 'none',
    WEB_PUSH: 'webpush',
    FCM: 'fcm',
    ONESIGNAL: 'onesignal',
});
export const PUSH_PROVIDER_VALUES = Object.freeze(Object.values(PUSH_PROVIDER));

const TEMPLATE_KEYS = Object.freeze(['onboarding', 'passwordReset', 'billing', 'alerts']);

const DEFAULT_TEMPLATE_OVERRIDE = Object.freeze({
    enabled: true,
    subject: '',
    preheader: '',
    headline: '',
    introText: '',
    ctaLabel: '',
    footerNote: '',
});

const PARTNER_SAFE_EVENT_MAP = Object.freeze({
    'outbound.email_sent': 'message.sent',
    'outbound.email_opened': 'message.opened',
    'outbound.email_clicked': 'message.clicked',
    'outbound.email_replied': 'message.replied',
    'outbound.email_bounced': 'message.bounced',
    'outbound.email_complained': 'message.complained',
    'outbound.unsubscribed': 'message.unsubscribed',
    'digest.sent': 'digest.sent',
    'trial.expiring': 'trial.expiring',
    'user.signup': 'account.created',
    'user.converted': 'account.converted',
    'plan.upgraded': 'billing.plan_upgraded',
    'plan.downgraded': 'billing.plan_downgraded',
});

function normalizeString(value, max = 500) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeUrl(value) {
    const normalized = normalizeString(value, 2000);
    return /^https?:\/\//i.test(normalized) ? normalized : '';
}

function normalizeSlug(value, fallback = 'partner') {
    const normalized = normalizeString(value, 80)
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || fallback;
}

function normalizeTemplateOverride(value = {}) {
    return Object.freeze({
        enabled: value?.enabled !== false,
        subject: normalizeString(value?.subject, 160),
        preheader: normalizeString(value?.preheader, 220),
        headline: normalizeString(value?.headline, 180),
        introText: normalizeString(value?.introText, 500),
        ctaLabel: normalizeString(value?.ctaLabel, 80),
        footerNote: normalizeString(value?.footerNote, 280),
    });
}

export function resolveCommunications(config = {}, brand = {}) {
    const effectiveBrand = { ...(PLATFORM_DEFAULTS || {}), ...(brand || {}) };
    const email = config?.email || {};
    const inApp = config?.inApp || {};
    const webhooks = config?.webhooks || {};
    const push = config?.push || {};

    const templates = Object.freeze(
        TEMPLATE_KEYS.reduce((acc, key) => {
            acc[key] = normalizeTemplateOverride(email?.templates?.[key] || email?.[key] || DEFAULT_TEMPLATE_OVERRIDE);
            return acc;
        }, {})
    );

    return Object.freeze({
        email: Object.freeze({
            senderDisplayName: normalizeString(email?.senderDisplayName || effectiveBrand.productName, 120),
            replyToAddress: normalizeString(
                email?.replyToAddress || effectiveBrand.emailReplyTo || effectiveBrand.supportEmail,
                160
            ),
            footerText: normalizeString(email?.footerText, 280),
            legalFooterText: normalizeString(email?.legalFooterText, 280),
            suppressPlatformFooter: Boolean(email?.suppressPlatformFooter),
            templates,
        }),
        inApp: Object.freeze({
            suppressVendorMessages: Boolean(inApp?.suppressVendorMessages),
            bannerStyle: IN_APP_MESSAGE_STYLE_VALUES.includes(inApp?.bannerStyle)
                ? inApp.bannerStyle
                : IN_APP_MESSAGE_STYLE.BRAND,
            tooltipTone: TOOLTIP_TONE_VALUES.includes(inApp?.tooltipTone)
                ? inApp.tooltipTone
                : TOOLTIP_TONE.GUIDED,
            setupBannerTitle: normalizeString(inApp?.setupBannerTitle, 160),
            setupBannerBody: normalizeString(inApp?.setupBannerBody, 320),
            welcomeHeadline: normalizeString(inApp?.welcomeHeadline, 160),
            dismissLabel: normalizeString(inApp?.dismissLabel, 40),
            supportCtaLabel: normalizeString(inApp?.supportCtaLabel, 60),
        }),
        webhooks: Object.freeze({
            eventNameMode: WEBHOOK_EVENT_NAME_MODE_VALUES.includes(webhooks?.eventNameMode)
                ? webhooks.eventNameMode
                : WEBHOOK_EVENT_NAME_MODE.PARTNER_SAFE,
            eventNamespace: normalizeSlug(webhooks?.eventNamespace || 'partner'),
            publicSenderName: normalizeString(webhooks?.publicSenderName || effectiveBrand.productName, 120),
            publicBaseUrl: normalizeUrl(webhooks?.publicBaseUrl || effectiveBrand.siteUrl || ''),
            hideVendorMetadata: webhooks?.hideVendorMetadata !== false,
        }),
        push: Object.freeze({
            enabled: Boolean(push?.enabled),
            provider: PUSH_PROVIDER_VALUES.includes(push?.provider) ? push.provider : PUSH_PROVIDER.NONE,
            senderName: normalizeString(push?.senderName || effectiveBrand.productName, 120),
            iconUrl: normalizeUrl(push?.iconUrl || effectiveBrand.faviconUrl || effectiveBrand.logoUrl || ''),
            deepLinkBaseUrl: normalizeUrl(push?.deepLinkBaseUrl || effectiveBrand.siteUrl || ''),
            mobileAppId: normalizeString(push?.mobileAppId, 160),
            topicPrefix: normalizeSlug(push?.topicPrefix || effectiveBrand.productName || 'partner'),
            notes: normalizeString(push?.notes, 500),
        }),
    });
}

export function resolvePublicEventName(eventName, communications = {}) {
    const resolved = communications?.webhooks ? communications : resolveCommunications({ webhooks: communications });
    const mode = resolved?.webhooks?.eventNameMode || WEBHOOK_EVENT_NAME_MODE.PARTNER_SAFE;
    if (mode === WEBHOOK_EVENT_NAME_MODE.CANONICAL) {
        return String(eventName || 'event.unknown');
    }

    const namespace = resolved?.webhooks?.eventNamespace || 'partner';
    const mapped = PARTNER_SAFE_EVENT_MAP[String(eventName || '')] || String(eventName || 'event.unknown').replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
    return `${namespace}.${mapped}`;
}
