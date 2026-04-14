/**
 * Tenant Quota & Noisy-Neighbour Guard Helpers
 *
 * These helpers provide deterministic, tenant-scoped rate-limit and usage-cap
 * evaluation primitives that consuming routes/middleware can use to prevent one
 * tenant from degrading others.
 *
 * Note: The in-memory limiter is per Worker isolate and should be complemented by
 * durable storage counters for globally consistent enforcement.
 */

export const TENANT_RATE_LIMIT_WINDOWS_MS = Object.freeze({
  apiRequestsPerMinute: 60 * 1000,
  oauthRequestsPerMinute: 60 * 1000,
  billingRequestsPerMinute: 60 * 1000,
  triggerRequestsPerMinute: 60 * 1000,
  auditRequestsPerHour: 60 * 60 * 1000,
});

export const TENANT_RATE_LIMIT_DEFAULTS = Object.freeze({
  apiRequestsPerMinute: 60,
  oauthRequestsPerMinute: 30,
  billingRequestsPerMinute: 10,
  triggerRequestsPerMinute: 5,
  auditRequestsPerHour: 10,
});

export const TENANT_MONTHLY_QUOTA_DEFAULTS = Object.freeze({
  monthlyAiCalls: 0,
  monthlyTokens: 0,
  monthlyExtractionRuns: 0,
  monthlyUrlInspections: 0,
  contentAuditMaxPages: 0,
});

function toNonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizeSiteId(siteId = '') {
  return String(siteId ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function resolveTenantQuotaPolicy(config = {}, options = {}) {
  const quotas = config?.quotas || {};
  const rateDefaults = {
    ...TENANT_RATE_LIMIT_DEFAULTS,
    ...(options.rateLimitDefaults || {}),
  };
  const monthlyDefaults = {
    ...TENANT_MONTHLY_QUOTA_DEFAULTS,
    ...(options.monthlyQuotaDefaults || {}),
  };

  const rateLimits = {
    apiRequestsPerMinute: toNonNegativeInteger(
      quotas.apiRequestsPerMinute,
      rateDefaults.apiRequestsPerMinute
    ),
    oauthRequestsPerMinute: toNonNegativeInteger(
      quotas.oauthRequestsPerMinute,
      rateDefaults.oauthRequestsPerMinute
    ),
    billingRequestsPerMinute: toNonNegativeInteger(
      quotas.billingRequestsPerMinute,
      rateDefaults.billingRequestsPerMinute
    ),
    triggerRequestsPerMinute: toNonNegativeInteger(
      quotas.triggerRequestsPerMinute,
      rateDefaults.triggerRequestsPerMinute
    ),
    auditRequestsPerHour: toNonNegativeInteger(
      quotas.auditRequestsPerHour,
      rateDefaults.auditRequestsPerHour
    ),
  };

  const monthlyCaps = {
    monthlyAiCalls: toNonNegativeInteger(quotas.monthlyAiCalls, monthlyDefaults.monthlyAiCalls),
    monthlyTokens: toNonNegativeInteger(quotas.monthlyTokens, monthlyDefaults.monthlyTokens),
    monthlyExtractionRuns: toNonNegativeInteger(
      quotas.monthlyExtractionRuns,
      monthlyDefaults.monthlyExtractionRuns
    ),
    monthlyUrlInspections: toNonNegativeInteger(
      quotas.monthlyUrlInspections,
      monthlyDefaults.monthlyUrlInspections
    ),
    contentAuditMaxPages: toNonNegativeInteger(
      quotas.contentAuditMaxPages,
      monthlyDefaults.contentAuditMaxPages
    ),
  };

  return Object.freeze({
    rateLimits: Object.freeze(rateLimits),
    monthlyCaps: Object.freeze(monthlyCaps),
    windowsMs: Object.freeze({ ...TENANT_RATE_LIMIT_WINDOWS_MS }),
  });
}

export function computeRateLimitWindow(nowMs = Date.now(), windowMs = 60_000) {
  const safeNow = Number(nowMs) || Date.now();
  const safeWindowMs = Math.max(1, Number(windowMs) || 60_000);
  const windowStartMs = Math.floor(safeNow / safeWindowMs) * safeWindowMs;

  return {
    windowStartMs,
    windowEndMs: windowStartMs + safeWindowMs,
    resetAtMs: windowStartMs + safeWindowMs,
  };
}

const GLOBAL_TENANT_QUOTA_STORE = new Map();

export function createTenantQuotaStore() {
  return new Map();
}

export function clearTenantQuotaStore(store = GLOBAL_TENANT_QUOTA_STORE) {
  if (store && typeof store.clear === 'function') {
    store.clear();
  }
}

function buildRateLimitCounterKey(siteId, bucket, windowStartMs) {
  return `${siteId}:${bucket}:${windowStartMs}`;
}

export function consumeTenantRateLimit(params = {}) {
  const siteId = normalizeSiteId(params.siteId || '');
  const bucket = String(params.bucket || '').trim();
  const limit = toNonNegativeInteger(params.limit, 0);
  const windowMs = Math.max(1, Number(params.windowMs) || 60_000);
  const nowMs = Number(params.nowMs) || Date.now();
  const store = params.store || GLOBAL_TENANT_QUOTA_STORE;

  if (!siteId) {
    throw new Error('siteId is required for tenant rate-limit evaluation');
  }
  if (!bucket) {
    throw new Error('bucket is required for tenant rate-limit evaluation');
  }

  if (limit <= 0) {
    return {
      allowed: true,
      unlimited: true,
      siteId,
      bucket,
      limit,
      used: 0,
      remaining: null,
      retryAfterMs: 0,
      ...computeRateLimitWindow(nowMs, windowMs),
    };
  }

  const { windowStartMs, windowEndMs, resetAtMs } = computeRateLimitWindow(nowMs, windowMs);
  const key = buildRateLimitCounterKey(siteId, bucket, windowStartMs);
  const used = toNonNegativeInteger(store.get(key), 0) + 1;
  store.set(key, used);

  const allowed = used <= limit;
  const remaining = Math.max(limit - used, 0);
  const retryAfterMs = allowed ? 0 : Math.max(windowEndMs - nowMs, 1);

  return {
    allowed,
    unlimited: false,
    siteId,
    bucket,
    limit,
    used,
    remaining,
    retryAfterMs,
    windowStartMs,
    windowEndMs,
    resetAtMs,
  };
}

export function consumeTenantQuotaBucket(tenant = {}, bucket = 'apiRequestsPerMinute', options = {}) {
  const policy = options.policy || resolveTenantQuotaPolicy(tenant?.config || {}, options);
  const limit = toNonNegativeInteger(policy?.rateLimits?.[bucket], 0);
  const windowMs = toNonNegativeInteger(
    options.windowMs,
    toNonNegativeInteger(policy?.windowsMs?.[bucket], 60_000)
  );

  return consumeTenantRateLimit({
    siteId: options.siteId || tenant?.siteId,
    bucket,
    limit,
    windowMs,
    nowMs: options.nowMs,
    store: options.store,
  });
}

function evaluateMonthlyCap(usedValue, limitValue) {
  const used = toNonNegativeInteger(usedValue, 0);
  const limit = toNonNegativeInteger(limitValue, 0);
  const unlimited = limit <= 0;
  const remaining = unlimited ? null : Math.max(limit - used, 0);
  const exceeded = !unlimited && used >= limit;
  const usageRatio = unlimited || limit === 0 ? 0 : used / limit;

  return {
    used,
    limit,
    unlimited,
    remaining,
    exceeded,
    usageRatio,
  };
}

export function evaluateTenantUsageAgainstPolicy(usage = {}, policyOrConfig = {}) {
  const policy = policyOrConfig?.monthlyCaps
    ? policyOrConfig
    : resolveTenantQuotaPolicy(policyOrConfig);

  const aiCalls = evaluateMonthlyCap(usage.monthlyAiCalls, policy.monthlyCaps.monthlyAiCalls);
  const tokens = evaluateMonthlyCap(usage.monthlyTokens, policy.monthlyCaps.monthlyTokens);
  const extractions = evaluateMonthlyCap(
    usage.monthlyExtractionRuns,
    policy.monthlyCaps.monthlyExtractionRuns
  );
  const inspections = evaluateMonthlyCap(
    usage.monthlyUrlInspections,
    policy.monthlyCaps.monthlyUrlInspections
  );

  const exceeded = [aiCalls, tokens, extractions, inspections].some((entry) => entry.exceeded);

  return {
    exceeded,
    monthly: Object.freeze({
      monthlyAiCalls: aiCalls,
      monthlyTokens: tokens,
      monthlyExtractionRuns: extractions,
      monthlyUrlInspections: inspections,
    }),
  };
}

// ─── KV-backed Durable Rate Limit ────────────────────────────────────────────

const KV_RATE_LIMIT_PREFIX = 'ratelimit:';
const KV_RATE_LIMIT_TTL_BUFFER_S = 5; // extra seconds so the KV key outlives the window

/**
 * KV-backed rate-limit enforcement.
 *
 * Unlike consumeTenantRateLimit (in-process Map), this helper persists counters
 * in Cloudflare KV so requests distributed across multiple Worker isolates share
 * the same window counter. It uses a best-effort read-increment-write pattern;
 * there is no perfect atomic guarantee without a Durable Object, but it removes
 * the single-isolate blindspot.
 *
 * Falls back to the in-process limiter when KV is unavailable so the consuming
 * app never hard-fails on a missing binding.
 *
 * @param {object} env         - Worker env with KV_CONFIG or KV_ANALYTICS binding
 * @param {string} siteId      - Tenant identifier
 * @param {string} bucket      - Rate-limit bucket name (matches TENANT_RATE_LIMIT_DEFAULTS key)
 * @param {object} [options]   - { config, policy, nowMs, windowMs, limit }
 * @returns {Promise<{ allowed: boolean, used: number, remaining: number|null, retryAfterMs: number, resetAtMs: number, source: 'kv'|'process' }>}
 */
export async function consumeTenantRateLimitKv(env, siteId, bucket, options = {}) {
  const kv = env?.KV_CONFIG || env?.KV_ANALYTICS || null;

  const policy = options.policy || resolveTenantQuotaPolicy(options.config || {});
  const limit = toNonNegativeInteger(
    options.limit ?? policy?.rateLimits?.[bucket],
    TENANT_RATE_LIMIT_DEFAULTS[bucket] || 0
  );
  const windowMs = Math.max(
    1,
    Number(options.windowMs || policy?.windowsMs?.[bucket] || TENANT_RATE_LIMIT_WINDOWS_MS[bucket] || 60_000)
  );
  const nowMs = Number(options.nowMs) || Date.now();

  // Fall back to in-process limiter when KV unavailable
  if (!kv?.get || !kv?.put) {
    const result = consumeTenantRateLimit({ siteId, bucket, limit, windowMs, nowMs });
    return { ...result, source: 'process' };
  }

  const normalizedSiteId = normalizeSiteId(siteId);
  if (!normalizedSiteId || !bucket) {
    const result = consumeTenantRateLimit({ siteId, bucket, limit, windowMs, nowMs });
    return { ...result, source: 'process' };
  }

  if (limit <= 0) {
    const { windowStartMs, windowEndMs, resetAtMs } = computeRateLimitWindow(nowMs, windowMs);
    return { allowed: true, unlimited: true, siteId: normalizedSiteId, bucket, limit, used: 0, remaining: null, retryAfterMs: 0, windowStartMs, windowEndMs, resetAtMs, source: 'kv' };
  }

  const { windowStartMs, windowEndMs, resetAtMs } = computeRateLimitWindow(nowMs, windowMs);
  const kvKey = `${KV_RATE_LIMIT_PREFIX}${normalizedSiteId}:${bucket}:${windowStartMs}`;
  const ttlSeconds = Math.ceil(windowMs / 1000) + KV_RATE_LIMIT_TTL_BUFFER_S;

  let used = 1;
  try {
    const existing = await kv.get(kvKey);
    used = (existing ? toNonNegativeInteger(existing, 0) : 0) + 1;
    await kv.put(kvKey, String(used), { expirationTtl: ttlSeconds });
  } catch {
    // KV call failed mid-flight — degrade to in-process for this request
    const result = consumeTenantRateLimit({ siteId, bucket, limit, windowMs, nowMs });
    return { ...result, source: 'process' };
  }

  const allowed = used <= limit;
  const remaining = Math.max(limit - used, 0);
  const retryAfterMs = allowed ? 0 : Math.max(windowEndMs - nowMs, 1);

  return {
    allowed,
    unlimited: false,
    siteId: normalizedSiteId,
    bucket,
    limit,
    used,
    remaining,
    retryAfterMs,
    windowStartMs,
    windowEndMs,
    resetAtMs,
    source: 'kv',
  };
}
