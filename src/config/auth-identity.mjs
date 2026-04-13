/**
 * Auth Identity Helpers
 *
 * Centralizes per-tenant SSO, MFA, session-cookie, and RBAC policy
 * for enterprise white-label deployments.
 */

import { normalizeHostname, normalizeUrl } from '../tenancy/domain-control.mjs';

export const AUTH_SSO_MODE = Object.freeze({
    DISABLED: 'disabled',
    OIDC: 'oidc',
    SAML: 'saml',
});

export const MFA_ENFORCEMENT_MODE = Object.freeze({
    OPTIONAL: 'optional',
    REQUIRED: 'required',
});

export const AUTH_SESSION_SAME_SITE = Object.freeze({
    STRICT: 'strict',
    LAX: 'lax',
    NONE: 'none',
});

export const AUTH_AUDIT_EXPORT_FORMAT = Object.freeze({
    JSON: 'json',
    JSONL: 'jsonl',
    CEF: 'cef',
});

export const AUTH_SSO_MODE_VALUES = Object.freeze(Object.values(AUTH_SSO_MODE));
export const MFA_ENFORCEMENT_MODE_VALUES = Object.freeze(Object.values(MFA_ENFORCEMENT_MODE));
export const AUTH_SESSION_SAME_SITE_VALUES = Object.freeze(Object.values(AUTH_SESSION_SAME_SITE));
export const AUTH_AUDIT_EXPORT_FORMAT_VALUES = Object.freeze(Object.values(AUTH_AUDIT_EXPORT_FORMAT));

export const DEFAULT_AUTH_PERMISSION_CATALOG = Object.freeze([
    'auth.manage',
    'branding.manage',
    'members.manage',
    'tenant.manage',
    'tenant.export',
    'reports.view',
    'reports.export',
    'integrations.manage',
    'billing.manage',
    'audit.view',
]);

export const DEFAULT_AUTH_ROLE_DEFINITIONS = Object.freeze([
    Object.freeze({
        id: 'tenant_owner',
        label: 'Tenant Owner',
        description: 'Full white-label, auth, billing, and export control for the tenant.',
        permissions: Object.freeze([
            'auth.manage',
            'branding.manage',
            'members.manage',
            'tenant.manage',
            'tenant.export',
            'reports.view',
            'reports.export',
            'integrations.manage',
            'billing.manage',
            'audit.view',
        ]),
        isDefault: true,
    }),
    Object.freeze({
        id: 'tenant_admin',
        label: 'Tenant Admin',
        description: 'Operational admin with access to users, integrations, and reporting.',
        permissions: Object.freeze([
            'auth.manage',
            'members.manage',
            'tenant.manage',
            'reports.view',
            'reports.export',
            'integrations.manage',
            'audit.view',
        ]),
        isDefault: true,
    }),
    Object.freeze({
        id: 'analyst',
        label: 'Analyst',
        description: 'Can review dashboards and export reports without changing auth policy.',
        permissions: Object.freeze(['reports.view', 'reports.export']),
        isDefault: true,
    }),
    Object.freeze({
        id: 'viewer',
        label: 'Viewer',
        description: 'Read-only dashboard access.',
        permissions: Object.freeze(['reports.view']),
        isDefault: true,
    }),
]);

export const DEFAULT_AUTH_ROLE_IDS = Object.freeze(
    DEFAULT_AUTH_ROLE_DEFINITIONS.map((role) => role.id)
);

function safeString(value = '') {
    return typeof value === 'string' ? value.trim() : '';
}

function labelize(value = '', fallback = 'Custom Role') {
    const text = String(value || fallback).replace(/[._-]+/g, ' ').trim();
    return text ? text.replace(/\b\w/g, (char) => char.toUpperCase()) : fallback;
}

function sanitizePermission(value = '') {
    return safeString(value)
        .toLowerCase()
        .replace(/[^a-z0-9._:-]/g, '.')
        .replace(/\.{2,}/g, '.')
        .replace(/^\.+|\.+$/g, '');
}

function normalizePermissionList(value = []) {
    const rawItems = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(',')
            : [];

    const seen = new Set();
    const normalized = [];
    for (const item of rawItems) {
        const permission = sanitizePermission(item);
        if (!permission || seen.has(permission)) {
            continue;
        }
        seen.add(permission);
        normalized.push(permission);
    }
    return normalized;
}

function sanitizeRoleId(value = '') {
    return safeString(value)
        .toLowerCase()
        .replace(/[^a-z0-9:_-]/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_+|_+$/g, '');
}

function normalizeRoleDefinition(value = {}) {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const id = sanitizeRoleId(value.id || value.key || value.roleId || '');
    if (!id) {
        return null;
    }

    return {
        id,
        label: safeString(value.label || value.name || labelize(id)) || labelize(id),
        description: safeString(value.description),
        permissions: normalizePermissionList(value.permissions || []),
        isDefault: Boolean(value.isDefault),
    };
}

function normalizeRoleDefinitions(value = []) {
    const rawItems = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? (() => {
                try {
                    const parsed = JSON.parse(value);
                    return Array.isArray(parsed) ? parsed : [];
                } catch {
                    return [];
                }
            })()
            : [];

    const merged = new Map();
    for (const item of rawItems) {
        const normalized = normalizeRoleDefinition(item);
        if (!normalized) {
            continue;
        }
        merged.set(normalized.id, normalized);
    }

    return [...merged.values()];
}

export function resolveAuthIdentity(config = {}) {
    const ssoMode = AUTH_SSO_MODE_VALUES.includes(config.ssoMode)
        ? config.ssoMode
        : AUTH_SSO_MODE.DISABLED;
    const mfaEnforcement = MFA_ENFORCEMENT_MODE_VALUES.includes(config.mfaEnforcement)
        ? config.mfaEnforcement
        : MFA_ENFORCEMENT_MODE.OPTIONAL;
    const sessionCookieSameSite = AUTH_SESSION_SAME_SITE_VALUES.includes(
        String(config.sessionCookieSameSite || '').toLowerCase()
    )
        ? String(config.sessionCookieSameSite || '').toLowerCase()
        : AUTH_SESSION_SAME_SITE.LAX;
    const auditExportFormat = AUTH_AUDIT_EXPORT_FORMAT_VALUES.includes(config.auditExportFormat)
        ? config.auditExportFormat
        : AUTH_AUDIT_EXPORT_FORMAT.JSONL;

    const configuredRoles = normalizeRoleDefinitions(config.roleDefinitions || config.roles || []);
    const roleMap = new Map(
        DEFAULT_AUTH_ROLE_DEFINITIONS.map((role) => [role.id, { ...role, permissions: [...role.permissions] }])
    );
    for (const role of configuredRoles) {
        roleMap.set(role.id, role);
    }

    return {
        ssoMode,
        oidcDiscoveryUrl: normalizeUrl(config.oidcDiscoveryUrl || config.discoveryUrl || ''),
        oidcClientIdSecret: safeString(config.oidcClientIdSecret || config.clientIdSecret || ''),
        oidcClientSecretSecret: safeString(config.oidcClientSecretSecret || config.clientSecretSecret || ''),
        samlEntryPoint: normalizeUrl(config.samlEntryPoint || config.ssoUrl || ''),
        samlEntityId: safeString(config.samlEntityId || config.entityId || ''),
        samlCertificateSecret: safeString(config.samlCertificateSecret || config.certificateSecret || ''),
        loginHostname: normalizeHostname(config.loginHostname || config.authHostname || ''),
        loginHelpText: safeString(config.loginHelpText || config.helpText || ''),
        passwordResetUrl: normalizeUrl(config.passwordResetUrl || config.resetUrl || ''),
        mfaHelpUrl: normalizeUrl(config.mfaHelpUrl || config.recoveryUrl || ''),
        mfaEnforcement,
        sessionCookieDomain: normalizeHostname(config.sessionCookieDomain || config.cookieDomain || ''),
        sessionCookieSameSite,
        sessionCookieSecureOnly: config.sessionCookieSecureOnly !== false,
        roleDefinitions: [...roleMap.values()],
        customPermissions: normalizePermissionList(config.customPermissions || config.permissionCatalog || []),
        auditExportFormat,
        notes: safeString(config.notes),
    };
}

export function resolveSessionCookiePolicy(request, authIdentity = {}) {
    const resolved = resolveAuthIdentity(authIdentity);
    const isSecure = request ? new URL(request.url).protocol === 'https:' : true;

    let sameSite = resolved.sessionCookieSameSite || AUTH_SESSION_SAME_SITE.LAX;
    let secureOnly = resolved.sessionCookieSecureOnly !== false;

    // CRITICAL FIX: SameSite=None REQUIRES secure HTTPS cookies. Never silently downgrade.
    // If operator configured sameSite=NONE but origin is insecure, log warning and use LAX instead.
    // This prevents silent security degradation and alerts operator to misconfiguration.
    if (sameSite === AUTH_SESSION_SAME_SITE.NONE) {
        if (!isSecure) {
            console.warn(
                '[AuthIdentity] sameSite=None configured but origin is insecure (http). ' +
                'Downgrading to sameSite=LAX to prevent cookie rejection. ' +
                'To use sameSite=None, deploy on https:// origin.'
            );
            sameSite = AUTH_SESSION_SAME_SITE.LAX;
            secureOnly = false;
        } else {
            secureOnly = true;
        }
    }

    return {
        domain: resolved.sessionCookieDomain || '',
        sameSite,
        secure: secureOnly ? isSecure : false,
        secureOnly,
        // Include metadata so caller knows policy was altered
        policyModified: sameSite === AUTH_SESSION_SAME_SITE.LAX && resolved.sessionCookieSameSite === AUTH_SESSION_SAME_SITE.NONE,
    };
}

// ─── Prompt 1: Per-tenant SSO Config Descriptors ─────────────────────────────

/**
 * All observable auth event types — used for audit trail entries.
 * Consuming app emits these; platform helpers write/read them.
 */
export const AUTH_EVENT_ACTION = Object.freeze({
    LOGIN_SUCCESS: 'auth.login.success',
    LOGIN_FAILURE: 'auth.login.failure',
    LOGOUT: 'auth.logout',
    SSO_INITIATED: 'auth.sso.initiated',
    SSO_COMPLETED: 'auth.sso.completed',
    SSO_FAILED: 'auth.sso.failed',
    MFA_ENROLLED: 'auth.mfa.enrolled',
    MFA_CHALLENGED: 'auth.mfa.challenged',
    MFA_PASSED: 'auth.mfa.passed',
    MFA_FAILED: 'auth.mfa.failed',
    PASSWORD_RESET_REQUESTED: 'auth.password_reset.requested',
    PASSWORD_RESET_COMPLETED: 'auth.password_reset.completed',
    ROLE_CHANGED: 'auth.role.changed',
    PERMISSION_DENIED: 'auth.permission.denied',
    SESSION_EXPIRED: 'auth.session.expired',
    TOKEN_REFRESHED: 'auth.token.refreshed',
    ACCOUNT_LOCKED: 'auth.account.locked',
    ACCOUNT_UNLOCKED: 'auth.account.unlocked',
});

export const AUTH_EVENT_ACTION_VALUES = Object.freeze(Object.values(AUTH_EVENT_ACTION));

/**
 * Resolve a ready-to-use OIDC config descriptor from tenant authIdentity config.
 * Returns null when ssoMode is not 'oidc' or required fields are absent.
 * Consuming app should use this as the gate before initiating an OIDC flow.
 */
export function resolveOidcConfig(authIdentity = {}) {
    const ssoMode = authIdentity?.ssoMode || AUTH_SSO_MODE.DISABLED;
    if (ssoMode !== AUTH_SSO_MODE.OIDC) {
        return null;
    }

    const discoveryUrl = normalizeUrl(authIdentity.oidcDiscoveryUrl || '');
    const clientIdSecret = safeString(authIdentity.oidcClientIdSecret || '');
    const clientSecretSecret = safeString(authIdentity.oidcClientSecretSecret || '');

    const ready = Boolean(discoveryUrl && clientIdSecret && clientSecretSecret);
    const missingFields = [];
    if (!discoveryUrl) missingFields.push('oidcDiscoveryUrl');
    if (!clientIdSecret) missingFields.push('oidcClientIdSecret');
    if (!clientSecretSecret) missingFields.push('oidcClientSecretSecret');

    return Object.freeze({
        protocol: 'oidc',
        discoveryUrl,
        clientIdSecret,
        clientSecretSecret,
        loginHostname: normalizeHostname(authIdentity.loginHostname || ''),
        ready,
        missingFields: Object.freeze(missingFields),
    });
}

/**
 * Resolve a ready-to-use SAML config descriptor from tenant authIdentity config.
 * Returns null when ssoMode is not 'saml' or required fields are absent.
 */
export function resolveSamlConfig(authIdentity = {}) {
    const ssoMode = authIdentity?.ssoMode || AUTH_SSO_MODE.DISABLED;
    if (ssoMode !== AUTH_SSO_MODE.SAML) {
        return null;
    }

    const entryPoint = normalizeUrl(authIdentity.samlEntryPoint || '');
    const entityId = safeString(authIdentity.samlEntityId || '');
    const certificateSecret = safeString(authIdentity.samlCertificateSecret || '');

    const ready = Boolean(entryPoint && entityId && certificateSecret);
    const missingFields = [];
    if (!entryPoint) missingFields.push('samlEntryPoint');
    if (!entityId) missingFields.push('samlEntityId');
    if (!certificateSecret) missingFields.push('samlCertificateSecret');

    return Object.freeze({
        protocol: 'saml',
        entryPoint,
        entityId,
        certificateSecret,
        loginHostname: normalizeHostname(authIdentity.loginHostname || ''),
        ready,
        missingFields: Object.freeze(missingFields),
    });
}

// ─── Prompt 2: White-label Login / MFA Branding Descriptor ───────────────────

/**
 * Merge auth identity + brand config into a single white-label login page descriptor.
 * Consuming app renders the login/password-reset/MFA screens using this object —
 * no vendor identity should appear if all white-label fields are populated.
 *
 * @param {object} authIdentity - config.authIdentity (post-merge)
 * @param {object} brand        - resolved brand object from brand-engine (optional)
 */
export function resolveLoginBranding(authIdentity = {}, brand = {}) {
    const loginHostname = normalizeHostname(authIdentity?.loginHostname || '');
    const loginOrigin = loginHostname ? `https://${loginHostname}` : (brand?.appOrigin || '');

    return Object.freeze({
        // Identity
        loginHostname,
        loginOrigin,
        // Visual brand
        productName: safeString(brand?.productName || ''),
        logoUrl: safeString(brand?.resolvedLogoUrl || brand?.logoUrl || ''),
        faviconUrl: safeString(brand?.faviconUrl || ''),
        primaryColor: safeString(brand?.primaryColor || '#3b82f6'),
        // White-label copy surfaces
        loginHelpText: safeString(authIdentity?.loginHelpText || ''),
        passwordResetUrl: normalizeUrl(authIdentity?.passwordResetUrl || ''),
        mfaHelpUrl: normalizeUrl(authIdentity?.mfaHelpUrl || ''),
        // MFA posture
        mfaEnforcement: MFA_ENFORCEMENT_MODE_VALUES.includes(authIdentity?.mfaEnforcement)
            ? authIdentity.mfaEnforcement
            : MFA_ENFORCEMENT_MODE.OPTIONAL,
        // SSO mode tells the login page which credential form to show
        ssoMode: AUTH_SSO_MODE_VALUES.includes(authIdentity?.ssoMode)
            ? authIdentity.ssoMode
            : AUTH_SSO_MODE.DISABLED,
    });
}

// ─── Prompt 3: RBAC Policy + Runtime Permission Check ────────────────────────

/**
 * Build a structured RBAC policy from resolved authIdentity.
 * Returns:
 *   permissionToRoles: Map<permission, string[]>  — which roles grant each permission
 *   roleToPermissions: Map<roleId, string[]>       — permissions held by each role
 *   knownRoles: string[]
 *   knownPermissions: string[]
 */
export function resolveRbacPolicy(authIdentity = {}) {
    const resolved = resolveAuthIdentity(authIdentity);
    const roles = resolved.roleDefinitions || [];

    const roleToPermissions = new Map();
    const permissionToRoles = new Map();

    for (const role of roles) {
        const perms = Array.isArray(role.permissions) ? role.permissions : [];
        roleToPermissions.set(role.id, perms);
        for (const perm of perms) {
            if (!permissionToRoles.has(perm)) {
                permissionToRoles.set(perm, []);
            }
            permissionToRoles.get(perm).push(role.id);
        }
    }

    // Merge custom permissions into catalog
    const allCustomPerms = Array.isArray(resolved.customPermissions) ? resolved.customPermissions : [];
    const knownPermissions = [...new Set([...permissionToRoles.keys(), ...allCustomPerms])];

    return Object.freeze({
        roleToPermissions,
        permissionToRoles,
        knownRoles: roles.map((r) => r.id),
        knownPermissions,
    });
}

/**
 * Assert that at least one of the supplied role IDs grants the required permission.
 * Returns { granted: boolean, roleId: string|null }
 * Safe to call at request time — no I/O.
 *
 * @param {ReturnType<resolveRbacPolicy>} rbacPolicy
 * @param {string[]} callerRoleIds - roles held by the current user
 * @param {string} requiredPermission
 */
export function assertPermission(rbacPolicy, callerRoleIds = [], requiredPermission = '') {
    if (!rbacPolicy || !requiredPermission) {
        return { granted: false, roleId: null };
    }

    const grantingRoles = rbacPolicy.permissionToRoles.get(requiredPermission) || [];
    for (const roleId of callerRoleIds) {
        if (grantingRoles.includes(roleId)) {
            return { granted: true, roleId };
        }
    }

    return { granted: false, roleId: null };
}

// ─── Prompt 4: Security Headers Scoped to Custom Domain ──────────────────────

const AUTH_SECURITY_HEADER_DEFAULTS = Object.freeze({
    hstsMaxAgeSeconds: 63072000,   // 2 years
    hstsIncludeSubdomains: true,
    hstsPreload: false,
    framePolicy: 'SAMEORIGIN',     // 'DENY' | 'SAMEORIGIN'
    referrerPolicy: 'strict-origin-when-cross-origin',
    permissionsPolicy: 'camera=(), microphone=(), geolocation=()',
});

/**
 * Build HTTP security response headers for an auth endpoint on the custom domain.
 * All values are scoped to the tenant's own domain; no vendor domain references appear.
 *
 * @param {object} authIdentity - config.authIdentity (post-merge)
 * @param {object} [options]    - overrides for individual header policies
 * @returns {Record<string, string>}
 */
export function buildAuthSecurityHeaders(authIdentity = {}, options = {}) {
    const opts = { ...AUTH_SECURITY_HEADER_DEFAULTS, ...(options || {}) };

    const loginHostname = normalizeHostname(authIdentity?.loginHostname || '');
    const cookieDomain = normalizeHostname(authIdentity?.sessionCookieDomain || loginHostname || '');

    // HSTS
    let hstsValue = `max-age=${Math.max(0, Math.floor(Number(opts.hstsMaxAgeSeconds) || 63072000))}`;
    if (opts.hstsIncludeSubdomains) hstsValue += '; includeSubDomains';
    if (opts.hstsPreload) hstsValue += '; preload';

    // X-Frame-Options — restrict framing to same origin (or deny) to block clickjacking
    const framePolicy = ['DENY', 'SAMEORIGIN'].includes(String(opts.framePolicy || '').toUpperCase())
        ? String(opts.framePolicy).toUpperCase()
        : 'SAMEORIGIN';

    // CSP: restrict to the tenant's own origin only — no vendor CDN references
    const cspOrigin = loginHostname ? `https://${loginHostname}` : "'self'";
    const cspValue = [
        `default-src 'self'`,
        `script-src 'self'`,
        `style-src 'self' 'unsafe-inline'`,
        `img-src 'self' data:`,
        `font-src 'self'`,
        `connect-src 'self' ${cspOrigin}`,
        `frame-ancestors ${framePolicy === 'DENY' ? "'none'" : "'self'"}`,
        `form-action 'self'`,
        `base-uri 'self'`,
    ].join('; ');

    const headers = {
        'Strict-Transport-Security': hstsValue,
        'X-Frame-Options': framePolicy,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': String(opts.referrerPolicy || 'strict-origin-when-cross-origin'),
        'Content-Security-Policy': cspValue,
        'Permissions-Policy': String(opts.permissionsPolicy || AUTH_SECURITY_HEADER_DEFAULTS.permissionsPolicy),
    };

    // Cookie binding metadata — not a real header but useful for Set-Cookie construction
    if (cookieDomain) {
        headers['X-Auth-Cookie-Domain'] = cookieDomain;
    }

    return Object.freeze(headers);
}

// ─── Prompt 5: Auth Audit Log (KV-backed, SIEM-exportable) ───────────────────

const AUTH_AUDIT_KEY_PREFIX = 'auth-audit:';
const AUTH_AUDIT_DEFAULT_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 year

function getAuthAuditKv(env = {}) {
    return env.KV_CONFIG || env.KV_ANALYTICS || null;
}

/**
 * Build a standardised auth audit event object.
 * Does not write to storage — suitable for passing to writeAuthAuditEvent or
 * assembling in-process before a batch write.
 */
export function buildAuthAuditEvent(params = {}) {
    const nowMs = Number(params.nowMs) || Date.now();
    const action = AUTH_EVENT_ACTION_VALUES.includes(params.action)
        ? params.action
        : String(params.action || 'auth.unknown');

    return Object.freeze({
        eventId: `${nowMs.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        siteId: String(params.siteId || '').trim().toLowerCase(),
        action,
        actor: String(params.actor || 'user').trim(),
        actorId: String(params.actorId || '').trim(),
        actorEmail: String(params.actorEmail || '').trim().toLowerCase(),
        actorRoles: Array.isArray(params.actorRoles) ? params.actorRoles.map(String) : [],
        ipAddress: String(params.ipAddress || '').trim(),
        userAgent: String(params.userAgent || '').trim(),
        ssoProtocol: String(params.ssoProtocol || '').trim(),
        outcome: String(params.outcome || 'success').trim(),
        reason: String(params.reason || '').trim(),
        details: params.details && typeof params.details === 'object' ? { ...params.details } : {},
        timestamp: new Date(nowMs).toISOString(),
        source: String(params.source || 'auth-identity').trim(),
    });
}

/**
 * Write a single auth audit event to KV.
 * Key: auth-audit:{siteId}:{eventId}
 * TTL defaults to 1 year.
 */
export async function writeAuthAuditEvent(env, siteId, event = {}) {
    const kv = getAuthAuditKv(env);
    if (!kv?.put) {
        return null;
    }

    const normalizedSiteId = String(siteId || '').trim().toLowerCase();
    if (!normalizedSiteId) {
        return null;
    }

    const auditEvent = buildAuthAuditEvent({ ...event, siteId: normalizedSiteId });
    const ttl = Math.max(60, Number(event.ttlSeconds) || AUTH_AUDIT_DEFAULT_TTL_SECONDS);
    const key = `${AUTH_AUDIT_KEY_PREFIX}${normalizedSiteId}:${auditEvent.eventId}`;

    await kv.put(key, JSON.stringify(auditEvent), { expirationTtl: ttl });
    return auditEvent;
}

/**
 * Export all auth audit events for a tenant in JSONL or CEF format.
 *
 * JSONL: one JSON object per line — suitable for BigQuery, Elastic, Splunk HTTP Event Collector.
 * CEF:   Common Event Format — syslog-compatible SIEM format (ArcSight, QRadar, etc.).
 *
 * @param {object} env
 * @param {string} siteId
 * @param {{ format?: 'jsonl'|'json'|'cef', limit?: number, cursor?: string }} options
 * @returns {{ entries: object[], format: string, siteId: string, cursor: string|null, truncated: boolean }}
 */
export async function exportAuthAuditLog(env, siteId, options = {}) {
    const kv = getAuthAuditKv(env);
    const normalizedSiteId = String(siteId || '').trim().toLowerCase();
    const format = AUTH_AUDIT_EXPORT_FORMAT_VALUES.includes(options.format)
        ? options.format
        : AUTH_AUDIT_EXPORT_FORMAT.JSONL;
    const limit = Math.max(1, Math.min(Number(options.limit) || 500, 2000));

    if (!kv?.list || !normalizedSiteId) {
        return { entries: [], format, siteId: normalizedSiteId, cursor: null, truncated: false };
    }

    const prefix = `${AUTH_AUDIT_KEY_PREFIX}${normalizedSiteId}:`;
    const listed = await kv.list({ prefix, limit, cursor: options.cursor || undefined });
    const keys = listed?.keys || [];

    const entries = [];
    for (const entry of keys) {
        if (!entry?.name) continue;
        try {
            const raw = await kv.get(entry.name);
            if (!raw) continue;
            entries.push(JSON.parse(raw));
        } catch {
            // Corrupt/expired entry — skip silently
        }
    }

    // CEF serialization: CEF:Version|Device Vendor|Device Product|Device Version|Signature ID|Name|Severity|Extension
    if (format === AUTH_AUDIT_EXPORT_FORMAT.JSONL || format === 'json') {
        return {
            entries,
            format,
            siteId: normalizedSiteId,
            cursor: listed?.list_complete === false ? (listed.cursor || null) : null,
            truncated: listed?.list_complete === false,
        };
    }

    // CEF format
    const cefLines = entries.map((evt) => {
        const sev = evt.outcome === 'success' ? '3' : '7';
        const ext = [
            `siteId=${normalizedSiteId}`,
            `actor=${evt.actor}`,
            evt.actorId ? `actorId=${evt.actorId}` : '',
            evt.actorEmail ? `actorEmail=${evt.actorEmail}` : '',
            evt.ipAddress ? `src=${evt.ipAddress}` : '',
            evt.ssoProtocol ? `ssoProtocol=${evt.ssoProtocol}` : '',
            evt.reason ? `reason=${evt.reason.replace(/\|/g, '/')}` : '',
            `rt=${new Date(evt.timestamp).getTime()}`,
        ].filter(Boolean).join(' ');
        return `CEF:0|cloudflare-wl-platform|auth|1|${evt.action}|${evt.action}|${sev}|${ext}`;
    });

    return {
        entries: cefLines,
        format,
        siteId: normalizedSiteId,
        cursor: listed?.list_complete === false ? (listed.cursor || null) : null,
        truncated: listed?.list_complete === false,
    };
}
