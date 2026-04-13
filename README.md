# @internal/cloudflare-wl-platform

A **Cloudflare Workers-specific shared library** that extracts the multi-tenant, white-label, and email infrastructure from the visibility-analytics application into a reusable, independently-versioned package.

**This is not a framework.** It is a collection of well-defined, narrow modules that any Cloudflare Workers application can consume without taking on routing, middleware, or lifecycle opinions.

---

## What this package provides

| Import path | Module | Description |
|---|---|---|
| `@internal/cloudflare-wl-platform` | `src/index.mjs` | Barrel re-export of the full public surface |
| `@internal/cloudflare-wl-platform/tenancy` | `src/tenancy/tenant-context.mjs` | `TenantContext` — resolves tenant from request, loads config, exposes `getBrand()` and `getSiteUrl()` |
| `@internal/cloudflare-wl-platform/domain` | `src/tenancy/domain-control.mjs` | `DomainRoutingService`, `DomainBrandingService` — per-tenant hostname routing and brand overrides |
| `@internal/cloudflare-wl-platform/brand` | `src/brand/brand-engine.mjs` | `resolveBrand(env, tenant)` — merges platform defaults with tenant config to produce a complete brand descriptor |
| `@internal/cloudflare-wl-platform/email` | `src/email/email-sender.mjs` | `sendEmailNotification`, `resolveSenderIdentity` — provider-agnostic email dispatch with per-tenant FROM identity |
| `@internal/cloudflare-wl-platform/billing` | `src/billing/billing-adapter.mjs` | `createBillingAdapter(tenant, env)` — wraps Stripe / custom billing backends behind a uniform interface |
| `@internal/cloudflare-wl-platform/config` | `src/config/config-loader.mjs` | `loadConfig`, `saveConfig`, `scheduleAuditRevision` — KV-backed tenant configuration persistence |
| `@internal/cloudflare-wl-platform/guards` | `src/guards/brand-scatter-guard.mjs` | `brandScatterGuardPlugin` — Vitest plugin that fails tests if platform brand strings leak into tenant-scoped output |

---

## Installation

### Local development (before publishing)

In the consuming application's `package.json`:

```json
{
  "dependencies": {
    "@internal/cloudflare-wl-platform": "file:../cloudflare-wl-platform"
  }
}
```

Then run `npm install` in the consuming application root.

### Production (package registry)

Once published to your private registry:

```json
{
  "dependencies": {
    "@internal/cloudflare-wl-platform": "^0.1.0"
  }
}
```

---

## Sender Identity Resolution — 4-Level Priority Chain

`resolveSenderIdentity(tenant, env)` is the canonical function for determining who an outbound email comes from. It applies the following priority chain, using the first level at which a non-empty `fromAddress` is found:

**Level 1 — Tenant `emailSender` config (highest priority)**
Read from `tenant.config.emailSender.fromAddress`. If set, the full `fromName`, `fromAddress`, `replyToAddress`, and `subjectPrefix` are taken from this object. This is the per-tenant override stored in KV config and edited through the white-label admin panel.

```js
// Produces: { fromName, fromAddress, replyTo, subjectPrefix }
const es = tenant?.config?.emailSender
if (es?.fromAddress) { /* use es */ }
```

**Level 2 — Tenant brand name + platform address**
If `tenant.getBrand().productName` is set but `emailSender.fromAddress` is empty, the sender display name is taken from the brand, and the address falls through to the platform env var. Useful for tenants that set a brand name but have not yet configured a dedicated sending domain.

```js
const productName = tenant?.getBrand?.()?.productName
const platformAddress = env?.EMAIL_FROM_ADDRESS || env?.EMAIL_FROM || ''
if (productName && platformAddress) { /* use productName + platformAddress */ }
```

**Level 3 — Platform env vars**
If both `EMAIL_FROM_NAME` and `EMAIL_FROM_ADDRESS` (or `EMAIL_FROM`) are set as Worker env bindings, they are used as the sender identity. No tenant override applies at this level.

```js
if (env?.EMAIL_FROM_NAME && platformAddress) { /* use env name + address */ }
```

**Level 4 — Hard fallback (lowest priority)**
`fromName: 'Notifications'`, `fromAddress: env.EMAIL_FROM_ADDRESS || 'noreply@localhost'`. Never used in production if env vars are configured correctly.

---

## Brand Scatter Guard

`brandScatterGuardPlugin` is a Vitest plugin that intercepts test assertions and fails any test where a platform-level brand string (e.g. the platform `APP_NAME`) appears in output that should be tenant-scoped. Wire it into a consuming application's `vitest.config.mjs`:

```js
// vitest.config.mjs (consuming application)
import { defineConfig } from 'vitest/config'
import { brandScatterGuardPlugin } from '@internal/cloudflare-wl-platform/guards'

export default defineConfig({
  plugins: [brandScatterGuardPlugin({ platformAppName: process.env.APP_NAME })],
  test: { /* ... */ },
})
```

The plugin reads `options.platformAppName` and registers a `expect.extend` matcher that checks branded string output. Tests that violate brand isolation fail with a clear message indicating which tenant context received platform branding.

---

## Security & Operational Notes

**⚠️ CRITICAL**: This library was hardened against concurrency, SSRF, XSS, and session hijacking attacks. See [SECURITY.md](SECURITY.md) for detailed patch documentation and migration guidance for consuming applications.

### Key Security Features

#### 1. Session Cookie Policy (CRITICAL)
- `sameSite=NONE` cookies now **require** HTTPS origins
- Silent downgrade to `LAX` on insecure origins is logged as a warning
- **Migration**: Verify all OAuth/SAML origins are HTTPS

#### 2. Email Error Handling (HIGH)
- `sendEmailNotification()` returns `{ success, error, retryable }` instead of throwing
- Supports optional circuit breaker for provider outages
- **Migration**: Wrap calls in error handler; queue retryable failures

#### 3. Config Cache Consistency (HIGH)
- Config cache automatically expires every 5 minutes (default)
- Stale entries are detected and invalidated
- Compatible with long-lived Workers (Durable Objects, gradual deployments)
- **Override**: Pass `cacheTtlMs` to `loadConfig()` for custom TTL

#### 4. Atomic Config Writes (HIGH)
- Concurrent `saveConfig()` calls use compare-and-set semantics
- Detects write conflicts and retries with exponential backoff
- Returns `casConflict: true` if all retries exhausted
- **No breaking change**: Existing apps work unchanged

#### 5. SSRF Protection (MEDIUM)
- `normalizeUrl()` rejects internal IP ranges (127.x, 10.x, 192.168.x, ::1, etc.)
- Also strips embedded credentials from URLs
- Applied to all domain control URLs (`appOrigin`, `docsUrl`, etc.)

#### 6. Custom JS Sandboxing (MEDIUM)
- New `buildCustomJsCspMetaTag()` generates CSP meta tag
- Custom JS is **blocked by default** (CSP: `script-src 'none'`)
- Consuming apps must implement sandboxing (iframe) to enable
- **Recommendation**: Wrap in `<iframe sandbox="allow-scripts">`

### Config Cache Behavior

Loaded configs are cached in-memory per Worker isolate for 5 minutes by default.

```javascript
// Load with default 5-minute TTL
const config = await loadConfig(env, siteId);

// Load with custom TTL (e.g., very fresh for auth changes)
const config = await loadConfig(env, siteId, { 
    cacheTtlMs: 1 * 60 * 1000  // 1 minute
});

// Force fresh from KV (skip cache)
const config = await loadConfig(env, siteId, { skipCache: true });

// Manually invalidate cache (e.g., after admin updates)
clearConfigCache(env, siteId);  // Clear one siteId
clearConfigCache(env);          // Clear entire scope
```

**Implications**:
- Config changes are visible within 5 minutes by default
- In gradual deployments, multiple Worker instances may serve different config versions for up to 5 minutes
- For time-sensitive changes (auth, security rules), reduce TTL or skip cache

---

## Compatibility

- **Runtime**: Cloudflare Workers only. This package uses `fetch`, `FormData`, `Response`, `crypto.randomUUID`, and KV/DO binding APIs that are only available in the Workers runtime or Miniflare.
- **Module format**: ESM only (`"type": "module"`). CommonJS consumers are not supported.
- **Node version**: >=18 for local tooling (Vitest, Wrangler CLI). Not intended to run in Node directly.
- **Vitest**: Must use the same `vitest` version (`^4.0.18`) as the consuming application to avoid dual-vitest module graph issues.
