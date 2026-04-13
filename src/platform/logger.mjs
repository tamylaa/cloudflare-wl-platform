/**
 * Structured Logger for Worker + Request contexts.
 */

import { RUNTIME_DEFAULTS, SERVICE_NAMES } from '../config/service-names.mjs';

const REDACTED_KEY_PARTS = [
  'password',
  'token',
  'secret',
  'key',
  'email',
  'phone',
  'address',
  'card',
];

function isTestEnv() {
  return typeof process !== 'undefined' && process?.env?.NODE_ENV === 'test';
}

function toRequestId() {
  if (globalThis?.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeValue(value) {
  if (value instanceof Error) {
    return {
      message: value.message,
      code: value.code || null,
      name: value.name || 'Error',
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = normalizeValue(nested);
    }
    return out;
  }
  return value;
}

function shouldRedact(key) {
  const lower = String(key || '').toLowerCase();
  if (!lower) {
    return false;
  }
  return REDACTED_KEY_PARTS.some((part) => lower.includes(part));
}

function redactObject(input) {
  if (!input || typeof input !== 'object') {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactObject(item));
  }

  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (shouldRedact(key)) {
      out[key] = '[REDACTED]';
      continue;
    }
    if (value && typeof value === 'object') {
      out[key] = redactObject(value);
      continue;
    }
    out[key] = value;
  }

  return out;
}

function normalizeEvent(event) {
  if (!event || typeof event !== 'string') {
    return RUNTIME_DEFAULTS.LOG_EVENT;
  }
  const trimmed = event.trim();
  return trimmed || RUNTIME_DEFAULTS.LOG_EVENT;
}

function normalizeContext(context) {
  if (typeof context === 'string') {
    return { service: context };
  }
  if (!context || typeof context !== 'object') {
    return {};
  }
  return { ...context };
}

export function createLogger(context = {}) {
  const baseContext = normalizeContext(context);
  const logInTest = baseContext.logInTest === true;
  delete baseContext.logInTest;

  function write(level, event, data = {}) {
    if (isTestEnv() && !logInTest) {
      return;
    }

    const normalizedData = normalizeValue(data);
    const entry = redactObject({
      ts: new Date().toISOString(),
      level,
      event: normalizeEvent(event),
      ...baseContext,
      ...(normalizedData && typeof normalizedData === 'object'
        ? normalizedData
        : { value: normalizedData }),
    });

    const line = JSON.stringify(entry);
    if (level === 'error') {
      console.error(line);
      return;
    }
    if (level === 'warn') {
      console.warn(line);
      return;
    }
    if (level === 'debug' && typeof console.debug === 'function') {
      console.debug(line);
      return;
    }
    console.log(line);
  }

  return {
    debug: (event, data) => write('debug', event, data),
    info: (event, data) => write('info', event, data),
    warn: (event, data) => write('warn', event, data),
    error: (event, data) => write('error', event, data),
  };
}

export function requestLogger(request, env, context = {}) {
  return createLogger({
    requestId: request?.headers?.get?.('cf-ray') || toRequestId(),
    service: env?.SERVICE_NAME || SERVICE_NAMES.CORE,
    env: env?.ENVIRONMENT || RUNTIME_DEFAULTS.ENVIRONMENT,
    ...normalizeContext(context),
  });
}

export function workerLogger(env, workerName, context = {}) {
  return createLogger({
    requestId: toRequestId(),
    service: workerName || env?.SERVICE_NAME || SERVICE_NAMES.CORE,
    env: env?.ENVIRONMENT || RUNTIME_DEFAULTS.ENVIRONMENT,
    ...normalizeContext(context),
  });
}

function normalizeArgs(args) {
  if (!args || args.length === 0) {
    return { message: '' };
  }

  if (args.length === 1) {
    const only = args[0];
    if (only && typeof only === 'object' && !Array.isArray(only) && !(only instanceof Error)) {
      return only;
    }
    if (only instanceof Error) {
      return normalizeValue(only);
    }
    return { message: String(only) };
  }

  const first = args[0];
  const rest = args.slice(1).map((item) => normalizeValue(item));
  const payload = {
    message: typeof first === 'string' ? first : JSON.stringify(normalizeValue(first)),
  };

  if (rest.length === 1 && rest[0] && typeof rest[0] === 'object' && !Array.isArray(rest[0])) {
    return { ...payload, ...rest[0] };
  }

  return { ...payload, args: rest };
}

export function toStructuredConsole(logger, defaults = {}) {
  const base = normalizeContext(defaults);
  return {
    log: (...args) => logger.info(RUNTIME_DEFAULTS.LOG_EVENT, { ...base, ...normalizeArgs(args) }),
    info: (...args) => logger.info(RUNTIME_DEFAULTS.LOG_EVENT, { ...base, ...normalizeArgs(args) }),
    warn: (...args) => logger.warn(RUNTIME_DEFAULTS.LOG_EVENT, { ...base, ...normalizeArgs(args) }),
    error: (...args) =>
      logger.error(RUNTIME_DEFAULTS.LOG_EVENT, { ...base, ...normalizeArgs(args) }),
    debug: (...args) =>
      logger.debug(RUNTIME_DEFAULTS.LOG_EVENT, { ...base, ...normalizeArgs(args) }),
  };
}
