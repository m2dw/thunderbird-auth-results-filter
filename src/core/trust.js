/**
 * Return true if authservId is covered by any entry in trustedDomains.
 *
 * Each entry must be a typed object { value: string, matchType: 'exact' | 'domain' }.
 * Malformed or unknown entries are silently ignored.
 *
 *   matchType: 'exact'  — authservId must equal value exactly (no subdomain expansion).
 *                         Used for pre-PSL exact-host trust.
 *   matchType: 'domain' — authservId === value OR authservId ends with '.' + value.
 *                         Reserved for registrable-domain trust once full PSL is available.
 *
 * This deliberately rejects:
 *   evil-example.co.jp  when value = example.co.jp
 *   example.co.jp.evil  when value = example.co.jp
 */
export function isTrustedAuthservId(authservId, trustedDomains) {
  const id = authservId.toLowerCase();
  return trustedDomains.some(entry => {
    if (!entry || typeof entry !== 'object' || typeof entry.value !== 'string') return false;
    const value = entry.value.toLowerCase();
    if (entry.matchType === 'exact') return id === value;
    if (entry.matchType === 'domain') return id === value || id.endsWith('.' + value);
    return false; // Unknown matchType: ignore.
  });
}
