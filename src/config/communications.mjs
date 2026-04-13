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

// ─── Prompt 2: In-App Message Suppression Policy ──────────────────────────────

// Platform-authored message categories that may be suppressed per tenant policy.
export const PLATFORM_MESSAGE_CATEGORY = Object.freeze({
    VENDOR_BRANDING: 'vendor_branding',
    PLATFORM_ANNOUNCEMENT: 'platform_announcement',
    UPGRADE_PROMPT: 'upgrade_prompt',
    ONBOARDING_HINT: 'onboarding_hint',
    SUPPORT_CTA: 'support_cta',
    LEGAL_NOTICE: 'legal_notice', // Cannot be suppressed
});

const SUPPRESSIBLE_CATEGORIES = new Set([
    PLATFORM_MESSAGE_CATEGORY.VENDOR_BRANDING,
    PLATFORM_MESSAGE_CATEGORY.PLATFORM_ANNOUNCEMENT,
    PLATFORM_MESSAGE_CATEGORY.UPGRADE_PROMPT,
    PLATFORM_MESSAGE_CATEGORY.ONBOARDING_HINT,
    PLATFORM_MESSAGE_CATEGORY.SUPPORT_CTA,
]);

/**
 * Build a runtime in-app message policy from resolved communications config.
 *
 * Returns an evaluatable policy object with a `shouldSuppressMessage(message)` guard
 * that consuming app UI layers call before rendering any platform-authored message.
 *
 * @param {object} config - config.communications (post-merge)
 * @returns {{ shouldSuppressMessage(msg): boolean, bannerStyle: string, tooltipTone: string, copy: object }}
 */
export function resolveInAppMessagePolicy(config = {}) {
    const resolved = resolveCommunications(config?.communications || config);
    const inApp = resolved.inApp;

    const suppressAll = inApp.suppressVendorMessages === true;
    const bannerStyle = inApp.bannerStyle;
    const isSuppressedStyle = bannerStyle === IN_APP_MESSAGE_STYLE.SUPPRESSED;

    function shouldSuppressMessage(message = {}) {
        const category = String(message?.category || PLATFORM_MESSAGE_CATEGORY.VENDOR_BRANDING);

        // Legal notices are never suppressible — always render
        if (category === PLATFORM_MESSAGE_CATEGORY.LEGAL_NOTICE) {
            return false;
        }

        // SUPPRESSED banner style suppresses all suppressible categories
        if (isSuppressedStyle && SUPPRESSIBLE_CATEGORIES.has(category)) {
            return true;
        }

        // suppressVendorMessages flag suppresses all suppressible categories
        if (suppressAll && SUPPRESSIBLE_CATEGORIES.has(category)) {
            return true;
        }

        // Individual category suppression list
        const suppressList = Array.isArray(message?.suppressCategories)
            ? message.suppressCategories
            : [];
        if (suppressList.includes(category)) {
            return true;
        }

        return false;
    }

    return Object.freeze({
        shouldSuppressMessage,
        bannerStyle,
        tooltipTone: inApp.tooltipTone,
        suppressAll: suppressAll || isSuppressedStyle,
        copy: Object.freeze({
            setupBannerTitle: inApp.setupBannerTitle,
            setupBannerBody: inApp.setupBannerBody,
            welcomeHeadline: inApp.welcomeHeadline,
            dismissLabel: inApp.dismissLabel,
            supportCtaLabel: inApp.supportCtaLabel,
        }),
    });
}

// ─── Prompt 3: Webhook Payload Sanitization ───────────────────────────────────

// Keys that should never appear in a public webhook payload when hideVendorMetadata=true
const VENDOR_METADATA_KEYS = new Set([
    'workerId', 'workerVersion', 'cfRay', 'cfRequestId',
    'platformVersion', 'internalTraceId', 'deploymentId',
    'vendorSiteId', 'vendorTenantId', 'vendorAccountId',
    '_platform', '_vendor', '_internal',
]);

// Regex patterns for vendor-identifiable values (Cloudflare Ray IDs, workers.dev URLs, etc.)
const VENDOR_VALUE_PATTERNS = [
    /\.workers\.dev/i,
    /\.pages\.dev/i,
    /cloudflare/i,
    /[0-9a-f]{16}-[0-9a-f]{16}/,  // Cloudflare Ray ID pattern
];

function isVendorValue(value) {
    if (typeof value !== 'string') return false;
    return VENDOR_VALUE_PATTERNS.some((re) => re.test(value));
}

function sanitizePayloadObject(obj, hideVendorMetadata, depth = 0) {
    if (depth > 8 || !obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
        return obj.map((item) => sanitizePayloadObject(item, hideVendorMetadata, depth + 1));
    }

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        // Drop keys in the vendor metadata denylist
        if (hideVendorMetadata && VENDOR_METADATA_KEYS.has(key)) continue;

        // Drop values that contain vendor platform identifiers
        if (hideVendorMetadata && isVendorValue(value)) continue;

        if (value && typeof value === 'object') {
            result[key] = sanitizePayloadObject(value, hideVendorMetadata, depth + 1);
        } else {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Sanitize an outbound webhook payload to remove vendor-identifiable metadata
 * and rewrite internal event names to partner-safe equivalents.
 *
 * @param {object} rawPayload   - The raw outbound payload before delivery
 * @param {object} communications - Resolved or raw communications config
 * @returns {object} - Sanitized payload safe to deliver to partner endpoints
 */
export function sanitizeWebhookPayload(rawPayload = {}, communications = {}) {
    const resolved = communications?.webhooks
        ? communications
        : resolveCommunications({ webhooks: communications });
    const webhooks = resolved.webhooks;
    const hideVendor = webhooks.hideVendorMetadata !== false;

    const sanitized = sanitizePayloadObject(rawPayload, hideVendor);

    // Rewrite event name field if present
    if (sanitized.event) {
        sanitized.event = resolvePublicEventName(sanitized.event, resolved);
    }
    if (sanitized.type) {
        sanitized.type = resolvePublicEventName(sanitized.type, resolved);
    }

    // Inject partner-safe sender identity metadata
    if (webhooks.publicSenderName) {
        sanitized.sender = webhooks.publicSenderName;
    }
    if (webhooks.publicBaseUrl) {
        sanitized.baseUrl = webhooks.publicBaseUrl;
    }

    return sanitized;
}

// ─── Prompt 4: Branded Push Notification Descriptor ──────────────────────────

/**
 * Build a ready-to-dispatch branded push notification descriptor.
 *
 * Assembles the tenant's push config (senderName, iconUrl, badge, deepLink,
 * topicPrefix) + brand identity + notification content into a single frozen
 * object a consuming Worker can hand directly to Web Push, FCM, or OneSignal.
 *
 * @param {object} pushConfig   - Resolved push config (from resolveCommunications().push)
 *                                OR raw config.communications.push (auto-resolved)
 * @param {object} brand        - Resolved brand object from brand-engine (optional)
 * @param {object} payload      - Notification content { title, body, url, data, badge }
 * @returns {object}            - Branded dispatch descriptor
 */
export function buildPushNotificationDescriptor(pushConfig = {}, brand = {}, payload = {}) {
    // Accept either resolved push sub-object or raw communications config
    const push = pushConfig?.senderName !== undefined
        ? pushConfig
        : resolveCommunications({ push: pushConfig }).push;

    const title = normalizeString(payload?.title || push.senderName || brand?.productName || '', 120);
    const body = normalizeString(payload?.body || '', 500);

    // Resolve icon: notification-specific → push brand icon → brand favicon → brand logo
    const icon = normalizeUrl(
        payload?.icon ||
        push.iconUrl ||
        brand?.faviconUrl ||
        brand?.logoUrl ||
        ''
    );

    // Badge: small monochrome icon for Android notification badge
    const badge = normalizeUrl(
        payload?.badge ||
        brand?.pwaIconUrl192 ||     // PWA icon works as badge fallback
        icon ||
        ''
    );

    // Deep link: notification click destination
    const rawUrl = normalizeUrl(payload?.url || payload?.deepLink || push.deepLinkBaseUrl || brand?.siteUrl || '');

    // Topic targeting: prefixed with partner namespace to avoid vendor topic collisions
    const topicPrefix = normalizeSlug(push.topicPrefix || brand?.productName || 'partner');
    const topic = payload?.topic
        ? `${topicPrefix}.${normalizeSlug(payload.topic)}`
        : topicPrefix;

    // Provider-specific customization hints (consuming app maps these to provider fields)
    const providerHints = Object.freeze({
        fcmAndroidChannelId: normalizeString(payload?.androidChannelId || push.mobileAppId || '', 160),
        apnsCategory: normalizeString(payload?.apnsCategory || '', 80),
        ttlSeconds: Math.max(0, Math.min(Number(payload?.ttlSeconds) || 86400, 2419200)),
    });

    return Object.freeze({
        provider: push.provider || PUSH_PROVIDER.NONE,
        senderName: normalizeString(push.senderName || brand?.productName || '', 120),
        title,
        body,
        icon,
        badge,
        url: rawUrl,
        topic,
        data: payload?.data && typeof payload.data === 'object' ? Object.freeze({ ...payload.data }) : Object.freeze({}),
        providerHints,
        // Readiness gate: consuming app checks this before dispatching
        ready: push.enabled === true && push.provider !== PUSH_PROVIDER.NONE && Boolean(title),
    });
}
