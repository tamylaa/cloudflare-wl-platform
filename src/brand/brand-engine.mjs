/**
 * Brand Module — Tenant-aware brand resolution for white-label support.
 *
 * Instead of hardcoding brand strings, colours, favicons, and URLs across the
 * app, all brand references resolve through this module. It now supports a
 * fuller tenant branding surface: logo assets, palette, fonts, metadata, and
 * optional custom CSS/JS for white-label deployments.
 *
 * @module config/brand
 */

import { resolveDomainControlFromConfig } from '../tenancy/domain-control.mjs';
import { enforceBrandingSecurityPolicy } from '../config/branding-security-policy.mjs';

function sanitizeEmbeddedText(value = '') {
    return String(value || '').replace(/<\/(style|script)/gi, '<\\/$1');
}

function stripQuotes(value = '') {
    return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function escapeHtmlAttribute(value = '') {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;');
}

// ── Platform Defaults ───────────────────────────────────────────────────

const PLATFORM_DEFAULTS = Object.freeze({
    productName: '',
    tagline: '',
    logoGlyph: '◉',
    logoUrl: '',
    faviconUrl: '',
    ogImageUrl: '',

    // Palette
    primaryColor: '#3b82f6',
    secondaryColor: '#8b5cf6',
    accentColor: '#14b8a6',
    accentHoverColor: '#2563eb',
    accentBgColor: '#eff6ff',
    successColor: '#10b981',
    errorColor: '#ef4444',
    warningColor: '#f59e0b',

    // Typography
    fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif",
    fontCssImport: '',
    fontUrl: '',

    // Optional tenant extensions
    customCss: '',
    customJs: '',
    allowUnsafeCustomJs: false,
    customJsSandboxCapabilities: ['allow-scripts'],
    // CRITICAL: CSP policy for custom.js. Enabled only if allowUnsafeCustomJs=true.
    // Injected as <meta http-equiv="Content-Security-Policy" content="...">
    // Default: 'script-src \'none\'' (blocks all scripts when custom.js enabled without sandbox)
    // Consuming apps should override with more permissive policy if sandboxing custom.js in iframe
    customJsCspPolicy: "script-src 'none'",

    // URLs — set by each consuming application
    siteUrl: '',
    appUrlFallback: '',
    docsUrl: '',
    helpCenterUrl: '',
    supportPortalUrl: '',
    supportEmail: '',
    feedbackEmail: '',
    socialHandle: '',
    socialUrl: '',

    // Email identity — set by each consuming application
    emailFromName: '',
    emailFromAddr: '',
    emailReplyTo: '',
    emailHeaderGradient: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',

    // Footer — set by each consuming application
    reportFooter: '',
    copyrightHolder: '',

    // UX labels — set by each consuming application
    dashboardTitle: '',
    userAgent: '',
});

/**
 * Resolve brand values from tenant config, env overrides, runtime overrides,
 * and platform defaults.
 *
 * Priority: runtime overrides > tenant.branding > env overrides > defaults
 *
 * @param {object} [env]                 — Cloudflare Worker env bindings
 * @param {object} [tenant]              — TenantContext with config (may be null)
 * @param {object|null} [runtimeBranding] — Request-scoped branding overrides
 * @returns {Readonly<Brand>}
 */
export function resolveBrand(env = {}, tenant = null, runtimeBranding = null) {
    const tenantBranding = tenant?.config?.branding || {};
    const tenantEmail = tenant?.config?.email || {};
    const runtime = runtimeBranding && typeof runtimeBranding === 'object' ? runtimeBranding : {};
    const mergedBranding = { ...tenantBranding, ...runtime };
    const domainControl = resolveDomainControlFromConfig(tenant?.config || {});

    const publicSiteUrl =
        domainControl.appOrigin || env.APP_URL || mergedBranding.siteUrl || PLATFORM_DEFAULTS.siteUrl;
    const docsUrl =
        domainControl.docsUrl ||
        domainControl.helpCenterUrl ||
        mergedBranding.docsUrl ||
        env.BRAND_DOCS_URL ||
        PLATFORM_DEFAULTS.docsUrl;
    const helpCenterUrl = domainControl.helpCenterUrl || docsUrl || PLATFORM_DEFAULTS.helpCenterUrl;
    const supportPortalUrl =
        domainControl.supportPortalUrl ||
        helpCenterUrl ||
        docsUrl ||
        PLATFORM_DEFAULTS.supportPortalUrl;
    const supportEmail =
        mergedBranding.supportEmail ||
        domainControl.supportEmail ||
        env.BRAND_SUPPORT_EMAIL ||
        PLATFORM_DEFAULTS.supportEmail;
    const derivedFromAddress = domainControl.sendingDomain
        ? `noreply@${domainControl.sendingDomain}`
        : '';

    const brand = {
        // Identity
        productName:
            mergedBranding.productName || env.BRAND_PRODUCT_NAME || PLATFORM_DEFAULTS.productName,
        tagline: mergedBranding.tagline || env.BRAND_TAGLINE || PLATFORM_DEFAULTS.tagline,
        logoGlyph: mergedBranding.logoGlyph || PLATFORM_DEFAULTS.logoGlyph,
        logoUrl: mergedBranding.logoUrl || env.BRAND_LOGO_URL || PLATFORM_DEFAULTS.logoUrl,
        faviconUrl:
            mergedBranding.faviconUrl || env.BRAND_FAVICON_URL || PLATFORM_DEFAULTS.faviconUrl,
        ogImageUrl:
            mergedBranding.ogImageUrl || env.BRAND_OG_IMAGE_URL || PLATFORM_DEFAULTS.ogImageUrl,

        // Palette
        primaryColor: mergedBranding.primaryColor || PLATFORM_DEFAULTS.primaryColor,
        secondaryColor: mergedBranding.secondaryColor || PLATFORM_DEFAULTS.secondaryColor,
        accentColor: mergedBranding.accentColor || PLATFORM_DEFAULTS.accentColor,
        accentHoverColor: mergedBranding.accentHoverColor || PLATFORM_DEFAULTS.accentHoverColor,
        accentBgColor: mergedBranding.accentBgColor || PLATFORM_DEFAULTS.accentBgColor,
        successColor: mergedBranding.successColor || PLATFORM_DEFAULTS.successColor,
        errorColor: mergedBranding.errorColor || PLATFORM_DEFAULTS.errorColor,
        warningColor: mergedBranding.warningColor || PLATFORM_DEFAULTS.warningColor,

        // Typography
        fontFamily: mergedBranding.fontFamily || env.BRAND_FONT_FAMILY || PLATFORM_DEFAULTS.fontFamily,
        fontCssImport:
            mergedBranding.fontCssImport || env.BRAND_FONT_CSS_URL || PLATFORM_DEFAULTS.fontCssImport,
        fontUrl: mergedBranding.fontUrl || env.BRAND_FONT_URL || PLATFORM_DEFAULTS.fontUrl,

        // Optional tenant extensions
        customCss: mergedBranding.customCss || PLATFORM_DEFAULTS.customCss,
        customJs: mergedBranding.customJs || PLATFORM_DEFAULTS.customJs,
        allowUnsafeCustomJs:
            mergedBranding.allowUnsafeCustomJs === true || env.ALLOW_TENANT_CUSTOM_JS === '1',
        customJsSandboxCapabilities:
            Array.isArray(mergedBranding.customJsSandboxCapabilities)
                ? mergedBranding.customJsSandboxCapabilities
                : PLATFORM_DEFAULTS.customJsSandboxCapabilities,
        customJsCspPolicy:
            mergedBranding.customJsCspPolicy || PLATFORM_DEFAULTS.customJsCspPolicy,

        // URLs
        siteUrl: publicSiteUrl,
        docsUrl: docsUrl,
        helpCenterUrl: helpCenterUrl,
        supportPortalUrl: supportPortalUrl,
        appHostname: domainControl.appHostname,
        supportEmail: supportEmail,
        feedbackEmail:
            mergedBranding.feedbackEmail || env.BRAND_FEEDBACK_EMAIL || PLATFORM_DEFAULTS.feedbackEmail,
        socialHandle: mergedBranding.socialHandle || PLATFORM_DEFAULTS.socialHandle,
        socialUrl: mergedBranding.socialUrl || PLATFORM_DEFAULTS.socialUrl,

        // Domain-control metadata
        sendingDomain: domainControl.sendingDomain,
        dnsTarget: domainControl.dnsTarget,
        domainStatus: domainControl.domainStatus,
        sslStatus: domainControl.sslStatus,
        emailAuthStatus: domainControl.emailAuthStatus,

        // Email identity
        emailFromName:
            mergedBranding.emailFromName || tenantEmail.fromName || PLATFORM_DEFAULTS.emailFromName,
        emailFromAddr:
            mergedBranding.emailFromAddr ||
            tenantEmail.fromAddress ||
            env.EMAIL_FROM ||
            derivedFromAddress ||
            PLATFORM_DEFAULTS.emailFromAddr,
        emailReplyTo:
            mergedBranding.supportEmail ||
            mergedBranding.emailReplyTo ||
            domainControl.supportEmail ||
            PLATFORM_DEFAULTS.emailReplyTo,
        emailHeaderGradient:
            mergedBranding.emailHeaderGradient || PLATFORM_DEFAULTS.emailHeaderGradient,

        // Labels
        dashboardTitle: mergedBranding.dashboardTitle || PLATFORM_DEFAULTS.dashboardTitle,
        reportFooter: mergedBranding.reportFooter || PLATFORM_DEFAULTS.reportFooter,
        copyrightHolder: mergedBranding.copyrightHolder || PLATFORM_DEFAULTS.copyrightHolder,
        userAgent: mergedBranding.userAgent || PLATFORM_DEFAULTS.userAgent,
    };

    return Object.freeze(brand);
}

/**
 * Generate CSS custom property overrides from brand config.
 * Injected at render time to override static :root values and optionally load
 * per-tenant fonts/custom CSS.
 *
 * @param {Brand} brand — Resolved brand object
 * @returns {string} CSS custom property block
 */
export function brandCSSOverrides(brand) {
    if (!brand) {
        return '';
    }

    const cssPolicy = enforceBrandingSecurityPolicy(
        { customCss: brand.customCss },
        { mode: 'config' }
    );
    const hasCustomCssPolicyIssue = [...cssPolicy.errors, ...cssPolicy.warnings].some(
        (finding) => finding.field === 'customCss'
    );

    const hasOverrides =
        brand.primaryColor !== PLATFORM_DEFAULTS.primaryColor ||
        brand.secondaryColor !== PLATFORM_DEFAULTS.secondaryColor ||
        brand.accentColor !== PLATFORM_DEFAULTS.accentColor ||
        brand.accentHoverColor !== PLATFORM_DEFAULTS.accentHoverColor ||
        brand.accentBgColor !== PLATFORM_DEFAULTS.accentBgColor ||
        brand.successColor !== PLATFORM_DEFAULTS.successColor ||
        brand.errorColor !== PLATFORM_DEFAULTS.errorColor ||
        brand.warningColor !== PLATFORM_DEFAULTS.warningColor ||
        brand.fontFamily !== PLATFORM_DEFAULTS.fontFamily ||
        Boolean(brand.fontCssImport || brand.fontUrl || (!hasCustomCssPolicyIssue && brand.customCss));

    if (!hasOverrides) {
        return '';
    }

    const safeFontFamily = sanitizeEmbeddedText(brand.fontFamily || PLATFORM_DEFAULTS.fontFamily);
    const fontImport = brand.fontCssImport
        ? `@import url("${sanitizeEmbeddedText(brand.fontCssImport)}");`
        : '';

    let fontFace = '';
    if (brand.fontUrl) {
        const fontName = stripQuotes((brand.fontFamily || 'TenantBrandFont').split(',')[0]);
        fontFace = `@font-face { font-family: "${sanitizeEmbeddedText(fontName || 'TenantBrandFont')}"; src: url("${sanitizeEmbeddedText(brand.fontUrl)}"); font-display: swap; }`;
    }

    const customCss = hasCustomCssPolicyIssue ? '' : sanitizeEmbeddedText(brand.customCss || '');

    return `${fontImport}
${fontFace}
:root {
  --primary: ${brand.primaryColor || PLATFORM_DEFAULTS.primaryColor};
  --accent: ${brand.primaryColor || PLATFORM_DEFAULTS.primaryColor};
  --secondary: ${brand.secondaryColor || PLATFORM_DEFAULTS.secondaryColor};
  --accent-2: ${brand.secondaryColor || PLATFORM_DEFAULTS.secondaryColor};
  --accent-strong: ${brand.accentColor || PLATFORM_DEFAULTS.accentColor};
  --accent-hover: ${brand.accentHoverColor || PLATFORM_DEFAULTS.accentHoverColor};
  --accent-bg: ${brand.accentBgColor || PLATFORM_DEFAULTS.accentBgColor};
  --success: ${brand.successColor || PLATFORM_DEFAULTS.successColor};
  --ok: ${brand.successColor || PLATFORM_DEFAULTS.successColor};
  --error: ${brand.errorColor || PLATFORM_DEFAULTS.errorColor};
  --danger: ${brand.errorColor || PLATFORM_DEFAULTS.errorColor};
  --warn: ${brand.warningColor || PLATFORM_DEFAULTS.warningColor};
  --font: ${safeFontFamily};
  --font-sans: ${safeFontFamily};
}
body { font-family: var(--font, ${safeFontFamily}); }
${customCss}`.trim();
}

/**
 * Resolve a favicon URL, falling back to the uploaded logo or a glyph SVG.
 *
 * @param {Brand} [brand]
 * @returns {string}
 */
export function getBrandFaviconHref(brand = PLATFORM_DEFAULTS) {
    if (brand?.faviconUrl) {
        return brand.faviconUrl;
    }
    if (brand?.logoUrl) {
        return brand.logoUrl;
    }
    const glyph = encodeURIComponent(brand?.logoGlyph || PLATFORM_DEFAULTS.logoGlyph);
    return `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${glyph}</text></svg>`;
}

/**
 * Resolve the most suitable Open Graph image for the current brand.
 *
 * @param {Brand} [brand]
 * @param {string} [fallback='']
 * @returns {string}
 */
export function getBrandOgImageUrl(brand = PLATFORM_DEFAULTS, fallback = '') {
    return brand?.ogImageUrl || brand?.logoUrl || fallback || '';
}

/**
 * Safely return tenant custom JS for opt-in admin injection.
 *
 * @param {Brand} [brand]
 * @returns {string}
 */
export function brandScriptOverrides(brand = PLATFORM_DEFAULTS) {
    if (brand?.allowUnsafeCustomJs !== true) {
        return '';
    }

    const jsPolicy = enforceBrandingSecurityPolicy(
        {
            customJs: brand?.customJs || '',
            allowUnsafeCustomJs: brand?.allowUnsafeCustomJs === true,
        },
        { mode: 'save' }
    );
    if (jsPolicy.errors.some((finding) => finding.field === 'customJs')) {
        return '';
    }

    return sanitizeEmbeddedText(brand?.customJs || '').trim();
}

export const CUSTOM_JS_SANDBOX_CAPABILITY_ALLOWLIST = Object.freeze([
    'allow-downloads',
    'allow-forms',
    'allow-modals',
    'allow-orientation-lock',
    'allow-pointer-lock',
    'allow-popups',
    'allow-popups-to-escape-sandbox',
    'allow-presentation',
    'allow-same-origin',
    'allow-scripts',
    'allow-storage-access-by-user-activation',
    'allow-top-navigation-by-user-activation',
]);

/**
 * Resolve and sanitize iframe sandbox capabilities for tenant custom JS.
 * Unknown capabilities are dropped.
 *
 * @param {Brand} [brand]
 * @param {string[]|string|null} [requestedCapabilities]
 * @returns {string[]}
 */
export function resolveCustomJsSandboxCapabilities(
    brand = PLATFORM_DEFAULTS,
    requestedCapabilities = null
) {
    const source =
        requestedCapabilities ??
        brand?.customJsSandboxCapabilities ??
        PLATFORM_DEFAULTS.customJsSandboxCapabilities;

    const values = Array.isArray(source)
        ? source
        : String(source || '')
              .split(/[\s,]+/)
              .map((item) => item.trim())
              .filter(Boolean);

    const filtered = values.filter((capability) =>
        CUSTOM_JS_SANDBOX_CAPABILITY_ALLOWLIST.includes(capability)
    );

    const unique = [...new Set(filtered)];
    if (unique.length === 0) {
        return [...PLATFORM_DEFAULTS.customJsSandboxCapabilities];
    }
    return unique;
}

/**
 * Build an iframe descriptor for isolated custom JS execution.
 * Consuming applications can use this descriptor to render a sandboxed iframe.
 *
 * @param {Brand} [brand]
 * @param {{ capabilities?: string[]|string|null, title?: string }} [options]
 * @returns {{ sandbox: string, srcdoc: string, title: string }|null}
 */
export function buildCustomJsSandboxIframeDescriptor(brand = PLATFORM_DEFAULTS, options = {}) {
    if (brand?.allowUnsafeCustomJs !== true) {
        return null;
    }

    const script = brandScriptOverrides(brand);
    if (!script) {
        return null;
    }

    const capabilities = resolveCustomJsSandboxCapabilities(brand, options?.capabilities);
    const title = String(options?.title || `${brand?.productName || 'Tenant'} custom scripts`).trim();

    return {
        sandbox: capabilities.join(' '),
        srcdoc: `<meta charset="utf-8"><script>${script}</script>`,
        title,
    };
}

/**
 * Render a sandboxed iframe HTML tag for tenant custom JS.
 *
 * @param {Brand} [brand]
 * @param {{ capabilities?: string[]|string|null, title?: string, className?: string }} [options]
 * @returns {string}
 */
export function renderCustomJsSandboxIframe(brand = PLATFORM_DEFAULTS, options = {}) {
    const descriptor = buildCustomJsSandboxIframeDescriptor(brand, options);
    if (!descriptor) {
        return '';
    }

    const className = options?.className
        ? ` class="${escapeHtmlAttribute(sanitizeEmbeddedText(options.className))}"`
        : '';

    return `<iframe sandbox="${escapeHtmlAttribute(descriptor.sandbox)}" title="${escapeHtmlAttribute(
        descriptor.title
    )}"${className} srcdoc="${escapeHtmlAttribute(descriptor.srcdoc)}"></iframe>`;
}

/**
 * Build the logo HTML, preferring image URL over glyph.
 *
 * @param {Brand} brand — Resolved brand object
 * @param {string} [className='logo'] — CSS class name
 * @returns {string} HTML string
 */
export function renderBrandLogo(brand, className = 'logo') {
    if (brand.logoUrl) {
        return `<img src="${brand.logoUrl}" alt="${brand.productName}" class="${className}" loading="lazy" />`;
    }
    return `<span class="${className}">${brand.logoGlyph}</span>`;
}

/**
 * Generate a Content-Security-Policy meta tag for custom.js injection.
 *
 * CRITICAL: This applies only when allowUnsafeCustomJs is true.
 * Default policy is script-src 'none' (blocks all scripts) unless overridden.
 *
 * Consuming apps should override with a sandboxing strategy:
 *   - Option 1: Wrap custom.js in an iframe with sandbox="allow-scripts" and restricted capabilities
 *   - Option 2: Parse and validate custom.js before injection (expensive, error-prone)
 *   - Option 3: Use a worker-safe sandbox (e.g., Cloudflare Workers for untrusted code execution)
 *
 * @param {Brand} [brand]
 * @returns {string} HTML meta tag or empty string if custom.js is disabled
 */
export function buildCustomJsCspMetaTag(brand = PLATFORM_DEFAULTS) {
    if (brand?.allowUnsafeCustomJs !== true) {
        return '';
    }

    const policy = brand?.customJsCspPolicy || PLATFORM_DEFAULTS.customJsCspPolicy;
    // Escape quotes for HTML attribute
    const safePolicy = String(policy || '').replace(/"/g, '&quot;');

    return `<meta http-equiv="Content-Security-Policy" content="${safePolicy}" />`;
}

/** Export defaults for testing and reference */
export { PLATFORM_DEFAULTS };
