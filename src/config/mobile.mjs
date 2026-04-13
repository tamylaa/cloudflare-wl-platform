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
