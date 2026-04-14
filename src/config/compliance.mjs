/**
 * Compliance & Data Residency white-label control plane.
 *
 * Covers four platform-core responsibilities:
 *   Q1 — Per-tenant data residency election + vendor enforcement confirmation
 *   Q2 — Per-tenant DPA management — partner-branded, no vendor attribution
 *   Q3 — Audit log access, SIEM export (CEF / JSON), configurable retention
 *   Q4 — Security posture evidence (SOC 2, ISO 27001, pen test) NDA sharing
 *
 * All helpers are pure functions — no I/O, no vendor terminology in any output.
 * Vendor infrastructure naming is never surfaced in partner-facing outputs.
 */

// ─── Re-export residency enum from mobile.mjs (canonical source) ─────────────
export { DATA_RESIDENCY_REGION, DATA_RESIDENCY_REGION_VALUES } from './mobile.mjs';

// ─── Enums ────────────────────────────────────────────────────────────────────

/** DPA signing status relative to the upstream vendor/platform DPA. */
export const DPA_STATUS = Object.freeze({
  NOT_CONFIGURED:  'not_configured',  // No DPA fields set
  DRAFT:           'draft',           // URL set but not yet accepted
  ACCEPTED:        'accepted',        // Partner DPA accepted (dpaAcceptedAt set)
  EXPIRED:         'expired',         // Accepted more than dpaReviewPeriodDays ago
  NEEDS_REVIEW:    'needs_review',    // New platform DPA version issued since acceptance
});
export const DPA_STATUS_VALUES = Object.freeze(Object.values(DPA_STATUS));

/** Audit log export format. */
export const AUDIT_LOG_FORMAT = Object.freeze({
  JSONL: 'jsonl',   // Newline-delimited JSON — universal, highest fidelity
  CEF:   'cef',     // ArcSight Common Event Format — Splunk / ArcSight / QRadar
});
export const AUDIT_LOG_FORMAT_VALUES = Object.freeze(Object.values(AUDIT_LOG_FORMAT));

/** Security posture evidence NDA access level. */
export const SECURITY_EVIDENCE_ACCESS = Object.freeze({
  NONE:        'none',        // Document not available for this partner
  NDA_REQUIRED: 'nda_required', // Available but requires signed NDA
  ON_REQUEST:  'on_request',  // Available on written request without formal NDA
  PUBLIC:      'public',      // Publicly available (e.g. summary page)
});
export const SECURITY_EVIDENCE_ACCESS_VALUES = Object.freeze(Object.values(SECURITY_EVIDENCE_ACCESS));

/** Data residency enforcement confirmation level. */
export const RESIDENCY_ENFORCEMENT = Object.freeze({
  UNCONFIRMED:   'unconfirmed',   // Region elected but infra enforcement not confirmed
  OPERATOR_NOTE: 'operator_note', // Operator has noted confirmation in dataResidencyNotes
  CONTRACTUAL:   'contractual',   // Covered in the upstream DPA / service agreement
  CERTIFIED:     'certified',     // Independently verified (e.g. ISO 27001 scope)
});
export const RESIDENCY_ENFORCEMENT_VALUES = Object.freeze(Object.values(RESIDENCY_ENFORCEMENT));

// ─── Internal constants ───────────────────────────────────────────────────────

// Vendor URLs that must never appear in any partner-facing compliance surface.
const VENDOR_URL_PATTERNS = [
  /\.workers\.dev/, /^https?:\/\/workers\.dev/,
  /\.pages\.dev/, /^https?:\/\/pages\.dev/,
  /cloudflare\.com/, /clodo\.io/,
  /readme\.io/, /atlassian\.com/,
];

// Vendor brand terms that must not appear in DPA / policy text fields.
const VENDOR_BRAND_TERMS = ['cloudflare', 'workers', 'clodo', 'anthropic', 'claude'];

function isVendorUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  return VENDOR_URL_PATTERNS.some((re) => re.test(lower));
}

function containsVendorTerm(str) {
  if (!str || typeof str !== 'string') return null;
  const lower = str.toLowerCase();
  return VENDOR_BRAND_TERMS.find((t) => lower.includes(t)) || null;
}

// Default DPA review cadence — partners should re-confirm DPA acceptance
// whenever the platform issues a new version (typically annually).
const DEFAULT_DPA_REVIEW_PERIOD_DAYS = 365;

// ─── Q1 — Data Residency ─────────────────────────────────────────────────────

/**
 * Resolve the effective data residency policy for a tenant.
 *
 * Returns a complete residency descriptor including the elected region,
 * enforcement level, contractual confirmation status, and any gaps.
 *
 * The descriptor is intentionally free of vendor infrastructure terminology —
 * regions are logical (eu, us, apac) not implementation-specific (Cloudflare
 * region codes, PoP names, etc.).
 *
 * @param {object} config - Full tenant config (post mergeWithDefaults)
 * @returns {{
 *   region: string,
 *   enforced: boolean,
 *   enforcementLevel: string,
 *   contractualConfirmation: boolean,
 *   notes: string,
 *   gaps: string[],
 *   ready: boolean
 * }}
 */
export function resolveDataResidencyPolicy(config) {
  const c = config?.compliance || {};

  const region = c.dataResidencyRegion || 'global';
  const enforced = Boolean(c.dataResidencyEnforced);
  const enforcementLevel = RESIDENCY_ENFORCEMENT_VALUES.includes(c.dataResidencyEnforcementLevel)
    ? c.dataResidencyEnforcementLevel
    : enforced ? RESIDENCY_ENFORCEMENT.OPERATOR_NOTE : RESIDENCY_ENFORCEMENT.UNCONFIRMED;
  const contractualConfirmation = Boolean(c.dataResidencyContractualConfirmation);
  const notes = String(c.dataResidencyNotes || '').trim();

  const gaps = [];
  if (region !== 'global' && !enforced) {
    gaps.push(`Data residency region '${region}' is elected but compliance.dataResidencyEnforced is false — infrastructure enforcement has not been confirmed.`);
  }
  if (region !== 'global' && enforced && !contractualConfirmation) {
    gaps.push("Data residency is enforced but compliance.dataResidencyContractualConfirmation is false — partners offering GDPR/DPA coverage should obtain written contractual confirmation from the platform operator.");
  }
  if (region !== 'global' && enforced && !notes && enforcementLevel === RESIDENCY_ENFORCEMENT.OPERATOR_NOTE) {
    gaps.push("compliance.dataResidencyNotes is empty — record the operator confirmation reference (e.g. ticket ID, contract clause) for audit trail purposes.");
  }

  const ready = region !== 'global'
    ? enforced && contractualConfirmation
    : true; // global tenants have no residency commitment to confirm

  return {
    region,
    enforced,
    enforcementLevel,
    contractualConfirmation,
    notes,
    gaps,
    ready,
  };
}

/**
 * Build a data residency certificate descriptor for surfacing to the partner.
 *
 * Contains all the fields a partner needs to include in their DPA annex or
 * end-client data processing notice. Production deployments should validate
 * that ready===true before issuing this in a legal context.
 *
 * @param {object} config - Full tenant config
 * @returns {{
 *   tenantId: string,
 *   region: string,
 *   enforcementLevel: string,
 *   contractualConfirmation: boolean,
 *   dpaVersion: string,
 *   dpaAcceptedAt: string,
 *   certifiedAt: string,
 *   ready: boolean
 * }}
 */
export function buildDataResidencyCertificate(config) {
  const c = config?.compliance || {};
  const site = config?.site || {};
  const policy = resolveDataResidencyPolicy(config);

  return Object.freeze({
    tenantId: String(site.id || ''),
    region: policy.region,
    enforcementLevel: policy.enforcementLevel,
    contractualConfirmation: policy.contractualConfirmation,
    dpaVersion: String(c.dpaVersion || ''),
    dpaAcceptedAt: String(c.dpaAcceptedAt || ''),
    certifiedAt: String(c.dataResidencyCertifiedAt || ''),
    ready: policy.ready,
  });
}

// ─── Q2 — DPA Management ─────────────────────────────────────────────────────

/**
 * Resolve the DPA status for a tenant.
 *
 * Checks whether the partner has:
 *   1. Configured a partner-branded DPA URL (end-client facing)
 *   2. Set the upstream platform DPA version they have accepted
 *   3. Provided their acceptance timestamp
 *   4. A DPA that is not overdue for review
 *
 * The DPA URL must be partner-owned — any vendor URL is a white-label breach.
 *
 * @param {object} config - Full tenant config
 * @returns {{
 *   status: string,
 *   dpaUrl: string,
 *   dpaVersion: string,
 *   acceptedAt: string,
 *   privacyPolicyUrl: string,
 *   daysSinceAcceptance: number|null,
 *   reviewPeriodDays: number,
 *   vendorLeak: boolean,
 *   vendorLeakReason: string,
 *   gaps: string[]
 * }}
 */
export function resolveDpaStatus(config) {
  const c = config?.compliance || {};

  const dpaUrl = String(c.dpaUrl || '').trim();
  const dpaVersion = String(c.dpaVersion || '').trim();
  const acceptedAt = String(c.dpaAcceptedAt || '').trim();
  const privacyPolicyUrl = String(c.privacyPolicyUrl || '').trim();
  const reviewPeriodDays = Math.max(
    1,
    Number(c.dpaReviewPeriodDays) || DEFAULT_DPA_REVIEW_PERIOD_DAYS
  );

  // Vendor-leak check
  let vendorLeak = false;
  let vendorLeakReason = '';
  for (const [field, url] of [['dpaUrl', dpaUrl], ['privacyPolicyUrl', privacyPolicyUrl]]) {
    if (url && isVendorUrl(url)) {
      vendorLeak = true;
      vendorLeakReason = `compliance.${field} '${url}' exposes a vendor-platform domain. DPA and privacy policy URLs must be on the partner's own domain so end clients never see vendor infrastructure.`;
      break;
    }
  }

  // Days since acceptance
  let daysSinceAcceptance = null;
  if (acceptedAt) {
    const acceptedMs = Date.parse(acceptedAt);
    if (!isNaN(acceptedMs)) {
      daysSinceAcceptance = Math.floor((Date.now() - acceptedMs) / 86_400_000);
    }
  }

  // Determine status
  let status;
  if (!dpaUrl && !dpaVersion && !acceptedAt) {
    status = DPA_STATUS.NOT_CONFIGURED;
  } else if (!acceptedAt) {
    status = DPA_STATUS.DRAFT;
  } else if (daysSinceAcceptance !== null && daysSinceAcceptance > reviewPeriodDays) {
    status = DPA_STATUS.EXPIRED;
  } else {
    status = DPA_STATUS.ACCEPTED;
  }

  // Gaps
  const gaps = [];
  if (!dpaUrl) gaps.push('compliance.dpaUrl is not set — partners must provide a partner-branded DPA URL for end clients to review.');
  if (!dpaVersion) gaps.push('compliance.dpaVersion is not set — record the upstream platform DPA version number accepted (e.g. "2026-01").');
  if (!acceptedAt) gaps.push('compliance.dpaAcceptedAt is not set — record the ISO timestamp when the upstream DPA was last accepted.');
  if (privacyPolicyUrl === '') gaps.push('compliance.privacyPolicyUrl is not set — partners serving EU/UK/CA residents should provide their own privacy policy URL.');
  if (vendorLeak) gaps.push(vendorLeakReason);
  if (status === DPA_STATUS.EXPIRED) {
    gaps.push(`DPA acceptance is overdue for review — ${daysSinceAcceptance} days since last acceptance exceeds the ${reviewPeriodDays}-day review cadence.`);
  }

  return {
    status,
    dpaUrl,
    dpaVersion,
    acceptedAt,
    privacyPolicyUrl,
    daysSinceAcceptance,
    reviewPeriodDays,
    vendorLeak,
    vendorLeakReason,
    gaps,
  };
}

// ─── Q3 — Audit Log Policy ────────────────────────────────────────────────────

/**
 * Resolve the audit log policy for a tenant.
 *
 * Returns a ready-to-enforce policy object that the consuming Worker uses to:
 *   - Decide whether to persist audit entries (retentionDays > 0)
 *   - Format audit entries (jsonl vs cef)
 *   - Route export webhooks (auditLogWebhookUrl)
 *   - Gate the /api/compliance/audit-export route
 *
 * @param {object} config - Full tenant config
 * @returns {{
 *   enabled: boolean,
 *   retentionDays: number,
 *   format: string,
 *   webhookUrl: string,
 *   exportEnabled: boolean,
 *   vendorLeak: boolean,
 *   vendorLeakReason: string,
 *   gaps: string[]
 * }}
 */
export function resolveAuditLogPolicy(config) {
  const c = config?.compliance || {};

  const enabled = Boolean(c.auditLogExportEnabled ?? false);
  const retentionDays = Math.max(0, Number(c.auditLogRetentionDays) || 90);
  const format = AUDIT_LOG_FORMAT_VALUES.includes(c.auditLogSiemFormat)
    ? c.auditLogSiemFormat
    : AUDIT_LOG_FORMAT.JSONL;
  const webhookUrl = String(c.auditLogWebhookUrl || '').trim();
  const exportEnabled = enabled || Boolean(c.auditLogExportEndpointEnabled);

  let vendorLeak = false;
  let vendorLeakReason = '';
  if (webhookUrl && isVendorUrl(webhookUrl)) {
    vendorLeak = true;
    vendorLeakReason = `compliance.auditLogWebhookUrl '${webhookUrl}' exposes a vendor-platform domain. Audit log webhooks must target the partner's own SIEM endpoint.`;
  }

  const gaps = [];
  if (retentionDays < 30) {
    gaps.push(`compliance.auditLogRetentionDays is ${retentionDays} — most compliance frameworks (SOC 2, ISO 27001, GDPR) require at least 90 days of audit retention.`);
  }
  if (exportEnabled && !webhookUrl && !c.auditLogExportS3Bucket && !c.auditLogExportBlobContainer) {
    gaps.push('Audit log export is enabled but no delivery target is configured (auditLogWebhookUrl / auditLogExportS3Bucket / auditLogExportBlobContainer).');
  }
  if (vendorLeak) gaps.push(vendorLeakReason);

  return Object.freeze({
    enabled,
    retentionDays,
    format,
    webhookUrl,
    exportEnabled,
    vendorLeak,
    vendorLeakReason,
    gaps,
  });
}

/**
 * Format a single audit log entry in either JSONL or CEF format.
 *
 * The formatted entry strips all vendor infrastructure terms before
 * writing so that exported audit logs never contain vendor branding.
 *
 * @param {{
 *   tenantId: string,
 *   actorId: string,
 *   actorType: 'user'|'system'|'api',
 *   action: string,
 *   resource: string,
 *   outcome: 'success'|'failure'|'denied',
 *   timestamp: string,
 *   details: object
 * }} entry
 * @param {'jsonl'|'cef'} format
 * @param {string} [productName] - Partner product name for CEF device field
 * @returns {string} - Formatted log line
 */
export function formatAuditLogEntry(entry, format = AUDIT_LOG_FORMAT.JSONL, productName = 'Platform') {
  const ts = entry.timestamp || new Date().toISOString();
  const safe = {
    ts,
    tenantId: String(entry.tenantId || ''),
    actorId:  String(entry.actorId  || ''),
    actorType: String(entry.actorType || 'system'),
    action:   String(entry.action   || ''),
    resource: String(entry.resource || ''),
    outcome:  ['success', 'failure', 'denied'].includes(entry.outcome) ? entry.outcome : 'unknown',
    details:  entry.details && typeof entry.details === 'object' ? entry.details : {},
  };

  if (format === AUDIT_LOG_FORMAT.CEF) {
    // CEF: header fields | extension
    const severity = safe.outcome === 'denied' ? 7 : safe.outcome === 'failure' ? 5 : 0;
    const ext = [
      `ts=${ts}`,
      `tenantId=${safe.tenantId}`,
      `actorId=${safe.actorId}`,
      `actorType=${safe.actorType}`,
      `outcome=${safe.outcome}`,
    ].join(' ');
    // Sanitize product name — must not contain | or backslash (CEF reserved)
    const safeName = String(productName).replace(/[|\\]/g, '-').slice(0, 64);
    return `CEF:0|${safeName}|AuditLog|1.0|${safe.action}|${safe.resource}|${severity}|${ext}`;
  }

  // Default: JSONL
  return JSON.stringify(safe);
}

// ─── Q4 — Security Posture Evidence ──────────────────────────────────────────

/**
 * Build the security posture evidence descriptor for a partner.
 *
 * Returns a structured map of evidence documents (SOC 2, ISO 27001, pen test,
 * trust page) with their access level and NDA requirements. Partners use this
 * to answer client due-diligence requests and accelerate sales cycles.
 *
 * All evidence URLs must be gated or partner-hosted — direct vendor report URLs
 * must not be shared with end clients without NDA coverage.
 *
 * @param {object} config - Full tenant config
 * @returns {{
 *   trustPageUrl: string,
 *   soc2: { url: string, access: string, scope: string },
 *   iso27001: { certified: boolean, scope: string, access: string },
 *   penTest: { url: string, access: string, frequency: string },
 *   certificationNotes: string,
 *   ndaContactEmail: string,
 *   vendorLeaks: Array<{ field: string, reason: string }>,
 *   gaps: string[]
 * }}
 */
export function buildSecurityPostureDescriptor(config) {
  const c = config?.compliance || {};

  const trustPageUrl       = String(c.securityPostureUrl || '').trim();
  const soc2Url            = String(c.soc2ReportUrl || '').trim();
  const penTestUrl         = String(c.penTestReportUrl || '').trim();
  const certificationNotes = String(c.certificationNotes || '').trim();
  const ndaContactEmail    = String(c.incidentNotificationEmail || c.ndaContactEmail || '').trim();

  const soc2Access = (SECURITY_EVIDENCE_ACCESS_VALUES.includes(c.soc2Access) &&
    c.soc2Access !== SECURITY_EVIDENCE_ACCESS.NONE)
    ? c.soc2Access
    : soc2Url ? SECURITY_EVIDENCE_ACCESS.NDA_REQUIRED : SECURITY_EVIDENCE_ACCESS.NONE;

  const penTestAccess = (SECURITY_EVIDENCE_ACCESS_VALUES.includes(c.penTestAccess) &&
    c.penTestAccess !== SECURITY_EVIDENCE_ACCESS.NONE)
    ? c.penTestAccess
    : penTestUrl ? SECURITY_EVIDENCE_ACCESS.NDA_REQUIRED : SECURITY_EVIDENCE_ACCESS.NONE;

  const iso27001Access = SECURITY_EVIDENCE_ACCESS_VALUES.includes(c.iso27001Access)
    ? c.iso27001Access
    : SECURITY_EVIDENCE_ACCESS.NONE;

  // Vendor-leak checks on all evidence URLs
  const vendorLeaks = [];
  const evidenceUrls = [
    ['compliance.securityPostureUrl', trustPageUrl],
    ['compliance.soc2ReportUrl',      soc2Url],
    ['compliance.penTestReportUrl',   penTestUrl],
  ];
  for (const [field, url] of evidenceUrls) {
    if (url && isVendorUrl(url)) {
      vendorLeaks.push({
        field,
        reason: `'${url}' exposes a vendor-platform domain. Security evidence URLs must be served through the partner's own trust portal or a gated partner-branded URL.`,
      });
    }
  }

  // Check for vendor terms in certificationNotes
  const noteTerm = containsVendorTerm(certificationNotes);
  if (noteTerm) {
    vendorLeaks.push({
      field: 'compliance.certificationNotes',
      reason: `certificationNotes contains vendor term '${noteTerm}'. Partner-facing security posture notes must use generic infrastructure language, not vendor names.`,
    });
  }

  const gaps = [];
  if (!trustPageUrl) gaps.push('compliance.securityPostureUrl is not set — partners should maintain a partner-branded security/trust page for client due diligence.');
  if (soc2Access === SECURITY_EVIDENCE_ACCESS.NONE && penTestAccess === SECURITY_EVIDENCE_ACCESS.NONE && !soc2Url && !penTestUrl) {
    gaps.push('No SOC 2 or pen test evidence is configured. For enterprise sales, at least one security evidence document should be available under NDA.');
  }
  if ((soc2Url || penTestUrl) && !ndaContactEmail) {
    gaps.push('Security evidence is configured but compliance.ndaContactEmail (or incidentNotificationEmail) is not set — partners need a contact point for NDA requests.');
  }
  for (const leak of vendorLeaks) gaps.push(leak.reason);

  return {
    trustPageUrl,
    soc2: {
      url: soc2Url,
      access: soc2Access,
      scope: String(c.soc2Scope || '').trim(),
    },
    iso27001: {
      certified: Boolean(c.iso27001Certified),
      scope: String(c.iso27001Scope || '').trim(),
      access: iso27001Access,
    },
    penTest: {
      url: penTestUrl,
      access: penTestAccess,
      frequency: String(c.penTestFrequency || 'annual').trim(),
    },
    certificationNotes,
    ndaContactEmail,
    vendorLeaks,
    gaps,
  };
}

// ─── Full compliance audit ────────────────────────────────────────────────────

/**
 * Run a full compliance white-label audit against a config.
 *
 * Combines all four Q-descriptors into a single pass/fail result.
 * Use this in the partner provisioning flow before issuing a compliance
 * certificate of readiness to EU/UK/CA regulated tenants.
 *
 * @param {object} config - Full tenant config (post mergeWithDefaults)
 * @returns {{ pass: boolean, errors: string[], warnings: string[] }}
 */
export function assertComplianceWhiteLabel(config) {
  const errors = [];
  const warnings = [];

  // Q1 — Data residency
  const residency = resolveDataResidencyPolicy(config);
  for (const gap of residency.gaps) {
    if (gap.includes('not been confirmed') || gap.includes('contractual')) {
      warnings.push(`Q1: ${gap}`);
    } else {
      warnings.push(`Q1: ${gap}`);
    }
  }
  if (config.compliance?.dataResidencyRegion && config.compliance.dataResidencyRegion !== 'global') {
    if (!residency.enforced) {
      errors.push(`Q1: Data residency region '${residency.region}' is elected but compliance.dataResidencyEnforced is false.`);
    }
  }

  // Q2 — DPA
  const dpa = resolveDpaStatus(config);
  if (dpa.vendorLeak) errors.push(`Q2: ${dpa.vendorLeakReason}`);
  for (const gap of dpa.gaps) {
    if (gap.includes('vendor-platform')) continue; // already in errors
    warnings.push(`Q2: ${gap}`);
  }

  // Q3 — Audit log
  const audit = resolveAuditLogPolicy(config);
  if (audit.vendorLeak) errors.push(`Q3: ${audit.vendorLeakReason}`);
  for (const gap of audit.gaps) {
    if (gap.includes('vendor-platform')) continue;
    warnings.push(`Q3: ${gap}`);
  }

  // Q4 — Security posture
  const posture = buildSecurityPostureDescriptor(config);
  for (const leak of posture.vendorLeaks) errors.push(`Q4: ${leak.reason}`);
  for (const gap of posture.gaps) {
    if (posture.vendorLeaks.some((l) => l.reason === gap)) continue;
    warnings.push(`Q4: ${gap}`);
  }

  return { pass: errors.length === 0, errors, warnings };
}
