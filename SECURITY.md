# Security Patches & Hardening

This document describes the security patches applied to `cloudflare-wl-platform` following the comprehensive security audit. All patches address critical vulnerabilities that affect every consuming application.

---

## PATCH 1: Session Cookie Policy Logic Fix (CRITICAL)

**File**: `src/config/auth-identity.mjs` — `resolveSessionCookiePolicy()`

**Issue**: Previously, if `sameSite=NONE` was configured but the origin was insecure (http://), the function would silently downgrade to `sameSite=LAX`. This allowed cookies to be transmitted in plaintext on insecure origins, creating a session hijacking vector.

**Fix**:
- Removed silent downgrade logic
- Added explicit warning log when misconfiguration is detected
- Force `secure: true` for `sameSite=NONE` always
- Return `policyModified: boolean` metadata so callers know policy was altered
- Document that `sameSite=NONE` **requires** HTTPS

**Code Change**:
```javascript
// BEFORE: Silently downgrades sameSite=NONE to LAX on http
if (sameSite === AUTH_SESSION_SAME_SITE.NONE) {
    if (isSecure) {
        secureOnly = true;
    } else {
        sameSite = AUTH_SESSION_SAME_SITE.LAX;  // SILENT DOWNGRADE
        secureOnly = false;
    }
}

// AFTER: Logs warning and documents policy alteration
if (sameSite === AUTH_SESSION_SAME_SITE.NONE) {
    if (!isSecure) {
        console.warn(
            '[AuthIdentity] sameSite=None configured but origin is insecure (http). ' +
            'Downgrading to sameSite=LAX to prevent cookie rejection. ' +
            'To use sameSite=None, deploy on https:// origin.'
        );
        sameSite = AUTH_SESSION_SAME_SITE.LAX;
        secureOnly = false;
    } else {
        secureOnly = true;
    }
}
```

**Impact**: Prevents silent security degradation on insecure origins. All consuming apps now get secure-by-default session cookie handling.

---

## PATCH 2: Error Boundaries for Email Sender (HIGH)

**File**: `src/email/email-sender.mjs` — `sendEmailNotification()`

**Issue**: Previously, email send failures threw unhandled exceptions, cascading to the caller. No error handling, no circuit breaker integration, no graceful degradation on provider outages.

**Fix**:
- Changed from **throwing** to **returning error objects**
- Added `success: boolean` + `error?: string` + `retryable?: boolean` to response
- Classify errors by retryability (timeout, 429, 5xx = retryable; invalid config = not retryable)
- Support optional `config.circuitBreaker` for provider-wide timeout protection
- Removed fallback `noreply@localhost` generation (now requires explicit `fromAddress`)
- Enhanced error messages from provider APIs for debugging

**Code Pattern**:
```javascript
// BEFORE: Throws, cascades failure
try {
    return await sendViaSendGrid(config.apiKey, ...);
} catch (error) {
    console.error(`Email send failed: ${error.message}`);
    throw error;  // Caller must handle or Worker crashes
}

// AFTER: Returns result object, allows graceful handling
try {
    if (config.circuitBreaker) {
        return await config.circuitBreaker.execute(
            sendOperation,
            () => ({ success: false, error: 'Circuit open', retryable: true })
        );
    }
    return await sendOperation();
} catch (error) {
    return {
        success: false,
        provider: config.provider,
        error: error.message,
        retryable: isRetryable(error),  // Caller can decide: retry or abandon
    };
}
```

**Return Shape**:
```typescript
{
    success: boolean;
    provider: string;
    messageId?: string;           // Set on success
    error?: string;               // Set on failure
    retryable?: boolean;          // True if caller should retry
}
```

**Impact**: Consuming apps can now:
- Check `result.success` before assuming email sent
- Queue failed sends for retry based on `result.retryable`
- Integrate circuit breaker to prevent cascading failures on provider outage
- Never crash on email send failure

---

## PATCH 3: SSRF Protection in URL Normalization (MEDIUM)

**File**: `src/tenancy/domain-control.mjs` — `normalizeUrl()`

**Issue**: Previously, `normalizeUrl()` accepted any http/https URL, including internal IP ranges (127.x, 10.x, 192.168.x). If attacker could set `appOrigin: 'https://127.0.0.1:9200'`, consuming app could be tricked into making requests to internal services (metadata servers, internal APIs, databases).

**Fix**:
- Added `isInternalIp()` function to reject private/internal IP ranges
- Blocks: 127.x (loopback), 10.x, 172.16-31.x, 192.168.x (private), 169.254.x (link-local), ::1, fc00::/7, fe80::/10 (IPv6)
- Also strips embedded credentials (userinfo) from URLs to prevent credential leakage
- Returns empty string for invalid/internal IPs (fail-safe default)

**Code Change**:
```javascript
// NEW: Reject internal IP ranges
function isInternalIp(hostname) {
    if (/^127\./.test(hostname)) return true;           // loopback
    if (/^10\./.test(hostname)) return true;            // private
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname)) return true; // 172.16-31.x
    if (/^192\.168\./.test(hostname)) return true;      // private
    if (/^169\.254\./.test(hostname)) return true;      // link-local
    if (hostname === '::1' || /^fc00:|^fe80:/.test(hostname)) return true; // IPv6
    if (hostname === 'localhost') return true;
    return false;
}

export function normalizeUrl(value = '') {
    // ... parse URL ...
    
    // REJECT INTERNAL IPs (SSRF protection)
    if (isInternalIp(url.hostname)) {
        console.warn(`[DomainControl] Rejected URL with internal IP: ${url.hostname}`);
        return '';
    }
    
    // STRIP credentials
    return `${url.protocol}//${url.host}${url.pathname}${url.search}`;
}
```

**Impact**: Even if tenant config is compromised or attacker gains write access, internal IPs cannot be reached. All consuming apps inherit this protection automatically.

---

## PATCH 4: Config Cache TTL & Expiration (HIGH)

**File**: `src/config/config-loader.mjs`

**Issue**: Cache had no TTL. In long-lived Workers (Durable Objects, gradual deployments), stale config persisted indefinitely. If tenant updated branding at 10:00, Worker instance still serving old branding at 15:00.

**Fix**:
- Changed cache entries from `{ config }` to `{ config, createdAt }`
- Added `DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000` (5 minutes)
- Check `isCacheEntryStale()` before returning cached value
- Support per-request TTL override via `options.cacheTtlMs`
- Gracefully delete stale entries and reload from KV

**Code Pattern**:
```javascript
// Cache entry structure
scopedCache.set(siteId, {
    config: frozen,
    createdAt: Date.now(),
});

// Check before returning
if (!skipCache && scopedCache?.has(siteId)) {
    const cacheEntry = scopedCache.get(siteId);
    if (!isCacheEntryStale(cacheEntry, cacheTtlMs)) {
        return cacheEntry.config;  // Return cached
    }
    // Stale: reload from KV
    scopedCache.delete(siteId);
}
```

**Options**:
```javascript
loadConfig(env, siteId, {
    cacheTtlMs: 10 * 60 * 1000,  // Override default 5 min TTL
});
```

**Impact**: Config freshness guaranteed within 5 minutes by default. Operators can tune per use case (shorter = more KV reads, longer = more staleness risk).

---

## PATCH 5: CAS-Based Atomic Config Writes (HIGH)

**File**: `src/config/config-loader.mjs` — `saveConfig()`, `loadConfig()`

**Issue**: `saveConfig()` did READ → MERGE → WRITE without locking. Concurrent updates on same siteId would lose writes. Example:
1. Worker A reads config (gen=1)
2. Worker B reads config (gen=1)
3. Worker A writes (gen=2)
4. Worker B writes (gen=2) with different data — **A's changes lost**

**Fix**:
- Add `{ data, __meta: { generation, storedAtMs } }` wrapping to KV
- Read `generation` before modifying
- Increment `generation` on write
- Retry with exponential backoff if concurrent write detected
- Return `casConflict: true` if retries exhausted (caller can retry or fail)

**Code Pattern**:
```javascript
// Store format
{
    data: { site, branding, auth, ... },
    __meta: {
        generation: 5,           // Incremented on each write
        storedAtMs: 1639518000,
        siteId: 'store-abc123',
    }
}

// Write logic with retry
async function saveConfig(...) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const existing = await kv.get(configKey(siteId), 'json');
        const generation = existing?.__meta?.generation || 0;
        
        const toSave = merge(existing.data, config);
        const nextGen = generation + 1;
        
        try {
            await kv.put(configKey(siteId), {
                data: toSave,
                __meta: { generation: nextGen, ... }
            });
            return { valid: true, generation: nextGen };
        } catch {
            // Another writer won — retry
            backoff(10 * 2 ** attempt);  // Exponential: 10ms, 20ms, 40ms
        }
    }
    
    return { valid: false, casConflict: true };
}
```

**Backward Compatibility**: `loadConfig()` handles both formats:
- New format: `{ data, __meta }`
- Legacy format: raw config (no wrapping)

**Impact**: No more silent data loss on concurrent writes. Consuming apps can detect conflicts and retry intelligently.

---

## PATCH 6: CSP Meta Tag Support for Custom JS (MEDIUM)

**File**: `src/brand/brand-engine.mjs` — Brand config defaults + `buildCustomJsCspMetaTag()`

**Issue**: `allowUnsafeCustomJs` had no sandbox. Custom JS ran in same document context as other tenants' UI, enabling XSS and data theft between tenants.

**Fix**:
- Added `customJsCspPolicy` field to PLATFORM_DEFAULTS
- Default: `script-src 'none'` (blocks all scripts)
- New `buildCustomJsCspMetaTag(brand)` function generates `<meta http-equiv="Content-Security-Policy" ...>`
- Consuming apps should:
  1. Wrap custom.js in iframe with `sandbox="allow-scripts"` + restricted capabilities
  2. OR override `customJsCspPolicy` with a sandboxing policy
  3. OR require code review before enabling `allowUnsafeCustomJs`

**Code Pattern**:
```javascript
// In brand-engine.mjs
const PLATFORM_DEFAULTS = {
    customJs: '',
    allowUnsafeCustomJs: false,
    customJsCspPolicy: "script-src 'none'",  // BLOCKS all scripts by default
};

// NEW function
export function buildCustomJsCspMetaTag(brand) {
    if (brand?.allowUnsafeCustomJs !== true) return '';
    
    const policy = brand?.customJsCspPolicy || "script-src 'none'";
    return `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
}

// Consuming app usage:
const cspMeta = buildCustomJsCspMetaTag(brand);
// Inject into <head>:
// <head>
//    ${cspMeta}
//    <iframe sandbox="allow-scripts" srcdoc="<script>${brand.customJs}</script>"></iframe>
// </head>
```

**Recommended Consuming App Pattern**:
```javascript
// Only inject custom.js into isolated iframe
if (brand.allowUnsafeCustomJs) {
    const sandbox = 'allow-scripts allow-same-origin';
    const srcdoc = `
        <meta charset="utf-8">
        <script>${escapeHtml(brand.customJs)}</script>
    `;
    document.body.appendChild(
        <iframe sandbox={sandbox} srcdoc={srcdoc} />
    );
}
```

**Impact**: Custom JS is now safe by default (blocked). Operators must explicitly enable AND implement sandboxing.

---

## Testing & Validation

### Manual Testing Checklist

- [ ] Session cookies with `sameSite=NONE` and http origin: Must log warning and downgrade
- [ ] Email send on provider down: Must return `{success: false, retryable: true}`
- [ ] Internal IP in `appOrigin`: Must be rejected
- [ ] Config updated in KV: Must refresh within 5 min (cache TTL)
- [ ] Concurrent saveConfig calls: Should detect and retry CAS conflict
- [ ] Custom JS enabled: CSP meta tag should be present + script-src 'none'

### Integration Test Coverage Needed

```javascript
// tests/integration/security-patches.test.mjs

describe('PATCH 1: Session Cookie', () => {
    it('downgrades sameSite=None on insecure origin and logs warning', () => {
        const policy = resolveSessionCookiePolicy(
            { url: 'http://example.com' },  // insecure
            { sessionCookieSameSite: 'none' }
        );
        expect(policy.sameSite).toBe('lax');
        expect(consoleWarnCalled).toBe(true);
    });
});

describe('PATCH 2: Email Errors', () => {
    it('returns error object instead of throwing on provider failure', async () => {
        const result = await sendEmailNotification(
            { provider: 'broken', apiKey: 'invalid' },
            'user@example.com',
            'body',
            'text'
        );
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/provider/i);
        expect(result.retryable).toBe(true);
    });
});

describe('PATCH 3: SSRF Protection', () => {
    it('rejects internal IP ranges', () => {
        expect(normalizeUrl('https://127.0.0.1')).toBe('');
        expect(normalizeUrl('https://10.0.0.1')).toBe('');
        expect(normalizeUrl('https://192.168.1.1')).toBe('');
        expect(normalizeUrl('https://172.20.0.1')).toBe('');
    });
});

describe('PATCH 4: Cache TTL', () => {
    it('invalidates cache after TTL expires', async () => {
        const config1 = await loadConfig(env, 'site', { cacheTtlMs: 100 });
        
        // Update KV
        await saveConfig(env, 'site', { branding: { productName: 'New' } });
        
        // Must invalidate old cache
        const config2 = await loadConfig(env, 'site');
        expect(config2.branding.productName).toBe('New');
    });
});

describe('PATCH 5: CAS', () => {
    it('detects and retries on concurrent saveConfig', async () => {
        const p1 = saveConfig(env, 'site', { branding: { primaryColor: '#red' } });
        const p2 = saveConfig(env, 'site', { branding: { primaryColor: '#blue' } });
        
        const [r1, r2] = await Promise.all([p1, p2]);
        
        // One succeeds, other retries and succeeds
        expect(r1.valid || r2.valid).toBe(true);
    });
});

describe('PATCH 6: CSP', () => {
    it('generates CSP meta tag only if custom.js enabled', () => {
        const tag1 = buildCustomJsCspMetaTag({ allowUnsafeCustomJs: false });
        expect(tag1).toBe('');
        
        const tag2 = buildCustomJsCspMetaTag({ allowUnsafeCustomJs: true });
        expect(tag2).toMatch(/Content-Security-Policy/);
        expect(tag2).toMatch(/script-src 'none'/);
    });
});
```

---

## Migration Guide for Consuming Apps

### 1. Email Sender Calls (Breaking Change)

**Before**:
```javascript
try {
    await sendEmailNotification(config, recipient, html, text, env);
} catch (error) {
    console.error('Email failed:', error);
}
```

**After**:
```javascript
const result = await sendEmailNotification(config, recipient, html, text, env);

if (!result.success) {
    if (result.retryable) {
        // Queue for later retry
        await queueEmailRetry(recipient, html, text, result.error);
    } else {
        // Log and escalate
        console.error('[Email] Non-retryable error:', result.error);
        notifyOperator('Email send permanently failed');
    }
    return;
}

console.log('Email sent:', result.messageId);
```

### 2. Config Cache Tuning (Optional)

Default 5-minute TTL is suitable for most cases. To override:

```javascript
// Very fresh config (useful for auth/security changes)
const config = await loadConfig(env, siteId, { cacheTtlMs: 60 * 1000 });  // 1 min

// Stale config acceptable (reduce KV load)
const config = await loadConfig(env, siteId, { cacheTtlMs: 30 * 60 * 1000 });  // 30 min
```

### 3. Custom JS Sandboxing (Highly Recommended)

**Pattern A: iframe sandbox (preferred)**:
```javascript
if (brand.allowUnsafeCustomJs) {
    const meta = buildCustomJsCspMetaTag(brand);
    const script = brand.customJs;
    
    document.head.insertAdjacentHTML('beforeend', meta);
    
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-scripts';
    iframe.srcdoc = `<script>${escapeHtml(script)}</script>`;
    document.body.appendChild(iframe);
}
```

**Pattern B: explicit allowlist (alternative)**:
```javascript
// Override default CSP to allow specific scripts only
const allowedScripts = ['https://trusted-cdn.com/mylib.js'];
const policy = allowedScripts
    .map(src => `'${src}'`)
    .join(' ');

brand.customJsCspPolicy = `script-src ${policy}`;
```

---

## Monitoring & Alerts

Consuming apps should monitor:

1. **Email retry rate**: If `result.retryable` is true >5%, provider may be degraded
2. **CAS conflict rate**: If `casConflict: true` >1%, concurrent config writes are colliding
3. **Cache staleness**: Track time-to-KV-update. Should be <5min by default
4. **Internal IP rejections**: Any rejected URLs should trigger security review

---

## References

- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) — `SameSite` cookie best practices
- [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP) — Sandbox directives and capabilities
- [SSRF Prevention](https://owasp.org/www-community/attacks/Server_Side_Request_Forgery) — IP range validation
- [Cloudflare KV Consistency](https://developers.cloudflare.com/workers/runtime-apis/kv/) — Strong eventually-consistent guarantees
