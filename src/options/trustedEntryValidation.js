import { extractRegistrableDomain } from '../core/psl.js';

const HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i;

export function isValidHostname(value) {
  return typeof value === 'string' && HOSTNAME_RE.test(value);
}

/**
 * Validate a candidate trusted entry before adding it.
 * Returns null if valid, or a human-readable error string if not.
 *
 * @param {string} value          - Raw input value (may have leading/trailing spaces).
 * @param {'exact'|'domain'} matchType
 * @param {Array}  existingEntries - Current trustedDomains array.
 * @returns {string|null}
 */
/**
 * For a trusted exact-host entry, return the registrable domain if a
 * domain-trust promotion action should be offered, or null if not safe to show.
 *
 * Returns null when:
 *   - the host has no registrable domain (it is itself a public suffix or invalid)
 *   - a domain trust entry for the derived registrable domain already exists
 *
 * @param {string} exactHostValue - The exact-host trust entry value (any case).
 * @param {Array}  trustedDomains - Current trusted entries.
 * @returns {string|null}
 */
export function getPromotableRegistrableDomain(exactHostValue, trustedDomains) {
  if (!isValidHostname(exactHostValue)) return null;
  const reg = extractRegistrableDomain(exactHostValue.toLowerCase());
  if (!reg) return null;
  if (trustedDomains.some(
    d => d && typeof d === 'object' && d.value === reg && d.matchType === 'domain',
  )) return null;
  return reg;
}

export function validateTrustedEntry(value, matchType, existingEntries) {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return 'Value cannot be empty.';
  if (!isValidHostname(trimmed)) {
    return 'Invalid hostname: use letters, digits, hyphens, and dots only.';
  }
  const lower = trimmed.toLowerCase();
  if (matchType === 'domain') {
    const reg = extractRegistrableDomain(lower);
    if (!reg) return 'This value is a public suffix and cannot be used for domain trust.';
    if (reg !== lower) return `For registrable-domain trust, enter the registrable domain itself (e.g. ${reg}, not ${lower}).`;
  }
  const duplicate = existingEntries.some(
    e => e && typeof e === 'object'
      && typeof e.value === 'string'
      && e.value.toLowerCase() === lower
      && e.matchType === matchType,
  );
  if (duplicate) return 'This entry already exists in the trusted list.';
  return null;
}
