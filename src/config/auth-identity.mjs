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
