import { describe, expect, it } from 'vitest'

import {
  consumeTenantRateLimit,
  createTenantQuotaStore,
  evaluateTenantUsageAgainstPolicy,
  resolveTenantQuotaPolicy,
} from '../../src/tenancy/tenant-quota.mjs'

describe('tenant-quota', () => {
  it('resolves effective policy with tenant overrides', () => {
    const policy = resolveTenantQuotaPolicy({
      quotas: {
        apiRequestsPerMinute: 120,
        monthlyAiCalls: 5000,
      },
    })

    expect(policy.rateLimits.apiRequestsPerMinute).toBe(120)
    expect(policy.rateLimits.oauthRequestsPerMinute).toBe(30)
    expect(policy.monthlyCaps.monthlyAiCalls).toBe(5000)
  })

  it('blocks requests after limit is exceeded within a window', () => {
    const store = createTenantQuotaStore()

    const first = consumeTenantRateLimit({
      siteId: 'tenant-a',
      bucket: 'apiRequestsPerMinute',
      limit: 2,
      windowMs: 60_000,
      nowMs: 1700000000000,
      store,
    })
    const second = consumeTenantRateLimit({
      siteId: 'tenant-a',
      bucket: 'apiRequestsPerMinute',
      limit: 2,
      windowMs: 60_000,
      nowMs: 1700000000010,
      store,
    })
    const third = consumeTenantRateLimit({
      siteId: 'tenant-a',
      bucket: 'apiRequestsPerMinute',
      limit: 2,
      windowMs: 60_000,
      nowMs: 1700000000020,
      store,
    })

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
    expect(third.allowed).toBe(false)
    expect(third.retryAfterMs).toBeGreaterThan(0)
  })

  it('evaluates monthly usage cap exceedance', () => {
    const policy = resolveTenantQuotaPolicy({
      quotas: {
        monthlyAiCalls: 100,
        monthlyTokens: 0,
      },
    })

    const usage = evaluateTenantUsageAgainstPolicy(
      {
        monthlyAiCalls: 101,
        monthlyTokens: 500000,
      },
      policy
    )

    expect(usage.exceeded).toBe(true)
    expect(usage.monthly.monthlyAiCalls.exceeded).toBe(true)
    expect(usage.monthly.monthlyTokens.unlimited).toBe(true)
  })
})
