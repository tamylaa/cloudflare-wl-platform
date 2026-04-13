import { describe, it, expect } from 'vitest';
import {
  AUTH_EVENT_ACTION,
  AUTH_SSO_MODE,
  MFA_ENFORCEMENT_MODE,
  resolveOidcConfig,
  resolveSamlConfig,
  resolveLoginBranding,
  resolveRbacPolicy,
  assertPermission,
  buildAuthSecurityHeaders,
  buildAuthAuditEvent,
  writeAuthAuditEvent,
  exportAuthAuditLog,
  AUTH_AUDIT_EXPORT_FORMAT,
} from '../../src/config/auth-identity.mjs';

// ─── Prompt 1: resolveOidcConfig / resolveSamlConfig ─────────────────────────

describe('resolveOidcConfig', () => {
  it('returns null when ssoMode is not oidc', () => {
    expect(resolveOidcConfig({ ssoMode: 'disabled' })).toBeNull();
    expect(resolveOidcConfig({})).toBeNull();
  });

  it('returns a ready descriptor when all OIDC fields are present', () => {
    const result = resolveOidcConfig({
      ssoMode: 'oidc',
      oidcDiscoveryUrl: 'https://login.example.com/.well-known/openid-configuration',
      oidcClientIdSecret: 'OIDC_CLIENT_ID',
      oidcClientSecretSecret: 'OIDC_CLIENT_SECRET',
      loginHostname: 'login.example.com',
    });
    expect(result).not.toBeNull();
    expect(result.protocol).toBe('oidc');
    expect(result.ready).toBe(true);
    expect(result.missingFields).toHaveLength(0);
    expect(result.loginHostname).toBe('login.example.com');
  });

  it('marks descriptor not-ready and lists missing fields when incomplete', () => {
    const result = resolveOidcConfig({ ssoMode: 'oidc', oidcDiscoveryUrl: 'https://idp.example.com' });
    expect(result.ready).toBe(false);
    expect(result.missingFields).toContain('oidcClientIdSecret');
    expect(result.missingFields).toContain('oidcClientSecretSecret');
  });
});

describe('resolveSamlConfig', () => {
  it('returns null when ssoMode is not saml', () => {
    expect(resolveSamlConfig({ ssoMode: 'oidc' })).toBeNull();
    expect(resolveSamlConfig({})).toBeNull();
  });

  it('returns a ready descriptor when all SAML fields are present', () => {
    const result = resolveSamlConfig({
      ssoMode: 'saml',
      samlEntryPoint: 'https://idp.okta.com/app/exkXXX/sso/saml',
      samlEntityId: 'https://app.example.com',
      samlCertificateSecret: 'SAML_CERT',
    });
    expect(result.protocol).toBe('saml');
    expect(result.ready).toBe(true);
    expect(result.missingFields).toHaveLength(0);
  });

  it('reports missing samlCertificateSecret when absent', () => {
    const result = resolveSamlConfig({
      ssoMode: 'saml',
      samlEntryPoint: 'https://idp.okta.com/app/exkXXX/sso/saml',
      samlEntityId: 'https://app.example.com',
    });
    expect(result.ready).toBe(false);
    expect(result.missingFields).toContain('samlCertificateSecret');
  });
});

// ─── Prompt 2: resolveLoginBranding ──────────────────────────────────────────

describe('resolveLoginBranding', () => {
  it('merges auth and brand into a white-label login descriptor', () => {
    const authIdentity = {
      loginHostname: 'login.acme.com',
      loginHelpText: 'Need help? Contact support.',
      passwordResetUrl: 'https://login.acme.com/reset',
      mfaEnforcement: 'required',
      ssoMode: 'oidc',
    };
    const brand = {
      productName: 'Acme Platform',
      resolvedLogoUrl: 'https://cdn.acme.com/logo.png',
      primaryColor: '#FF5733',
    };

    const result = resolveLoginBranding(authIdentity, brand);

    expect(result.loginHostname).toBe('login.acme.com');
    expect(result.loginOrigin).toBe('https://login.acme.com');
    expect(result.productName).toBe('Acme Platform');
    expect(result.logoUrl).toBe('https://cdn.acme.com/logo.png');
    expect(result.primaryColor).toBe('#FF5733');
    expect(result.loginHelpText).toBe('Need help? Contact support.');
    expect(result.mfaEnforcement).toBe(MFA_ENFORCEMENT_MODE.REQUIRED);
    expect(result.ssoMode).toBe(AUTH_SSO_MODE.OIDC);
  });

  it('falls back to defaults when auth / brand fields are absent', () => {
    const result = resolveLoginBranding({}, {});
    expect(result.loginHostname).toBe('');
    expect(result.ssoMode).toBe(AUTH_SSO_MODE.DISABLED);
    expect(result.mfaEnforcement).toBe(MFA_ENFORCEMENT_MODE.OPTIONAL);
    expect(result.primaryColor).toBe('#3b82f6');
  });
});

// ─── Prompt 3: resolveRbacPolicy + assertPermission ──────────────────────────

describe('resolveRbacPolicy and assertPermission', () => {
  it('builds a permission map from default role definitions', () => {
    const policy = resolveRbacPolicy({});
    expect(policy.knownRoles).toContain('tenant_owner');
    expect(policy.knownRoles).toContain('viewer');
    expect(policy.permissionToRoles.has('reports.view')).toBe(true);
    // tenant_owner, tenant_admin, analyst, viewer should all grant reports.view
    const grantingRoles = policy.permissionToRoles.get('reports.view');
    expect(grantingRoles).toContain('tenant_owner');
    expect(grantingRoles).toContain('viewer');
  });

  it('assertPermission returns granted=true when role holds permission', () => {
    const policy = resolveRbacPolicy({});
    const result = assertPermission(policy, ['tenant_admin'], 'audit.view');
    expect(result.granted).toBe(true);
    expect(result.roleId).toBe('tenant_admin');
  });

  it('assertPermission returns granted=false when no role holds permission', () => {
    const policy = resolveRbacPolicy({});
    const result = assertPermission(policy, ['viewer'], 'billing.manage');
    expect(result.granted).toBe(false);
    expect(result.roleId).toBeNull();
  });

  it('custom role overrides default role with same id', () => {
    const policy = resolveRbacPolicy({
      roleDefinitions: [
        { id: 'viewer', label: 'Viewer+', permissions: ['reports.view', 'billing.manage'] },
      ],
    });
    const result = assertPermission(policy, ['viewer'], 'billing.manage');
    expect(result.granted).toBe(true);
  });
});

// ─── Prompt 4: buildAuthSecurityHeaders ──────────────────────────────────────

describe('buildAuthSecurityHeaders', () => {
  it('generates HSTS, CSP, X-Frame-Options scoped to custom domain', () => {
    const headers = buildAuthSecurityHeaders({
      loginHostname: 'login.acme.com',
      sessionCookieDomain: 'acme.com',
    });

    expect(headers['Strict-Transport-Security']).toMatch(/max-age=/);
    expect(headers['Strict-Transport-Security']).toMatch(/includeSubDomains/);
    expect(headers['X-Frame-Options']).toBe('SAMEORIGIN');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Content-Security-Policy']).toMatch(/https:\/\/login\.acme\.com/);
    expect(headers['Content-Security-Policy']).not.toMatch(/workers\.dev/);
    expect(headers['Referrer-Policy']).toBeTruthy();
    expect(headers['X-Auth-Cookie-Domain']).toBe('acme.com');
  });

  it('emits X-Frame-Options: DENY when framePolicy is DENY', () => {
    const headers = buildAuthSecurityHeaders({}, { framePolicy: 'DENY' });
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Content-Security-Policy']).toMatch(/frame-ancestors 'none'/);
  });

  it('falls back to safe defaults when no loginHostname configured', () => {
    const headers = buildAuthSecurityHeaders({});
    expect(headers['Strict-Transport-Security']).toBeTruthy();
    expect(headers['Content-Security-Policy']).toMatch(/default-src 'self'/);
    expect(headers['X-Auth-Cookie-Domain']).toBeUndefined();
  });
});

// ─── Prompt 5: buildAuthAuditEvent + writeAuthAuditEvent + exportAuthAuditLog ─

describe('buildAuthAuditEvent', () => {
  it('builds a standardized event with all expected fields', () => {
    const event = buildAuthAuditEvent({
      siteId: 'ACME-Tenant',
      action: AUTH_EVENT_ACTION.LOGIN_SUCCESS,
      actorEmail: 'ADMIN@ACME.COM',
      ipAddress: '203.0.113.5',
      source: 'auth-worker',
    });

    expect(event.siteId).toBe('acme-tenant'); // normalised to lowercase
    expect(event.action).toBe('auth.login.success');
    expect(event.actorEmail).toBe('admin@acme.com');
    expect(event.ipAddress).toBe('203.0.113.5');
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.eventId).toBeTruthy();
    expect(event.outcome).toBe('success');
  });

  it('accepts unknown action strings without throwing', () => {
    const event = buildAuthAuditEvent({ action: 'custom.sso.bypass', siteId: 'test' });
    expect(event.action).toBe('custom.sso.bypass');
  });
});

describe('writeAuthAuditEvent', () => {
  it('writes to KV and returns the event', async () => {
    const written = [];
    const mockKv = {
      put: async (key, value) => { written.push({ key, value }); },
    };
    const event = await writeAuthAuditEvent({ KV_CONFIG: mockKv }, 'acme', {
      action: AUTH_EVENT_ACTION.LOGOUT,
      actorId: 'user-42',
    });

    expect(event).not.toBeNull();
    expect(event.action).toBe(AUTH_EVENT_ACTION.LOGOUT);
    expect(written).toHaveLength(1);
    expect(written[0].key).toMatch(/^auth-audit:acme:/);
  });

  it('returns null when KV is unavailable', async () => {
    const result = await writeAuthAuditEvent({}, 'acme', { action: AUTH_EVENT_ACTION.LOGIN_FAILURE });
    expect(result).toBeNull();
  });
});

describe('exportAuthAuditLog', () => {
  it('returns entries in JSONL format by default', async () => {
    const storedEvent = buildAuthAuditEvent({
      siteId: 'demo',
      action: AUTH_EVENT_ACTION.MFA_ENROLLED,
      actorId: 'user-1',
    });
    const mockKv = {
      list: async () => ({
        keys: [{ name: `auth-audit:demo:${storedEvent.eventId}` }],
        list_complete: true,
      }),
      get: async () => JSON.stringify(storedEvent),
    };

    const result = await exportAuthAuditLog({ KV_CONFIG: mockKv }, 'demo');
    expect(result.format).toBe(AUTH_AUDIT_EXPORT_FORMAT.JSONL);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].action).toBe(AUTH_EVENT_ACTION.MFA_ENROLLED);
    expect(result.truncated).toBe(false);
  });

  it('returns CEF strings when format=cef requested', async () => {
    const storedEvent = buildAuthAuditEvent({
      siteId: 'demo',
      action: AUTH_EVENT_ACTION.SSO_COMPLETED,
      actorId: 'user-2',
      outcome: 'success',
    });
    const mockKv = {
      list: async () => ({
        keys: [{ name: `auth-audit:demo:${storedEvent.eventId}` }],
        list_complete: true,
      }),
      get: async () => JSON.stringify(storedEvent),
    };

    const result = await exportAuthAuditLog({ KV_CONFIG: mockKv }, 'demo', { format: 'cef' });
    expect(result.format).toBe('cef');
    expect(result.entries[0]).toMatch(/^CEF:0\|cloudflare-wl-platform\|auth/);
    expect(result.entries[0]).toMatch(/auth\.sso\.completed/);
  });
});
