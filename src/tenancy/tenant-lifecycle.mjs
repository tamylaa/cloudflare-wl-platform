/**
 * Tenant Lifecycle Orchestration Helpers
 *
 * Platform-core primitives for provisioning, export, and offboarding flows.
 * Consuming apps can call these helpers to run self-service lifecycle actions
 * while preserving tenant-scoped auditability.
 */

import {
  configKey,
  configRevisionPrefix,
  listConfigRevisions,
  loadConfig,
  saveConfig,
} from '../config/config-loader.mjs';
import { mergeWithDefaults } from '../config/customer-config.schema.mjs';
import { DOMAIN_CONTROL_STATUS, EMAIL_AUTH_STATUS, normalizeHostname } from './domain-control.mjs';
import { registerTenant, unregisterTenant } from './tenant-context.mjs';
import { TENANT_MONTHLY_QUOTA_DEFAULTS, TENANT_RATE_LIMIT_DEFAULTS } from './tenant-quota.mjs';

const TENANT_AUDIT_KEY_PREFIX = 'tenant-audit:';
const TENANT_AUDIT_TTL_SECONDS = 180 * 24 * 60 * 60;

function getLifecycleKv(env = {}) {
  return env.KV_CONFIG || env.KV_ANALYTICS || null;
}

function sanitizeSiteId(value = '') {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sanitizeEmail(value = '') {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized.includes('@') ? normalized : '';
}

function normalizeOrigin(value = '') {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }
  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }
  return `https://${normalized}`;
}

function toTenantName(value = '', fallback = 'Tenant Workspace') {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  return normalized || fallback;
}

function deriveDomainFromHostname(hostname = '') {
  return String(hostname || '').trim().toLowerCase();
}

function toIsoNow(nowMs = Date.now()) {
  return new Date(nowMs).toISOString();
}

function tenantAuditKey(siteId, eventId) {
  return `${TENANT_AUDIT_KEY_PREFIX}${siteId}:${eventId}`;
}

async function writeTenantLifecycleAudit(env, siteId, event = {}) {
  const kv = getLifecycleKv(env);
  if (!kv?.put) {
    return null;
  }

  const nowMs = Date.now();
  const eventId = `${nowMs.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    eventId,
    siteId,
    createdAt: toIsoNow(nowMs),
    category: String(event.category || 'tenant.lifecycle'),
    action: String(event.action || 'unknown'),
    actor: String(event.actor || 'system'),
    source: String(event.source || 'tenant-lifecycle'),
    requestId: String(event.requestId || ''),
    details: event.details && typeof event.details === 'object' ? event.details : {},
  };

  await kv.put(tenantAuditKey(siteId, eventId), JSON.stringify(payload), {
    expirationTtl: TENANT_AUDIT_TTL_SECONDS,
  });

  return payload;
}

function buildProvisioningConfig(payload = {}) {
  const hostname = normalizeHostname(payload.hostname || payload.appHostname || payload.domain || '');
  const siteId = sanitizeSiteId(payload.siteId || hostname || payload.domain || '');
  const domain = deriveDomainFromHostname(payload.domain || hostname || siteId);
  const appOrigin = normalizeOrigin(payload.appOrigin || hostname || domain);
  const siteUrl = payload.siteUrl || appOrigin || (domain ? `https://${domain}` : '');
  const displayName = toTenantName(payload.name || payload.displayName || siteId, siteId || 'Tenant Workspace');

  if (!siteId) {
    throw new Error('siteId or hostname is required for tenant provisioning');
  }

  const partialConfig = {
    site: {
      id: siteId,
      domain,
      siteUrl,
      name: displayName,
      platform: payload.platform || 'custom',
      language: payload.language || 'en',
      country: payload.country || 'US',
      timezone: payload.timezone || 'UTC',
      currency: payload.currency || 'USD',
    },
    branding: {
      productName: payload.productName || displayName,
      tagline: payload.tagline || '',
      ...(payload.branding || {}),
    },
    domainControl: {
      appHostname: hostname,
      appOrigin,
      domainStatus: DOMAIN_CONTROL_STATUS.PENDING_DNS,
      sslStatus: DOMAIN_CONTROL_STATUS.PROVISIONING,
      dnsTarget: String(payload.dnsTarget || '').trim(),
      docsUrl: String(payload.docsUrl || '').trim(),
      helpCenterUrl: String(payload.helpCenterUrl || '').trim(),
      supportPortalUrl: String(payload.supportPortalUrl || '').trim(),
      supportEmail: sanitizeEmail(payload.supportEmail || ''),
      sendingDomain: String(payload.sendingDomain || '').trim(),
      emailAuthStatus: payload.sendingDomain
        ? EMAIL_AUTH_STATUS.PENDING_DNS
        : EMAIL_AUTH_STATUS.UNCONFIGURED,
    },
    domainRouting: {
      appHostname: hostname,
      appOrigin,
      domainStatus: DOMAIN_CONTROL_STATUS.PENDING_DNS,
      sslStatus: DOMAIN_CONTROL_STATUS.PROVISIONING,
      dnsTarget: String(payload.dnsTarget || '').trim(),
    },
    domainBranding: {
      docsUrl: String(payload.docsUrl || '').trim(),
      helpCenterUrl: String(payload.helpCenterUrl || '').trim(),
      supportPortalUrl: String(payload.supportPortalUrl || '').trim(),
      supportEmail: sanitizeEmail(payload.supportEmail || ''),
      statusPageUrl: String(payload.statusPageUrl || '').trim(),
      incidentReportingUrl: String(payload.incidentReportingUrl || '').trim(),
      onboardingUrl: String(payload.onboardingUrl || '').trim(),
      sendingDomain: String(payload.sendingDomain || '').trim(),
      emailAuthStatus: payload.sendingDomain
        ? EMAIL_AUTH_STATUS.PENDING_DNS
        : EMAIL_AUTH_STATUS.UNCONFIGURED,
    },
    tenantIsolation: {
      organizationId: sanitizeSiteId(payload.organizationId || siteId),
      tenantRole: payload.tenantRole || 'standalone',
      masterTenantId: sanitizeSiteId(payload.masterTenantId || ''),
      subtenantIds: Array.isArray(payload.subtenantIds)
        ? payload.subtenantIds.map((id) => sanitizeSiteId(id)).filter(Boolean)
        : [],
      dataIsolationMode: payload.dataIsolationMode || 'strict',
      crossTenantLearningMode: payload.crossTenantLearningMode || 'disabled',
      allowBenchmarking: Boolean(payload.allowBenchmarking),
      requireExplicitConsent: payload.requireExplicitConsent !== false,
      notes: String(payload.isolationNotes || ''),
    },
    quotas: {
      ...TENANT_RATE_LIMIT_DEFAULTS,
      ...TENANT_MONTHLY_QUOTA_DEFAULTS,
      ...(payload.quotas || {}),
    },
  };

  const mergedOverrides = payload.configOverrides && typeof payload.configOverrides === 'object'
    ? payload.configOverrides
    : {};

  const merged = mergeWithDefaults({
    ...partialConfig,
    ...mergedOverrides,
    site: {
      ...partialConfig.site,
      ...(mergedOverrides.site || {}),
      id: siteId,
      domain,
    },
    tenantIsolation: {
      ...partialConfig.tenantIsolation,
      ...(mergedOverrides.tenantIsolation || {}),
    },
  });

  return {
    siteId,
    hostname,
    domain,
    config: merged,
  };
}

function buildProvisioningChecklist(config = {}) {
  const roles = config?.authIdentity?.roleDefinitions;
  const hasRoles = Array.isArray(roles) && roles.length > 0;

  return Object.freeze({
    routingReady: Boolean(config?.domainRouting?.appHostname && config?.domainRouting?.appOrigin),
    sslWorkflowStarted: ['pending_dns', 'provisioning', 'active'].includes(
      config?.domainRouting?.sslStatus
    ),
    brandingSeeded: Boolean(config?.branding?.productName),
    supportChannelConfigured: Boolean(
      config?.domainBranding?.supportEmail || config?.domainBranding?.supportPortalUrl
    ),
    defaultRolesSeeded: hasRoles,
  });
}

async function countKvKeysByPrefix(kv, prefix, options = {}) {
  if (!kv?.list) {
    return 0;
  }

  const maxKeys = Math.max(1, Math.min(Number(options.maxKeys) || 2000, 10000));
  const pageLimit = Math.max(1, Math.min(Number(options.pageLimit) || 200, 1000));
  let cursor;
  let count = 0;

  do {
    const listed = await kv.list({ prefix, cursor, limit: pageLimit });
    const keys = listed?.keys || [];
    count += keys.length;

    if (count >= maxKeys || listed?.list_complete !== false) {
      break;
    }

    cursor = listed.cursor;
  } while (cursor);

  return Math.min(count, maxKeys);
}

async function countR2ObjectsByPrefix(r2, prefix, options = {}) {
  if (!r2?.list) {
    return 0;
  }

  const maxObjects = Math.max(1, Math.min(Number(options.maxObjects) || 2000, 10000));
  const pageLimit = Math.max(1, Math.min(Number(options.pageLimit) || 500, 1000));
  let cursor;
  let count = 0;

  do {
    const listed = await r2.list({ prefix, cursor, limit: pageLimit });
    const objects = listed?.objects || [];
    count += objects.length;

    if (count >= maxObjects || !listed?.truncated) {
      break;
    }

    cursor = listed.cursor;
  } while (cursor);

  return Math.min(count, maxObjects);
}

async function deleteKvByPrefix(kv, prefix, options = {}) {
  if (!kv?.list || !kv?.delete) {
    return 0;
  }

  const maxDelete = Math.max(1, Math.min(Number(options.maxDelete) || 5000, 20000));
  const pageLimit = Math.max(1, Math.min(Number(options.pageLimit) || 200, 1000));
  let cursor;
  let deleted = 0;

  do {
    const listed = await kv.list({ prefix, cursor, limit: pageLimit });
    const keys = listed?.keys || [];

    for (const entry of keys) {
      if (!entry?.name) {
        continue;
      }
      await kv.delete(entry.name);
      deleted += 1;
      if (deleted >= maxDelete) {
        return deleted;
      }
    }

    if (listed?.list_complete !== false) {
      break;
    }

    cursor = listed.cursor;
  } while (cursor);

  return deleted;
}

async function deleteR2ByPrefix(r2, prefix, options = {}) {
  if (!r2?.list || !r2?.delete) {
    return 0;
  }

  const maxDelete = Math.max(1, Math.min(Number(options.maxDelete) || 5000, 20000));
  const pageLimit = Math.max(1, Math.min(Number(options.pageLimit) || 500, 1000));
  let cursor;
  let deleted = 0;

  do {
    const listed = await r2.list({ prefix, cursor, limit: pageLimit });
    const objects = listed?.objects || [];

    for (const object of objects) {
      const key = object?.key || object?.name;
      if (!key) {
        continue;
      }
      await r2.delete(key);
      deleted += 1;
      if (deleted >= maxDelete) {
        return deleted;
      }
    }

    if (!listed?.truncated) {
      break;
    }

    cursor = listed.cursor;
  } while (cursor);

  return deleted;
}

export async function listTenantLifecycleEvents(env, siteId, options = {}) {
  const kv = getLifecycleKv(env);
  const normalizedSiteId = sanitizeSiteId(siteId);
  if (!kv?.list || !normalizedSiteId) {
    return [];
  }

  const limit = Math.max(1, Math.min(Number(options.limit) || 50, 500));
  const listed = await kv.list({
    prefix: `${TENANT_AUDIT_KEY_PREFIX}${normalizedSiteId}:`,
    limit,
  });

  const entries = [];
  for (const key of listed?.keys || []) {
    const value = await kv.get(key.name, 'json').catch(() => null);
    if (value) {
      entries.push(value);
    }
  }

  return entries.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function provisionTenant(env, payload = {}, options = {}) {
  const kv = getLifecycleKv(env);
  if (!kv?.put) {
    throw new Error('KV_CONFIG or KV_ANALYTICS binding is required for tenant provisioning');
  }

  const actor = String(options.actor || payload.actor || 'self-service').trim() || 'self-service';
  const source = String(options.source || payload.source || 'tenant-lifecycle').trim() || 'tenant-lifecycle';
  const requestId = String(options.requestId || payload.requestId || '').trim();

  const { siteId, hostname, domain, config } = buildProvisioningConfig(payload);

  const existingConfig = await kv.get(configKey(siteId), 'json').catch(() => null);
  if (existingConfig && options.allowExisting !== true) {
    return {
      success: false,
      siteId,
      error: `Tenant '${siteId}' already exists`,
      conflict: true,
    };
  }

  const validation = await saveConfig(env, siteId, config, {
    merge: false,
    audit: {
      actor,
      source,
      reason: 'tenant_provisioning',
      requestId,
      scope: 'tenant-lifecycle',
      category: 'provisioning',
    },
  });

  if (!validation.valid) {
    return {
      success: false,
      siteId,
      validation,
    };
  }

  await registerTenant(env, siteId, {
    hostname,
    domain,
    name: config.site?.name,
    tier: String(payload.tier || 'growth').trim() || 'growth',
  });

  const resolved = await loadConfig(env, siteId, { skipCache: true });
  const checklist = buildProvisioningChecklist(resolved);
  const auditEntry = await writeTenantLifecycleAudit(env, siteId, {
    category: 'tenant.lifecycle',
    action: 'provisioned',
    actor,
    source,
    requestId,
    details: {
      hostname,
      domain,
      tier: String(payload.tier || 'growth').trim() || 'growth',
      generation: validation.generation || 0,
    },
  });

  return {
    success: true,
    siteId,
    hostname,
    domain,
    generation: validation.generation || 0,
    provisionedAt: toIsoNow(),
    checklist,
    estimatedAutomationMinutes: 5,
    selfServiceReady:
      checklist.routingReady && checklist.sslWorkflowStarted && checklist.brandingSeeded,
    auditEventId: auditEntry?.eventId || '',
  };
}

export async function exportTenantData(env, siteId, options = {}) {
  const kv = getLifecycleKv(env);
  const normalizedSiteId = sanitizeSiteId(siteId);
  if (!kv?.get || !normalizedSiteId) {
    throw new Error('Valid siteId and KV binding are required for tenant export');
  }

  const includeUsageSummary = options.includeUsageSummary !== false;
  const revisionLimit = Math.max(1, Math.min(Number(options.revisionLimit) || 50, 300));

  const config = await loadConfig(env, normalizedSiteId, { skipCache: true });
  const revisions = await listConfigRevisions(env, normalizedSiteId, { limit: revisionLimit });
  const storedEnvelope = await kv.get(configKey(normalizedSiteId), 'json').catch(() => null);
  const registry = await kv.get(`tenant-registry:${normalizedSiteId}`, 'json').catch(() => null);
  const lifecycleEvents = await listTenantLifecycleEvents(env, normalizedSiteId, {
    limit: Math.max(1, Math.min(Number(options.eventLimit) || 100, 500)),
  });

  const usageSummary = includeUsageSummary
    ? {
        analyticsKeyCount: await countKvKeysByPrefix(env.KV_ANALYTICS, `${normalizedSiteId}:`),
        historyKeyCount: await countKvKeysByPrefix(env.KV_HISTORY, `${normalizedSiteId}:`),
        r2ObjectCount: await countR2ObjectsByPrefix(env.R2_ANALYTICS, `${normalizedSiteId}/`).catch(
          () => 0
        ),
      }
    : null;

  return {
    exportedAt: toIsoNow(),
    siteId: normalizedSiteId,
    config,
    configGeneration: Number(storedEnvelope?.__meta?.generation) || 0,
    configStoredAtMs: Number(storedEnvelope?.__meta?.storedAtMs) || 0,
    revisions,
    registry,
    lifecycleEvents,
    usageSummary,
  };
}

export async function offboardTenant(env, siteId, options = {}) {
  const kv = getLifecycleKv(env);
  const normalizedSiteId = sanitizeSiteId(siteId);
  if (!kv?.put || !normalizedSiteId) {
    throw new Error('Valid siteId and KV binding are required for tenant offboarding');
  }

  const actor = String(options.actor || 'self-service').trim() || 'self-service';
  const source = String(options.source || 'tenant-lifecycle').trim() || 'tenant-lifecycle';
  const requestId = String(options.requestId || '').trim();
  const hardDeleteConfig = options.hardDeleteConfig === true;
  const purgeData = options.purgeData === true;
  const includeExport = options.includeExport !== false;

  const exportSnapshot = includeExport
    ? await exportTenantData(env, normalizedSiteId, options.exportOptions || {})
    : null;

  await unregisterTenant(env, normalizedSiteId);

  if (options.deleteRegistryEntry === true) {
    await kv.delete(`tenant-registry:${normalizedSiteId}`);
  }

  const purgeSummary = {
    configDeleted: false,
    configRevisionKeysDeleted: 0,
    analyticsKeysDeleted: 0,
    historyKeysDeleted: 0,
    r2ObjectsDeleted: 0,
  };

  if (hardDeleteConfig) {
    await kv.delete(configKey(normalizedSiteId));
    purgeSummary.configDeleted = true;
    purgeSummary.configRevisionKeysDeleted = await deleteKvByPrefix(
      kv,
      configRevisionPrefix(normalizedSiteId),
      options
    );
  }

  if (purgeData) {
    purgeSummary.analyticsKeysDeleted = await deleteKvByPrefix(
      env.KV_ANALYTICS,
      `${normalizedSiteId}:`,
      options
    );
    purgeSummary.historyKeysDeleted = await deleteKvByPrefix(
      env.KV_HISTORY,
      `${normalizedSiteId}:`,
      options
    );
    purgeSummary.r2ObjectsDeleted = await deleteR2ByPrefix(
      env.R2_ANALYTICS,
      `${normalizedSiteId}/`,
      options
    );
  }

  const auditEntry = await writeTenantLifecycleAudit(env, normalizedSiteId, {
    category: 'tenant.lifecycle',
    action: 'offboarded',
    actor,
    source,
    requestId,
    details: {
      hardDeleteConfig,
      purgeData,
      includeExport,
      purgeSummary,
    },
  });

  return {
    success: true,
    siteId: normalizedSiteId,
    offboardedAt: toIsoNow(),
    exportSnapshot,
    purgeSummary,
    auditEventId: auditEntry?.eventId || '',
  };
}
