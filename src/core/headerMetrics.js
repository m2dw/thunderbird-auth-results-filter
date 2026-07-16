/**
 * Raw identity header metrics for decision-log observability.
 *
 * Extracts and compares Sender, Reply-To, Return-Path, List-Id, and
 * List-Unsubscribe header values. These metrics are logged only — no scoring
 * changes are made here. They exist so future Layer 2/Layer 4 rules can
 * evaluate identity-header signals without requiring a schema change.
 */

import { parseMailboxAddress } from './messageIdentity.js';
import { getDomainParts } from './domainParts.js';

const LIST_HEADER_MAX_LEN = 200;
const ADDR_MAX_LEN = 200;

/**
 * Extract domain from a parsed mailbox address string (the part after '@').
 * Returns null for an empty or address-less string.
 *
 * @param {string|null} address - Lowercased email address
 * @returns {string|null}
 */
function domainFromAddress(address) {
  if (!address) return null;
  const atIdx = address.indexOf('@');
  if (atIdx === -1) return null;
  return address.slice(atIdx + 1) || null;
}

/**
 * Compute raw identity header metrics from message headers for decision-log storage.
 *
 * All fields default to null / false when headers are absent so callers never
 * need to guard against missing properties.
 *
 * @param {object} [opts]
 * @param {object} [opts.headers]    - Parsed header map (keys lowercase, values string[])
 * @param {string} [opts.fromDomain] - RFC5322 From domain (lowercased)
 * @returns {{
 *   senderHeader:                      string|null,
 *   senderDomain:                      string|null,
 *   senderRegistrableDomain:           string|null,
 *   senderSubdomainDepth:              number|null,
 *   replyToHeader:                     string|null,
 *   replyToDomain:                     string|null,
 *   replyToRegistrableDomain:          string|null,
 *   replyToSubdomainDepth:             number|null,
 *   returnPathHeader:                  string|null,
 *   returnPathDomain:                  string|null,
 *   returnPathRegistrableDomain:       string|null,
 *   returnPathSubdomainDepth:          number|null,
 *   listId:                            string|null,
 *   listUnsubscribe:                   string|null,
 *   senderDomainMatchesFromDomain:     boolean|null,
 *   replyToDomainMatchesFromDomain:    boolean|null,
 *   returnPathDomainMatchesFromDomain: boolean|null,
 *   hasListHeaders:                    boolean,
 * }}
 */
export function computeHeaderMetrics({ headers = {}, fromDomain = '' } = {}) {
  const fromParts = getDomainParts(fromDomain);
  const fromReg = fromParts.registrableDomain;

  function extractAddressMetrics(rawHeader) {
    const full = rawHeader ? (parseMailboxAddress(rawHeader) || null) : null;
    const parsed = full ? full.slice(0, ADDR_MAX_LEN) : null;
    const rawDomain = domainFromAddress(full);
    const domain = rawDomain ? rawDomain.slice(0, ADDR_MAX_LEN) : null;
    const parts = domain ? getDomainParts(domain) : null;
    const registrableDomain = parts?.registrableDomain ?? null;
    const subdomainDepth = parts ? parts.subdomainDepth : null;
    const matchesFrom =
      registrableDomain !== null && fromReg !== null
        ? registrableDomain === fromReg
        : null;
    return { parsed, domain, registrableDomain, subdomainDepth, matchesFrom };
  }

  const sender = extractAddressMetrics(headers['sender']?.[0] ?? null);
  const replyTo = extractAddressMetrics(headers['reply-to']?.[0] ?? null);
  const returnPath = extractAddressMetrics(headers['return-path']?.[0] ?? null);

  const rawListId = headers['list-id']?.[0]?.trim() || null;
  const listId = rawListId ? rawListId.slice(0, LIST_HEADER_MAX_LEN) : null;
  const rawListUnsub = headers['list-unsubscribe']?.[0]?.trim() || null;
  const listUnsubscribe = rawListUnsub ? rawListUnsub.slice(0, LIST_HEADER_MAX_LEN) : null;
  const hasListHeaders = listId !== null || listUnsubscribe !== null;

  return {
    senderHeader:                      sender.parsed,
    senderDomain:                      sender.domain,
    senderRegistrableDomain:           sender.registrableDomain,
    senderSubdomainDepth:              sender.subdomainDepth,
    replyToHeader:                     replyTo.parsed,
    replyToDomain:                     replyTo.domain,
    replyToRegistrableDomain:          replyTo.registrableDomain,
    replyToSubdomainDepth:             replyTo.subdomainDepth,
    returnPathHeader:                  returnPath.parsed,
    returnPathDomain:                  returnPath.domain,
    returnPathRegistrableDomain:       returnPath.registrableDomain,
    returnPathSubdomainDepth:          returnPath.subdomainDepth,
    listId,
    listUnsubscribe,
    senderDomainMatchesFromDomain:     sender.matchesFrom,
    replyToDomainMatchesFromDomain:    replyTo.matchesFrom,
    returnPathDomainMatchesFromDomain: returnPath.matchesFrom,
    hasListHeaders,
  };
}
