/**
 * PSL-backed domain parts utility.
 *
 * Wraps `tldts` to provide structured decomposition of a hostname into its
 * constituent parts (registrable domain, public suffix, subdomain). The raw
 * per-field data is exposed for Layer 2 alignment checks and Layer 3
 * subdomain-depth metrics.
 *
 * tldts is vendored into src/vendor/ by `npm run vendor` (and postinstall).
 * The bundle includes the full ICANN public suffix list plus private domains.
 */

import { parse } from '../vendor/tldts.esm.min.js';

/**
 * Decompose a hostname into its PSL-defined parts.
 *
 * Private domains (e.g. blogspot.com) are recognised when
 * `allowPrivateDomains: true` is in effect, which is the mode used here.
 *
 * @param {string} host - Hostname to parse. Normalised to lowercase.
 * @returns {{
 *   hostname:          string | null,
 *   registrableDomain: string | null,
 *   publicSuffix:      string | null,
 *   subdomain:         string | null,
 *   subdomainDepth:    number,
 *   isIcann:           boolean | null,
 *   isPrivate:         boolean | null
 * }}
 */
export function getDomainParts(host) {
  if (!host) return emptyResult();

  const normalized = host.toLowerCase();
  const parsed = parse(normalized, { allowPrivateDomains: true });

  // tldts returns an empty string for subdomain when the hostname is exactly
  // the registrable domain; normalise to null for consistency.
  const subdomain = parsed.subdomain || null;
  const subdomainDepth = subdomain ? subdomain.split('.').length : 0;

  return {
    hostname: parsed.hostname ?? normalized,
    registrableDomain: parsed.domain ?? null,
    publicSuffix: parsed.publicSuffix ?? null,
    subdomain,
    subdomainDepth,
    isIcann: parsed.isIcann ?? null,
    isPrivate: parsed.isPrivate ?? null,
  };
}

/** Sentinel result for empty / unparseable input. */
function emptyResult() {
  return {
    hostname: null,
    registrableDomain: null,
    publicSuffix: null,
    subdomain: null,
    subdomainDepth: 0,
    isIcann: null,
    isPrivate: null,
  };
}
