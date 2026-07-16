/**
 * PSL-backed domain utilities.
 *
 * Re-exports the full-PSL `getDomainParts` wrapper and keeps
 * `extractRegistrableDomain` as a thin convenience shim for callers that only
 * need the registrable domain string.
 *
 * The old hand-curated PUBLIC_SUFFIXES table has been removed; accuracy is
 * now provided by the full ICANN PSL bundled with tldts.
 */

import { getDomainParts } from './domainParts.js';

export { getDomainParts };

/**
 * Return the registrable domain for a hostname, e.g.
 *   'mail1.foo.example.co.jp' → 'example.co.jp'
 *   'mail1.foo.bar.example.jp' → 'example.jp'
 * Returns null when the hostname is itself a public suffix or is empty.
 */
export function extractRegistrableDomain(hostname) {
  return getDomainParts(hostname).registrableDomain;
}
