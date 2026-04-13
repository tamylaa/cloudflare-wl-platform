/**
 * TTL Constants — Named time-to-live values for KV storage.
 *
 * Replaces scattered raw `86400 * N` literals with semantic names.
 * All values are in SECONDS (matching Cloudflare KV expirationTtl).
 *
 * For millisecond values (e.g. Date arithmetic), use `TTL_MS`.
 *
 * @module config/ttl
 */

// ── Seconds (for KV expirationTtl) ──────────────────────────────────────

export const TTL = {
  // ── Data freshness ────────────────────
  CONSOLIDATED_DATA: 86400 * 7, // 7 days
  GSC_RAW_DATA: 86400 * 7, // 7 days
  ANALYSIS_RESULTS: 86400 * 7, // 7 days
  PAGESPEED_HISTORY: 86400 * 90, // 90 days
  PROGRESS_HISTORY: 86400 * 90, // 90 days
  INTENT_ANALYSIS: 86400 * 90, // 90 days
  CONTENT_AUDIT: 86400 * 3, // 3 days (successful)
  CONTENT_AUDIT_EMPTY: 86400, // 1 day (no results)
  CONTENT_REWRITES: 86400 * 30, // 30 days
  ACTIONS: 86400 * 30, // 30 days
  DISMISSED_ITEMS: 86400 * 30, // 30 days
  NOTIFICATION_HISTORY: 86400 * 14, // 14 days

  // convenience values used by scheduled handler
  DAYS_30: 86400 * 30, // 30 days (alias)

  // ── Auth / Sessions ───────────────────
  SESSION: 86400 * 30, // 30 days
  REMEMBER_ME: 86400 * 90, // 90 days (remembered login cookie)
  USER_SETTINGS: 86400, // 1 day
  CSRF_TOKEN: 600, // 10 minutes
  OAUTH_STATE: 600, // 10 minutes
  OAUTH_TOKEN: 86400 * 365, // 1 year (stored tokens)

  // ── AI results ────────────────────────
  AI_WELCOME_RESULT: 86400 * 3, // 3 days
  AI_FORECAST: 86400 * 7, // 7 days
  AI_RECOMMENDATIONS: 86400 * 7, // 7 days
  AI_USAGE_PERIOD: 86400 * 35, // 35 days (billing period + buffer)

  // ── Platform tracking ─────────────────
  PAGESPEED_RESULT: 86400 * 7, // 7 days
  IMPACT_RECORD: 86400 * 120, // 120 days (improvement tracking)
  PROGRESS_SNAPSHOT: 86400 * 100, // 100 days (analytics snapshots)
  COUPON_USAGE: 86400 * 365, // 1 year
  AI_BACKLOG: 86400 * 365, // 1 year

  // ── Cache headers ─────────────────────
  STATIC_ASSET: 86400 * 7, // 7 days (immutable hashed assets)
  PRECOMPUTE: 14400, // 4 hours (precomputed cockpit data)
  CACHE_MICRO: 60, // 1 minute (very short cache)
  CACHE_SHORT: 300, // 5 minutes (short cache)
  CACHE_MEDIUM: 1800, // 30 minutes (medium cache)
  SWR_SHORT: 600, // 10 minutes (stale-while-revalidate)
  R2_CACHE_MAX_AGE: 86400, // 1 day (Cache-Control max-age)
  CORS_MAX_AGE: 86400, // 1 day (Access-Control-Max-Age)

  // ── Rate limiting ─────────────────────
  RATE_LIMIT_WINDOW: 3600, // 1 hour

  // ── Free audit funnel ─────────────────
  AUDIT_CACHE: 900, // 15 minutes (public audit result)
  AUDIT_LEAD: 86400 * 90, // 90 days (prospect record from audit)
  AUDIT_ATTRIBUTION: 86400 * 30, // 30 days (attribution cookie mirror in KV)
  AUDIT_REAUDIT_DEDUP: 86400 * 6, // 6 days (prevent overlapping re-audits)
  AUDIT_INVITE_DEDUP: 86400 * 14, // 14 days (prevent spam invites)

  // ── Outbound campaign system ──────
  OUTBOUND_DISCOVERY: 86400 * 30, // 30 days (discovery run metadata)
  OUTBOUND_BATCH: 86400 * 30, // 30 days (batch results)
  OUTBOUND_THROTTLE: 3600, // 1 hour (hourly send counter)
  OUTBOUND_WARMUP: 86400 * 90, // 90 days (campaign warmup state)
  OUTBOUND_BOUNCE: 86400 * 30, // 30 days (domain bounce rate)
};

// ── Milliseconds (for Date arithmetic, setTimeout) ──────────────────────

export const TTL_MS = {
  ONE_DAY: 86400000,
  ONE_WEEK: 86400000 * 7,
  ONE_HOUR: 3600000,
  ONE_MINUTE: 60000,
  FIVE_MINUTES: 300000,
  THREE_DAYS: 86400000 * 3,
  SIX_HOURS: 21600000,
  FOUR_HOURS: 14400000, // matches TTL.PRECOMPUTE * 1000
  FORTY_EIGHT_HOURS: 172800000, // 48h — data staleness threshold
  POPUP_TIMEOUT: 300000, // 5 minutes (OAuth popup)
  NINETY_DAYS: 86400000 * 90, // 90d — default lookback window
  TWO_DAYS: 86400000 * 2, // 2d — GSC data lag
};

// ── Timeout defaults (for external API calls) ──────────────────────────

export const TIMEOUTS = {
  /** Per-page content fetch timeout (ms). Override with env.CONTENT_FETCH_TIMEOUT_MS */
  CONTENT_FETCH: 12000,
  /** GSC query timeout — used as default if no DeadlineBudget provided */
  GSC_QUERY: 15000,
  /** PageSpeed API per-page timeout */
  PAGESPEED: 30000,
  /** Backlinks API timeout */
  BACKLINKS: 15000,
  /** Internal service binding calls (marketing, analytics engine) */
  SERVICE_BINDING: 5000,
  /** AI generation cooldown (ms) */
  AI_COOLDOWN: 10000,
  /** Workflow default timeout (ms) */
  WORKFLOW_DEFAULT: 120000,
  /** Dashboard auto-refresh interval (ms) */
  DASHBOARD_REFRESH: 300000,
};

// ── Auth token constants (seconds) ───────────────────────────────────────

export const TOKEN_DEFAULTS = {
  /** JWT lifetime for service account tokens (seconds) */
  JWT_LIFETIME: 3600,
  /** Token renewal threshold — refresh before expiry (ms) */
  RENEWAL_BUFFER_MS: 360000,
};
