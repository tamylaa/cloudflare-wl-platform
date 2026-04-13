// cloudflare-wl-platform — tenancy/domain-control
// Public surface for domain-control config utilities.
/**
 * Domain Control — tenant-level custom-domain, SSL, help-centre, and email-auth.
 *
 * Canonical platform module. Provides both the low-level domain helpers and the
 * higher-level DomainRoutingService / DomainBrandingService split-surface API.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const DOMAIN_CONTROL_STATUS = Object.freeze({
    UNCONFIGURED: 'unconfigured',
    PENDING_DNS: 'pending_dns',
    PROVISIONING: 'provisioning',
    ACTIVE: 'active',
    ERROR: 'error',
});

export const EMAIL_AUTH_STATUS = Object.freeze({
    UNCONFIGURED: 'unconfigured',
    PENDING_DNS: 'pending_dns',
    VERIFYING: 'verifying',
    ACTIVE: 'active',
    ERROR: 'error',
});

export const DOMAIN_CONTROL_STATUS_VALUES = Object.freeze(Object.values(DOMAIN_CONTROL_STATUS));
export const EMAIL_AUTH_STATUS_VALUES = Object.freeze(Object.values(EMAIL_AUTH_STATUS));

// ─── Low-level helpers ────────────────────────────────────────────────────────

function safeString(value = '') {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Normalize a hostname-like value by stripping protocol, path, port, and casing.
 * @param {string} value
 * @returns {string}
 */
export function normalizeHostname(value = '') {
    let hostname = safeString(value).toLowerCase();
    if (!hostname) {
        return '';
    }

    hostname = hostname.replace(/^https?:\/\//, '');
    hostname = hostname.split('/')[0] || '';
    hostname = hostname.split(':')[0] || '';
    hostname = hostname.replace(/^\.+|\.+$/g, '');
    return hostname;
}

/**
 * Check if a hostname is an internal / private IP address that should not be reachable.
 * Blocks localhost, private ranges (10.x, 172.16-31.x, 192.168.x), link-local, and loopback.
 * @param {string} hostname
 * @returns {boolean} true if hostname is internal/private
 */
function isInternalIp(hostname) {
    if (!hostname) return false;
    
    const lower = hostname.toLowerCase();
    
    // IPv4 ranges
    if (/^127\./.test(lower)) return true;           // 127.0.0.x loopback
    if (/^10\./.test(lower)) return true;            // 10.0.0.0/8 private
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(lower)) return true; // 172.16-31.x private
    if (/^192\.168\./.test(lower)) return true;      // 192.168.x.x private
    if (/^169\.254\./.test(lower)) return true;      // 169.254.x.x link-local
    
    // IPv6 ranges
    if (lower === '::1') return true;                // loopback
    if (/^fc00:|^fe80:/.test(lower)) return true;    // fc00::/7 unique local, fe80::/10 link-local
    
    // Special hostnames
    if (lower === 'localhost') return true;
    if (lower === 'localhost.localdomain') return true;
    
    return false;
}

/**
 * Normalize a URL-like value to an absolute http/https URL string.
 * 
 * SECURITY: Rejects internal/private IP addresses to prevent SSRF attacks.
 * Also strips embedded credentials (userinfo) from URLs.
 * 
 * @param {string} value
 * @returns {string} Safe HTTPS URL or empty string if invalid
 */
export function normalizeUrl(value = '') {
    const raw = safeString(value);
    if (!raw) {
        return '';
    }

    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
        const url = new URL(withProtocol);
        
        // Reject non-HTTP protocols
        if (!/^https?:$/i.test(url.protocol)) {
            return '';
        }

        // CRITICAL FIX: Reject internal/private IP addresses (SSRF protection)
        const hostname = url.hostname;
        if (isInternalIp(hostname)) {
            console.warn(`[DomainControl] Rejected URL with internal IP: ${hostname}`);
            return '';
        }

        // Reconstruct URL without embedded credentials (userinfo)
        // This prevents URLs like https://user:pass@attacker.com from leaking credentials
        return `${url.protocol}//${url.host}${url.pathname}${url.search}`.replace(/\/$/, '');
    } catch {
        return '';
    }
}

/**
 * Build a public https origin from a hostname.
 * @param {string} hostname
 * @returns {string}
 */
export function toHttpsOrigin(hostname = '') {
    const normalized = normalizeHostname(hostname);
    return normalized ? `https://${normalized}` : '';
}

/**
 * Normalize a sending domain / email-auth domain.
 * @param {string} value
 * @returns {string}
 */
export function normalizeEmailDomain(value = '') {
    const normalized = normalizeHostname(value);
    return normalized.replace(/^@+/, '');
}

/**
 * Resolve an instance domain-control config into a normalized shape.
 * Missing values fall back to empty strings or unconfigured statuses.
 *
 * @param {object} [config]
 * @returns {{
 *   appHostname: string,
 *   appOrigin: string,
 *   docsUrl: string,
 *   helpCenterUrl: string,
 *   supportPortalUrl: string,
 *   supportEmail: string,
 *   sendingDomain: string,
 *   dnsTarget: string,
 *   domainStatus: string,
 *   sslStatus: string,
 *   emailAuthStatus: string,
 *   notes: string,
 * }}
 */
export function resolveDomainControl(config = {}) {
    const appHostname = normalizeHostname(config.appHostname || config.hostname);
    const appOrigin = normalizeUrl(config.appOrigin || config.siteUrl || toHttpsOrigin(appHostname));
    const docsUrl = normalizeUrl(config.docsUrl || config.helpCenterUrl || config.supportPortalUrl);
    const helpCenterUrl = normalizeUrl(config.helpCenterUrl || config.docsUrl || docsUrl);
    const supportPortalUrl = normalizeUrl(
        config.supportPortalUrl || config.helpCenterUrl || config.docsUrl || helpCenterUrl || docsUrl
    );
    const supportEmail = safeString(config.supportEmail).toLowerCase();
    const sendingDomain = normalizeEmailDomain(config.sendingDomain || config.emailFromDomain);
    const dnsTarget = normalizeHostname(config.dnsTarget);
    const domainStatus = DOMAIN_CONTROL_STATUS_VALUES.includes(config.domainStatus)
        ? config.domainStatus
        : DOMAIN_CONTROL_STATUS.UNCONFIGURED;
    const sslStatus = DOMAIN_CONTROL_STATUS_VALUES.includes(config.sslStatus)
        ? config.sslStatus
        : DOMAIN_CONTROL_STATUS.UNCONFIGURED;
    const emailAuthStatus = EMAIL_AUTH_STATUS_VALUES.includes(config.emailAuthStatus)
        ? config.emailAuthStatus
        : EMAIL_AUTH_STATUS.UNCONFIGURED;
    const notes = safeString(config.notes);

    return {
        appHostname,
        appOrigin,
        docsUrl,
        helpCenterUrl,
        supportPortalUrl,
        supportEmail,
        sendingDomain,
        dnsTarget,
        domainStatus,
        sslStatus,
        emailAuthStatus,
        notes,
    };
}

// ─── DomainRoutingService ─────────────────────────────────────────────────────
//
// Routing-identity fields: appHostname, appOrigin, domainStatus, sslStatus, dnsTarget.
// Safe to call at middleware time — fast and stateless, no async I/O.

function extractRoutingIdentity(domainControl) {
    const resolved = resolveDomainControl(domainControl);
    return {
        appHostname: resolved.appHostname,
        appOrigin: resolved.appOrigin || toHttpsOrigin(resolved.appHostname),
        domainStatus: resolved.domainStatus,
        sslStatus: resolved.sslStatus,
        dnsTarget: resolved.dnsTarget,
    };
}

function isHostnameActive(domainControl) {
    const { domainStatus } = extractRoutingIdentity(domainControl);
    return domainStatus === DOMAIN_CONTROL_STATUS.ACTIVE;
}

function isSslActive(domainControl) {
    const { sslStatus } = extractRoutingIdentity(domainControl);
    return sslStatus === DOMAIN_CONTROL_STATUS.ACTIVE;
}

export const DomainRoutingService = Object.freeze({
    extractRoutingIdentity,
    isHostnameActive,
    isSslActive,
});

// ─── DomainBrandingService ────────────────────────────────────────────────────
//
// Brand/support config fields: docsUrl, helpCenterUrl, supportPortalUrl,
// supportEmail, sendingDomain, emailAuthStatus, notes.
// Used inside handlers at render time.

function extractBrandingConfig(domainControl) {
    const resolved = resolveDomainControl(domainControl);
    return {
        docsUrl: resolved.docsUrl,
        helpCenterUrl: resolved.helpCenterUrl,
        supportPortalUrl: resolved.supportPortalUrl,
        supportEmail: resolved.supportEmail,
        statusPageUrl: typeof domainControl?.statusPageUrl === 'string' ? domainControl.statusPageUrl : '',
        incidentReportingUrl:
            typeof domainControl?.incidentReportingUrl === 'string' ? domainControl.incidentReportingUrl : '',
        onboardingUrl: typeof domainControl?.onboardingUrl === 'string' ? domainControl.onboardingUrl : '',
        sendingDomain: resolved.sendingDomain,
        emailAuthStatus: resolved.emailAuthStatus,
        notes: resolved.notes,
    };
}

function isBrandedEmailReady(domainControl) {
    const { sendingDomain, emailAuthStatus } = extractBrandingConfig(domainControl);
    return Boolean(sendingDomain) && emailAuthStatus === EMAIL_AUTH_STATUS.ACTIVE;
}

export const DomainBrandingService = Object.freeze({
    extractBrandingConfig,
    isBrandedEmailReady,
});

