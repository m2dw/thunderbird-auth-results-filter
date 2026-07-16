/**
 * MX lookup via DNS over HTTPS (DoH) for setup hints only.
 * Used exclusively by the setup assistant to suggest authserv-id candidates.
 * Never called during normal message scoring.
 *
 * Sends the account domain to the configured DoH resolver.
 * Users must explicitly add any suggested entry — nothing is auto-trusted.
 */

// Google Public DNS IPs expose JSON at dns.google/resolve; /dns-query is RFC 8484 wire only.
const GOOGLE_DNS_IPS = new Set(['8.8.8.8', '8.8.4.4']);

/**
 * Resolvers permitted by manifest host permissions.
 * Only these values produce a valid DoH URL; all others are rejected.
 * Manifest entries: *://dns.google/*, *://cloudflare-dns.com/*, *://1.1.1.1/*, *://1.0.0.1/*
 */
export const PERMITTED_RESOLVERS = new Set([
  '8.8.8.8',
  '8.8.4.4',
  '1.1.1.1',
  '1.0.0.1',
  'cloudflare-dns.com',
]);

/**
 * Map a resolver IP/hostname to a DoH JSON endpoint URL.
 * Returns null for empty/invalid input or resolvers not covered by manifest permissions.
 *
 * @param {string} resolver - IP address or hostname from PERMITTED_RESOLVERS.
 * @returns {string|null}
 */
export function resolverToDoHUrl(resolver) {
  if (!resolver || typeof resolver !== 'string') return null;
  const r = resolver.trim();
  if (!r || !PERMITTED_RESOLVERS.has(r)) return null;
  if (GOOGLE_DNS_IPS.has(r)) return 'https://dns.google/resolve';
  return `https://${r}/dns-query`;
}

/**
 * Parse MX records from a DoH JSON answer array.
 * Handles missing, null, or malformed answers gracefully.
 *
 * @param {Array|undefined} answer - The Answer array from a DoH JSON response.
 * @returns {Array<{exchange: string, priority: number}>}
 */
export function parseMxAnswer(answer) {
  if (!Array.isArray(answer)) return [];
  const results = [];
  for (const record of answer) {
    if (!record || record.type !== 15) continue;
    const parts = String(record.data ?? '').trim().split(/\s+/);
    if (parts.length < 2) continue;
    const priority = parseInt(parts[0], 10);
    const exchange = parts[1].replace(/\.$/, '').toLowerCase();
    if (exchange) {
      results.push({ exchange, priority: isNaN(priority) ? 10 : priority });
    }
  }
  return results;
}

/**
 * Look up MX records for a domain via DoH.
 * Returns a result object — never throws.
 *
 * @param {string} domain       - Domain to query.
 * @param {string} resolver     - Resolver IP/hostname (e.g. "8.8.8.8").
 * @param {number} [timeoutMs]  - Abort timeout in milliseconds (default 5000).
 * @returns {Promise<{ok: true, hosts: string[]} | {ok: false, error: string}>}
 */
export async function lookupMxHosts(domain, resolver, timeoutMs = 5000) {
  const dohBase = resolverToDoHUrl(resolver);
  if (!dohBase) return { ok: false, error: 'invalid_resolver' };

  const url = `${dohBase}?name=${encodeURIComponent(domain)}&type=MX`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      headers: { Accept: 'application/dns-json' },
      signal: controller.signal,
    });
    if (!resp.ok) return { ok: false, error: `http_error` };
    const json = await resp.json();
    if (json.Status !== 0) {
      return json.Status === 3
        ? { ok: true, hosts: [] }  // NXDOMAIN — domain simply has no MX
        : { ok: false, error: 'dns_error' };
    }
    const records = parseMxAnswer(json.Answer);
    // Sort by priority (lowest = highest preference).
    records.sort((a, b) => a.priority - b.priority);
    return { ok: true, hosts: records.map(r => r.exchange) };
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, error: 'timeout' };
    return { ok: false, error: 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}
