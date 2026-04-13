import { describe, expect, it } from 'vitest'

import {
  DOMAIN_CONTROL_STATUS,
  EMAIL_AUTH_STATUS,
  DomainBrandingService,
  normalizeUrl,
  resolveDomainControl,
  resolveDomainControlFromConfig,
} from '../../src/tenancy/domain-control.mjs'

describe('domain-control', () => {
  it('rejects internal/private URL targets', () => {
    expect(normalizeUrl('https://127.0.0.1:8080/admin')).toBe('')
    expect(normalizeUrl('https://10.20.30.40/path')).toBe('')
    expect(normalizeUrl('https://localhost.localdomain/')).toBe('')
  })

  it('sanitizes domain branding URLs when resolving domain control', () => {
    const resolved = resolveDomainControl({
      appHostname: 'app.clientbrand.com',
      appOrigin: 'https://app.clientbrand.com',
      docsUrl: 'https://help.clientbrand.com',
      statusPageUrl: 'javascript:alert(1)',
      incidentReportingUrl: 'https://status.clientbrand.com/incidents',
      onboardingUrl: 'https://app.clientbrand.com/onboarding',
      domainStatus: DOMAIN_CONTROL_STATUS.ACTIVE,
      sslStatus: DOMAIN_CONTROL_STATUS.ACTIVE,
    })

    expect(resolved.statusPageUrl).toBe('')
    expect(resolved.incidentReportingUrl).toBe('https://status.clientbrand.com/incidents')
    expect(resolved.onboardingUrl).toBe('https://app.clientbrand.com/onboarding')
  })

  it('merges split domainRouting/domainBranding over legacy domainControl', () => {
    const resolved = resolveDomainControlFromConfig({
      domainControl: {
        appHostname: 'legacy.example.com',
        appOrigin: 'https://legacy.example.com',
        docsUrl: 'https://legacy-help.example.com',
        sendingDomain: 'legacy-mail.example.com',
        emailAuthStatus: EMAIL_AUTH_STATUS.PENDING_DNS,
      },
      domainRouting: {
        appHostname: 'app.clientbrand.com',
        appOrigin: 'https://app.clientbrand.com',
        domainStatus: DOMAIN_CONTROL_STATUS.ACTIVE,
        sslStatus: DOMAIN_CONTROL_STATUS.ACTIVE,
      },
      domainBranding: {
        docsUrl: 'https://help.clientbrand.com',
        supportPortalUrl: 'https://support.clientbrand.com',
        sendingDomain: 'mail.clientbrand.com',
        emailAuthStatus: EMAIL_AUTH_STATUS.ACTIVE,
      },
    })

    expect(resolved.appHostname).toBe('app.clientbrand.com')
    expect(resolved.appOrigin).toBe('https://app.clientbrand.com')
    expect(resolved.docsUrl).toBe('https://help.clientbrand.com')
    expect(resolved.supportPortalUrl).toBe('https://support.clientbrand.com')
    expect(resolved.sendingDomain).toBe('mail.clientbrand.com')
    expect(resolved.emailAuthStatus).toBe(EMAIL_AUTH_STATUS.ACTIVE)
  })

  it('marks branded email readiness only when domain and auth are active', () => {
    expect(
      DomainBrandingService.isBrandedEmailReady({
        sendingDomain: 'mail.clientbrand.com',
        emailAuthStatus: EMAIL_AUTH_STATUS.ACTIVE,
      })
    ).toBe(true)

    expect(
      DomainBrandingService.isBrandedEmailReady({
        sendingDomain: 'mail.clientbrand.com',
        emailAuthStatus: EMAIL_AUTH_STATUS.PENDING_DNS,
      })
    ).toBe(false)
  })
})
