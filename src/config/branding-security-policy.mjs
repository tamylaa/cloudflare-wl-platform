/**
 * Branding Security Policy
 *
 * Centralized guardrails for tenant branding payloads. This policy is shared
 * by config validation (warning-first compatibility mode) and runtime render
 * helpers (strict mode for executable custom code).
 */

const KB = 1024;
const DEFAULT_POLICY_MODE = 'config';

export const BRANDING_ASSET_FIELD_POLICY = Object.freeze({
  logoUrl: Object.freeze({
    allowedDataUriMimeTypes: Object.freeze([
      'image/svg+xml',
      'image/png',
      'image/jpeg',
      'image/webp',
    ]),
    warnDataUriBytes: 12 * KB,
    maxDataUriBytes: 256 * KB,
  }),
  faviconUrl: Object.freeze({
    allowedDataUriMimeTypes: Object.freeze([
      'image/svg+xml',
      'image/png',
      'image/x-icon',
      'image/vnd.microsoft.icon',
    ]),
    warnDataUriBytes: 12 * KB,
    maxDataUriBytes: 128 * KB,
  }),
  ogImageUrl: Object.freeze({
    allowedDataUriMimeTypes: Object.freeze([
      'image/svg+xml',
      'image/png',
      'image/jpeg',
      'image/webp',
    ]),
    warnDataUriBytes: 12 * KB,
    maxDataUriBytes: 512 * KB,
  }),
  fontUrl: Object.freeze({
    allowedDataUriMimeTypes: Object.freeze([
      'font/woff2',
      'font/woff',
      'font/ttf',
      'font/otf',
      'application/font-woff',
      'application/x-font-ttf',
      'application/octet-stream',
    ]),
    warnDataUriBytes: 12 * KB,
    maxDataUriBytes: 1024 * KB,
  }),
});

export const BRANDING_CUSTOM_CODE_LIMITS = Object.freeze({
  customCssWarnChars: 8000,
  customCssMaxChars: 20000,
  customJsWarnChars: 8000,
  customJsMaxChars: 16000,
});

const VENDOR_WATERMARK_MARKERS = Object.freeze([
  'powered by',
  'built with',
  'white-label by',
  'shutterstock',
  'getty images',
  'adobe stock',
  'envato',
  'freepik',
  'canva',
  'istock',
  'watermark',
]);

const SVG_ACTIVE_CONTENT_PATTERNS = Object.freeze([
  /<script\b/i,
  /\son\w+\s*=/i,
  /<foreignObject\b/i,
  /<iframe\b/i,
  /<object\b/i,
  /<embed\b/i,
  /xlink:href\s*=\s*['"]\s*javascript:/i,
  /href\s*=\s*['"]\s*javascript:/i,
]);

const BLOCKED_CSS_GUARDRAILS = Object.freeze([
  {
    pattern: /@import\s+url\s*\(/i,
    message: 'Custom CSS cannot use @import url(...) because it introduces remote, unreviewed assets.',
  },
  {
    pattern: /expression\s*\(/i,
    message: 'Custom CSS cannot use expression(...) due to script-like execution risk.',
  },
  {
    pattern: /url\s*\(\s*['"]?\s*javascript:/i,
    message: 'Custom CSS cannot reference javascript: URLs.',
  },
  {
    pattern: /<\/?style\b/i,
    message: 'Custom CSS should contain raw declarations only, not <style> tags.',
  },
]);

const BLOCKED_JS_GUARDRAILS = Object.freeze([
  {
    pattern: /\beval\s*\(/i,
    message: 'Custom JS cannot use eval(...).',
  },
  {
    pattern: /\bnew\s+Function\s*\(/i,
    message: 'Custom JS cannot use Function constructors.',
  },
  {
    pattern: /[^\w$]Function\s*\(/,
    message: 'Custom JS cannot use Function constructors.',
  },
  {
    pattern: /setTimeout\s*\(\s*['"]/i,
    message: 'Custom JS cannot execute string-based setTimeout payloads.',
  },
  {
    pattern: /setInterval\s*\(\s*['"]/i,
    message: 'Custom JS cannot execute string-based setInterval payloads.',
  },
  {
    pattern: /<\/?script\b/i,
    message: 'Custom JS should contain raw script content only, not <script> tags.',
  },
]);

function pushBlockingFinding(mode, errors, warnings, field, message) {
  if (mode === 'save') {
    errors.push({ field, message });
    return;
  }
  warnings.push({ field, message });
}

function parseDataUri(value = '') {
  const input = String(value || '').trim();
  const match = input.match(/^data:([^;,]+)?((?:;[^,]*)*),([\s\S]*)$/i);
  if (!match) {
    return null;
  }

  const mimeType = String(match[1] || 'text/plain').trim().toLowerCase();
  const attributes = String(match[2] || '');
  const payload = String(match[3] || '');
  const isBase64 = /;base64/i.test(attributes);

  return {
    mimeType,
    isBase64,
    payload,
    bytes: isBase64 ? computeBase64Bytes(payload) : computeUtf8Bytes(decodeDataPayload(payload, false)),
  };
}

function computeBase64Bytes(payload = '') {
  const normalized = String(payload || '').replace(/\s+/g, '');
  if (!normalized) {
    return 0;
  }

  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function computeUtf8Bytes(value = '') {
  const text = String(value || '');
  if (typeof TextEncoder === 'function') {
    return new TextEncoder().encode(text).length;
  }
  return text.length;
}

function decodeDataPayload(payload = '', isBase64 = false) {
  const data = String(payload || '');
  if (!data) {
    return '';
  }

  if (!isBase64) {
    try {
      return decodeURIComponent(data);
    } catch {
      return data;
    }
  }

  const normalized = data.replace(/\s+/g, '');
  try {
    if (typeof atob === 'function') {
      const ascii = atob(normalized);
      const bytes = Uint8Array.from(ascii, (char) => char.charCodeAt(0));
      if (typeof TextDecoder === 'function') {
        return new TextDecoder().decode(bytes);
      }
      return ascii;
    }
  } catch {
    // Fall through to Buffer decoding when available.
  }

  if (typeof Buffer !== 'undefined') {
    try {
      return Buffer.from(normalized, 'base64').toString('utf8');
    } catch {
      return '';
    }
  }

  return '';
}

function hasSvgActiveContent(svgText = '') {
  const text = String(svgText || '');
  return SVG_ACTIVE_CONTENT_PATTERNS.some((pattern) => pattern.test(text));
}

function findVendorWatermarkMarker(value = '') {
  const lower = String(value || '').toLowerCase();
  return VENDOR_WATERMARK_MARKERS.find((marker) => lower.includes(marker)) || '';
}

/**
 * Enforce branding security policy for tenant-provided assets and custom code.
 *
 * Modes:
 * - save: dangerous findings are blocking errors
 * - config: dangerous findings are downgraded to warnings for compatibility
 *
 * @param {object} [branding]
 * @param {{mode?: 'save' | 'config'}} [options]
 * @returns {{valid: boolean, mode: 'save' | 'config', errors: Array<{field: string, message: string}>, warnings: Array<{field: string, message: string}>}}
 */
export function enforceBrandingSecurityPolicy(branding = {}, options = {}) {
  const mode = options?.mode === 'save' ? 'save' : DEFAULT_POLICY_MODE;
  const errors = [];
  const warnings = [];

  for (const [field, fieldPolicy] of Object.entries(BRANDING_ASSET_FIELD_POLICY)) {
    const value = branding?.[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      continue;
    }

    const markerInReference = findVendorWatermarkMarker(value);
    if (markerInReference) {
      warnings.push({
        field,
        message: `${field} appears to contain a vendor watermark marker ('${markerInReference}').`,
      });
    }

    const trimmedValue = value.trim();
    if (!/^data:/i.test(trimmedValue)) {
      continue;
    }

    const parsed = parseDataUri(trimmedValue);
    if (!parsed) {
      pushBlockingFinding(
        mode,
        errors,
        warnings,
        field,
        `${field} must be a valid data URI when inline payloads are used.`
      );
      continue;
    }

    if (!fieldPolicy.allowedDataUriMimeTypes.includes(parsed.mimeType)) {
      pushBlockingFinding(
        mode,
        errors,
        warnings,
        field,
        `${field} data URI MIME '${parsed.mimeType}' is not allowed for this asset type.`
      );
    }

    if (parsed.bytes > fieldPolicy.warnDataUriBytes) {
      warnings.push({
        field,
        message: `${field} contains a large inline data URI (${parsed.bytes} bytes). Prefer hosted assets to keep config payloads small.`,
      });
    }

    if (parsed.bytes > fieldPolicy.maxDataUriBytes) {
      pushBlockingFinding(
        mode,
        errors,
        warnings,
        field,
        `${field} inline data URI (${parsed.bytes} bytes) exceeds the maximum allowed size (${fieldPolicy.maxDataUriBytes} bytes).`
      );
    }

    if (parsed.mimeType === 'image/svg+xml') {
      const svgText = decodeDataPayload(parsed.payload, parsed.isBase64);
      if (hasSvgActiveContent(svgText)) {
        pushBlockingFinding(
          mode,
          errors,
          warnings,
          field,
          `${field} SVG contains active content (scripts/events/foreign objects), which is blocked.`
        );
      }

      const markerInSvg = findVendorWatermarkMarker(svgText);
      if (markerInSvg) {
        warnings.push({
          field,
          message: `${field} SVG appears to contain a vendor watermark marker ('${markerInSvg}').`,
        });
      }
    }
  }

  const customCss = typeof branding?.customCss === 'string' ? branding.customCss : '';
  if (customCss.trim().length > 0) {
    if (customCss.length > BRANDING_CUSTOM_CODE_LIMITS.customCssWarnChars) {
      warnings.push({
        field: 'customCss',
        message: `Custom CSS is large (${customCss.length} chars). Prefer hosted, versioned style bundles when possible.`,
      });
    }

    if (customCss.length > BRANDING_CUSTOM_CODE_LIMITS.customCssMaxChars) {
      pushBlockingFinding(
        mode,
        errors,
        warnings,
        'customCss',
        `Custom CSS exceeds maximum length (${BRANDING_CUSTOM_CODE_LIMITS.customCssMaxChars} chars).`
      );
    }

    for (const guardrail of BLOCKED_CSS_GUARDRAILS) {
      if (guardrail.pattern.test(customCss)) {
        pushBlockingFinding(mode, errors, warnings, 'customCss', guardrail.message);
      }
    }

    const markerInCss = findVendorWatermarkMarker(customCss);
    if (markerInCss) {
      warnings.push({
        field: 'customCss',
        message: `Custom CSS appears to include a vendor watermark marker ('${markerInCss}').`,
      });
    }
  }

  const customJs = typeof branding?.customJs === 'string' ? branding.customJs : '';
  if (customJs.trim().length > 0) {
    if (branding?.allowUnsafeCustomJs !== true) {
      pushBlockingFinding(
        mode,
        errors,
        warnings,
        'customJs',
        'Custom JS is disabled by default and requires allowUnsafeCustomJs=true for trusted deployments.'
      );
    }

    if (customJs.length > BRANDING_CUSTOM_CODE_LIMITS.customJsWarnChars) {
      warnings.push({
        field: 'customJs',
        message: `Custom JS is large (${customJs.length} chars). Prefer hosted, versioned script assets with review history.`,
      });
    }

    if (customJs.length > BRANDING_CUSTOM_CODE_LIMITS.customJsMaxChars) {
      pushBlockingFinding(
        mode,
        errors,
        warnings,
        'customJs',
        `Custom JS exceeds maximum length (${BRANDING_CUSTOM_CODE_LIMITS.customJsMaxChars} chars).`
      );
    }

    for (const guardrail of BLOCKED_JS_GUARDRAILS) {
      if (guardrail.pattern.test(customJs)) {
        pushBlockingFinding(mode, errors, warnings, 'customJs', guardrail.message);
      }
    }

    const markerInJs = findVendorWatermarkMarker(customJs);
    if (markerInJs) {
      warnings.push({
        field: 'customJs',
        message: `Custom JS appears to include a vendor watermark marker ('${markerInJs}').`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    mode,
    errors,
    warnings,
  };
}
