/**
 * Tests for src/config/compliance.mjs
 *
 * Coverage map:
 *   Q1 — resolveDataResidencyPolicy, buildDataResidencyCertificate
 *   Q2 — resolveDpaStatus
 *   Q3 — resolveAuditLogPolicy, formatAuditLogEntry
 *   Q4 — buildSecurityPostureDescriptor
 *   Full — assertComplianceWhiteLabel
 */

import { describe, it, expect } from 'vitest';
import { mergeWithDefaults } from '../../src/config/customer-config.schema.mjs';
import {
  AUDIT_LOG_FORMAT,
  DPA_STATUS,
  RESIDENCY_ENFORCEMENT,
  SECURITY_EVIDENCE_ACCESS,
  assertComplianceWhiteLabel,
  buildDataResidencyCertificate,
  buildSecurityPostureDescriptor,
  formatAuditLogEntry,
  resolveAuditLogPolicy,
  resolveDataResidencyPolicy,
  resolveDpaStatus,
} from '../../src/config/compliance.mjs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SITE = { id: 'acme', domain: 'acme.com', siteUrl: 'https://acme.com', name: 'Acme' };

function makeConfig(overrides = {}) {
  return mergeWithDefaults({
    site: SITE,
    compliance: { ...overrides.compliance },
  });
}

// ─── Q1 — Data Residency ─────────────────────────────────────────────────────

describe('resolveDataResidencyPolicy — Q1', () => {
  it('returns ready:true for global (no commitment required)', () => {
    const result = resolveDataResidencyPolicy(makeConfig());
    expect(result.region).toBe('global');
    expect(result.ready).toBe(true);
    expect(result.gaps).toHaveLength(0);
  });

  it('flags gap when region is set but enforced=false', () => {
    const result = resolveDataResidencyPolicy(makeConfig({
      compliance: { dataResidencyRegion: 'eu' },
    }));
    expect(result.enforced).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.gaps.some((g) => /enforcement has not been confirmed/i.test(g))).toBe(true);
  });

  it('flags gap when enforced but contractual confirmation missing', () => {
    const result = resolveDataResidencyPolicy(makeConfig({
      compliance: {
        dataResidencyRegion: 'eu',
        dataResidencyEnforced: true,
        dataResidencyContractualConfirmation: false,
      },
    }));
    expect(result.ready).toBe(false);
    expect(result.gaps.some((g) => /contractual confirmation/i.test(g))).toBe(true);
  });

  it('is ready when region enforced + contractual confirmed', () => {
    const result = resolveDataResidencyPolicy(makeConfig({
      compliance: {
        dataResidencyRegion: 'eu',
        dataResidencyEnforced: true,
        dataResidencyContractualConfirmation: true,
      },
    }));
    expect(result.ready).toBe(true);
    expect(result.gaps.filter((g) => /enforcement|contractual/i.test(g))).toHaveLength(0);
  });

  it('uses RESIDENCY_ENFORCEMENT.UNCONFIRMED when not enforced', () => {
    const result = resolveDataResidencyPolicy(makeConfig({
      compliance: { dataResidencyRegion: 'us' },
    }));
    expect(result.enforcementLevel).toBe(RESIDENCY_ENFORCEMENT.UNCONFIRMED);
  });

  it('honours explicit enforcementLevel override', () => {
    const result = resolveDataResidencyPolicy(makeConfig({
      compliance: {
        dataResidencyRegion: 'eu',
        dataResidencyEnforced: true,
        dataResidencyContractualConfirmation: true,
        dataResidencyEnforcementLevel: RESIDENCY_ENFORCEMENT.CERTIFIED,
      },
    }));
    expect(result.enforcementLevel).toBe(RESIDENCY_ENFORCEMENT.CERTIFIED);
  });
});

describe('buildDataResidencyCertificate — Q1', () => {
  it('includes tenantId from site.id', () => {
    const cert = buildDataResidencyCertificate(makeConfig({
      compliance: {
        dataResidencyRegion: 'eu',
        dataResidencyEnforced: true,
        dataResidencyContractualConfirmation: true,
        dpaVersion: '2026-01',
        dpaAcceptedAt: '2026-01-01T00:00:00Z',
      },
    }));
    expect(cert.tenantId).toBe('acme');
    expect(cert.region).toBe('eu');
    expect(cert.dpaVersion).toBe('2026-01');
    expect(cert.contractualConfirmation).toBe(true);
    expect(cert.ready).toBe(true);
  });

  it('is not ready when region set but not confirmed', () => {
    const cert = buildDataResidencyCertificate(makeConfig({
      compliance: { dataResidencyRegion: 'eu' },
    }));
    expect(cert.ready).toBe(false);
  });
});

// ─── Q2 — DPA Management ─────────────────────────────────────────────────────

describe('resolveDpaStatus — Q2', () => {
  it('returns NOT_CONFIGURED when no DPA fields are set', () => {
    const result = resolveDpaStatus(makeConfig());
    expect(result.status).toBe(DPA_STATUS.NOT_CONFIGURED);
    expect(result.vendorLeak).toBe(false);
  });

  it('returns DRAFT when dpaUrl set but not accepted', () => {
    const result = resolveDpaStatus(makeConfig({
      compliance: { dpaUrl: 'https://acme.com/dpa', dpaVersion: '2026-01' },
    }));
    expect(result.status).toBe(DPA_STATUS.DRAFT);
  });

  it('returns ACCEPTED when dpaAcceptedAt is recent', () => {
    const result = resolveDpaStatus(makeConfig({
      compliance: {
        dpaUrl: 'https://acme.com/dpa',
        dpaVersion: '2026-01',
        dpaAcceptedAt: new Date().toISOString(),
      },
    }));
    expect(result.status).toBe(DPA_STATUS.ACCEPTED);
  });

  it('returns EXPIRED when acceptance is older than reviewPeriodDays', () => {
    const oldDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    const result = resolveDpaStatus(makeConfig({
      compliance: {
        dpaUrl: 'https://acme.com/dpa',
        dpaVersion: '2026-01',
        dpaAcceptedAt: oldDate,
        dpaReviewPeriodDays: 365,
      },
    }));
    expect(result.status).toBe(DPA_STATUS.EXPIRED);
    expect(result.gaps.some((g) => /overdue for review/i.test(g))).toBe(true);
  });

  it('flags vendor leak when dpaUrl is on a vendor domain', () => {
    const result = resolveDpaStatus(makeConfig({
      compliance: { dpaUrl: 'https://workers.dev/legal/dpa' },
    }));
    expect(result.vendorLeak).toBe(true);
    expect(result.vendorLeakReason).toMatch(/vendor-platform domain/i);
  });

  it('flags vendor leak when privacyPolicyUrl is on a vendor domain', () => {
    const result = resolveDpaStatus(makeConfig({
      compliance: { privacyPolicyUrl: 'https://cloudflare.com/privacy' },
    }));
    expect(result.vendorLeak).toBe(true);
  });
});

// ─── Q3 — Audit Log Policy ────────────────────────────────────────────────────

describe('resolveAuditLogPolicy — Q3', () => {
  it('returns sane defaults when nothing configured', () => {
    const result = resolveAuditLogPolicy(makeConfig());
    expect(result.retentionDays).toBe(90);
    expect(result.format).toBe(AUDIT_LOG_FORMAT.JSONL);
    expect(result.exportEnabled).toBe(false);
    expect(result.vendorLeak).toBe(false);
  });

  it('respects configured retentionDays', () => {
    const result = resolveAuditLogPolicy(makeConfig({
      compliance: { auditLogRetentionDays: 180 },
    }));
    expect(result.retentionDays).toBe(180);
  });

  it('respects CEF format', () => {
    const result = resolveAuditLogPolicy(makeConfig({
      compliance: { auditLogSiemFormat: 'cef' },
    }));
    expect(result.format).toBe(AUDIT_LOG_FORMAT.CEF);
  });

  it('flags gap when export enabled but no delivery target', () => {
    const result = resolveAuditLogPolicy(makeConfig({
      compliance: { auditLogExportEnabled: true },
    }));
    expect(result.gaps.some((g) => /no delivery target/i.test(g))).toBe(true);
  });

  it('has no delivery gap when webhookUrl is set', () => {
    const result = resolveAuditLogPolicy(makeConfig({
      compliance: {
        auditLogExportEnabled: true,
        auditLogWebhookUrl: 'https://siem.acme.com/hook',
      },
    }));
    expect(result.gaps.some((g) => /no delivery target/i.test(g))).toBe(false);
  });

  it('flags vendor leak when webhookUrl is on a vendor domain', () => {
    const result = resolveAuditLogPolicy(makeConfig({
      compliance: { auditLogWebhookUrl: 'https://workers.dev/hook' },
    }));
    expect(result.vendorLeak).toBe(true);
    expect(result.vendorLeakReason).toMatch(/vendor-platform domain/i);
  });
});

describe('formatAuditLogEntry — Q3', () => {
  const entry = {
    tenantId: 'acme',
    actorId: 'user-1',
    actorType: 'user',
    action: 'config.update',
    resource: 'tenant/acme',
    outcome: 'success',
    timestamp: '2026-04-14T00:00:00Z',
    details: { field: 'branding.primaryColor' },
  };

  it('formats JSONL — parseable JSON', () => {
    const line = formatAuditLogEntry(entry, AUDIT_LOG_FORMAT.JSONL);
    const parsed = JSON.parse(line);
    expect(parsed.tenantId).toBe('acme');
    expect(parsed.outcome).toBe('success');
    expect(parsed.action).toBe('config.update');
  });

  it('formats CEF — starts with CEF:0', () => {
    const line = formatAuditLogEntry(entry, AUDIT_LOG_FORMAT.CEF, 'Acme Platform');
    expect(line.startsWith('CEF:0')).toBe(true);
    expect(line).toContain('config.update');
    expect(line).toContain('tenantId=acme');
  });

  it('CEF sanitizes productName pipes', () => {
    const line = formatAuditLogEntry(entry, AUDIT_LOG_FORMAT.CEF, 'Acme|Corp');
    expect(line).not.toContain('Acme|Corp');
    expect(line).toContain('Acme-Corp');
  });

  it('JSONL treats denied outcome as denied', () => {
    const denied = { ...entry, outcome: 'denied' };
    const parsed = JSON.parse(formatAuditLogEntry(denied, AUDIT_LOG_FORMAT.JSONL));
    expect(parsed.outcome).toBe('denied');
  });

  it('CEF sets severity 7 for denied outcome', () => {
    const denied = { ...entry, outcome: 'denied' };
    const line = formatAuditLogEntry(denied, AUDIT_LOG_FORMAT.CEF, 'Platform');
    // severity is the 7th pipe-delimited field in CEF header
    const parts = line.split('|');
    expect(parts[6]).toBe('7');
  });
});

// ─── Q4 — Security Posture ────────────────────────────────────────────────────

describe('buildSecurityPostureDescriptor — Q4', () => {
  it('returns default NONE access levels when no evidence configured', () => {
    const result = buildSecurityPostureDescriptor(makeConfig());
    expect(result.soc2.access).toBe(SECURITY_EVIDENCE_ACCESS.NONE);
    expect(result.penTest.access).toBe(SECURITY_EVIDENCE_ACCESS.NONE);
    expect(result.iso27001.certified).toBe(false);
    expect(result.vendorLeaks).toHaveLength(0);
  });

  it('infers NDA_REQUIRED access when soc2ReportUrl is set', () => {
    const result = buildSecurityPostureDescriptor(makeConfig({
      compliance: { soc2ReportUrl: 'https://trust.acme.com/soc2' },
    }));
    expect(result.soc2.access).toBe(SECURITY_EVIDENCE_ACCESS.NDA_REQUIRED);
    expect(result.soc2.url).toBe('https://trust.acme.com/soc2');
  });

  it('flags vendor leak on soc2ReportUrl with vendor domain', () => {
    const result = buildSecurityPostureDescriptor(makeConfig({
      compliance: { soc2ReportUrl: 'https://cloudflare.com/reports/soc2' },
    }));
    expect(result.vendorLeaks.length).toBeGreaterThan(0);
    expect(result.vendorLeaks[0].field).toBe('compliance.soc2ReportUrl');
  });

  it('flags vendor term in certificationNotes', () => {
    const result = buildSecurityPostureDescriptor(makeConfig({
      compliance: { certificationNotes: 'Hosted on Cloudflare Workers' },
    }));
    expect(result.vendorLeaks.some((l) => l.field === 'compliance.certificationNotes')).toBe(true);
  });

  it('gap includes no evidence warning when no docs configured', () => {
    const result = buildSecurityPostureDescriptor(makeConfig());
    expect(result.gaps.some((g) => /no SOC 2 or pen test/i.test(g))).toBe(true);
  });

  it('no evidence gap when soc2 or pen test configured', () => {
    const result = buildSecurityPostureDescriptor(makeConfig({
      compliance: {
        soc2ReportUrl: 'https://trust.acme.com/soc2',
        incidentNotificationEmail: 'security@acme.com',
      },
    }));
    expect(result.gaps.some((g) => /no SOC 2 or pen test/i.test(g))).toBe(false);
  });
});

// ─── Full Audit ───────────────────────────────────────────────────────────────

describe('assertComplianceWhiteLabel — full audit', () => {
  it('passes for a fully configured compliant partner', () => {
    const config = makeConfig({
      compliance: {
        dataResidencyRegion: 'eu',
        dataResidencyEnforced: true,
        dataResidencyContractualConfirmation: true,
        dpaUrl: 'https://acme.com/dpa',
        dpaVersion: '2026-01',
        dpaAcceptedAt: new Date().toISOString(),
        privacyPolicyUrl: 'https://acme.com/privacy',
        soc2ReportUrl: 'https://trust.acme.com/soc2',
        incidentNotificationEmail: 'legal@acme.com',
      },
    });
    const { pass, errors } = assertComplianceWhiteLabel(config);
    expect(pass).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('fails when dpaUrl is on a vendor domain', () => {
    const config = makeConfig({
      compliance: { dpaUrl: 'https://pages.dev/dpa' },
    });
    const { pass, errors } = assertComplianceWhiteLabel(config);
    expect(pass).toBe(false);
    expect(errors.some((e) => /Q2/i.test(e))).toBe(true);
  });

  it('fails when security posture URL is on a vendor domain', () => {
    const config = makeConfig({
      compliance: { soc2ReportUrl: 'https://cloudflare.com/soc2' },
    });
    const { pass, errors } = assertComplianceWhiteLabel(config);
    expect(pass).toBe(false);
    expect(errors.some((e) => /Q4/i.test(e))).toBe(true);
  });

  it('fails when certificationNotes contains a vendor term', () => {
    const config = makeConfig({
      compliance: { certificationNotes: 'Uses Cloudflare Workers KV' },
    });
    const { pass, errors } = assertComplianceWhiteLabel(config);
    expect(pass).toBe(false);
    expect(errors.some((e) => /Q4/i.test(e))).toBe(true);
  });

  it('fails when region set but enforced=false', () => {
    const config = makeConfig({
      compliance: { dataResidencyRegion: 'eu', dataResidencyEnforced: false },
    });
    const { pass, errors } = assertComplianceWhiteLabel(config);
    expect(pass).toBe(false);
    expect(errors.some((e) => /Q1/i.test(e))).toBe(true);
  });

  it('has warnings (not errors) for informational gaps on empty config', () => {
    const { pass, errors, warnings } = assertComplianceWhiteLabel(makeConfig());
    expect(pass).toBe(true);
    expect(errors).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
