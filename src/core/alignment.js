/**
 * Layer 2: Sender Alignment Metrics
 *
 * Computes alignment between the RFC5322 From domain and the SPF / DKIM /
 * DMARC results found in trusted Authentication-Results headers.
 *
 * Alignment is checked at the registrable-domain level using the full PSL
 * via getDomainParts(). Entries from untrusted authserv-ids are ignored
 * entirely so they cannot influence the summary booleans.
 *
 * These metrics are observability-only — they do not affect classification.
 */

import { getDomainParts } from './domainParts.js';
import { isTrustedAuthservId } from './trust.js';

/**
 * Extract the domain portion from an email address or bare domain string.
 * If the value contains '@', everything after it is returned; otherwise the
 * whole value is returned (lowercased). Returns null for empty/falsy input.
 *
 * @param {string|null} value
 * @returns {string|null}
 */
function emailToDomain(value) {
  if (!value) return null;
  const at = value.indexOf('@');
  return at >= 0 ? value.slice(at + 1).toLowerCase() : value.toLowerCase();
}

/**
 * Resolve the DKIM signing domain from an Authentication-Results property map.
 *
 * Priority:
 *   1. `header.d`
 *   2. bare `d`
 *   3. domain portion of `header.i` / bare `i` (the part after '@')
 *
 * Returns null when no usable domain can be derived (missing, empty, or
 * malformed `header.i` without an '@').
 *
 * @param {object|null|undefined} properties
 * @returns {string|null}
 */
export function resolveDkimDomain(properties) {
  const d = properties?.['header.d'] ?? properties?.['d'] ?? null;
  if (d) return d;
  const i = properties?.['header.i'] ?? properties?.['i'] ?? null;
  if (!i) return null;
  const at = i.indexOf('@');
  if (at < 0) return null;
  const domain = i.slice(at + 1).toLowerCase();
  return domain || null;
}

/**
 * Compute Layer 2 alignment metrics from parsed Authentication-Results.
 *
 * For DMARC and SPF the first matching result across all trusted headers is
 * used; subsequent occurrences are ignored. For DKIM all results from all
 * trusted headers are collected (multiple signatures are common).
 *
 * @param {object} opts
 * @param {Array}  opts.parsedAuthResults - Output of parseAllAuthResults (with properties).
 * @param {Array}  opts.trustedDomains    - Trusted-domain list from storage.
 * @param {string} [opts.fromDomain]      - RFC5322 From domain (lowercased).
 * @returns {{
 *   from:    { domain: string|null, registrableDomain: string|null },
 *   dmarc:   { result: string, headerFrom: string|null, headerFromRegistrableDomain: string|null } | null,
 *   spf:     { result: string, smtpMailFrom: string|null, smtpMailFromDomain: string|null,
 *               smtpMailFromRegistrableDomain: string|null, smtpMailFromSubdomainDepth: number|null,
 *               alignedWithFrom: boolean } | null,
 *   dkim:    Array<{ result: string, domain: string|null, registrableDomain: string|null, subdomainDepth: number|null, alignedWithFrom: boolean }>,
 *   summary: { spfAligned: boolean, anyDkimAligned: boolean, anyAuthAligned: boolean }
 * }}
 */
export function computeAlignmentMetrics({ parsedAuthResults = [], trustedDomains = [], fromDomain = '' } = {}) {
  const fromParts = getDomainParts(fromDomain);

  const from = {
    domain: fromDomain || null,
    registrableDomain: fromParts.registrableDomain,
  };

  let dmarc = null;
  let spf = null;
  const dkim = [];

  for (const ar of parsedAuthResults) {
    if (!isTrustedAuthservId(ar.authservId, trustedDomains)) continue;

    for (const r of ar.results) {
      // DMARC — take first occurrence only.
      if (r.method === 'dmarc' && dmarc === null) {
        const rawHeaderFrom = r.properties?.['header.from'] ?? null;
        const headerFromDomain = emailToDomain(rawHeaderFrom);
        const hfParts = headerFromDomain ? getDomainParts(headerFromDomain) : null;
        dmarc = {
          result: r.result,
          headerFrom: headerFromDomain,
          headerFromRegistrableDomain: hfParts?.registrableDomain ?? null,
        };
      }

      // SPF — take first occurrence only.
      if (r.method === 'spf' && spf === null) {
        const rawSmtp = r.properties?.['smtp.mailfrom'] ?? null;
        const smtpDomain = emailToDomain(rawSmtp);
        const smtpParts = smtpDomain ? getDomainParts(smtpDomain) : null;
        const aligned =
          smtpParts?.registrableDomain != null &&
          fromParts.registrableDomain != null &&
          smtpParts.registrableDomain === fromParts.registrableDomain;
        spf = {
          result: r.result,
          smtpMailFrom: rawSmtp,
          smtpMailFromDomain: smtpDomain,
          smtpMailFromRegistrableDomain: smtpParts?.registrableDomain ?? null,
          smtpMailFromSubdomainDepth: smtpParts ? smtpParts.subdomainDepth : null,
          alignedWithFrom: aligned,
        };
      }

      // DKIM — collect all occurrences.
      if (r.method === 'dkim') {
        const domain = resolveDkimDomain(r.properties);
        const dkimParts = domain ? getDomainParts(domain) : null;
        const aligned =
          dkimParts?.registrableDomain != null &&
          fromParts.registrableDomain != null &&
          dkimParts.registrableDomain === fromParts.registrableDomain;
        dkim.push({
          result: r.result,
          domain,
          registrableDomain: dkimParts?.registrableDomain ?? null,
          subdomainDepth: dkimParts ? dkimParts.subdomainDepth : null,
          alignedWithFrom: aligned,
        });
      }
    }
  }

  const summary = {
    spfAligned: spf?.alignedWithFrom ?? false,
    anyDkimAligned: dkim.some(d => d.alignedWithFrom),
    anyAuthAligned: (spf?.alignedWithFrom ?? false) || dkim.some(d => d.alignedWithFrom),
  };

  return { from, dmarc, spf, dkim, summary };
}

/**
 * Compute pass-only alignment summary for Layer 4 composite rules.
 *
 * Unlike computeAlignmentMetrics(), this function:
 *   - Considers only results with result === 'pass'.
 *   - Scans ALL trusted SPF results (not just the first) so a later
 *     aligned SPF pass is not missed when an earlier SPF result was non-pass.
 *
 * This prevents non-pass aligned results (e.g. spf=fail smtp.mailfrom=example.com)
 * from incorrectly triggering Layer 4 composite scoring.
 *
 * @param {object} opts
 * @param {Array}  opts.parsedAuthResults - Output of parseAllAuthResults.
 * @param {Array}  opts.trustedDomains    - Trusted-domain list.
 * @param {string} [opts.fromDomain]      - RFC5322 From domain (lowercased).
 * @returns {{ spfAligned: boolean, anyDkimAligned: boolean, anyAuthAligned: boolean, anyTrustedAuthPass: boolean, spfMailFromRegistrableDomain: string|null, anyTrustedSpfPass: boolean, anyTrustedDkimFail: boolean, dkimFailDomains: string[], anyTrustedDmarcFail: boolean, anyTrustedDmarcPass: boolean, anyTrustedDmarcNonNone: boolean, anyTrustedDmarcNone: boolean, anyTrustedSpfFail: boolean, spfFailMailFromRegistrableDomain: string|null }}
 */
export function computePassAlignmentSummary({ parsedAuthResults = [], trustedDomains = [], fromDomain = '' } = {}) {
  const fromParts = getDomainParts(fromDomain);
  if (fromParts.registrableDomain === null) {
    // Alignment flags are all false because there is no registrable From domain
    // to align against, but anyTrustedAuthPass must still be computed so that
    // the composite.unparseableFromWithInfrastructureMismatch guardrail can be
    // suppressed when a trusted infrastructure auth pass vouches for the sender.
    let anyTrustedAuthPass = false;
    outer: for (const ar of parsedAuthResults) {
      if (!isTrustedAuthservId(ar.authservId, trustedDomains)) continue;
      for (const r of ar.results) {
        if (r.result !== 'pass') continue;
        if (r.method === 'spf') {
          const rawMailFrom = r.properties?.['smtp.mailfrom'] ?? null;
          const rawHelo = r.properties?.['smtp.helo'] ?? null;
          const rawSmtp = rawMailFrom || rawHelo;
          if (!rawSmtp) continue;
          const atIdx = rawSmtp.indexOf('@');
          const smtpDomain = (atIdx >= 0 ? rawSmtp.slice(atIdx + 1) : rawSmtp).toLowerCase();
          if (getDomainParts(smtpDomain).registrableDomain !== null) { anyTrustedAuthPass = true; break outer; }
        }
        if (r.method === 'dkim') {
          const domain = resolveDkimDomain(r.properties);
          if (domain && getDomainParts(domain).registrableDomain !== null) { anyTrustedAuthPass = true; break outer; }
        }
      }
    }
    return {
      spfAligned: false,
      anyDkimAligned: false,
      anyAuthAligned: false,
      anyTrustedAuthPass,
      spfMailFromRegistrableDomain: null,
      anyTrustedSpfPass: false,
      anyTrustedDkimFail: false,
      dkimFailDomains: [],
      anyTrustedDmarcFail: false,
      anyTrustedDmarcPass: false,
      anyTrustedDmarcNonNone: false,
      anyTrustedDmarcNone: false,
      anyTrustedSpfFail: false,
      spfFailMailFromRegistrableDomain: null,
    };
  }

  let spfAligned = false;
  let anyDkimAligned = false;
  let anyTrustedAuthPass = false;
  let spfMailFromRegistrableDomain = null;
  let anyTrustedSpfPass = false;
  let anyTrustedDkimFail = false;
  let anyTrustedDmarcFail = false;
  let anyTrustedDmarcPass = false;
  let anyTrustedDmarcNonNone = false;
  let anyTrustedDmarcNone = false;
  let anyTrustedSpfFail = false;
  let spfFailMailFromRegistrableDomain = null;
  const dkimFailDomainsSet = new Set();

  for (const ar of parsedAuthResults) {
    if (!isTrustedAuthservId(ar.authservId, trustedDomains)) continue;
    for (const r of ar.results) {
      // Track fail results before the pass-only filter below.
      if (r.method === 'dkim' && r.result === 'fail') {
        anyTrustedDkimFail = true;
        const failDomain = resolveDkimDomain(r.properties);
        if (failDomain) dkimFailDomainsSet.add(failDomain.toLowerCase());
      }
      if (r.method === 'dmarc' && r.result === 'fail') {
        anyTrustedDmarcFail = true;
      }
      if (r.method === 'dmarc' && r.result === 'pass') {
        anyTrustedDmarcPass = true;
      }
      if (r.method === 'dmarc' && r.result !== 'none') {
        anyTrustedDmarcNonNone = true;
      }
      if (r.method === 'dmarc' && r.result === 'none') {
        anyTrustedDmarcNone = true;
      }
      if (r.method === 'spf' && r.result === 'fail') {
        anyTrustedSpfFail = true;
        if (spfFailMailFromRegistrableDomain === null) {
          const rawSmtp = r.properties?.['smtp.mailfrom'] ?? null;
          if (rawSmtp) {
            const atIdx = rawSmtp.indexOf('@');
            const smtpDomain = (atIdx >= 0 ? rawSmtp.slice(atIdx + 1) : rawSmtp).toLowerCase();
            const smtpParts = getDomainParts(smtpDomain);
            if (smtpParts.registrableDomain !== null) {
              spfFailMailFromRegistrableDomain = smtpParts.registrableDomain;
            }
          }
        }
      }

      if (r.result !== 'pass') continue;

      if (r.method === 'spf') {
        anyTrustedSpfPass = true;
        const rawSmtp = r.properties?.['smtp.mailfrom'] ?? null;
        if (!rawSmtp) continue;
        const atIdx = rawSmtp.indexOf('@');
        const smtpDomain = (atIdx >= 0 ? rawSmtp.slice(atIdx + 1) : rawSmtp).toLowerCase();
        const smtpParts = getDomainParts(smtpDomain);
        if (smtpParts.registrableDomain === null) continue;
        anyTrustedAuthPass = true;
        if (spfMailFromRegistrableDomain === null) {
          spfMailFromRegistrableDomain = smtpParts.registrableDomain;
        }
        if (smtpParts.registrableDomain === fromParts.registrableDomain) {
          spfAligned = true;
        }
      }

      if (r.method === 'dkim') {
        const domain = resolveDkimDomain(r.properties);
        if (!domain) continue;
        const dkimParts = getDomainParts(domain);
        if (dkimParts.registrableDomain === null) continue;
        anyTrustedAuthPass = true;
        if (dkimParts.registrableDomain === fromParts.registrableDomain) {
          anyDkimAligned = true;
        }
      }
    }
  }

  return {
    spfAligned,
    anyDkimAligned,
    anyAuthAligned: spfAligned || anyDkimAligned,
    anyTrustedAuthPass,
    spfMailFromRegistrableDomain,
    anyTrustedSpfPass,
    anyTrustedDkimFail,
    dkimFailDomains: [...dkimFailDomainsSet],
    anyTrustedDmarcFail,
    anyTrustedDmarcPass,
    anyTrustedDmarcNonNone,
    anyTrustedDmarcNone,
    anyTrustedSpfFail,
    spfFailMailFromRegistrableDomain,
  };
}
