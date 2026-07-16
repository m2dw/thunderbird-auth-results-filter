/**
 * Pure helpers for generating authserv-id setup suggestions from account
 * email domains.  Heuristic suggestions require no external requests.
 * MX-based suggestions use DNS over HTTPS via mxLookup.js when opted in.
 */

/** Common inbound-authentication-server hostname prefixes. */
const HEURISTIC_PREFIXES = ['', 'mail.', 'mx.', 'imap.', 'pop.', 'smtp.'];

/**
 * Extract the domain part of an email address.
 * Returns null for malformed or non-string input.
 *
 * @param {string} email
 * @returns {string|null}
 */
export function extractEmailDomain(email) {
  if (typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

/**
 * Generate heuristic authserv-id candidate suggestions for a single domain.
 * Produces common mail-server hostname patterns: bare domain, mail., mx.,
 * imap., pop., smtp.
 *
 * @param {string} domain - Lowercase domain name.
 * @returns {Array<{host: string, source: 'heuristic', domain: string}>}
 */
export function generateHeuristicSuggestions(domain) {
  if (!domain || typeof domain !== 'string') return [];
  const d = domain.toLowerCase().trim();
  if (!d) return [];
  return HEURISTIC_PREFIXES.map(prefix => ({
    host: prefix + d,
    source: 'heuristic',
    domain: d,
  }));
}

/**
 * Generate deduplicated authserv-id suggestions from an array of email
 * addresses.  Extracts unique account domains and produces heuristic host
 * candidates for each.  Suggestions are NOT trusted entries — the user must
 * confirm each one explicitly.
 *
 * @param {string[]} emails - Email addresses from account identities.
 * @returns {Array<{host: string, source: string, domain: string}>}
 */
export function generateSuggestionsFromEmails(emails) {
  if (!Array.isArray(emails)) return [];

  const seenDomains = new Set();
  const seenHosts = new Set();
  const result = [];

  for (const email of emails) {
    const domain = extractEmailDomain(email);
    if (!domain || seenDomains.has(domain)) continue;
    seenDomains.add(domain);
    for (const s of generateHeuristicSuggestions(domain)) {
      if (!seenHosts.has(s.host)) {
        seenHosts.add(s.host);
        result.push(s);
      }
    }
  }

  return result;
}

/**
 * Build suggestion objects from a list of MX exchange hostnames.
 * Deduplicates hosts and tags each entry with source: 'mx'.
 *
 * @param {string[]} hosts  - MX exchange hostnames (already lowercased).
 * @param {string}   domain - Account domain these hosts were found for.
 * @returns {Array<{host: string, source: 'mx', domain: string}>}
 */
export function generateMxSuggestionsFromHosts(hosts, domain) {
  if (!Array.isArray(hosts) || !domain || typeof domain !== 'string') return [];
  const seenHosts = new Set();
  const result = [];
  for (const host of hosts) {
    if (!host || typeof host !== 'string') continue;
    const h = host.toLowerCase().trim();
    if (!h || seenHosts.has(h)) continue;
    seenHosts.add(h);
    result.push({ host: h, source: 'mx', domain: domain.toLowerCase() });
  }
  return result;
}
