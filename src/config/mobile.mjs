/**
 * Mobile & PWA white-label control plane.
 *
 * Centralizes tenant-configurable PWA manifest fields, splash/icon assets,
 * push notification branding, and mobile app store identity — all surfaces
 * must remain vendor-neutral when configured by a partner.
 */

// ── PWA Display Mode ──────────────────────────────────────────────────────────

export const PWA_DISPLAY_MODE = Object.freeze({
  STANDALONE: 'standalone',
  FULLSCREEN: 'fullscreen',
  MINIMAL_UI: 'minimal-ui',
  BROWSER: 'browser',
});
export const PWA_DISPLAY_MODE_VALUES = Object.freeze(Object.values(PWA_DISPLAY_MODE));

// ── PWA Orientation Lock ───────────────────────────────────────────────────────

export const PWA_ORIENTATION = Object.freeze({
  ANY: 'any',
  PORTRAIT: 'portrait',
  LANDSCAPE: 'landscape',
});
export const PWA_ORIENTATION_VALUES = Object.freeze(Object.values(PWA_ORIENTATION));

// ── Mobile App Platform ───────────────────────────────────────────────────────

export const MOBILE_APP_PLATFORM = Object.freeze({
  NONE: 'none',
  PWA: 'pwa',
  NATIVE_IOS: 'native-ios',
  NATIVE_ANDROID: 'native-android',
  CROSS_PLATFORM: 'cross-platform', // React Native / Flutter under partner account
});
export const MOBILE_APP_PLATFORM_VALUES = Object.freeze(Object.values(MOBILE_APP_PLATFORM));

// ── Data Residency Region ─────────────────────────────────────────────────────
// White-label safe values — no vendor infrastructure names.

export const DATA_RESIDENCY_REGION = Object.freeze({
  GLOBAL: 'global',
  EU: 'eu',
  US: 'us',
  APAC: 'apac',
  UK: 'uk',
  CA: 'ca',
});
export const DATA_RESIDENCY_REGION_VALUES = Object.freeze(Object.values(DATA_RESIDENCY_REGION));

// ── Vendor terms that must not appear in partner-facing mobile surfaces ───────
// Includes both infrastructure vendors and the AI platform vendor.
const MOBILE_VENDOR_TERMS = [
  'cloudflare',
  'workers.dev',
  'pages.dev',
  'anthropic',
  'claude',
];

// String fields in config.mobile that are displayed to end users / devices
const MOBILE_PARTNER_VISIBLE_FIELDS = [
  'pwaName',
  'pwaShortName',
  'pwaDescription',
  'appStoreName',
  'appStoreDeveloper',
  'pushSenderName',
  'appleWebAppTitle',
];

// ── Apple status bar styles ───────────────────────────────────────────────────
export const APPLE_STATUS_BAR_STYLE = Object.freeze({
  DEFAULT: 'default',
  BLACK: 'black',
  BLACK_TRANSLUCENT: 'black-translucent',
});
export const APPLE_STATUS_BAR_STYLE_VALUES = Object.freeze(Object.values(APPLE_STATUS_BAR_STYLE));

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Scan all partner-visible mobile string fields (and branding.productName as PWA fallback)
 * for vendor-platform term exposure.
 *
 * @param {object} mobile   - config.mobile section
 * @param {object} branding - config.branding section
 * @returns {{ hasLeak: boolean, leaks: Array<{field: string, value: string, term: string}> }}
 */
export function checkMobileVendorLeak(mobile = {}, branding = {}) {
  const leaks = [];

  for (const field of MOBILE_PARTNER_VISIBLE_FIELDS) {
    const value = mobile[field] || '';
    if (!value) continue;
    const lower = value.toLowerCase();
    for (const term of MOBILE_VENDOR_TERMS) {
      if (lower.includes(term)) {
        leaks.push({ field: `mobile.${field}`, value, term });
        break; // one finding per field
      }
    }
  }

  // branding.productName is the final fallback name used in PWA manifest
  const productName = branding.productName || '';
  if (productName) {
    const lower = productName.toLowerCase();
    for (const term of MOBILE_VENDOR_TERMS) {
      if (lower.includes(term)) {
        leaks.push({ field: 'branding.productName', value: productName, term });
        break;
      }
    }
  }

  return { hasLeak: leaks.length > 0, leaks };
}

/**
 * Build a Web App Manifest object from tenant config.
 * Safe to JSON-serialize and serve as /manifest.webmanifest.
 * Falls back to branding values when mobile-specific fields are empty.
 *
 * @param {object} config - Full tenant config (post mergeWithDefaults)
 * @returns {object} Web App Manifest descriptor
 */
export function buildPwaManifest(config) {
  const m = config?.mobile || {};
  const b = config?.branding || {};

  const name = m.pwaName || b.productName || '';
  const shortName = m.pwaShortName || name.slice(0, 12);

  const icons = [];
  if (m.pwaIconUrl192) {
    icons.push({ src: m.pwaIconUrl192, sizes: '192x192', type: 'image/png' });
  }
  if (m.pwaIconUrl512) {
    icons.push({ src: m.pwaIconUrl512, sizes: '512x512', type: 'image/png', purpose: 'maskable' });
  }

  return {
    name,
    short_name: shortName,
    description: m.pwaDescription || '',
    start_url: m.pwaStartUrl || '/',
    scope: m.pwaScope || '/',
    display: m.pwaDisplayMode || PWA_DISPLAY_MODE.STANDALONE,
    orientation: m.pwaOrientation || PWA_ORIENTATION.ANY,
    theme_color: m.pwaThemeColor || b.primaryColor || '',
    background_color: m.pwaBackgroundColor || '#ffffff',
    icons,
  };
}

/**
 * Resolve the current mobile app offering descriptor for a tenant.
 * Identifies which surfaces are active, whether they are white-label-ready,
 * and what gaps remain.
 *
 * @param {object} config - Full tenant config
 * @returns {{ platform: string, hasPwa: boolean, hasNativeIos: boolean,
 *             hasNativeAndroid: boolean, hasAppStore: boolean, ready: boolean,
 *             gaps: Array<{surface: string, field: string, message: string}> }}
 */
export function resolveMobileAppOffering(config) {
  const m = config?.mobile || {};
  const platform = m.platform || MOBILE_APP_PLATFORM.NONE;

  const hasPwa = m.pwaEnabled === true;
  const hasNativeIos =
    platform === MOBILE_APP_PLATFORM.NATIVE_IOS ||
    platform === MOBILE_APP_PLATFORM.CROSS_PLATFORM;
  const hasNativeAndroid =
    platform === MOBILE_APP_PLATFORM.NATIVE_ANDROID ||
    platform === MOBILE_APP_PLATFORM.CROSS_PLATFORM;
  const hasAppStore = Boolean(m.appStoreId || m.playStoreId);

  const gaps = [];

  if (hasPwa) {
    if (!m.pwaName)
      gaps.push({ surface: 'pwa', field: 'mobile.pwaName', message: 'PWA name must be set for a white-labeled install prompt' });
    if (!m.pwaIconUrl192)
      gaps.push({ surface: 'pwa', field: 'mobile.pwaIconUrl192', message: 'PWA 192×192 partner icon URL is required' });
    if (!m.pwaIconUrl512)
      gaps.push({ surface: 'pwa', field: 'mobile.pwaIconUrl512', message: 'PWA 512×512 maskable partner icon URL is required' });
  }

  if (hasNativeIos && !m.appStoreId)
    gaps.push({ surface: 'native-ios', field: 'mobile.appStoreId', message: 'Native iOS offering must include the App Store numeric ID' });
  if (hasNativeAndroid && !m.playStoreId)
    gaps.push({ surface: 'native-android', field: 'mobile.playStoreId', message: 'Native Android offering must include the Play Store package name' });
  if ((hasNativeIos || hasNativeAndroid) && !m.appStoreName)
    gaps.push({ surface: 'app-store', field: 'mobile.appStoreName', message: 'App store listing name must be set to the partner brand name' });
  if ((hasNativeIos || hasNativeAndroid) && !m.appStoreDeveloper)
    gaps.push({ surface: 'app-store', field: 'mobile.appStoreDeveloper', message: "Developer account name should be the partner's own Apple/Google account, not the platform vendor" });

  const isActive = hasPwa || hasNativeIos || hasNativeAndroid;
  const ready = isActive && gaps.length === 0;

  return { platform, hasPwa, hasNativeIos, hasNativeAndroid, hasAppStore, ready, gaps };
}

/**
 * Resolve all partner-branded mobile asset surfaces into a structured descriptor.
 * Includes icons, splash screens, push notification assets, and app store assets.
 * Vendor leak audit result is included as `vendorLeaks`.
 *
 * @param {object} config - Full tenant config
 * @returns {object} Asset descriptor
 */
export function resolveMobileAssetDescriptor(config) {
  const m = config?.mobile || {};
  const b = config?.branding || {};

  return {
    icons: {
      favicon: b.faviconUrl || null,
      logo: b.logoUrl || null,
      pwaIcon192: m.pwaIconUrl192 || null,
      pwaIcon512: m.pwaIconUrl512 || null,
      appStoreIcon: m.appStoreIconUrl || null,
      pushIcon: m.pushIconUrl || null,
      pushBadge: m.pushBadgeUrl || null,
    },
    splash: {
      appleWebAppSplash: m.pwaSplashScreenUrl || null,
      pwaBackgroundColor: m.pwaBackgroundColor || null,
      pwaThemeColor: m.pwaThemeColor || b.primaryColor || null,
    },
    push: {
      senderName: m.pushSenderName || null,
      iconUrl: m.pushIconUrl || null,
      badgeUrl: m.pushBadgeUrl || null,
      vapidConfigured: Boolean(m.pushVapidPublicKey),
    },
    appStore: {
      appStoreId: m.appStoreId || null,
      playStoreId: m.playStoreId || null,
      name: m.appStoreName || null,
      developer: m.appStoreDeveloper || null,
      iconUrl: m.appStoreIconUrl || null,
    },
    vendorLeaks: checkMobileVendorLeak(m, b),
  };
}

/**
 * Build mobile-specific HTML meta tag descriptors for the responsive web experience.
 * Returns an array of descriptor objects for injection into <head>.
 * All values are drawn from partner config; no vendor defaults are inserted.
 *
 * Descriptor shape:
 *   { name, content }        → <meta name="..." content="...">
 *   { property, content }    → <meta property="..." content="...">
 *   { rel, href }            → <link rel="..." href="...">
 *
 * @param {object} config - Full tenant config
 * @returns {Array<object>} Meta tag descriptors
 */
export function buildMobileMetaTags(config) {
  const m = config?.mobile || {};
  const b = config?.branding || {};
  const d = config?.domainRouting || config?.domainControl || {};

  const tags = [];

  // Viewport — always present
  tags.push({ name: 'viewport', content: 'width=device-width, initial-scale=1' });

  // Theme color (partner primary color or explicit mobile override)
  const themeColor = m.pwaThemeColor || b.primaryColor || '';
  if (themeColor) tags.push({ name: 'theme-color', content: themeColor });

  // PWA manifest link
  if (m.pwaEnabled) {
    tags.push({ rel: 'manifest', href: '/manifest.webmanifest' });
  }

  // Apple web app meta tags
  if (m.appleWebAppCapable) {
    tags.push({ name: 'apple-mobile-web-app-capable', content: 'yes' });
  }
  const appleTitle = m.appleWebAppTitle || m.pwaName || b.productName || '';
  if (appleTitle) {
    tags.push({ name: 'apple-mobile-web-app-title', content: appleTitle });
  }
  tags.push({
    name: 'apple-mobile-web-app-status-bar-style',
    content: m.appleWebAppStatusBarStyle || APPLE_STATUS_BAR_STYLE.DEFAULT,
  });

  // Apple touch icon (partner-branded)
  const touchIcon = m.pwaIconUrl192 || b.logoUrl || '';
  if (touchIcon) {
    tags.push({ rel: 'apple-touch-icon', href: touchIcon });
  }

  // Apple splash (if provided)
  if (m.pwaSplashScreenUrl) {
    tags.push({ rel: 'apple-touch-startup-image', href: m.pwaSplashScreenUrl });
  }

  // OG image for mobile share previews
  if (b.ogImageUrl) {
    tags.push({ property: 'og:image', content: b.ogImageUrl });
  }

  // Canonical origin — ensures client-side code uses the white-labeled domain for auth
  const origin = d.appOrigin || '';
  if (origin) {
    tags.push({ name: 'x-partner-origin', content: origin });
  }

  return tags;
}

/**
 * Assert completeness of all mobile white-label surfaces.
 * Checks vendor neutrality, PWA asset completeness, push branding, app store identity,
 * and that the auth domain is not a vendor-platform domain.
 *
 * Consuming apps should surface `gaps` in the partner admin dashboard.
 *
 * @param {object} config - Full tenant config
 * @returns {{ complete: boolean, gaps: Array<{surface: string, field: string, message: string}> }}
 */
export function assertMobileWhiteLabel(config) {
  const m = config?.mobile || {};
  const b = config?.branding || {};
  const d = config?.domainRouting || config?.domainControl || {};
  const push = config?.communications?.push || {};

  const gaps = [];

  // 1. Vendor leak check across all partner-visible string surfaces
  const { hasLeak, leaks } = checkMobileVendorLeak(m, b);
  if (hasLeak) {
    for (const leak of leaks) {
      gaps.push({
        surface: 'vendor-leak',
        field: leak.field,
        message: `'${leak.field}' contains vendor term '${leak.term}' — replace with partner-branded content`,
      });
    }
  }

  // 2. PWA asset completeness
  if (m.pwaEnabled) {
    if (!m.pwaName)
      gaps.push({ surface: 'pwa', field: 'mobile.pwaName', message: 'White-label PWA name is required when pwaEnabled' });
    if (!m.pwaShortName)
      gaps.push({ surface: 'pwa', field: 'mobile.pwaShortName', message: 'PWA short name (≤12 chars) required for install prompt' });
    if (!m.pwaIconUrl192)
      gaps.push({ surface: 'pwa', field: 'mobile.pwaIconUrl192', message: 'PWA 192×192 partner icon URL is required' });
    if (!m.pwaIconUrl512)
      gaps.push({ surface: 'pwa', field: 'mobile.pwaIconUrl512', message: 'PWA 512×512 maskable partner icon URL is required' });
    if (!m.pwaThemeColor && !b.primaryColor)
      gaps.push({ surface: 'pwa', field: 'mobile.pwaThemeColor', message: 'PWA theme color required for branded splash and status bar' });
  }

  // 3. Push notification branding
  if (push.enabled) {
    const hasSenderName = Boolean(m.pushSenderName || push.senderName);
    if (!hasSenderName)
      gaps.push({ surface: 'push', field: 'mobile.pushSenderName', message: 'Push sender name must be a partner brand name — not the platform vendor name' });
    const hasIcon = Boolean(m.pushIconUrl || push.iconUrl || b.logoUrl);
    if (!hasIcon)
      gaps.push({ surface: 'push', field: 'mobile.pushIconUrl', message: 'Push notification icon must be a partner-branded asset URL' });
    if (!m.pushVapidPublicKey)
      gaps.push({ surface: 'push', field: 'mobile.pushVapidPublicKey', message: 'Web push requires a VAPID key pair scoped to the partner domain (store key name in Wrangler secrets)' });
  }

  // 4. Native app store identity
  const platform = m.platform || MOBILE_APP_PLATFORM.NONE;
  const isNative =
    platform === MOBILE_APP_PLATFORM.NATIVE_IOS ||
    platform === MOBILE_APP_PLATFORM.NATIVE_ANDROID ||
    platform === MOBILE_APP_PLATFORM.CROSS_PLATFORM;

  if (isNative) {
    if (!m.appStoreName)
      gaps.push({ surface: 'app-store', field: 'mobile.appStoreName', message: 'App store listing name must be set to the partner brand name' });
    if (!m.appStoreDeveloper)
      gaps.push({ surface: 'app-store', field: 'mobile.appStoreDeveloper', message: "Developer account must be the partner's own Apple/Google account — not the platform vendor" });
    if (!m.appStoreIconUrl)
      gaps.push({ surface: 'app-store', field: 'mobile.appStoreIconUrl', message: 'App store icon must be hosted on partner CDN, not vendor infrastructure' });
  }

  // 5. Custom domain for white-labeled mobile auth flows
  const hostname = d.appHostname || '';
  if (hostname) {
    const lower = hostname.toLowerCase();
    const vendorDomains = ['workers.dev', 'pages.dev', 'cloudflare', 'localhost'];
    if (vendorDomains.some((v) => lower.includes(v))) {
      gaps.push({
        surface: 'domain',
        field: 'domainRouting.appHostname',
        message: `Custom domain '${hostname}' exposes vendor infrastructure — mobile auth flows must use a partner-branded domain`,
      });
    }
  } else {
    gaps.push({
      surface: 'domain',
      field: 'domainRouting.appHostname',
      message: 'No custom domain configured — mobile browsers will fall back to the vendor platform URL. Set appHostname for a fully white-labeled mobile experience.',
    });
  }

  return { complete: gaps.length === 0, gaps };
}
