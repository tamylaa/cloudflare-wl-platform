// cloudflare-wl-platform — guards/brand-scatter-guard
// Vitest plugin that fails tests when platform brand strings leak into tenant-scoped output.

/**
 * Named patterns used by the brand scatter guard.
 * Exported so consumers can reference them in assertions or custom rules.
 */
export const BRAND_SCATTER_PATTERNS = Object.freeze([
    {
        name: 'config-branding',
        re: /config\??\.(branding)\??\.(\w+)/,
        hint: 'use resolveBrand(env, tenant) instead',
    },
    {
        name: 'effectiveBrand',
        re: /effectiveBrand\.(primary|product|logo)\w*/,
        hint: 'use resolveBrand() or tenant.getBrand() instead',
    },
]);

/**
 * Scan a source code string for brand scatter violations.
 *
 * @param {string} sourceCode - Source text to scan
 * @param {string} filename   - Filename label for violation reporting
 * @returns {Array<{filename: string, line: number, match: string, pattern: string}>}
 */
export function scanForBrandScatter(sourceCode, filename = '<unknown>') {
    const violations = [];
    const lines = (sourceCode || '').split('\n');
    lines.forEach((line, idx) => {
        if (/^\s*(import|export|\/\/|\/\*)/.test(line)) return;
        for (const { name, re } of BRAND_SCATTER_PATTERNS) {
            const m = re.exec(line);
            if (m) {
                violations.push({ filename, line: idx + 1, match: m[0], pattern: name });
            }
        }
    });
    return violations;
}

// ─── Glob helper (zero-dep) ───────────────────────────────────────────────────

function globToRegex(pattern) {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '~~~GLOBSTAR~~~')
        .replace(/\*/g, '[^/\\\\]*')
        .replace(/~~~GLOBSTAR~~~/g, '.*');
    return new RegExp(escaped + '$');
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

/**
 * Vitest/Vite plugin that scans transformed source files and fails the build if
 * platform-level brand reads bypass the canonical resolveBrand() / tenant.getBrand() path.
 *
 * Wiring (vitest.config.mjs):
 *   import { brandScatterGuardPlugin } from '@internal/cloudflare-wl-platform/guards'
 *   export default defineConfig({ plugins: [brandScatterGuardPlugin({ platformAppName: process.env.APP_NAME })] })
 *
 * @param {Object} [options]
 * @param {string}   [options.platformAppName] - App name shown in violation messages
 * @param {string[]} [options.scannedDirs]     - Absolute path prefixes to guard (legacy API)
 * @param {string[]} [options.include]         - Glob patterns to include, e.g. ['src/**\/*.mjs']
 * @returns {import('vite').Plugin}
 */
export function brandScatterGuardPlugin({ platformAppName = '', scannedDirs = [], include = null } = {}) {
    const violations = [];
    const includeFilters = include ? include.map(globToRegex) : null;

    return {
        name: 'brand-scatter-guard',

        transform(code, id) {
            if (id.includes('node_modules') || id.includes('.test.') || id.includes('__tests__')) {
                return null;
            }

            if (scannedDirs.length > 0 && !scannedDirs.some((dir) => id.startsWith(dir))) {
                return null;
            }

            if (includeFilters) {
                const normalizedId = id.replace(/\\/g, '/');
                if (!includeFilters.some((re) => re.test(normalizedId))) {
                    return null;
                }
            }

            const found = scanForBrandScatter(code, id);
            for (const v of found) {
                const patternObj = BRAND_SCATTER_PATTERNS.find((p) => p.name === v.pattern);
                violations.push(
                    `${id}:${v.line} — brand bypass: "${v.match}"` +
                        ` — ${patternObj?.hint ?? 'use the canonical brand API'}` +
                        (platformAppName ? ` [guard: ${platformAppName}]` : '')
                );
            }

            return null;
        },

        buildEnd() {
            if (violations.length > 0) {
                this.error(
                    `Brand Scatter Guard: ${violations.length} violation(s) detected:\n` +
                        violations.join('\n')
                );
            }
        },
    };
}
