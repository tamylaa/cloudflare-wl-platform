import { describe, it, expect } from 'vitest'

import {
  BRANDING_ASSET_FIELD_POLICY,
  BRANDING_CUSTOM_CODE_LIMITS,
  enforceBrandingSecurityPolicy,
} from '../../src/config/branding-security-policy.mjs'

describe('branding-security-policy', () => {
  it('accepts safe SVG logo data URI in save mode', () => {
    const safeSvg =
      'data:image/svg+xml,' +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24"/></svg>')

    const result = enforceBrandingSecurityPolicy({ logoUrl: safeSvg }, { mode: 'save' })

    expect(result.errors).toHaveLength(0)
  })

  it('rejects active-content SVG logo in save mode', () => {
    const activeSvg =
      'data:image/svg+xml,' +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

    const result = enforceBrandingSecurityPolicy({ logoUrl: activeSvg }, { mode: 'save' })

    expect(result.errors.some((finding) => finding.field === 'logoUrl')).toBe(true)
  })

  it('downgrades blocking customJs findings to warnings in config mode', () => {
    const result = enforceBrandingSecurityPolicy(
      {
        customJs: 'eval("1 + 1")',
        allowUnsafeCustomJs: true,
      },
      { mode: 'config' }
    )

    expect(result.errors).toHaveLength(0)
    expect(result.warnings.some((finding) => finding.field === 'customJs')).toBe(true)
  })

  it('emits watermark warnings when markers are detected', () => {
    const result = enforceBrandingSecurityPolicy(
      {
        logoUrl: 'https://cdn.example.com/assets/logo-powered-by-canva.png',
      },
      { mode: 'save' }
    )

    expect(result.warnings.some((finding) => finding.field === 'logoUrl')).toBe(true)
  })

  it('exports asset and custom-code policy constants', () => {
    expect(typeof BRANDING_ASSET_FIELD_POLICY.logoUrl.maxDataUriBytes).toBe('number')
    expect(typeof BRANDING_CUSTOM_CODE_LIMITS.customJsMaxChars).toBe('number')
  })
})
