/**
 * Partner Ops & Support — white-label unit tests
 *
 * Q1  buildAdminPortalDescriptor      — partner admin portal identity + vendor-leak
 * Q2  buildSupportExperienceDescriptor — help centre, tickets, status page
 * Q3  resolveSandboxEnvironmentDescriptor — sandbox isolation + assertNotSandboxConfig
 * Q4  resolveSlaPolicyDescriptor      — SLA tier, uptime, incident page
 *     buildIncidentReportDescriptor   — vendor-neutral incident copy
 * Q5  buildPartnerDocsDescriptor      — docs identity + mode
 *     assertPartnerOpsWhiteLabel      — full audit pass/fail
 */

import { describe, it, expect } from 'vitest';
import {
  buildAdminPortalDescriptor,
  buildSupportExperienceDescriptor,
  resolveSandboxEnvironmentDescriptor,
  assertNotSandboxConfig,
  resolveSlaPolicyDescriptor,
  buildIncidentReportDescriptor,
  buildPartnerDocsDescriptor,
  assertPartnerOpsWhiteLabel,
  PARTNER_ENV,
  PARTNER_DOCS_MODE,
  SLA_TIER,
  SUPPORT_SYSTEM,
} from '../../src/config/partner-ops.mjs';

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeConfig(overrides = {}) {
  return {
    branding: { productName: 'AcmeSEO', primaryColor: '#3B5BDB', ...overrides.branding },
    domainRouting: { appOrigin: 'https://app.acme.com', appHostname: 'app.acme.com', ...overrides.domainRouting },
    domainBranding: { helpCenterUrl: '', supportPortalUrl: '', ...overrides.domainBranding },
    tenantIsolation: { organizationId: 'org-acme', ...overrides.tenantIsolation },
    billing: { reseller: { mode: 'reseller', ...overrides.billingReseller } },
    quotas: {},
    compliance: { auditLogExportEnabled: false, ...overrides.compliance },
    operations: { ...overrides.operations },
    partnerOps: {
      adminPortalEnabled: false,
      adminPortalUrl: '',
      adminPortalProductName: '',
      helpCenterUrl: '',
      ticketSystemUrl: '',
      statusPageUrl: '',
      supportEmail: '',
      supportBrand: '',
      ticketSystem: SUPPORT_SYSTEM.DISABLED,
      environment: PARTNER_ENV.PRODUCTION,
      sandboxEnabled: false,
      sandboxUrl: '',
      sandboxDataIsolated: true,
      featureFlagsEnabled: false,
      slaTier: SLA_TIER.NONE,
      slaUptimePct: 0,
      slaResponseTimeMs: 0,
      maintenanceWindowCron: '',
      incidentPageUrl: '',
      alertEmail: '',
      partnerDocsMode: PARTNER_DOCS_MODE.DISABLED,
      partnerDocsUrl: '',
      partnerDocsProductName: '',
      docsHasOnboarding: true,
      docsHasBrandingSetup: true,
      docsHasTenantManagement: true,
      docsHasApiIntegration: true,
      notes: '',
      ...overrides.partnerOps,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Q1 — Partner Admin Portal
// ─────────────────────────────────────────────────────────────────────────────

describe('buildAdminPortalDescriptor — Q1', () => {
  it('returns not-enabled when adminPortalEnabled is false', () => {
    const desc = buildAdminPortalDescriptor(makeConfig());
    expect(desc.enabled).toBe(false);
    expect(desc.ready).toBe(false);
  });

  it('returns ready descriptor when fully configured', () => {
    const config = makeConfig({
      partnerOps: {
        adminPortalEnabled: true,
        adminPortalUrl: 'https://admin.acme.com',
        adminPortalProductName: 'Acme Partner Hub',
      },
    });
    const desc = buildAdminPortalDescriptor(config);
    expect(desc.enabled).toBe(true);
    expect(desc.portalUrl).toBe('https://admin.acme.com');
    expect(desc.productName).toBe('Acme Partner Hub');
    expect(desc.ready).toBe(true);
    expect(desc.vendorLeak).toBe(false);
  });

  it('falls back to branding.productName when adminPortalProductName is empty', () => {
    const config = makeConfig({
      partnerOps: { adminPortalEnabled: true, adminPortalUrl: 'https://admin.acme.com', adminPortalProductName: '' },
    });
    const desc = buildAdminPortalDescriptor(config);
    expect(desc.productName).toBe('AcmeSEO');
  });

  it('flags vendorLeak for workers.dev portal URL', () => {
    const config = makeConfig({
      partnerOps: {
        adminPortalEnabled: true,
        adminPortalUrl: 'https://admin.my-platform.workers.dev',
        adminPortalProductName: 'Acme Hub',
      },
    });
    const desc = buildAdminPortalDescriptor(config);
    expect(desc.vendorLeak).toBe(true);
    expect(desc.ready).toBe(false);
    expect(desc.vendorLeakReason).toMatch(/vendor-platform domain/);
  });

  it('includes capabilities from branding and billing configuration', () => {
    const config = makeConfig({
      partnerOps: { adminPortalEnabled: true, adminPortalUrl: 'https://admin.acme.com', adminPortalProductName: 'Acme Hub' },
    });
    const desc = buildAdminPortalDescriptor(config);
    expect(desc.capabilities).toContain('tenant_management');
    expect(desc.capabilities).toContain('billing_management');
    expect(desc.capabilities).toContain('branding_configuration');
    expect(desc.capabilities).toContain('usage_dashboard');
  });

  it('flags vendorLeak for vendor brand term in product name', () => {
    const config = makeConfig({
      partnerOps: {
        adminPortalEnabled: true,
        adminPortalUrl: 'https://admin.acme.com',
        adminPortalProductName: 'Powered by Cloudflare Admin',
      },
    });
    const desc = buildAdminPortalDescriptor(config);
    expect(desc.vendorLeak).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Q2 — White-label Support Experience
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSupportExperienceDescriptor — Q2', () => {
  it('returns empty descriptor when nothing configured', () => {
    const desc = buildSupportExperienceDescriptor(makeConfig());
    expect(desc.helpCenterUrl).toBe('');
    expect(desc.statusPageUrl).toBe('');
    expect(desc.fullyWhiteLabeled).toBe(false);
    expect(desc.vendorLeaks).toHaveLength(0);
  });

  it('returns fullyWhiteLabeled=true when all surfaces configured and clean', () => {
    const config = makeConfig({
      partnerOps: {
        helpCenterUrl: 'https://help.acme.com',
        ticketSystemUrl: 'https://support.acme.com',
        statusPageUrl: 'https://status.acme.com',
        supportBrand: 'Acme Support Team',
        ticketSystem: SUPPORT_SYSTEM.CUSTOM_PORTAL,
      },
    });
    const desc = buildSupportExperienceDescriptor(config);
    expect(desc.fullyWhiteLabeled).toBe(true);
    expect(desc.vendorLeaks).toHaveLength(0);
    expect(desc.helpCenterUrl).toBe('https://help.acme.com');
    expect(desc.supportBrand).toBe('Acme Support Team');
    expect(desc.ticketSystem).toBe(SUPPORT_SYSTEM.CUSTOM_PORTAL);
  });

  it('flags vendorLeak for statuspage.io status URL', () => {
    const config = makeConfig({
      partnerOps: {
        helpCenterUrl: 'https://help.acme.com',
        statusPageUrl: 'https://acmeseo.statuspage.io',
        supportBrand: 'Acme Support',
      },
    });
    const desc = buildSupportExperienceDescriptor(config);
    expect(desc.vendorLeaks.some((l) => l.field === 'partnerOps.statusPageUrl')).toBe(true);
    expect(desc.fullyWhiteLabeled).toBe(false);
  });

  it('flags vendorLeak for zendesk.com ticket URL', () => {
    const config = makeConfig({
      partnerOps: {
        ticketSystemUrl: 'https://acme.zendesk.com/tickets',
        supportBrand: 'Acme Support',
      },
    });
    const desc = buildSupportExperienceDescriptor(config);
    expect(desc.vendorLeaks.some((l) => l.field === 'partnerOps.ticketSystemUrl')).toBe(true);
  });

  it('flags vendorLeak for vendor brand term in supportBrand', () => {
    const config = makeConfig({
      partnerOps: {
        helpCenterUrl: 'https://help.acme.com',
        statusPageUrl: 'https://status.acme.com',
        supportBrand: 'Cloudflare Support',
      },
    });
    const desc = buildSupportExperienceDescriptor(config);
    expect(desc.vendorLeaks.some((l) => l.field === 'partnerOps.supportBrand')).toBe(true);
  });

  it('falls back to branding.productName when supportBrand is empty', () => {
    const config = makeConfig({ partnerOps: { supportBrand: '' } });
    const desc = buildSupportExperienceDescriptor(config);
    expect(desc.supportBrand).toBe('AcmeSEO');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Q3 — Sandbox / Staging Environment
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveSandboxEnvironmentDescriptor — Q3', () => {
  it('returns production environment by default', () => {
    const desc = resolveSandboxEnvironmentDescriptor(makeConfig());
    expect(desc.environment).toBe(PARTNER_ENV.PRODUCTION);
    expect(desc.isSandbox).toBe(false);
    expect(desc.sandboxEnabled).toBe(false);
  });

  it('returns ready sandbox descriptor when fully configured', () => {
    const config = makeConfig({
      partnerOps: {
        environment: PARTNER_ENV.SANDBOX,
        sandboxEnabled: true,
        sandboxUrl: 'https://sandbox.acme.com',
        sandboxDataIsolated: true,
      },
    });
    const desc = resolveSandboxEnvironmentDescriptor(config);
    expect(desc.isSandbox).toBe(true);
    expect(desc.sandboxEnabled).toBe(true);
    expect(desc.sandboxUrl).toBe('https://sandbox.acme.com');
    expect(desc.dataIsolated).toBe(true);
    expect(desc.ready).toBe(true);
    expect(desc.vendorLeak).toBe(false);
  });

  it('flags vendorLeak for workers.dev sandbox URL', () => {
    const config = makeConfig({
      partnerOps: {
        sandboxEnabled: true,
        sandboxUrl: 'https://sandbox.my-platform.workers.dev',
        sandboxDataIsolated: true,
      },
    });
    const desc = resolveSandboxEnvironmentDescriptor(config);
    expect(desc.vendorLeak).toBe(true);
    expect(desc.ready).toBe(false);
  });

  it('warns when sandbox URL matches production URL', () => {
    const config = makeConfig({
      domainRouting: { appOrigin: 'https://app.acme.com' },
      partnerOps: {
        sandboxEnabled: true,
        sandboxUrl: 'https://app.acme.com',
        sandboxDataIsolated: true,
      },
    });
    const desc = resolveSandboxEnvironmentDescriptor(config);
    expect(desc.warnings.some((w) => w.includes('must be different'))).toBe(true);
  });

  it('warns when sandbox is not configured on a production tenant', () => {
    const desc = resolveSandboxEnvironmentDescriptor(makeConfig());
    expect(desc.warnings.some((w) => w.includes('No sandbox environment'))).toBe(true);
  });

  it('warns when sandboxDataIsolated is false', () => {
    const config = makeConfig({
      partnerOps: { sandboxEnabled: true, sandboxUrl: 'https://sandbox.acme.com', sandboxDataIsolated: false },
    });
    const desc = resolveSandboxEnvironmentDescriptor(config);
    expect(desc.warnings.some((w) => w.includes('sandboxDataIsolated'))).toBe(true);
  });
});

describe('assertNotSandboxConfig — Q3', () => {
  it('returns safe=true for production config', () => {
    const result = assertNotSandboxConfig(makeConfig());
    expect(result.safe).toBe(true);
    expect(result.environment).toBe(PARTNER_ENV.PRODUCTION);
  });

  it('returns safe=false for sandbox config', () => {
    const config = makeConfig({ partnerOps: { environment: PARTNER_ENV.SANDBOX } });
    const result = assertNotSandboxConfig(config);
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/sandbox/);
  });

  it('returns safe=false for staging config', () => {
    const config = makeConfig({ partnerOps: { environment: PARTNER_ENV.STAGING } });
    const result = assertNotSandboxConfig(config);
    expect(result.safe).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Q4 — SLA Policy & Incident Reporting
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveSlaPolicyDescriptor — Q4', () => {
  it('returns no-commitment defaults when nothing configured', () => {
    const desc = resolveSlaPolicyDescriptor(makeConfig());
    expect(desc.slaTier).toBe(SLA_TIER.NONE);
    expect(desc.uptimePct).toBe(0);
    expect(desc.ready).toBe(false);
  });

  it('returns ready descriptor for a configured enterprise SLA', () => {
    const config = makeConfig({
      partnerOps: {
        slaTier: SLA_TIER.ENTERPRISE,
        slaUptimePct: 99.95,
        slaResponseTimeMs: 2000,
        incidentPageUrl: 'https://status.acme.com',
        alertEmail: 'ops@acme.com',
        maintenanceWindowCron: '0 3 * * 0',
      },
    });
    const desc = resolveSlaPolicyDescriptor(config);
    expect(desc.slaTier).toBe(SLA_TIER.ENTERPRISE);
    expect(desc.uptimePct).toBe(99.95);
    expect(desc.responseTimeMs).toBe(2000);
    expect(desc.incidentPageUrl).toBe('https://status.acme.com');
    expect(desc.ready).toBe(true);
    expect(desc.vendorLeak).toBe(false);
  });

  it('flags vendorLeak for statuspage.io incident page', () => {
    const config = makeConfig({
      partnerOps: {
        slaTier: SLA_TIER.BUSINESS,
        slaUptimePct: 99.9,
        incidentPageUrl: 'https://acme.statuspage.io',
      },
    });
    const desc = resolveSlaPolicyDescriptor(config);
    expect(desc.vendorLeak).toBe(true);
    expect(desc.ready).toBe(false);
    expect(desc.vendorLeakReason).toMatch(/vendor-platform or third-party/);
  });

  it('reads slaUptimeTarget from legacy operations block', () => {
    const config = makeConfig({ operations: { slaUptimeTarget: 99.9, slaResponseTimeMs: 5000 } });
    const desc = resolveSlaPolicyDescriptor(config);
    expect(desc.uptimePct).toBe(99.9);
  });
});

describe('buildIncidentReportDescriptor — Q4', () => {
  it('redacts cloudflare from incident title', () => {
    const config = makeConfig();
    const result = buildIncidentReportDescriptor(config, {
      title: 'Cloudflare Workers degraded performance',
      body: 'Our Cloudflare Workers-based routing is experiencing elevated latency.',
      severity: 'major',
    });
    expect(result.title).not.toMatch(/cloudflare/i);
    expect(result.body).not.toMatch(/cloudflare/i);
    expect(result.productName).toBe('AcmeSEO');
  });

  it('redacts multiple vendor terms in one pass', () => {
    const config = makeConfig();
    const result = buildIncidentReportDescriptor(config, {
      title: 'D1 and R2 both experiencing issues',
      body: 'Durable Objects are also affected.',
    });
    expect(result.title).not.toMatch(/\bD1\b/);
    expect(result.title).not.toMatch(/\bR2\b/);
    expect(result.body).not.toMatch(/Durable Objects/i);
  });

  it('uses branding.productName in replacement', () => {
    const config = makeConfig({ branding: { productName: 'PartnerCo' } });
    const result = buildIncidentReportDescriptor(config, { title: 'Cloudflare issue' });
    expect(result.title).toContain('PartnerCo infrastructure');
  });

  it('passes through clean incident copy unchanged', () => {
    const config = makeConfig();
    const result = buildIncidentReportDescriptor(config, {
      title: 'Elevated response times on the analytics endpoint',
      body: 'Our engineering team is investigating the root cause.',
      severity: 'minor',
    });
    expect(result.title).toBe('Elevated response times on the analytics endpoint');
    expect(result.severity).toBe('minor');
  });

  it('defaults severity to minor for unknown values', () => {
    const config = makeConfig();
    const result = buildIncidentReportDescriptor(config, { title: 'test', severity: 'catastrophic' });
    expect(result.severity).toBe('minor');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Q5 — White-label Partner Documentation
// ─────────────────────────────────────────────────────────────────────────────

describe('buildPartnerDocsDescriptor — Q5', () => {
  it('returns disabled mode by default', () => {
    const desc = buildPartnerDocsDescriptor(makeConfig());
    expect(desc.mode).toBe(PARTNER_DOCS_MODE.DISABLED);
    expect(desc.ready).toBe(false);
  });

  it('returns ready descriptor for branded docs', () => {
    const config = makeConfig({
      partnerOps: {
        partnerDocsMode: PARTNER_DOCS_MODE.BRANDED,
        partnerDocsUrl: 'https://docs.acme.com',
        partnerDocsProductName: 'AcmeSEO Developer Docs',
      },
    });
    const desc = buildPartnerDocsDescriptor(config);
    expect(desc.mode).toBe(PARTNER_DOCS_MODE.BRANDED);
    expect(desc.docsUrl).toBe('https://docs.acme.com');
    expect(desc.productName).toBe('AcmeSEO Developer Docs');
    expect(desc.branded).toBe(true);
    expect(desc.ready).toBe(true);
    expect(desc.vendorLeak).toBe(false);
  });

  it('unbranded mode sets branded=false', () => {
    const config = makeConfig({
      partnerOps: {
        partnerDocsMode: PARTNER_DOCS_MODE.UNBRANDED,
        partnerDocsUrl: 'https://docs.acme.com',
        partnerDocsProductName: 'SEO Platform',
      },
    });
    const desc = buildPartnerDocsDescriptor(config);
    expect(desc.branded).toBe(false);
    expect(desc.ready).toBe(true);
  });

  it('flags vendorLeak for pages.dev docs URL', () => {
    const config = makeConfig({
      partnerOps: {
        partnerDocsMode: PARTNER_DOCS_MODE.BRANDED,
        partnerDocsUrl: 'https://acme-docs.pages.dev',
        partnerDocsProductName: 'AcmeSEO Docs',
      },
    });
    const desc = buildPartnerDocsDescriptor(config);
    expect(desc.vendorLeak).toBe(true);
    expect(desc.ready).toBe(false);
  });

  it('populates 4 default sections when mode is active', () => {
    const config = makeConfig({
      partnerOps: {
        partnerDocsMode: PARTNER_DOCS_MODE.UNBRANDED,
        partnerDocsUrl: 'https://docs.acme.com',
        partnerDocsProductName: 'SEO Platform',
      },
    });
    const desc = buildPartnerDocsDescriptor(config);
    expect(desc.sections).toContain('onboarding');
    expect(desc.sections).toContain('branding_setup');
    expect(desc.sections).toContain('tenant_management');
    expect(desc.sections).toContain('api_integration');
  });

  it('falls back to branding.productName when partnerDocsProductName is empty', () => {
    const config = makeConfig({
      partnerOps: {
        partnerDocsMode: PARTNER_DOCS_MODE.BRANDED,
        partnerDocsUrl: 'https://docs.acme.com',
        partnerDocsProductName: '',
      },
    });
    const desc = buildPartnerDocsDescriptor(config);
    expect(desc.productName).toBe('AcmeSEO');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Full audit — assertPartnerOpsWhiteLabel
// ─────────────────────────────────────────────────────────────────────────────

describe('assertPartnerOpsWhiteLabel — full audit', () => {
  it('passes for a fully configured partner', () => {
    const config = makeConfig({
      partnerOps: {
        adminPortalEnabled: true,
        adminPortalUrl: 'https://admin.acme.com',
        adminPortalProductName: 'Acme Partner Hub',
        helpCenterUrl: 'https://help.acme.com',
        ticketSystemUrl: 'https://support.acme.com',
        statusPageUrl: 'https://status.acme.com',
        supportBrand: 'Acme Support Team',
        ticketSystem: SUPPORT_SYSTEM.CUSTOM_PORTAL,
        sandboxEnabled: true,
        sandboxUrl: 'https://sandbox.acme.com',
        sandboxDataIsolated: true,
        slaTier: SLA_TIER.BUSINESS,
        slaUptimePct: 99.9,
        incidentPageUrl: 'https://status.acme.com',
        partnerDocsMode: PARTNER_DOCS_MODE.BRANDED,
        partnerDocsUrl: 'https://docs.acme.com',
        partnerDocsProductName: 'AcmeSEO Docs',
      },
    });
    const result = assertPartnerOpsWhiteLabel(config);
    expect(result.errors).toHaveLength(0);
    expect(result.pass).toBe(true);
  });

  it('fails when status page is on a vendor domain', () => {
    const config = makeConfig({
      partnerOps: {
        statusPageUrl: 'https://acme.statuspage.io',
        supportBrand: 'Acme Support',
        helpCenterUrl: 'https://help.acme.com',
      },
    });
    const result = assertPartnerOpsWhiteLabel(config);
    expect(result.pass).toBe(false);
    expect(result.errors.some((e) => e.includes('Q2'))).toBe(true);
  });

  it('fails when admin portal uses workers.dev', () => {
    const config = makeConfig({
      partnerOps: {
        adminPortalEnabled: true,
        adminPortalUrl: 'https://admin.acme.workers.dev',
        adminPortalProductName: 'Acme Hub',
      },
    });
    const result = assertPartnerOpsWhiteLabel(config);
    expect(result.pass).toBe(false);
    expect(result.errors.some((e) => e.includes('Q1'))).toBe(true);
  });

  it('warns when admin portal is not set up', () => {
    const result = assertPartnerOpsWhiteLabel(makeConfig());
    expect(result.warnings.some((w) => w.includes('Q1'))).toBe(true);
  });

  it('warns when no sandbox configured', () => {
    const result = assertPartnerOpsWhiteLabel(makeConfig());
    expect(result.warnings.some((w) => w.includes('Q3'))).toBe(true);
  });

  it('warns when docs are disabled', () => {
    const result = assertPartnerOpsWhiteLabel(makeConfig());
    expect(result.warnings.some((w) => w.includes('Q5'))).toBe(true);
  });
});
