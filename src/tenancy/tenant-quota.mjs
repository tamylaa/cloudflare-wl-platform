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
