/**
 * Mobile & cross-platform white-label tests.
 *
 * Validation prompts covered:
 *   Q1 — White-labeled mobile app offering: PWA manifest + native offering descriptor
 *   Q2 — All splash/icon/push/app-store metadata configurable per partner, vendor-free
 *   Q3 — Responsive web maintains white-label on mobile browsers (meta tags + domain)
 */

import { describe, it, expect } from 'vitest';
import {
  buildPwaManifest,
  resolveMobileAppOffering,
  resolveMobileAssetDescriptor,
  checkMobileVendorLeak,
  buildMobileMetaTags,
  assertMobileWhiteLabel,
  MOBILE_APP_PLATFORM,
  PWA_DISPLAY_MODE,
} from '../../src/config/mobile.mjs';
import { validateConfig } from '../../src/config/config-validator.mjs';
import { mergeWithDefaults } from '../../src/config/customer-config.schema.mjs';

// ─── Config fixtures ──────────────────────────────────────────────────────────

function baseConfig(overrides = {}) {
  return mergeWithDefaults({
    site: { id: 'acme', domain: 'acme.com', siteUrl: 'https://acme.com', name: 'Acme' },
    ...overrides,
  });
}

const PARTNER_ICONS = {
  pwaIconUrl192: 'https://cdn.acme.com/icons/icon-192.png',
  pwaIconUrl512: 'https://cdn.acme.com/icons/icon-512.png',
};

const FULL_MOBILE = {
  platform: MOBILE_APP_PLATFORM.CROSS_PLATFORM,
  pwaEnabled: true,
  pwaName: 'Acme Analytics',
  pwaShortName: 'Acme',
  pwaDescription: 'Partner analytics dashboard',
  pwaThemeColor: '#1e40af',
  pwaBackgroundColor: '#ffffff',
  pwaDisplayMode: PWA_DISPLAY_MODE.STANDALONE,
  ...PARTNER_ICONS,
  pwaSplashScreenUrl: 'https://cdn.acme.com/splash.png',
  appleWebAppCapable: true,
  appleWebAppTitle: 'Acme',
  appleWebAppStatusBarStyle: 'black-translucent',
  pushSenderName: 'Acme Alerts',
  pushIconUrl: 'https://cdn.acme.com/push-icon.png',
  pushBadgeUrl: 'https://cdn.acme.com/badge.png',
  pushVapidPublicKey: 'ACME_VAPID_PUBLIC_KEY',
  appStoreId: '1234567890',
  playStoreId: 'com.acme.analytics',
  appStoreName: 'Acme Analytics',
  appStoreDeveloper: 'Acme Corp Ltd',
  appStoreIconUrl: 'https://cdn.acme.com/app-store-icon.png',
};

// ─── Q1: White-labeled mobile app offering ────────────────────────────────────

describe('Q1 — white-labeled mobile app offering', () => {
  describe('buildPwaManifest', () => {
    it('produces a manifest with partner brand name and icons', () => {
      const config = baseConfig({
        mobile: { ...FULL_MOBILE },
        branding: { productName: 'Acme Brand', primaryColor: '#1e40af' },
      });
      const manifest = buildPwaManifest(config);
      expect(manifest.name).toBe('Acme Analytics');
      expect(manifest.short_name).toBe('Acme');
      expect(manifest.theme_color).toBe('#1e40af');
      expect(manifest.display).toBe(PWA_DISPLAY_MODE.STANDALONE);
      expect(manifest.icons).toHaveLength(2);
      expect(manifest.icons[0].sizes).toBe('192x192');
      expect(manifest.icons[1].purpose).toBe('maskable');
    });

    it('falls back to branding.productName when pwaName is not set', () => {
      const config = baseConfig({
        mobile: { pwaEnabled: true, ...PARTNER_ICONS },
        branding: { productName: 'Fallback Brand' },
      });
      const manifest = buildPwaManifest(config);
      expect(manifest.name).toBe('Fallback Brand');
    });

    it('produces no icons when no icon URLs are configured', () => {
      const config = baseConfig({ mobile: { pwaName: 'Test' } });
      const manifest = buildPwaManifest(config);
      expect(manifest.icons).toHaveLength(0);
    });

    it('manifest contains no vendor terms when fully configured', () => {
      const config = baseConfig({ mobile: { ...FULL_MOBILE } });
      const manifest = buildPwaManifest(config);
      const serialized = JSON.stringify(manifest).toLowerCase();
      const VENDOR_TERMS = ['cloudflare', 'workers.dev', 'pages.dev', 'anthropic', 'claude'];
      for (const term of VENDOR_TERMS) {
        expect(serialized).not.toContain(term);
      }
    });

    it('start_url and scope default to /', () => {
      const config = baseConfig({ mobile: { pwaName: 'X' } });
      const manifest = buildPwaManifest(config);
      expect(manifest.start_url).toBe('/');
      expect(manifest.scope).toBe('/');
    });
  });

  describe('resolveMobileAppOffering', () => {
    it('reports ready=true for a fully configured cross-platform offering', () => {
      const config = baseConfig({ mobile: { ...FULL_MOBILE } });
      const offering = resolveMobileAppOffering(config);
      expect(offering.hasPwa).toBe(true);
      expect(offering.hasNativeIos).toBe(true);
      expect(offering.hasNativeAndroid).toBe(true);
      expect(offering.hasAppStore).toBe(true);
      expect(offering.ready).toBe(true);
      expect(offering.gaps).toHaveLength(0);
    });

    it('reports ready=false and gaps when pwaEnabled but icons missing', () => {
      const config = baseConfig({ mobile: { pwaEnabled: true, pwaName: 'X' } });
      const offering = resolveMobileAppOffering(config);
      expect(offering.ready).toBe(false);
      const fields = offering.gaps.map((g) => g.field);
      expect(fields).toContain('mobile.pwaIconUrl192');
      expect(fields).toContain('mobile.pwaIconUrl512');
    });

    it('registers gap for missing appStoreDeveloper on native platform', () => {
      const config = baseConfig({
        mobile: {
          platform: MOBILE_APP_PLATFORM.NATIVE_IOS,
          appStoreId: '1234',
          appStoreName: 'Acme',
          // appStoreDeveloper intentionally omitted
          pwaEnabled: false,
        },
      });
      const offering = resolveMobileAppOffering(config);
      expect(offering.gaps.some((g) => g.field === 'mobile.appStoreDeveloper')).toBe(true);
    });

    it('platform=none with no pwa → ready=false (no offering configured)', () => {
      const config = baseConfig({ mobile: { platform: MOBILE_APP_PLATFORM.NONE, pwaEnabled: false } });
      const offering = resolveMobileAppOffering(config);
      expect(offering.ready).toBe(false);
    });
  });
});

// ─── Q2: All mobile assets configurable per partner, vendor-free ──────────────

describe('Q2 — mobile assets configurable per partner without vendor exposure', () => {
  describe('checkMobileVendorLeak', () => {
    it('detects cloudflare in pwaName', () => {
      const result = checkMobileVendorLeak({ pwaName: 'Powered by Cloudflare Analytics' }, {});
      expect(result.hasLeak).toBe(true);
      expect(result.leaks[0].field).toBe('mobile.pwaName');
      expect(result.leaks[0].term).toBe('cloudflare');
    });

    it('detects anthropic in pushSenderName', () => {
      const result = checkMobileVendorLeak({ pushSenderName: 'Anthropic Platform Alerts' }, {});
      expect(result.hasLeak).toBe(true);
      expect(result.leaks[0].term).toBe('anthropic');
    });

    it('detects vendor term in branding.productName (PWA fallback)', () => {
      const result = checkMobileVendorLeak({}, { productName: 'Claude Dashboard' });
      expect(result.hasLeak).toBe(true);
      expect(result.leaks[0].field).toBe('branding.productName');
    });

    it('passes clean partner-branded content', () => {
      const result = checkMobileVendorLeak(
        { pwaName: 'Acme Analytics', appStoreName: 'Acme Corp', pushSenderName: 'Acme Alerts' },
        { productName: 'Acme Analytics Pro' }
      );
      expect(result.hasLeak).toBe(false);
      expect(result.leaks).toHaveLength(0);
    });
  });

  describe('resolveMobileAssetDescriptor', () => {
    it('maps all asset URLs into structured descriptor', () => {
      const config = baseConfig({
        mobile: { ...FULL_MOBILE },
        branding: {
          faviconUrl: 'https://cdn.acme.com/favicon.ico',
          logoUrl: 'https://cdn.acme.com/logo.svg',
          ogImageUrl: 'https://cdn.acme.com/og.png',
        },
      });
      const descriptor = resolveMobileAssetDescriptor(config);
      expect(descriptor.icons.pwaIcon192).toBe(PARTNER_ICONS.pwaIconUrl192);
      expect(descriptor.icons.pwaIcon512).toBe(PARTNER_ICONS.pwaIconUrl512);
      expect(descriptor.icons.pushIcon).toBe(FULL_MOBILE.pushIconUrl);
      expect(descriptor.push.senderName).toBe(FULL_MOBILE.pushSenderName);
      expect(descriptor.push.vapidConfigured).toBe(true);
      expect(descriptor.appStore.developer).toBe('Acme Corp Ltd');
      expect(descriptor.splash.pwaThemeColor).toBe('#1e40af');
    });

    it('vendorLeaks.hasLeak is false for clean config', () => {
      const config = baseConfig({ mobile: { ...FULL_MOBILE } });
      const descriptor = resolveMobileAssetDescriptor(config);
      expect(descriptor.vendorLeaks.hasLeak).toBe(false);
    });

    it('vendorLeaks.hasLeak is true when vendor term in appStoreDeveloper', () => {
      const config = baseConfig({ mobile: { appStoreDeveloper: 'Cloudflare Inc.' } });
      const descriptor = resolveMobileAssetDescriptor(config);
      expect(descriptor.vendorLeaks.hasLeak).toBe(true);
    });

    it('null assets for unconfigured fields', () => {
      const config = baseConfig({});
      const descriptor = resolveMobileAssetDescriptor(config);
      expect(descriptor.icons.pwaIcon192).toBeNull();
      expect(descriptor.push.senderName).toBeNull();
      expect(descriptor.appStore.appStoreId).toBeNull();
    });
  });

  describe('validateConfig — mobile enum + vendor leak checks', () => {
    it('errors on unknown mobile.platform value', () => {
      const config = baseConfig({ mobile: { platform: 'react-native-bad-value' } });
      const { errors } = validateConfig(config);
      expect(errors.some((e) => e.field === 'mobile.platform')).toBe(true);
    });

    it('errors when pwaName contains a vendor term', () => {
      const config = baseConfig({ mobile: { pwaName: 'My Cloudflare App' } });
      const { errors } = validateConfig(config);
      expect(errors.some((e) => e.field === 'mobile.pwaName')).toBe(true);
    });

    it('errors when appStoreDeveloper contains a vendor term', () => {
      const config = baseConfig({ mobile: { appStoreDeveloper: 'Anthropic Platform Ltd' } });
      const { errors } = validateConfig(config);
      expect(errors.some((e) => e.field === 'mobile.appStoreDeveloper')).toBe(true);
    });

    it('warns when pwaEnabled but pwaIconUrl192 missing', () => {
      const config = baseConfig({ mobile: { pwaEnabled: true, pwaName: 'Acme', pwaIconUrl512: 'https://cdn.acme.com/512.png' } });
      const { warnings } = validateConfig(config);
      expect(warnings.some((w) => w.field === 'mobile.pwaIconUrl192')).toBe(true);
    });

    it('warns when native platform set but appStoreDeveloper missing', () => {
      const config = baseConfig({ mobile: { platform: MOBILE_APP_PLATFORM.NATIVE_ANDROID } });
      const { warnings } = validateConfig(config);
      expect(warnings.some((w) => w.field === 'mobile.appStoreDeveloper')).toBe(true);
    });

    it('no mobile errors for clean fully-configured config', () => {
      const config = baseConfig({ mobile: { ...FULL_MOBILE } });
      const { errors } = validateConfig(config);
      const mobileErrors = errors.filter((e) => e.field.startsWith('mobile.'));
      expect(mobileErrors).toHaveLength(0);
    });
  });
});

// ─── Q3: Responsive web maintains white-label on mobile browsers ──────────────

describe('Q3 — responsive web white-label on mobile browsers', () => {
  describe('buildMobileMetaTags', () => {
    it('always includes viewport meta tag', () => {
      const config = baseConfig({});
      const tags = buildMobileMetaTags(config);
      const viewport = tags.find((t) => t.name === 'viewport');
      expect(viewport).toBeDefined();
      expect(viewport.content).toContain('width=device-width');
    });

    it('includes theme-color from mobile config', () => {
      const config = baseConfig({ mobile: { pwaThemeColor: '#1e40af' } });
      const tags = buildMobileMetaTags(config);
      const themeTag = tags.find((t) => t.name === 'theme-color');
      expect(themeTag?.content).toBe('#1e40af');
    });

    it('falls back to branding.primaryColor for theme-color', () => {
      const config = baseConfig({ branding: { primaryColor: '#9333ea' } });
      const tags = buildMobileMetaTags(config);
      const themeTag = tags.find((t) => t.name === 'theme-color');
      expect(themeTag?.content).toBe('#9333ea');
    });

    it('includes manifest link when pwaEnabled', () => {
      const config = baseConfig({ mobile: { pwaEnabled: true } });
      const tags = buildMobileMetaTags(config);
      const manifestLink = tags.find((t) => t.rel === 'manifest');
      expect(manifestLink?.href).toBe('/manifest.webmanifest');
    });

    it('does not include manifest link when pwaEnabled is false', () => {
      const config = baseConfig({ mobile: { pwaEnabled: false } });
      const tags = buildMobileMetaTags(config);
      expect(tags.find((t) => t.rel === 'manifest')).toBeUndefined();
    });

    it('includes apple-mobile-web-app-capable when flag is set', () => {
      const config = baseConfig({ mobile: { appleWebAppCapable: true, appleWebAppTitle: 'Acme' } });
      const tags = buildMobileMetaTags(config);
      const appleCapable = tags.find((t) => t.name === 'apple-mobile-web-app-capable');
      const appleTitle = tags.find((t) => t.name === 'apple-mobile-web-app-title');
      expect(appleCapable?.content).toBe('yes');
      expect(appleTitle?.content).toBe('Acme');
    });

    it('apple-touch-icon uses partner icon URL', () => {
      const config = baseConfig({ mobile: { pwaIconUrl192: 'https://cdn.acme.com/icon-192.png' } });
      const tags = buildMobileMetaTags(config);
      const touchIcon = tags.find((t) => t.rel === 'apple-touch-icon');
      expect(touchIcon?.href).toBe('https://cdn.acme.com/icon-192.png');
    });

    it('includes canonical partner origin for white-label auth flow', () => {
      const config = baseConfig({
        domainRouting: { appHostname: 'app.acme.com', appOrigin: 'https://app.acme.com' },
      });
      const tags = buildMobileMetaTags(config);
      const origin = tags.find((t) => t.name === 'x-partner-origin');
      expect(origin?.content).toBe('https://app.acme.com');
    });

    it('no vendor URLs leak into meta tag content', () => {
      const config = baseConfig({
        mobile: { ...FULL_MOBILE },
        branding: { primaryColor: '#1e40af', ogImageUrl: 'https://cdn.acme.com/og.png' },
        domainRouting: { appHostname: 'app.acme.com', appOrigin: 'https://app.acme.com' },
      });
      const tags = buildMobileMetaTags(config);
      const serialized = JSON.stringify(tags).toLowerCase();
      for (const term of ['workers.dev', 'pages.dev', 'anthropic']) {
        expect(serialized).not.toContain(term);
      }
    });
  });

  describe('assertMobileWhiteLabel', () => {
    it('complete=true for a fully white-labeled config', () => {
      const config = baseConfig({
        mobile: { ...FULL_MOBILE },
        branding: { primaryColor: '#1e40af' },
        domainRouting: { appHostname: 'app.acme.com', appOrigin: 'https://app.acme.com' },
      });
      const result = assertMobileWhiteLabel(config);
      expect(result.complete).toBe(true);
      expect(result.gaps).toHaveLength(0);
    });

    it('reports gap for missing custom domain', () => {
      const config = baseConfig({ mobile: { pwaEnabled: false } });
      // domainRouting.appHostname is empty by default
      const result = assertMobileWhiteLabel(config);
      expect(result.gaps.some((g) => g.field === 'domainRouting.appHostname')).toBe(true);
    });

    it('reports error when appHostname is a vendor domain', () => {
      const config = baseConfig({
        domainRouting: { appHostname: 'my-site.workers.dev', appOrigin: 'https://my-site.workers.dev' },
      });
      const result = assertMobileWhiteLabel(config);
      const domainGap = result.gaps.find((g) => g.field === 'domainRouting.appHostname');
      expect(domainGap).toBeDefined();
      expect(domainGap.surface).toBe('domain');
    });

    it('reports PWA gaps when pwaEnabled without icons', () => {
      const config = baseConfig({
        mobile: { pwaEnabled: true, pwaName: 'Acme' },
        domainRouting: { appHostname: 'app.acme.com', appOrigin: 'https://app.acme.com' },
      });
      const result = assertMobileWhiteLabel(config);
      expect(result.complete).toBe(false);
      expect(result.gaps.some((g) => g.field === 'mobile.pwaIconUrl192')).toBe(true);
    });

    it('reports vendor-leak gap when pwaName contains cloudflare', () => {
      const config = baseConfig({
        mobile: { pwaName: 'Cloudflare App', ...PARTNER_ICONS },
        domainRouting: { appHostname: 'app.acme.com', appOrigin: 'https://app.acme.com' },
      });
      const result = assertMobileWhiteLabel(config);
      expect(result.gaps.some((g) => g.surface === 'vendor-leak')).toBe(true);
    });

    it('reports push gaps when push enabled but VAPID key missing', () => {
      const config = baseConfig({
        mobile: {
          pushSenderName: 'Acme Alerts',
          pushIconUrl: 'https://cdn.acme.com/push.png',
          // pushVapidPublicKey intentionally omitted
        },
        communications: { push: { enabled: true, provider: 'fcm', senderName: 'Acme', iconUrl: 'https://cdn.acme.com/push.png' } },
        domainRouting: { appHostname: 'app.acme.com', appOrigin: 'https://app.acme.com' },
      });
      const result = assertMobileWhiteLabel(config);
      expect(result.gaps.some((g) => g.field === 'mobile.pushVapidPublicKey')).toBe(true);
    });
  });
});
