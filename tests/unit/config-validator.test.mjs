import { describe, expect, it } from 'vitest'

import { mergeWithDefaults } from '../../src/config/customer-config.schema.mjs'
import { validateConfig } from '../../src/config/config-validator.mjs'

function buildBaseConfig(overrides = {}) {
  return mergeWithDefaults({
    site: {
      id: 'tenant-a',
      domain: 'example.com',
      siteUrl: 'https://example.com',
      name: 'Example',
    },
    ...overrides,
  })
}

describe('config-validator domain and branding security checks', () => {
  it('warns on invalid domainRouting and domainBranding URLs', () => {
    const config = buildBaseConfig({
      domainRouting: {
        appOrigin: 'app.clientbrand.com',
      },
      domainBranding: {
        docsUrl: 'ftp://help.clientbrand.com',
      },
    })

    const result = validateConfig(config)

    expect(result.warnings.some((item) => item.field === 'domainRouting.appOrigin')).toBe(true)
    expect(result.warnings.some((item) => item.field === 'domainBranding.docsUrl')).toBe(true)
  })

  it('errors on invalid split domain status enums', () => {
    const config = buildBaseConfig({
      domainRouting: {
        domainStatus: 'totally_custom_state',
      },
      domainBranding: {
        emailAuthStatus: 'not_a_real_status',
      },
    })

    const result = validateConfig(config)

    expect(result.errors.some((item) => item.field === 'domainRouting.domainStatus')).toBe(true)
    expect(result.errors.some((item) => item.field === 'domainBranding.emailAuthStatus')).toBe(true)
  })

  it('warns on invalid customJsSandboxCapabilities shape', () => {
    const config = buildBaseConfig({
      branding: {
        customJsSandboxCapabilities: 'allow-scripts',
      },
    })

    const result = validateConfig(config)

    expect(result.warnings.some((item) => item.field === 'branding.customJsSandboxCapabilities')).toBe(true)
  })

  it('surfaces shared branding policy warnings through validator', () => {
    const config = buildBaseConfig({
      branding: {
        customJs: 'eval("1+1")',
        allowUnsafeCustomJs: true,
      },
    })

    const result = validateConfig(config)

    expect(result.warnings.some((item) => item.field === 'branding.customJs')).toBe(true)
  })

  it('warns when per-tenant noisy-neighbour rate limits are not configured', () => {
    const config = buildBaseConfig({
      quotas: {
        apiRequestsPerMinute: 0,
        oauthRequestsPerMinute: 0,
        billingRequestsPerMinute: 0,
        triggerRequestsPerMinute: 0,
        auditRequestsPerHour: 0,
      },
    })

    const result = validateConfig(config)

    expect(result.warnings.some((item) => item.field === 'quotas')).toBe(true)
  })

  it('errors on invalid operations and residency enums', () => {
    const config = buildBaseConfig({
      operations: {
        environment: 'staging-like',
      },
      compliance: {
        dataResidencyRegion: 'moon',
      },
    })

    const result = validateConfig(config)

    expect(result.errors.some((item) => item.field === 'operations.environment')).toBe(true)
    expect(result.errors.some((item) => item.field === 'compliance.dataResidencyRegion')).toBe(true)
  })
})
