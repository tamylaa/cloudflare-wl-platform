/**
 * Centralized service identifiers used by logging and observability.
 */

export const SERVICE_NAMES = Object.freeze({
  CORE: 'visibility-analytics',
  AI_GATE: 'ai-gate',
  API_ROUTES: 'api-routes',
  INDEX_NOTIFICATION: 'index-notification',
  MIDDLEWARE: 'middleware',
  PAYMENT_HANDLER: 'payment-handler',
  SCHEDULED_HANDLER: 'scheduled-handler',
  ANALYTICS_SCHEDULER: 'analytics-scheduler',
});

export const RUNTIME_DEFAULTS = Object.freeze({
  ENVIRONMENT: 'production',
  LOG_EVENT: 'log_event',
});
