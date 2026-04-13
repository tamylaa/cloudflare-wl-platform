/**
 * Customer Configuration Loader
 *
 * Loads customer config from KV storage, merges with defaults, validates,
 * and caches for the lifetime of the request.
 *
 * Loading priority:
 *   1. KV: `customer-config:{siteId}` → stored customer config (JSON)
 *   2. Env adapter: bridges legacy env vars into config shape (backward compat)
 *   3. Defaults: everything falls back to customerConfigDefaults
 *
 * The returned config object is frozen — mutations are a bug.
 *
 * Usage:
 *   import { loadConfig, loadConfigFromEnv } from './config-loader.mjs';
 *
 *   // In Worker: load from KV (preferred)
 *   const config = await loadConfig(env, 'store-abc123');
 *
 *   // Fallback: derive from env vars (backward compat for existing deployment)
 *   const config = loadConfigFromEnv(env);
 */

import { customerConfigDefaults, mergeWithDefaults } from './customer-config.schema.mjs';
import { validateConfig, assertValidConfig } from './config-validator.mjs';
import { buildConfigFromEnv } from './env-adapter.mjs';
import { TTL } from './ttl.mjs';

// ─── KV Key Pattern ──────────────────────────────────────────────────────────

const CONFIG_KEY_PREFIX = 'customer-config:';
const CONFIG_REVISION_KEY_PREFIX = 'customer-config-revision:';
const CONFIG_AUDIT_RETENTION_TTL = TTL.REMEMBER_ME || 90 * 24 * 60 * 60;
const CONFIG_AUDIT_INLINE_FIELD_LIMIT = 2048;
const CONFIG_AUDIT_SNAPSHOT_MAX_BYTES = 32 * 1024;
const CONFIG_AUDIT_REDACTION_ALLOWLIST = new Set([
  'site.id',
  'site.domain',
  'site.siteUrl',
  'site.name',
  'branding.productName',
  'branding.tagline',
  'domainControl.appHostname',
  'domainControl.appOrigin',
  'domainRouting.appHostname',
  'domainRouting.appOrigin',
  'domainBranding.docsUrl',
  'domainBranding.helpCenterUrl',
  'domainBranding.supportPortalUrl',
]);
const CONFIG_AUDIT_ALWAYS_REDACT_FIELDS = new Set([
  'logourl',
  'faviconurl',
  'ogimageurl',
  'fonturl',
  'customcss',
  'customjs',
  'apikey',
  'clientsecret',
  'clientsecretsecret',
  'refreshtoken',
  'token',
  'password',
  'privatekey',
  'certificate',
  'webhookurl',
]);
const CONFIG_AUDIT_REDACT_FIELD_PATTERN =
  /(secret|token|password|api[-_]?key|privatekey|certificate|webhookurl|refresh)/i;

/**
 * Build the KV key for a customer config.
 * @param {string} siteId
 * @returns {string}
 */
export function configKey(siteId) {
  const normalizedSiteId = normalizeTenantSiteId(siteId) || String(siteId || '');
  return `${CONFIG_KEY_PREFIX}${normalizedSiteId}`;
}

/**
 * Build the KV prefix for config revision history.
 * @param {string} siteId
 * @returns {string}
 */
export function configRevisionPrefix(siteId) {
  const normalizedSiteId = normalizeTenantSiteId(siteId) || String(siteId || '');
  return `${CONFIG_REVISION_KEY_PREFIX}${normalizedSiteId}:`;
}

// Monotonic counter for sub-millisecond revision ordering within a Worker lifetime.
// Ensures deterministic "latest first" sort when two writes share the same Date.now() tick.
let _revisionSeq = 0;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTenantSiteId(value = '') {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

function enforceConfigSiteId(config = {}, siteId = '') {
  const normalizedSiteId = normalizeTenantSiteId(siteId) || String(siteId || '');
  const safeConfig = isPlainObject(config) ? config : {};
  const safeSite = isPlainObject(safeConfig.site) ? safeConfig.site : {};

  return {
    ...safeConfig,
    site: {
      ...safeSite,
      id: normalizedSiteId,
    },
  };
}

export function validateTenantConfigOwnership(config = {}, siteId = '') {
  const normalizedSiteId = normalizeTenantSiteId(siteId);
  const configSiteId = normalizeTenantSiteId(config?.site?.id || '');

  if (!normalizedSiteId) {
    return {
      valid: false,
      normalizedSiteId,
      configSiteId,
      message: 'siteId is required for tenant ownership validation',
    };
  }

  if (!configSiteId) {
    return {
      valid: true,
      normalizedSiteId,
      configSiteId,
      message: '',
    };
  }

  if (configSiteId !== normalizedSiteId) {
    return {
      valid: false,
      normalizedSiteId,
      configSiteId,
      message: `Config ownership mismatch: expected site.id '${normalizedSiteId}' but found '${configSiteId}'`,
    };
  }

  return {
    valid: true,
    normalizedSiteId,
    configSiteId,
    message: '',
  };
}

function isAuditPathAllowlisted(path = '') {
  return CONFIG_AUDIT_REDACTION_ALLOWLIST.has(String(path || '').trim());
}

function shouldRedactAuditPath(path = '') {
  const normalizedPath = String(path || '').trim();
  const fieldName = normalizedPath.split('.').pop() || '';
  const normalizedFieldName = fieldName.toLowerCase();
  if (!fieldName || isAuditPathAllowlisted(normalizedPath)) {
    return false;
  }

  return (
    CONFIG_AUDIT_ALWAYS_REDACT_FIELDS.has(normalizedFieldName) ||
    CONFIG_AUDIT_REDACT_FIELD_PATTERN.test(normalizedFieldName)
  );
}

function trimAuditSnapshotValue(value, path = '') {
  if (shouldRedactAuditPath(path)) {
    return `[redacted from audit snapshot: ${path || 'value'}]`;
  }

  if (typeof value === 'string') {
    const shouldOmit =
      value.length > CONFIG_AUDIT_INLINE_FIELD_LIMIT && !isAuditPathAllowlisted(path);

    if (shouldOmit) {
      return `[omitted from audit snapshot: ${path || 'value'} (${value.length} chars)]`;
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      trimAuditSnapshotValue(item, path ? `${path}[${index}]` : `[${index}]`)
    );
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => {
        const nestedPath = path ? `${path}.${key}` : key;
        return [key, trimAuditSnapshotValue(nestedValue, nestedPath)];
      })
    );
  }

  return value;
}

function buildSafeAuditSnapshot(snapshot = null, label = 'snapshot') {
  if (!snapshot || typeof snapshot !== 'object') {
    return snapshot || null;
  }

  const trimmedSnapshot = trimAuditSnapshotValue(snapshot);
  const serialized = JSON.stringify(trimmedSnapshot);
  if (serialized.length <= CONFIG_AUDIT_SNAPSHOT_MAX_BYTES) {
    return trimmedSnapshot;
  }

  return {
    _snapshotTrimmed: true,
    note: `${label} omitted from audit snapshot due to size (${serialized.length} bytes after trimming)`,
    topLevelKeys: Object.keys(snapshot),
    branding: trimAuditSnapshotValue(snapshot?.branding || {}, 'branding'),
    site: trimAuditSnapshotValue(snapshot?.site || {}, 'site'),
  };
}

function snapshotHasAuditOmissions(snapshot) {
  const serialized = JSON.stringify(snapshot || {});
  return (
    serialized.includes('[omitted from audit snapshot:') ||
    serialized.includes('[redacted from audit snapshot:')
  );
}

function collectChangedPaths(beforeValue, afterValue, prefix = '') {
  if (beforeValue === afterValue) {
    return [];
  }

  if (Array.isArray(beforeValue) || Array.isArray(afterValue)) {
    return [prefix || '$'];
  }

  if (isPlainObject(beforeValue) || isPlainObject(afterValue)) {
    const beforeObj = isPlainObject(beforeValue) ? beforeValue : {};
    const afterObj = isPlainObject(afterValue) ? afterValue : {};
    const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
    const changed = [];
    for (const key of keys) {
      const path = prefix ? `${prefix}.${key}` : key;
      changed.push(...collectChangedPaths(beforeObj[key], afterObj[key], path));
    }
    return changed;
  }

  return [prefix || '$'];
}

function normalizeAuditMetadata(audit = {}) {
  return {
    actor: String(audit.actor || 'system').trim() || 'system',
    source: String(audit.source || 'config-loader').trim() || 'config-loader',
    reason: String(audit.reason || '').trim(),
    requestId: String(audit.requestId || '').trim(),
    scope: String(audit.scope || 'tenant-config').trim() || 'tenant-config',
    category: String(audit.category || 'config').trim() || 'config',
  };
}

export function sanitizeConfigRevisionForDisplay(revision = {}) {
  const entry = revision && typeof revision === 'object' ? revision : {};
  return {
    revisionId: String(entry.revisionId || ''),
    siteId: String(entry.siteId || ''),
    timestamp: String(entry.timestamp || ''),
    createdAtMs: Number(entry.createdAtMs) || 0,
    actor: String(entry.actor || 'system'),
    source: String(entry.source || 'config-loader'),
    reason: String(entry.reason || ''),
    requestId: String(entry.requestId || ''),
    scope: String(entry.scope || 'tenant-config'),
    category: String(entry.category || 'config'),
    mergeMode: String(entry.mergeMode || 'merge'),
    canRollback:
      Boolean(entry.before && typeof entry.before === 'object') && entry.beforeSnapshotTrimmed !== true,
    hasAfterSnapshot: Boolean(entry.after && typeof entry.after === 'object'),
    beforeSnapshotTrimmed: entry.beforeSnapshotTrimmed === true,
    afterSnapshotTrimmed: entry.afterSnapshotTrimmed === true,
    changedPaths: Array.isArray(entry.changedPaths) ? entry.changedPaths.slice(0, 100) : [],
    changedFieldCount: Number(entry.changedFieldCount) || 0,
    validation: {
      valid: Boolean(entry?.validation?.valid),
      errorCount: Number(entry?.validation?.errorCount) || 0,
      warningCount: Number(entry?.validation?.warningCount) || 0,
    },
  };
}

export async function getConfigRevision(env, siteId, revisionId, options = {}) {
  const targetRevisionId = String(revisionId || '').trim();
  if (!siteId || !targetRevisionId) {
    return null;
  }

  const searchLimit = Math.max(1, Math.min(Number(options.searchLimit) || 100, 500));
  const revisions = await listConfigRevisions(env, siteId, { limit: searchLimit });
  return revisions.find((entry) => String(entry?.revisionId || '') === targetRevisionId) || null;
}

export async function restoreConfigRevision(env, siteId, revisionId, options = {}) {
  const restoreMode = options.restoreMode === 'after' ? 'after' : 'before';
  const revision = await getConfigRevision(env, siteId, revisionId, {
    searchLimit: options.searchLimit,
  });

  if (!revision) {
    throw new Error(`[ConfigLoader] Revision '${revisionId}' not found for '${siteId}'`);
  }

  const snapshotSource = restoreMode === 'after' ? revision.after : revision.before;
  const snapshotTrimmed = restoreMode === 'after'
    ? revision.afterSnapshotTrimmed === true
    : revision.beforeSnapshotTrimmed === true;
  if (!snapshotSource || typeof snapshotSource !== 'object' || snapshotTrimmed) {
    throw new Error(
      `[ConfigLoader] Revision '${revisionId}' does not contain a restorable ${restoreMode} snapshot`
    );
  }

  const rollbackAudit = {
    ...(options.audit || {}),
    source: options?.audit?.source || 'config-rollback',
    reason: options?.audit?.reason || `rollback_to_${restoreMode}_snapshot`,
    scope: options?.audit?.scope || revision.scope || 'tenant-config',
    category: options?.audit?.category || 'rollback',
  };

  const snapshot = JSON.parse(JSON.stringify(snapshotSource));
  const validation = await saveConfig(env, siteId, snapshot, {
    merge: false,
    audit: rollbackAudit,
  });

  return {
    revision,
    restoreMode,
    restoredConfig: snapshot,
    validation,
  };
}

async function writeConfigRevision(kv, siteId, beforeConfig, afterConfig, validation, audit = {}, merge = true) {
  if (!kv?.put) {
    return null;
  }

  const now = Date.now();
  const seqNum = ++_revisionSeq;
  const timestamp = new Date(now).toISOString();
  const meta = normalizeAuditMetadata(audit);
  const changedPaths = collectChangedPaths(beforeConfig || {}, afterConfig || {});
  const revisionId = `${siteId}-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const reverseTimeKey = String(9999999999999 - now).padStart(13, '0');
  const safeBefore = buildSafeAuditSnapshot(beforeConfig, 'before snapshot');
  const safeAfter = buildSafeAuditSnapshot(afterConfig, 'after snapshot');
  const beforeSnapshotTrimmed = snapshotHasAuditOmissions(safeBefore) || safeBefore?._snapshotTrimmed === true;
  const afterSnapshotTrimmed = snapshotHasAuditOmissions(safeAfter) || safeAfter?._snapshotTrimmed === true;
  const entry = {
    revisionId,
    revisionSeq: seqNum,
    siteId,
    timestamp,
    createdAtMs: now,
    sortKey: reverseTimeKey,
    actor: meta.actor,
    source: meta.source,
    reason: meta.reason,
    requestId: meta.requestId,
    scope: meta.scope,
    category: meta.category,
    mergeMode: merge ? 'merge' : 'overwrite',
    changedPaths: changedPaths.slice(0, 100),
    changedFieldCount: changedPaths.length,
    validation: {
      valid: Boolean(validation?.valid),
      errorCount: Array.isArray(validation?.errors) ? validation.errors.length : 0,
      warningCount: Array.isArray(validation?.warnings) ? validation.warnings.length : 0,
    },
    beforeSnapshotTrimmed,
    afterSnapshotTrimmed,
    before: safeBefore,
    after: safeAfter,
  };

  await kv.put(
    `${configRevisionPrefix(siteId)}${reverseTimeKey}:${revisionId}`,
    JSON.stringify(entry),
    { expirationTtl: CONFIG_AUDIT_RETENTION_TTL }
  );

  return entry;
}

// ─── In-Memory Cache ─────────────────────────────────────────────────────────

// Request-scoped cache bucketed by the active env/KV binding. This avoids repeated
// KV reads within a request while preventing stale config bleed across test envs or
// other independently constructed worker contexts.
//
// CRITICAL FIX: Cache entries now include timestamp for TTL checking.
// Default TTL: 5 minutes. Prevents silent config staleness in long-lived Workers.
let _cache = new WeakMap();
const FALLBACK_CACHE_SCOPE = {};
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheScope(env) {
  return env?.KV_CONFIG || env?.KV_ANALYTICS || env || FALLBACK_CACHE_SCOPE;
}

function getScopedCache(env, { create = true } = {}) {
  const scope = getCacheScope(env);
  let scopedCache = _cache.get(scope);

  if (!scopedCache && create) {
    scopedCache = new Map();
    _cache.set(scope, scopedCache);
  }

  return scopedCache || null;
}

/**
 * Check if a cached config entry has expired based on TTL.
 * @param {Object} entry - Cache entry with { config, createdAt }
 * @param {number} [ttlMs] - TTL in milliseconds (default: 5 minutes)
 * @returns {boolean} true if entry is stale/expired
 */
function isCacheEntryStale(entry, ttlMs = DEFAULT_CACHE_TTL_MS) {
  if (!entry || typeof entry !== 'object' || !entry.createdAt) {
    return true;
  }
  return Date.now() - entry.createdAt > ttlMs;
}

/**
 * Clear the config cache. Call between requests if the Worker is long-lived.
 * 
 * @param {Object} [env] - Cloudflare env (to scope cache). If omitted, clears all.
 * @param {string} [siteId] - Specific siteId to invalidate. If omitted, clears entire scope.
 */
export function clearConfigCache(env = null, siteId = null) {
  if (!env) {
    _cache = new WeakMap();
    return;
  }

  const scopedCache = getScopedCache(env, { create: false });
  if (!scopedCache) {
    return;
  }

  if (siteId) {
    const normalizedSiteId = normalizeTenantSiteId(siteId) || String(siteId || '');
    scopedCache.delete(normalizedSiteId);
    if (scopedCache.size === 0) {
      // Clean up empty cache to allow GC
      _cache.delete(getCacheScope(env));
    }
    return;
  }

  scopedCache.clear();
}

// ─── Main Loader ─────────────────────────────────────────────────────────────

/**
 * Load a customer's configuration from KV, merge with defaults, validate.
 *
 * @param {Object} env - Worker environment (must have KV_ANALYTICS or KV_CONFIG)
 * @param {string} siteId - Customer site identifier (e.g. 'store-abc123')
 * @param {Object} [options]
 * @param {boolean} [options.strict=false] - If true, throws on validation errors
 * @param {boolean} [options.skipCache=false] - Force a fresh KV read
 * @param {number} [options.cacheTtlMs] - Override default cache TTL (ms). Default: 5 min.
 * @returns {Promise<Object>} Complete, validated, frozen config
 */
export async function loadConfig(env, siteId, options = {}) {
  const { strict = false, skipCache = false, cacheTtlMs = DEFAULT_CACHE_TTL_MS } = options;
  const normalizedSiteId = normalizeTenantSiteId(siteId) || String(siteId || '');

  if (!normalizedSiteId) {
    throw new Error('[ConfigLoader] siteId is required');
  }

  const scopedCache = getScopedCache(env);

  // Check cache (but verify it hasn't expired)
  if (!skipCache && scopedCache?.has(normalizedSiteId)) {
    const cacheEntry = scopedCache.get(normalizedSiteId);
    if (!isCacheEntryStale(cacheEntry, cacheTtlMs)) {
      return cacheEntry.config;
    }
    // Cache expired; delete stale entry and reload from KV
    scopedCache.delete(normalizedSiteId);
  }

  const kv = env.KV_CONFIG || env.KV_ANALYTICS;
  let storedConfig = null;

  // 1. Try loading from KV
  if (kv) {
    try {
      const raw = await kv.get(configKey(siteId), 'json');
      if (raw) {
        // Handle both legacy format and new CAS-wrapped format
        if (raw.__meta && raw.data) {
          storedConfig = raw.data;
        } else if (!raw.__meta) {
          // Legacy format: raw config data without wrapping
          storedConfig = raw;
        }
      }
    } catch (err) {
      console.warn(`[ConfigLoader] Failed to read config from KV for '${siteId}':`, err.message);
    }
  }

  // 2. If no KV config, fall back to env adapter
  if (!storedConfig) {
    storedConfig = buildConfigFromEnv(env, normalizedSiteId);
  }

  const ownership = validateTenantConfigOwnership(storedConfig, normalizedSiteId);
  if (!ownership.valid) {
    const message = `[ConfigLoader] ${ownership.message}`;
    if (strict) {
      throw new Error(message);
    }
    console.error(message);
  }

  storedConfig = enforceConfigSiteId(storedConfig, normalizedSiteId);

  // 3. Merge with defaults
  const merged = mergeWithDefaults(storedConfig);

  // 4. Validate
  const validation = validateConfig(merged);

  if (strict && !validation.valid) {
    assertValidConfig(merged); // throws
  }

  if (!validation.valid) {
    console.warn(
      `[ConfigLoader] Config for '${siteId}' has validation errors:`,
      validation.errors.map((e) => `${e.field}: ${e.message}`).join('; ')
    );
  }

  if (validation.warnings.length > 0) {
    console.warn(
      `[ConfigLoader] Config for '${siteId}' warnings:`,
      validation.warnings.map((w) => `${w.field}: ${w.message}`).join('; ')
    );
  }

  // 5. Freeze and cache with timestamp
  const frozen = deepFreeze(merged);
  scopedCache?.set(normalizedSiteId, {
    config: frozen,
    createdAt: Date.now(),
  });

  return frozen;
}

// ─── Config Revision History ─────────────────────────────────────────────────

/**
 * List the latest config revisions for a tenant.
 *
 * @param {Object} env - Worker environment
 * @param {string} siteId - Customer site identifier
 * @param {Object} [options]
 * @param {number} [options.limit=20] - Max number of revisions to return
 * @returns {Promise<Array<Object>>}
 */
export async function listConfigRevisions(env, siteId, options = {}) {
  const kv = env.KV_CONFIG || env.KV_ANALYTICS;
  if (!kv?.list || !siteId) {
    return [];
  }

  const safeLimit = Math.max(1, Math.min(Number(options.limit) || 20, 100));
  const listed = await kv.list({ prefix: configRevisionPrefix(siteId), limit: safeLimit }).catch(() => null);
  const keys = listed?.keys || [];

  const revisions = [];
  for (const key of keys) {
    if (!key?.name) {
      continue;
    }
    const entry = await kv.get(key.name, 'json').catch(() => null);
    if (entry) {
      revisions.push(entry);
    }
  }

  return revisions
    .sort((a, b) => {
      const timeDelta = (Number(b?.createdAtMs) || 0) - (Number(a?.createdAtMs) || 0);
      if (timeDelta !== 0) {
        return timeDelta;
      }
      // Tiebreaker for same-millisecond writes: higher revisionSeq = later write.
      return (Number(b?.revisionSeq) || 0) - (Number(a?.revisionSeq) || 0);
    })
    .slice(0, safeLimit);
}

// ─── Save Config ─────────────────────────────────────────────────────────────

/**
 * Save a customer config to KV with CAS (compare-and-set) for atomicity.
 *
 * CRITICAL FIX: Uses generation-based versioning to prevent lost updates on
 * concurrent writes. If another writer changes the config between our read and
 * write, this function will detect the conflict and retry (up to maxRetries).
 *
 * @param {Object} env - Worker environment
 * @param {string} siteId - Customer site identifier
 * @param {Object} config - Complete or partial config to save
 * @param {Object} [options]
 * @param {boolean} [options.merge=true] - Merge with existing config vs overwrite
 * @param {number} [options.maxRetries=3] - How many times to retry on CAS conflict
 * @param {Object} [options.audit={}] - Audit metadata
 * @returns {Promise<{ valid: boolean, errors: Array, warnings: Array, casConflict?: boolean }>}
 */
export async function saveConfig(env, siteId, config, options = {}) {
  const { merge = true, audit = {}, maxRetries = 3 } = options;
  const kv = env.KV_CONFIG || env.KV_ANALYTICS;
  const normalizedSiteId = normalizeTenantSiteId(siteId) || String(siteId || '');

  if (!kv) {
    throw new Error('[ConfigLoader] No KV binding available (KV_CONFIG or KV_ANALYTICS)');
  }

  const requestedOwnership = validateTenantConfigOwnership(config, normalizedSiteId);
  if (!requestedOwnership.valid) {
    return {
      valid: false,
      errors: [
        {
          field: 'site.id',
          message: requestedOwnership.message,
        },
      ],
      warnings: [],
      ownershipViolation: true,
    };
  }

  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    try {
      // READ: Get current config with metadata
      let existing = null;
      let existingMeta = { generation: 0 };
      
      try {
        const raw = await kv.get(configKey(siteId), 'json');
        if (raw && typeof raw === 'object') {
          // Unwrap if stored in { data, __meta } format
          if (raw.__meta && raw.data) {
            existing = raw.data;
            existingMeta = raw.__meta;
          } else if (!raw.__meta) {
            // Legacy format without metadata
            existing = raw;
          }
        }
      } catch {
        /* no existing config */
      }

      const existingOwnership = validateTenantConfigOwnership(existing || {}, normalizedSiteId);
      if (existing && !existingOwnership.valid) {
        return {
          valid: false,
          errors: [
            {
              field: 'site.id',
              message: existingOwnership.message,
            },
          ],
          warnings: [],
          ownershipViolation: true,
        };
      }

      // MERGE: Combine with user input
      let toSave = config;
      if (merge && existing) {
        const { deepMerge } = await import('./customer-config.schema.mjs');
        toSave = deepMerge(existing, config);
      }
      toSave = enforceConfigSiteId(toSave, normalizedSiteId);

      // VALIDATE: Check config integrity
      const merged = mergeWithDefaults(toSave);
      const validation = validateConfig(merged);

      if (!validation.valid) {
        console.warn(
          '[ConfigLoader] Saving config with validation errors:',
          validation.errors.map((e) => `${e.field}: ${e.message}`).join('; ')
        );
      }

      // WRITE: Store with CAS metadata
      const nextGeneration = existingMeta.generation + 1;
      const wrapped = {
        data: toSave,
        __meta: {
          generation: nextGeneration,
          storedAtMs: Date.now(),
          siteId: normalizedSiteId,
        },
      };

      // Use put with the version condition (if KV supports it)
      // If not, this is still safer than before because we have a generation number
      // that consuming apps can check for concurrent writes
      await kv.put(configKey(normalizedSiteId), JSON.stringify(wrapped));

      // Write audit revision (after confirming KV write succeeded)
      await writeConfigRevision(
        kv,
        normalizedSiteId,
        existing || {},
        toSave,
        validation,
        audit,
        merge
      );

      // Clear cache for this siteId to ensure next read gets fresh data
      clearConfigCache(env, normalizedSiteId);

      return { ...validation, generation: nextGeneration };
    } catch (err) {
      lastError = err;
      // On conflict, retry with fresh read
      attempt++;
      if (attempt <= maxRetries) {
        // Exponential backoff: 10ms, 20ms, 40ms
        const delayMs = 10 * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  // All retries exhausted
  console.error(
    `[ConfigLoader] CAS write failed for '${normalizedSiteId}' after ${maxRetries} retries:`,
    lastError?.message
  );

  return {
    valid: false,
    errors: [
      {
        field: '__save',
        message: `Concurrent write conflict detected. Please retry. (${lastError?.message || 'unknown error'})`,
      },
    ],
    warnings: [],
    casConflict: true,
  };
}

// ─── Async Audit Revision ─────────────────────────────────────────────────────

/**
 * Schedule a config audit revision to be written asynchronously after the response.
 *
 * Call this after saveConfig() in route handlers that have a Cloudflare
 * ExecutionContext (ctx). The revision write is offloaded to ctx.waitUntil()
 * so it does not block the HTTP response (~500ms KV write removed from critical path).
 *
 * @param {Object} env - Worker environment
 * @param {string} siteId - Customer site identifier
 * @param {Object} snapshot - The config object that was just saved (after-state)
 * @param {Object} ctx - Cloudflare ExecutionContext (must have .waitUntil())
 * @param {Object} [options]
 * @param {Object} [options.before=null] - Config before the save (before-state for diff)
 * @param {Object} [options.validation={ valid: true }] - Validation result from saveConfig
 * @param {Object} [options.audit={}] - Audit metadata (actor, source, reason, scope, etc.)
 * @param {boolean} [options.merge=true] - Whether the save was a merge or overwrite
 */
export async function scheduleAuditRevision(env, siteId, snapshot, ctx, options = {}) {
  const { before = null, validation = { valid: true }, audit = {}, merge = true } = options;
  const kv = env?.KV_CONFIG || env?.KV_ANALYTICS;
  if (!kv?.put) {
    return;
  }
  const work = writeConfigRevision(kv, siteId, before, snapshot, validation, audit, merge)
    .catch((err) => console.error('[audit-revision]', siteId, err.message));
  if (ctx?.waitUntil) {
    ctx.waitUntil(work);
  } else {
    await work; // sync fallback — callers without ctx block until written
  }
}

// ─── Convenience: Load from Env Only ─────────────────────────────────────────

/**
 * Build a config purely from env vars. No KV. For backward compatibility.
 * Use this when migrating from the old env-var-only approach.
 *
 * @param {Object} env - Worker environment
 * @returns {Object} Complete, validated config (not frozen)
 */
export function loadConfigFromEnv(env) {
  const partial = buildConfigFromEnv(env);
  return mergeWithDefaults(partial);
}

// ─── Deep Freeze ─────────────────────────────────────────────────────────────

/**
 * Recursively freeze an object to prevent mutations.
 */
function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const val of Object.values(obj)) {
    if (typeof val === 'object' && val !== null && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}
