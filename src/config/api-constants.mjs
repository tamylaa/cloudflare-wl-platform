/**
 * API Constants — URLs, limits, and query defaults for external APIs.
 *
 * Centralizes all hardcoded Google Search Console, PageSpeed, and other
 * API references so they can be changed in a single place.
 *
 * @module config/api-constants
 */

// ── Google Search Console ──────────────────────────────────────────────

export const GSC_API = Object.freeze({
  /** GSC Search Analytics query endpoint base */
  BASE_URL: 'https://www.googleapis.com/webmasters/v3/sites',

  /** URL Inspection API */
  INSPECTION_URL: 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',

  /** Default row limits per query dimension */
  ROW_LIMITS: Object.freeze({
    QUERIES: 5000,
    PAGES: 5000,
    MULTI_DIM: 5000,
    DATE_SERIES: 10000,
    SEARCH_APPEARANCE: 1000,
    DAILY_TOTALS: 500,
  }),

  /** Default query window (days) */
  DEFAULT_DAYS: 90,

  /** Dimensions used in the 9-query pipeline */
  DIMENSIONS: Object.freeze([
    ['query', 'page'],
    ['query', 'country'],
    ['query', 'device'],
    ['query', 'date'],
    ['page', 'country'],
    ['page', 'device'],
    ['page', 'date'],
    ['searchAppearance'],
    ['date'],
  ]),
});

// ── PageSpeed Insights ────────────────────────────────────────────────

export const PAGESPEED_API = Object.freeze({
  BASE_URL: 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed',
  STRATEGIES: ['mobile', 'desktop'],
});

// ── AI Model Limits ───────────────────────────────────────────────────

export const AI_LIMITS = Object.freeze({
  /** Max tokens for prompt/completion budgets */
  MAX_OUTPUT_TOKENS: 4096,
  MAX_PROMPT_TOKENS: 12000,

  /** Default temperature for different operation types */
  TEMPERATURE: Object.freeze({
    ANALYSIS: 0.3, // Factual, deterministic
    CREATIVE: 0.7, // Content rewrites, suggestions
    CHAT: 0.5, // Conversational balance
  }),

  /** Rate limits for AI operations */
  RATE: Object.freeze({
    MAX_GENERATION_PER_HOUR: 5,
    MAX_CHAT_PER_MINUTE: 10,
  }),
});

// ── Cache-Control Header Presets ──────────────────────────────────────

export const CACHE_HEADERS = Object.freeze({
  /** Immutable assets (CSS/JS with content hash in URL) */
  IMMUTABLE: 'public, max-age=31536000, immutable',

  /** Dynamic personal content (cockpit HTML) */
  PRIVATE_SHORT: 'private, max-age=300, stale-while-revalidate=600',

  /** Public shared assets (fonts, images) */
  PUBLIC_LONG: 'public, max-age=86400',

  /** API responses (short-lived, revalidate) */
  API_DEFAULT: 'public, max-age=60, stale-while-revalidate=300',

  /** Never cache (auth pages, billing, mutations) */
  NO_STORE: 'no-store',

  /** Health/status endpoints */
  NO_CACHE: 'no-cache, max-age=0',
});

// ── Webhook / External Service URLs ──────────────────────────────────

export const EXTERNAL_URLS = Object.freeze({
  /** Exchange rate APIs for currency conversion (ordered by priority) */
  FX_PRIMARY: 'https://api.frankfurter.app/latest',
  FX_FALLBACK: 'https://open.er-api.com/v6/latest/USD',

  /** Bing Webmaster Tools */
  BING_API_BASE: 'https://ssl.bing.com/webmaster/api.svc/json',

  /** Cloudflare GraphQL Analytics */
  CLOUDFLARE_GRAPHQL: 'https://api.cloudflare.com/client/v4/graphql/',

  /** Google Analytics 4 Data API */
  GA4_API_BASE: 'https://analyticsdata.googleapis.com/v1beta',

  /** Vercel API */
  VERCEL_API_BASE: 'https://api.vercel.com',

  /** Netlify API */
  NETLIFY_API_BASE: 'https://api.netlify.com/api/v1',

  /** Moz Link API */
  MOZ_API: 'https://lsapi.seomoz.com/v2/url_metrics',

  /** Google Custom Search Engine */
  GOOGLE_CSE: 'https://www.googleapis.com/customsearch/v1',
});

// ── Google OAuth Endpoints ───────────────────────────────────────────

export const GOOGLE_OAUTH = Object.freeze({
  AUTH_ENDPOINT: 'https://accounts.google.com/o/oauth2/v2/auth',
  TOKEN_ENDPOINT: 'https://oauth2.googleapis.com/token',
  REVOKE_ENDPOINT: 'https://oauth2.googleapis.com/revoke',
});

// ── Microsoft OAuth Endpoints ────────────────────────────────────────

export const MICROSOFT_OAUTH = Object.freeze({
  AUTH_ENDPOINT: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  TOKEN_ENDPOINT: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  REVOKE_ENDPOINT: 'https://login.microsoftonline.com/common/oauth2/v2.0/logout',
});

// ── AI Provider Endpoints ────────────────────────────────────────────

export const AI_ENDPOINTS = Object.freeze({
  ANTHROPIC: 'https://api.anthropic.com/v1/messages',
  OPENAI: 'https://api.openai.com/v1/chat/completions',
});

// ── Payment Gateway URLs ─────────────────────────────────────────────

export const PAYMENT_URLS = Object.freeze({
  RAZORPAY_API: 'https://api.razorpay.com/v1',
  RAZORPAY_CHECKOUT_JS: 'https://checkout.razorpay.com/v1/checkout.js',
  STRIPE_API: 'https://api.stripe.com/v1',
});

// ── Microsoft Graph ──────────────────────────────────────────────────

/** Extend MICROSOFT_OAUTH with Graph API scope used in token exchange */
export const MICROSOFT_GRAPH = Object.freeze({
  DEFAULT_SCOPE: 'https://graph.microsoft.com/.default',
});

// ── Azure OpenAI ─────────────────────────────────────────────────────

export const AZURE_OPENAI = Object.freeze({
  DEFAULT_API_VERSION: '2023-12-01-preview',
});

// ── Shopify ──────────────────────────────────────────────────────────

export const SHOPIFY_DEFAULTS = Object.freeze({
  API_VERSION: '2024-01',
});

// ── CDN Dependencies ─────────────────────────────────────────────────

export const CDN_URLS = Object.freeze({
  CHART_JS: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js',
  GOOGLE_FONTS_INTER:
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap',
});

// ── Google Custom Search Engine ──────────────────────────────────────

export const CSE_CONFIG = Object.freeze({
  /** Number of results to request per CSE query (max 10 per API call) */
  RESULTS_LIMIT: 10,
});

// ── Content & Scoring Thresholds ─────────────────────────────────────

export const CONTENT_THRESHOLDS = Object.freeze({
  /** Word count below which content is considered "thin" */
  THIN: 300,
  /** Target word count for existing short pages */
  TARGET_SHORT: 800,
  /** Target word count for new articles */
  TARGET_NEW: 1200,
});

// ── Health & Scoring Config ──────────────────────────────────────────

export const SCORING_CONFIG = Object.freeze({
  /** Health score thresholds for color coding */
  HEALTH: Object.freeze({
    GREEN: 75,
    AMBER: 50,
  }),
  /** Severity multipliers for ranking recommendations */
  SEVERITY: Object.freeze({
    critical: 50,
    high: 30,
    medium: 15,
    low: 5,
  }),
  /** Effort scores (lower = more effort) */
  EFFORT: Object.freeze({
    low: 10,
    medium: 5,
    high: 1,
  }),
});

// ── Circuit Breaker Defaults ─────────────────────────────────────────

export const CIRCUIT_BREAKER_DEFAULTS = Object.freeze({
  FAILURE_THRESHOLD: 5,
  RESET_TIMEOUT_MS: 60_000,
  HALF_OPEN_MAX: 2,
});

// ── Emergency FX Fallback Rates ──────────────────────────────────────

export const FX_FALLBACK_RATES = Object.freeze({
  INR: 84.5,
  EUR: 0.92,
  GBP: 0.79,
});

// ── Stripe Webhook Tolerance ─────────────────────────────────────────

export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300; // 5 minutes

// ── Retry Defaults ───────────────────────────────────────────────────

export const RETRY_DEFAULTS = Object.freeze({
  /** Exponential backoff delays for polling (ms) */
  AI_POLLING_DELAYS: [2000, 3000, 5000],
  /** GSC-fetcher retry config */
  GSC_FETCH: Object.freeze({ maxAttempts: 2, baseDelayMs: 1000 }),
});

// ── Page Audit Limits ────────────────────────────────────────────────

export const PAGE_AUDIT = Object.freeze({
  MAX_PAGES: 15,
  CONCURRENCY: 2,
  MAX_PAGESPEED: 10,
});

// ── Action Routes — Canonical API paths for action endpoints ─────────

const _ACTION_BASE = '/dashboard/actions';

export const ACTION_ROUTES = Object.freeze({
  BASE: _ACTION_BASE,
  START: `${_ACTION_BASE}/start/`,
  COMPLETE: `${_ACTION_BASE}/complete/`,
  DISMISS: `${_ACTION_BASE}/dismiss/`,
  PROGRESS: `${_ACTION_BASE}/progress/`,
  PROGRESS_STATE: `${_ACTION_BASE}/progress-state/`,
  LIFECYCLE: `${_ACTION_BASE}/lifecycle/`,
  TIMELINE: `${_ACTION_BASE}/timeline/`,
  SUMMARY: `${_ACTION_BASE}/summary`,
  // Contract routes
  CONTRACT: `${_ACTION_BASE}/contract/`,
  CONTRACT_EVAL: `${_ACTION_BASE}/contract/evaluate/`,
  CONTRACTS: `${_ACTION_BASE}/contracts`,
});
