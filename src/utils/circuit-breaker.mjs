/**
 * Circuit Breaker — Prevents cascade failures from external service outages.
 *
 * Implements the classic three-state pattern: CLOSED → OPEN → HALF_OPEN.
 *
 *   CLOSED   — Requests flow normally. Failures increment a counter.
 *              When failures reach `threshold`, transitions to OPEN.
 *   OPEN     — All requests fast-fail with CircuitOpenError.
 *              After `resetTimeoutMs`, transitions to HALF_OPEN.
 *   HALF_OPEN — A single probe request is allowed through.
 *              Success → CLOSED.  Failure → OPEN (reset timer restarts).
 *
 * Designed for Cloudflare Workers — uses in-memory state per isolate.
 * For distributed state, pass a `kvNamespace` to persist across edges.
 *
 * Usage:
 *   const breaker = new CircuitBreaker('gsc-api', { threshold: 5 });
 *   const result = await breaker.execute(() => fetch(url));
 *
 * @module utils/circuit-breaker
 */

// ── States ──────────────────────────────────────────────────────────────

export const CircuitState = Object.freeze({
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
});

// ── Error ───────────────────────────────────────────────────────────────

export class CircuitOpenError extends Error {
  constructor(name, remainingMs) {
    super(`Circuit "${name}" is OPEN — fast-failing (resets in ${Math.ceil(remainingMs / 1000)}s)`);
    this.name = 'CircuitOpenError';
    this.circuitName = name;
    this.remainingMs = remainingMs;
  }
}

// ── In-memory registry (per-isolate singleton) ──────────────────────────

const _registry = new Map();

/**
 * Get or create a named CircuitBreaker. Ensures one breaker per name per isolate.
 *
 * @param {string} name    — Unique service identifier (e.g. 'gsc-api', 'ai-engine')
 * @param {object} [opts]  — Options (only used on first creation)
 * @returns {CircuitBreaker}
 */
export function getCircuitBreaker(name, opts) {
  if (!_registry.has(name)) {
    _registry.set(name, new CircuitBreaker(name, opts));
  }
  return _registry.get(name);
}

/** Reset all breakers — useful in tests. */
export function resetAllBreakers() {
  _registry.clear();
}

// ── Circuit Breaker ─────────────────────────────────────────────────────

export class CircuitBreaker {
  /**
   * @param {string} name — Human-readable identifier for logging
   * @param {object} [options]
   * @param {number} [options.threshold=5]        — Consecutive failures before opening
   * @param {number} [options.resetTimeoutMs=30000] — Time in OPEN state before probing
   * @param {number} [options.halfOpenMax=1]      — Max concurrent requests in HALF_OPEN
   * @param {Function} [options.isFailure]        — Custom predicate: (error|response) → boolean
   * @param {Function} [options.onStateChange]    — Callback: (name, from, to) => void
   */
  constructor(
    name,
    { threshold = 5, resetTimeoutMs = 30000, halfOpenMax = 1, isFailure, onStateChange } = {}
  ) {
    this.name = name;
    this.threshold = threshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this.halfOpenMax = halfOpenMax;
    this.isFailure = isFailure || defaultIsFailure;
    this.onStateChange = onStateChange || (() => {});

    // Internal state
    this._state = CircuitState.CLOSED;
    this._failureCount = 0;
    this._successCount = 0;
    this._lastFailureTime = 0;
    this._halfOpenInFlight = 0;

    // Metrics
    this._totalRequests = 0;
    this._totalFailures = 0;
    this._totalSuccesses = 0;
    this._totalRejected = 0;
  }

  /** Current circuit state. */
  get state() {
    // Auto-transition from OPEN → HALF_OPEN when timeout expires
    if (this._state === CircuitState.OPEN && this._isResetTimeoutExpired()) {
      this._transition(CircuitState.HALF_OPEN);
    }
    return this._state;
  }

  /** Snapshot of breaker metrics. */
  get metrics() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this._failureCount,
      totalRequests: this._totalRequests,
      totalFailures: this._totalFailures,
      totalSuccesses: this._totalSuccesses,
      totalRejected: this._totalRejected,
      lastFailureTime: this._lastFailureTime ? new Date(this._lastFailureTime).toISOString() : null,
    };
  }

  /**
   * Execute a function through the circuit breaker.
   *
   * @template T
   * @param {() => Promise<T>} fn       — The operation to protect
   * @param {() => Promise<T>} [fallback] — Optional fallback when circuit is open
   * @returns {Promise<T>}
   */
  async execute(fn, fallback) {
    const currentState = this.state; // may trigger OPEN→HALF_OPEN transition

    // ── OPEN: fast-fail ──────────────────────────────────────────
    if (currentState === CircuitState.OPEN) {
      this._totalRejected++;
      if (fallback) {
        console.warn(`[CircuitBreaker:${this.name}] OPEN — using fallback`);
        return fallback();
      }
      const remaining = this.resetTimeoutMs - (Date.now() - this._lastFailureTime);
      throw new CircuitOpenError(this.name, Math.max(0, remaining));
    }

    // ── HALF_OPEN: allow limited probe requests ──────────────────
    if (currentState === CircuitState.HALF_OPEN) {
      if (this._halfOpenInFlight >= this.halfOpenMax) {
        this._totalRejected++;
        if (fallback) {
          return fallback();
        }
        throw new CircuitOpenError(this.name, this.resetTimeoutMs);
      }
      this._halfOpenInFlight++;
    }

    // ── CLOSED or HALF_OPEN probe: execute ───────────────────────
    this._totalRequests++;
    try {
      const result = await fn();

      // Check if the result indicates a failure (e.g., HTTP 5xx)
      if (this.isFailure(result)) {
        this._recordFailure(result);
        return result; // Still return the result — caller decides what to do
      }

      this._recordSuccess();
      return result;
    } catch (err) {
      // Only trip the breaker if the custom predicate considers this a real failure
      // (e.g., 401/403 auth errors should NOT trip the breaker)
      if (this.isFailure(err)) {
        this._recordFailure(err);
      }
      throw err;
    } finally {
      if (currentState === CircuitState.HALF_OPEN) {
        this._halfOpenInFlight--;
      }
    }
  }

  /**
   * Manually reset the breaker to CLOSED state.
   * Useful for admin override or after a known fix.
   */
  reset() {
    this._failureCount = 0;
    this._halfOpenInFlight = 0;
    if (this._state !== CircuitState.CLOSED) {
      this._transition(CircuitState.CLOSED);
    }
  }

  // ── Internal Helpers ──────────────────────────────────────────────

  _recordSuccess() {
    this._totalSuccesses++;
    this._successCount++;
    this._failureCount = 0;

    if (this._state === CircuitState.HALF_OPEN) {
      // Probe succeeded — close the circuit
      this._transition(CircuitState.CLOSED);
    }
  }

  _recordFailure(errorOrResponse) {
    this._totalFailures++;
    this._failureCount++;
    this._successCount = 0;
    this._lastFailureTime = Date.now();

    const errMsg = errorOrResponse?.message || errorOrResponse?.status || 'unknown';
    console.warn(
      `[CircuitBreaker:${this.name}] Failure #${this._failureCount}/${this.threshold}: ${errMsg}`
    );

    if (this._state === CircuitState.HALF_OPEN) {
      // Probe failed — reopen
      this._transition(CircuitState.OPEN);
    } else if (this._failureCount >= this.threshold) {
      // Threshold crossed — open
      this._transition(CircuitState.OPEN);
    }
  }

  _transition(newState) {
    const from = this._state;
    this._state = newState;

    if (newState === CircuitState.CLOSED) {
      this._failureCount = 0;
      this._halfOpenInFlight = 0;
    }
    if (newState === CircuitState.HALF_OPEN) {
      this._halfOpenInFlight = 0;
    }

    console.log(`[CircuitBreaker:${this.name}] ${from} → ${newState}`);
    this.onStateChange(this.name, from, newState);
  }

  _isResetTimeoutExpired() {
    return Date.now() - this._lastFailureTime >= this.resetTimeoutMs;
  }
}

// ── Default failure predicate ───────────────────────────────────────────

/**
 * Default failure check: treats Response objects with status >= 500 as failures,
 * and any thrown Error as a failure.
 * Does NOT treat 4xx as circuit failures (they're client errors, not service issues).
 */
function defaultIsFailure(resultOrError) {
  if (resultOrError instanceof Error) {
    return true;
  }
  if (resultOrError && typeof resultOrError.status === 'number') {
    return resultOrError.status >= 500;
  }
  return false;
}
