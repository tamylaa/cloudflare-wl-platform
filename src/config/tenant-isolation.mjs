/**
 * Tenant Isolation Helpers
 *
 * Centralizes hierarchy, privacy-boundary, and cross-tenant learning settings
 * for white-label deployments that may have a master tenant with sub-tenants.
 */

export const TENANT_HIERARCHY_ROLE = Object.freeze({
    STANDALONE: 'standalone',
    MASTER: 'master',
    SUBTENANT: 'subtenant',
});

export const DATA_ISOLATION_MODE = Object.freeze({
    STRICT: 'strict',
    MASTER_CONTROLLED: 'master_controlled',
    SHARED_AGGREGATES: 'shared_aggregates',
});

export const CROSS_TENANT_LEARNING_MODE = Object.freeze({
    DISABLED: 'disabled',
    ANONYMIZED_AGGREGATES: 'anonymized_aggregates',
    EXPLICIT_OPT_IN: 'explicit_opt_in',
});

export const TENANT_HIERARCHY_ROLE_VALUES = Object.freeze(Object.values(TENANT_HIERARCHY_ROLE));
export const DATA_ISOLATION_MODE_VALUES = Object.freeze(Object.values(DATA_ISOLATION_MODE));
export const CROSS_TENANT_LEARNING_MODE_VALUES = Object.freeze(
    Object.values(CROSS_TENANT_LEARNING_MODE)
);

function safeString(value = '') {
    return typeof value === 'string' ? value.trim() : '';
}

function sanitizeTenantIdentifier(value = '') {
    return safeString(value)
        .toLowerCase()
        .replace(/[^a-z0-9:_-]/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');
}

function normalizeTenantList(value = []) {
    const rawItems = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(',')
            : [];

    const seen = new Set();
    const normalized = [];
    for (const item of rawItems) {
        const candidate = sanitizeTenantIdentifier(item);
        if (!candidate || seen.has(candidate)) {
            continue;
        }
        seen.add(candidate);
        normalized.push(candidate);
    }

    return normalized;
}

/**
 * Normalize tenant hierarchy / privacy policy config into a stable shape.
 */
export function resolveTenantIsolation(config = {}) {
    const tenantRole = TENANT_HIERARCHY_ROLE_VALUES.includes(config.tenantRole)
        ? config.tenantRole
        : TENANT_HIERARCHY_ROLE.STANDALONE;
    const dataIsolationMode = DATA_ISOLATION_MODE_VALUES.includes(config.dataIsolationMode)
        ? config.dataIsolationMode
        : DATA_ISOLATION_MODE.STRICT;
    const crossTenantLearningMode = CROSS_TENANT_LEARNING_MODE_VALUES.includes(
        config.crossTenantLearningMode
    )
        ? config.crossTenantLearningMode
        : CROSS_TENANT_LEARNING_MODE.DISABLED;

    return {
        organizationId: sanitizeTenantIdentifier(config.organizationId || config.organizationKey || ''),
        tenantRole,
        masterTenantId: sanitizeTenantIdentifier(config.masterTenantId || config.parentTenantId || ''),
        subtenantIds: normalizeTenantList(config.subtenantIds || config.childTenantIds || []),
        dataIsolationMode,
        crossTenantLearningMode,
        allowBenchmarking: Boolean(config.allowBenchmarking),
        requireExplicitConsent: config.requireExplicitConsent !== false,
        notes: safeString(config.notes),
    };
}
