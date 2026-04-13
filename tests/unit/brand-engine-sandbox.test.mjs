import { describe, expect, it } from 'vitest'

import {
  CUSTOM_JS_SANDBOX_CAPABILITY_ALLOWLIST,
  buildCustomJsSandboxIframeDescriptor,
  renderCustomJsSandboxIframe,
  resolveCustomJsSandboxCapabilities,
} from '../../src/brand/brand-engine.mjs'

describe('brand-engine sandbox helpers', () => {
  it('filters sandbox capabilities using allowlist', () => {
    const capabilities = resolveCustomJsSandboxCapabilities(
      {
        allowUnsafeCustomJs: true,
        customJs: 'console.log("safe")',
        customJsSandboxCapabilities: ['allow-scripts', 'allow-popups', 'not-real-capability'],
      },
      null
    )

    expect(capabilities).toContain('allow-scripts')
    expect(capabilities).toContain('allow-popups')
    expect(capabilities).not.toContain('not-real-capability')
  })

  it('falls back to default capability when all provided values are invalid', () => {
    const capabilities = resolveCustomJsSandboxCapabilities(
      {
        allowUnsafeCustomJs: true,
        customJs: 'console.log("safe")',
        customJsSandboxCapabilities: ['invalid-cap'],
      },
      null
    )

    expect(capabilities).toEqual(['allow-scripts'])
  })

  it('returns null descriptor when custom JS is disabled', () => {
    const descriptor = buildCustomJsSandboxIframeDescriptor({
      allowUnsafeCustomJs: false,
      customJs: 'console.log("safe")',
    })

    expect(descriptor).toBeNull()
  })

  it('returns null descriptor when custom JS is blocked by policy', () => {
    const descriptor = buildCustomJsSandboxIframeDescriptor({
      allowUnsafeCustomJs: true,
      customJs: 'eval("alert(1)")',
      customJsSandboxCapabilities: ['allow-scripts'],
    })

    expect(descriptor).toBeNull()
  })

  it('renders iframe HTML for safe custom JS', () => {
    const html = renderCustomJsSandboxIframe(
      {
        productName: 'Acme',
        allowUnsafeCustomJs: true,
        customJs: 'console.log("hello")',
        customJsSandboxCapabilities: ['allow-scripts', 'allow-popups'],
      },
      { className: 'tenant-js-sandbox' }
    )

    expect(html).toContain('<iframe')
    expect(html).toContain('sandbox="allow-scripts allow-popups"')
    expect(html).toContain('class="tenant-js-sandbox"')
    expect(html).toContain('srcdoc=')
    expect(CUSTOM_JS_SANDBOX_CAPABILITY_ALLOWLIST).toContain('allow-scripts')
  })
})
