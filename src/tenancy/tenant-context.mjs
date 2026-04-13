/**
 * Tenant Context — The core multi-tenancy primitive.
 *
 * Every request (fetch) or scheduled iteration creates a TenantContext
 * that flows through the entire pipeline. It encapsulates:
 *
 *   1. Tenant identity  (siteId, domain, display name)
 *   2. Scoped storage   (KV keys prefixed with siteId)
 *   3. Credentials      (per-tenant secrets or env fallback)
 *   4. Customer config   (branding, thresholds, features, etc.)
 *
 * Deployment modes:
 *   - 'saas'       → Multi-tenant: hostname → tenant lookup, shared infra
 *   - 'dedicated'  → Single-tenant: env-based config, isolated infra
 *
 * Usage:
 *   import { resolveTenantContext } from './tenant-context.mjs';
 *
 *   // In fetch handler:
 *   const tenant = await resolveTenantContext(request, env);
 *
 *   // In scheduled handler:
 *   const tenant = await resolveTenantContextForSite(env, siteId);
 *
 *   // Scoped KV access:
 *   await tenant.kvPut('latest-consolidated', data);
 *   const data = await tenant.kvGet('latest-consolidated', 'json');
 */

import { loadConfig, loadConfigFromEnv } from '../config/config-loader.mjs';
import { extractDomain } from '../config/env-adapter.mjs';
import { resolveBrand, PLATFORM_DEFAULTS } from '../brand/brand-engine.mjs';
import { resolveTenantIsolation } from '../config/tenant-isolation.mjs';
import { consumeTenantQuotaBucket, resolveTenantQuotaPolicy } from './tenant-quota.mjs';

function normalizeTenantSiteId(value = '') {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._:-]/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');
}

// ─── Deploy Mode ────────────────────────────────────────────────────────────

/**
 * Determine deployment mode from env.
 * @param {Object} env
 * @returns {'saas'|'dedicated'}
 */
export function getDeployMode(env) {
    const mode = (env.DEPLOY_MODE || 'dedicated').toLowerCase();
    return mode === 'saas' ? 'saas' : 'dedicated';
}

// ─── TenantContext Class ────────────────────────────────────────────────────

export class TenantContext {
    /**
     * @param {Object} options
     * @param {string} options.siteId        — Unique tenant identifier
     * @param {string} options.domain        — Bare domain (e.g. 'example.com')
     * @param {string} options.displayName   — Human-readable name
     * @param {Object} options.env           — Worker env bindings
     * @param {Object} options.config        — Merged customer config
     * @param {string} options.deployMode    — 'saas' or 'dedicated'
     */
    constructor({ siteId, domain, displayName, env, config, deployMode }) {
        this.siteId = siteId;
        this.domain = domain;
        this.displayName = displayName;
        this.env = env;
        this.config = config;
        this.deployMode = deployMode;
    }

    /**
     * Create a new TenantContext with a different siteId, preserving all other properties.
     * This is the safe way to "clone" a TenantContext for per-user scoping.
     *
     * Using Object.create + Object.assign to clone a TenantContext breaks private
     * fields (#brandCache) because private fields are per-instance, not per-prototype.
     * This method uses the constructor, so all private fields are properly initialized.
     *
     * @param {string} newSiteId - The new siteId (e.g. `user:email@example.com`)
     * @returns {TenantContext} A new TenantContext instance with the new siteId
     */
    withSiteId(newSiteId) {
        return new TenantContext({
            siteId: newSiteId,
            domain: this.domain,
            displayName: this.displayName,
            env: this.env,
            config: this.config,
            deployMode: this.deployMode,
        });
    }

    // ── Scoped KV Access ───────────────────────────────────────────────

    /**
     * Build a tenant-scoped KV key.
     * In dedicated mode, keys are NOT prefixed (backward-compatible).
     * In SaaS mode, keys are prefixed with `{siteId}:`.
     */
    kvKey(key) {
        return this.deployMode === 'saas' ? `${this.siteId}:${key}` : key;
    }

    /** Get from KV_ANALYTICS with tenant prefix. */
    async kvGet(key, type) {
        return this.env.KV_ANALYTICS.get(this.kvKey(key), type);
    }

    /** Put to KV_ANALYTICS with tenant prefix. */
    async kvPut(key, value, options) {
        return this.env.KV_ANALYTICS.put(this.kvKey(key), value, options);
    }

    /** Delete from KV_ANALYTICS with tenant prefix. */
    async kvDelete(key) {
        return this.env.KV_ANALYTICS.delete(this.kvKey(key));
    }

    /** List from KV_ANALYTICS with tenant prefix. */
    async kvList(options = {}) {
        return this.env.KV_ANALYTICS.list({
            ...options,
            prefix: this.kvKey(options.prefix || ''),
        });
    }

    /** Get from KV_HISTORY with tenant prefix. */
    async historyGet(key, type) {
        return this.env.KV_HISTORY.get(this.kvKey(key), type);
    }

    /** Put to KV_HISTORY with tenant prefix. */
    async historyPut(key, value, options) {
        return this.env.KV_HISTORY.put(this.kvKey(key), value, options);
    }

    /** Delete from KV_HISTORY with tenant prefix. */
    async historyDelete(key) {
        return this.env.KV_HISTORY.delete(this.kvKey(key));
    }

    /** List from KV_HISTORY with tenant prefix. */
    async historyList(options = {}) {
        return this.env.KV_HISTORY.list({
            ...options,
            prefix: this.kvKey(options.prefix || ''),
        });
    }

    // ── Scoped R2 Access ──────────────────────────────────────────────

    /**
     * Build a tenant-scoped R2 key.
     * In dedicated mode, keys are NOT prefixed (backward-compatible).
     * In SaaS mode, keys are prefixed with `{siteId}/`.
     */
    r2Key(key) {
        return this.deployMode === 'saas' ? `${this.siteId}/${key}` : key;
    }

    /** Get from R2 with tenant prefix. */
    async r2Get(key) {
        if (!this.env.R2_ANALYTICS) {
            return null;
        }
        return this.env.R2_ANALYTICS.get(this.r2Key(key));
    }

    /** Put to R2 with tenant prefix. */
    async r2Put(key, value, options) {
        if (!this.env.R2_ANALYTICS) {
            return;
        }
        return this.env.R2_ANALYTICS.put(this.r2Key(key), value, options);
    }

    /** List from R2 with tenant prefix. */
    async r2List(options = {}) {
        if (!this.env.R2_ANALYTICS) {
            return { objects: [], truncated: false };
        }
        return this.env.R2_ANALYTICS.list({
            ...options,
            prefix: this.r2Key(options.prefix || ''),
        });
    }

    // ── Credentials ───────────────────────────────────────────────────

    /**
     * Get the GSC site URL for this tenant.
     * In dedicated mode, reads from env. In SaaS mode, reads from config.
     */
    getSiteUrl() {
        return this.config?.site?.siteUrl || this.env.SITE_URL || '';
    }

    /**
     * Get the GSC credentials for this tenant.
     * In dedicated mode, reads directly from env (Wrangler secrets).
     * In SaaS mode, tries KV-stored encrypted credentials first, then env fallback.
     */
    async getGSCCredentials() {
        // In SaaS mode, try tenant-specific credentials from KV
        if (this.deployMode === 'saas') {
            const creds = await this.kvGet('credentials:gsc', 'json');
            if (creds) {
                return creds;
            }
        }

        // Fallback: env-level secrets (works for dedicated and as SaaS fallback)
        const authMethod = this.config?.credentials?.gscAuthMethod || 'service_account';
        if (authMethod === 'service_account') {
            return {
                authMethod: 'service_account',
                serviceAccountKey: this.env.GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_KEY || null,
            };
        }
        return {
            authMethod: 'oauth',
            clientId: this.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID || '',
            clientSecret: this.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET || '',
            refreshToken: this.env.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN || '',
        };
    }

    /**
     * Get the PageSpeed API key for this tenant.
     */
    getPageSpeedApiKey() {
        return this.env.PAGESPEED_API_KEY || null;
    }

    // ── Branding ──────────────────────────────────────────────────────

    /** @type {Readonly<Brand>|null} */
    #brandCache = null;

    /**
     * Resolve the full brand object for this tenant (lazy-memoized).
     * Uses the 3-tier merge: tenant.config.branding > env > PLATFORM_DEFAULTS.
     * @returns {Readonly<Brand>}
     */
    getBrand() {
        if (!this.#brandCache) {
            this.#brandCache = resolveBrand(this.env, this);
        }
        return this.#brandCache;
    }

    /** Get raw branding config for this tenant (without resolution). */
    getBranding() {
        return this.config?.branding || {};
    }

    /** Get the product name for this tenant (delegates to getBrand). */
    getProductName() {
        return this.getBrand().productName;
    }

    // ── Isolation & Quotas ───────────────────────────────────────────

    /** Resolve normalized tenant-isolation policy from this tenant's config. */
    getTenantIsolationPolicy() {
        return resolveTenantIsolation(this.config?.tenantIsolation || {});
    }

    /**
     * Assert that a caller-provided siteId belongs to this context.
     * Throws on mismatch to prevent cross-tenant data access.
     */
    assertTenantOwnership(candidateSiteId = '') {
        const expected = normalizeTenantSiteId(this.siteId);
        const actual = normalizeTenantSiteId(candidateSiteId);

        if (!actual || actual !== expected) {
            throw new Error(
                `[TenantContext] Tenant ownership mismatch: expected '${expected}' but received '${actual || '(empty)'}'`
            );
        }

        return true;
    }

    /** Resolve effective per-tenant quota policy (rate limits + monthly caps). */
    getQuotaPolicy(options = {}) {
        return resolveTenantQuotaPolicy(this.config || {}, options);
    }

    /**
     * Consume one unit from a tenant-scoped rate-limit bucket.
     * Buckets map to config.quotas fields (e.g. apiRequestsPerMinute).
     */
    consumeRateLimit(bucket = 'apiRequestsPerMinute', options = {}) {
        return consumeTenantQuotaBucket(this, bucket, {
            ...options,
            siteId: options.siteId || this.siteId,
        });
    }

    // ── Feature Flags ─────────────────────────────────────────────────

    /** Check if a feature is enabled for this tenant. */
    isFeatureEnabled(featureName) {
        return this.config?.features?.[featureName] ?? false;
    }

    // ── OAuth Configuration ────────────────────────────────────────────

    /**
     * Get an OAuth credential value from environment.
     * Looks up Wrangler Secret by name.
     *
     * @param {string} secretName - E.g., 'GOOGLE_CLIENT_ID'
     * @returns {string|null}
     */
    getCredential(secretName) {
        return this.env[secretName] || null;
    }

    /**
     * Get the app base URL for OAuth redirect URIs.
     * Falls back through config → env → brand defaults.
     *
     * @returns {string}
     */
    getAppUrl() {
        return (
            this.config?.app?.url ||
            this.env.APP_URL ||
            this.getBrand().siteUrl ||
            PLATFORM_DEFAULTS.appUrlFallback
        );
    }

    /**
     * Get OAuth configuration for a given provider.
     * Returns null if provider not enabled.
     *
     * @param {string} provider - 'gsc', 'drive', 'gmail', etc.
     * @returns {{clientId: string, clientSecret: string, scopes: string[]}|null}
     */
    getOAuthConfig(provider = 'gsc') {
        const googleConfig = this.config?.oauth?.google?.[provider];

        if (!googleConfig?.enabled) {
            return null;
        }

        const clientId = this.getCredential(googleConfig.clientIdSecret);
        const clientSecret = this.getCredential(googleConfig.clientSecretSecret);

        if (!clientId || !clientSecret) {
            console.warn(`[TenantContext] OAuth config incomplete for ${provider}: missing credentials`);
            return null;
        }

        return {
            clientId,
            clientSecret,
            scopes: googleConfig.scopes || ['https://www.googleapis.com/auth/webmasters.readonly'],
            provider,
        };
    }

    /**
     * Check if OAuth is configured and enabled for a provider.
     *
     * @param {string} provider - 'gsc' (default)
     * @returns {boolean}
     */
    isOAuthEnabled(provider = 'gsc') {
        return this.getOAuthConfig(provider) !== null;
    }

    // ── Convenience ───────────────────────────────────────────────────

    /** Serialize tenant info for logging. */
    toJSON() {
        return {
            siteId: this.siteId,
            domain: this.domain,
            displayName: this.displayName,
            deployMode: this.deployMode,
        };
    }
}

// ─── Tenant Resolution ──────────────────────────────────────────────────────

/**
 * Resolve tenant context from an incoming HTTP request.
 *
 * Resolution strategy:
 *   1. SaaS mode: hostname → tenant mapping via KV lookup
 *   2. Dedicated mode: derive from env.SITE_URL (single tenant)
 *
 * @param {Request} request
 * @param {Object} env
 * @returns {Promise<TenantContext>}
 */
export async function resolveTenantContext(request, env, options = {}) {
    const deployMode = getDeployMode(env);
    const { skipConfig = false } = options;

    if (deployMode === 'saas') {
        return await _resolveSaaSTenant(request, env, { skipConfig });
    }

    return await _resolveDedicatedTenant(env, undefined, { skipConfig });
}

/**
 * Resolve tenant context for a known siteId (used in scheduled handlers).
 *
 * @param {Object} env
 * @param {string} siteId
 * @returns {Promise<TenantContext>}
 */
export async function resolveTenantContextForSite(env, siteId) {
    const deployMode = getDeployMode(env);

    try {
        const config = await loadConfig(env, siteId);
        return new TenantContext({
            siteId,
            domain: config.site?.domain || extractDomain(config.site?.siteUrl || ''),
            displayName: config.site?.name || siteId,
            env,
            config,
            deployMode,
        });
    } catch (err) {
        console.warn(
            `[TenantContext] Failed to load config for '${siteId}', using env fallback:`,
            err.message
        );
        return await _resolveDedicatedTenant(env, siteId);
    }
}

// ─── Private Helpers ────────────────────────────────────────────────────────

/**
 * SaaS mode: Use hostname → siteId mapping from KV.
 * KV key: `tenant-map:{hostname}` → siteId
 */
async function _resolveSaaSTenant(request, env, options = {}) {
    const url = new URL(request.url);
    const hostname = url.hostname;
    const { skipConfig = false } = options;

    // Fast path for pre-auth API requests: avoid KV lookups entirely and derive a
    // safe tenant stub from the hostname until the route actually needs full config.
    if (skipConfig) {
        const siteId = hostname.replace(/\./g, '-') || 'default-site';
        const config = loadConfigFromEnv(env);
        return new TenantContext({
            siteId,
            domain: extractDomain(hostname) || hostname,
            displayName: config.site?.name || hostname,
            env,
            config,
            deployMode: 'saas',
        });
    }

    // Look up hostname → siteId mapping
    const kv = env.KV_CONFIG || env.KV_ANALYTICS;
    let siteId = null;
    try {
        siteId = await kv.get(`tenant-map:${hostname}`);
    } catch {
        /* KV error */
    }

    if (!siteId) {
        // Fallback: derive siteId from hostname
        siteId = hostname.replace(/\./g, '-');
        console.warn(
            `[TenantContext] No tenant mapping for hostname '${hostname}', derived siteId: '${siteId}'`
        );
    }

    try {
        const config = await loadConfig(env, siteId);
        return new TenantContext({
            siteId,
            domain: config.site?.domain || extractDomain(hostname),
            displayName: config.site?.name || hostname,
            env,
            config,
            deployMode: 'saas',
        });
    } catch (err) {
        console.warn(`[TenantContext] Config load failed for SaaS tenant '${siteId}':`, err.message);
        // Emergency fallback
        return await _resolveDedicatedTenant(env, siteId);
    }
}

/**
 * Dedicated mode: Single-tenant, config from env vars.
 */
async function _resolveDedicatedTenant(env, siteIdOverride, options = {}) {
    const siteUrl = env.SITE_URL || '';
    const domain = extractDomain(siteUrl);
    const siteId = siteIdOverride || domain || 'default-site';
    const { skipConfig = false } = options;

    let config;
    try {
        config = skipConfig ? loadConfigFromEnv(env) : await loadConfig(env, siteId);
    } catch {
        config = loadConfigFromEnv(env);
    }

    return new TenantContext({
        siteId,
        domain,
        displayName: config.site?.name || domain || 'Default Site',
        env,
        config,
        deployMode: 'dedicated',
    });
}

// ─── Tenant Registry (SaaS mode) ───────────────────────────────────────────

/**
 * List all registered tenant siteIds.
 * Used by the scheduled handler to iterate over all tenants.
 *
 * @param {Object} env
 * @returns {Promise<string[]>} Array of siteIds
 */
export async function listAllTenants(env) {
    const deployMode = getDeployMode(env);

    if (deployMode === 'dedicated') {
        // Single tenant — derive from env
        const domain = extractDomain(env.SITE_URL || '');
        return [domain || 'default-site'];
    }

    // SaaS mode: list all tenant registrations from KV
    const kv = env.KV_CONFIG || env.KV_ANALYTICS;
    const tenants = [];
    let cursor;

    try {
        do {
            const list = await kv.list({ prefix: 'tenant-registry:', cursor, limit: 100 });
            for (const key of list.keys) {
                // tenant-registry:{siteId} → exists
                const siteId = key.name.replace('tenant-registry:', '');
                if (siteId) {
                    tenants.push(siteId);
                }
            }
            cursor = list.list_complete === false ? list.cursor : null;
        } while (cursor);
    } catch (err) {
        console.error('[TenantContext] Failed to list tenants:', err.message);
    }

    return tenants.length > 0 ? tenants : ['default-site'];
}

/**
 * Register a new tenant in the SaaS registry.
 *
 * @param {Object} env
 * @param {string} siteId
 * @param {Object} registrationData - { hostname, domain, name, tier }
 */
export async function registerTenant(env, siteId, registrationData = {}) {
    const kv = env.KV_CONFIG || env.KV_ANALYTICS;

    // Store tenant registry entry
    await kv.put(
        `tenant-registry:${siteId}`,
        JSON.stringify({
            siteId,
            hostname: registrationData.hostname || '',
            domain: registrationData.domain || '',
            name: registrationData.name || siteId,
            tier: registrationData.tier || 'growth',
            registeredAt: new Date().toISOString(),
            active: true,
        })
    );

    // Store hostname → siteId mapping (for request routing)
    if (registrationData.hostname) {
        await kv.put(`tenant-map:${registrationData.hostname}`, siteId);
    }

    console.log(
        `[TenantContext] Registered tenant '${siteId}' (hostname: ${registrationData.hostname || 'none'})`
    );
}

/**
 * Unregister a tenant (mark inactive, don't delete data).
 */
export async function unregisterTenant(env, siteId) {
    const kv = env.KV_CONFIG || env.KV_ANALYTICS;

    try {
        const raw = await kv.get(`tenant-registry:${siteId}`);
        if (raw) {
            const entry = JSON.parse(raw);
            entry.active = false;
            entry.deactivatedAt = new Date().toISOString();
            await kv.put(`tenant-registry:${siteId}`, JSON.stringify(entry));

            // Remove hostname mapping
            if (entry.hostname) {
                await kv.delete(`tenant-map:${entry.hostname}`);
            }
        }
    } catch (err) {
        console.error(`[TenantContext] Failed to unregister tenant '${siteId}':`, err.message);
    }
}
