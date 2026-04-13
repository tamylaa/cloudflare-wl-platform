import { describe, it, expect } from 'vitest'

// Scaffold smoke test — Phase 7
// Verifies that every placeholder module in the scaffold is present and
// exports __placeholder === true before Phase 8 begins populating them.

describe('cloudflare-wl-platform scaffold — Phase 7 placeholder check', () => {
    it('src/tenancy/tenant-context.mjs is present', async () => {
        const { TenantContext, resolveTenantContext, resolveTenantContextForSite, listAllTenants, getDeployMode } = await import('../../src/tenancy/tenant-context.mjs')
        expect(typeof TenantContext, 'tenant-context.mjs must export TenantContext').toBe('function')
        expect(typeof resolveTenantContext, 'tenant-context.mjs must export resolveTenantContext').toBe('function')
        expect(typeof resolveTenantContextForSite, 'tenant-context.mjs must export resolveTenantContextForSite').toBe('function')
        expect(typeof listAllTenants, 'tenant-context.mjs must export listAllTenants').toBe('function')
        expect(typeof getDeployMode, 'tenant-context.mjs must export getDeployMode').toBe('function')
    })

    it('src/tenancy/domain-control.mjs is present', async () => {
        const { DOMAIN_CONTROL_STATUS, normalizeHostname, resolveDomainControl } = await import('../../src/tenancy/domain-control.mjs')
        expect(typeof DOMAIN_CONTROL_STATUS, 'domain-control.mjs must export DOMAIN_CONTROL_STATUS').toBe('object')
        expect(typeof normalizeHostname, 'domain-control.mjs must export normalizeHostname').toBe('function')
        expect(typeof resolveDomainControl, 'domain-control.mjs must export resolveDomainControl').toBe('function')
    })

    it('src/brand/brand-engine.mjs is present', async () => {
        const { resolveBrand, PLATFORM_DEFAULTS, brandCSSOverrides } = await import('../../src/brand/brand-engine.mjs')
        expect(typeof resolveBrand, 'brand-engine.mjs must export resolveBrand').toBe('function')
        expect(typeof PLATFORM_DEFAULTS, 'brand-engine.mjs must export PLATFORM_DEFAULTS').toBe('object')
        expect(typeof brandCSSOverrides, 'brand-engine.mjs must export brandCSSOverrides').toBe('function')
    })

    it('src/email/email-sender.mjs is present', async () => {
        const { sendEmailNotification, resolveSenderIdentity } = await import('../../src/email/email-sender.mjs')
        expect(typeof sendEmailNotification, 'email-sender.mjs must export sendEmailNotification').toBe('function')
    })

    it('src/billing/billing-adapter.mjs is present', async () => {
        const { createBillingAdapter } = await import('../../src/billing/billing-adapter.mjs')
        expect(typeof createBillingAdapter, 'billing-adapter.mjs must export createBillingAdapter').toBe('function')
    })

    it('src/config/config-loader.mjs is present', async () => {
        const { loadConfig, saveConfig, loadConfigFromEnv, configKey, clearConfigCache } = await import('../../src/config/config-loader.mjs')
        expect(typeof loadConfig, 'config-loader.mjs must export loadConfig').toBe('function')
        expect(typeof saveConfig, 'config-loader.mjs must export saveConfig').toBe('function')
        expect(typeof loadConfigFromEnv, 'config-loader.mjs must export loadConfigFromEnv').toBe('function')
        expect(typeof configKey, 'config-loader.mjs must export configKey').toBe('function')
        expect(typeof clearConfigCache, 'config-loader.mjs must export clearConfigCache').toBe('function')
    })

    it('src/index.mjs exports branding security policy helpers', async () => {
        const { enforceBrandingSecurityPolicy, BRANDING_ASSET_FIELD_POLICY } = await import('../../src/index.mjs')
        expect(typeof enforceBrandingSecurityPolicy, 'index.mjs must export enforceBrandingSecurityPolicy').toBe('function')
        expect(typeof BRANDING_ASSET_FIELD_POLICY, 'index.mjs must export BRANDING_ASSET_FIELD_POLICY').toBe('object')
    })

    it('src/config/branding-security-policy.mjs is importable and callable', async () => {
        const { enforceBrandingSecurityPolicy } = await import('../../src/config/branding-security-policy.mjs')
        expect(typeof enforceBrandingSecurityPolicy, 'branding-security-policy.mjs must export enforceBrandingSecurityPolicy').toBe('function')

        const result = enforceBrandingSecurityPolicy({}, { mode: 'config' })
        expect(result.valid).toBe(true)
        expect(Array.isArray(result.errors)).toBe(true)
        expect(Array.isArray(result.warnings)).toBe(true)
    })

    it('src/guards/brand-scatter-guard.mjs is present', async () => {
        const { brandScatterGuardPlugin } = await import('../../src/guards/brand-scatter-guard.mjs')
        expect(typeof brandScatterGuardPlugin, 'brand-scatter-guard.mjs must export brandScatterGuardPlugin').toBe('function')
        const plugin = brandScatterGuardPlugin({ platformAppName: 'TestApp' })
        expect(plugin.name).toBe('brand-scatter-guard')
    })
})
