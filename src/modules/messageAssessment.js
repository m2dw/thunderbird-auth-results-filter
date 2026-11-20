/**
 * Per-message assessment shared by the new-mail handler and on-demand analysis
 * (rule match report).
 *
 * Given a message's parsed headers and a storage snapshot, runs the full
 * scoring pipeline — trust policy, mail-auth-signal integration, Layer 1–5
 * scoring — and returns the score result together with the intermediate
 * metrics the decision log records.
 *
 * This module performs no side effects: it never moves, flags, or notifies,
 * and never writes storage. Thunderbird lookups that depend on live state
 * (address books, account identities) are injected by the caller so the
 * function stays testable and so callers can cache them per run.
 */

import { isTrustedAuthservId } from '../core/trust.js';
import { extractRegistrableDomain } from '../core/psl.js';
import { scoreMessage } from '../core/scoring.js';
import { computeDisplayNameMetrics } from '../core/displayNameMetrics.js';
import { computePassAlignmentSummary } from '../core/alignment.js';
import { parseMailboxAddress, parseFromHeader, parseMessageIdDomain } from '../core/messageIdentity.js';
import { computeMessageIdMetrics } from '../core/compositeRules.js';
import { computeHeaderMetrics } from '../core/headerMetrics.js';
import { analyzeMailAuthSignals, adaptAuthResults, adaptCompositeSignals } from './mailAuthSignalAdapter.js';

/**
 * Assess one message.
 *
 * @param {object} opts
 * @param {object} opts.headers   - Lower-cased header map as returned by browser.messages.getFull().headers.
 * @param {string|null} [opts.accountId] - Receiving account id (message.folder.accountId).
 * @param {object} opts.data      - Storage snapshot from getStorage().
 * @param {object} [opts.lookups]
 * @param {(address: string) => Promise<boolean>} [opts.lookups.isEmailInAddressBook]
 *   Called only when settings.addressBookWhitelistEnabled is true and a sender address exists.
 * @param {(accountId: string|null) => Promise<string[]>} [opts.lookups.getAccountDomains]
 * @returns {Promise<object>} { result, parsed, metrics, fromDomain, fromLocalPart, messageIdDomain,
 *   headerMetrics, displayNameMetrics, fromParseMetrics, messageIdMetrics }
 */
export async function assessMessage({ headers, accountId = null, data, lookups = {} }) {
  const { trustedDomains, senderDomainRules, manualWhitelist, settings } = data;
  const isEmailInAddressBook = lookups.isEmailInAddressBook ?? (async () => false);
  const getAccountDomains = lookups.getAccountDomains ?? (async () => []);

  // Build trustedAuthservIds by extracting authserv-ids that actually appear in
  // Authentication-Results headers and testing each against the add-on's full trust
  // semantics. This covers matchType:'domain' entries (e.g. { value:'example.com',
  // matchType:'domain' }) whose subdomain authserv-ids (e.g. mx.example.com) would
  // otherwise fail the exact-only match used by mail-auth-signal internally.
  const rawAuthResultHeaders = [].concat(headers['authentication-results'] ?? []);
  const trustedAuthservIds = [...new Set(
    rawAuthResultHeaders
      .map(h => h.split(/[\s;]/)[0]?.toLowerCase())
      .filter(Boolean)
      .filter(id => isTrustedAuthservId(id, trustedDomains))
  )];

  const { metrics, signals } = analyzeMailAuthSignals({
    headers,
    trustedAuthservIds,
    getRegistrableDomain: extractRegistrableDomain,
  });
  const parsed = adaptAuthResults(metrics.authenticationResults);

  const fromHeader = headers['from']?.[0] ?? '';
  const fromDomain = metrics.fromDomain ?? extractFromDomainFallback(fromHeader);
  // Use senderIdentity.localPart (populated by the package when fromDomain is extractable);
  // fall back to the local helper only when the package returned null (no domain path).
  // Lowercase to match the add-on's parseMailboxAddress convention used by the fallback.
  const fromLocalPart = (metrics.senderIdentity.localPart?.toLowerCase()) ?? extractFromLocalPart(fromHeader);
  const messageIdDomain = parseMessageIdDomain(headers['message-id']?.[0] ?? null);

  const headerMetrics = computeHeaderMetrics({
    headers,
    fromDomain,
  });

  const senderAddress = fromLocalPart && fromDomain
    ? `${fromLocalPart.toLowerCase()}@${fromDomain.toLowerCase()}`
    : '';

  const isInAddressBook = settings.addressBookWhitelistEnabled && senderAddress
    ? await isEmailInAddressBook(senderAddress)
    : false;

  const accountDomains = await getAccountDomains(accountId);

  const fromParseMetrics = parseFromHeader(headers['from']?.[0] ?? null);

  const displayNameMetrics = computeDisplayNameMetrics({
    fromHeader: headers['from']?.[0] ?? null,
    fromDomain,
    fromAddress: fromParseMetrics.mailboxAddress ?? null,
  });

  const passAlignmentSummary = computePassAlignmentSummary({ parsedAuthResults: parsed, trustedDomains, fromDomain });

  const messageIdMetrics = computeMessageIdMetrics({
    messageIdDomain,
    fromDomain,
    anyAuthAligned: passAlignmentSummary.anyAuthAligned,
  });

  const mailAuthSignalReasons = adaptCompositeSignals(signals, settings.compositeScores, {
    addonAnyAuthAligned: passAlignmentSummary.anyAuthAligned,
    anyTrustedDmarcPass: passAlignmentSummary.anyTrustedDmarcPass,
  });

  const result = scoreMessage({
    parsedAuthResults: parsed,
    trustedDomains,
    senderDomain: fromDomain,
    senderLocalPart: fromLocalPart,
    messageIdDomain,
    senderDomainRules,
    authScores: settings.authScores,
    heuristicScores: settings.heuristicScores,
    layer2Scores: settings.layer2Scores,
    compositeScores: settings.compositeScores,
    alignmentSummary: passAlignmentSummary,
    whitelistEntries: manualWhitelist ?? [],
    whitelistMitigationScore: settings.whitelistMitigationScore,
    isInAddressBook,
    addressBookMitigationScore: settings.addressBookMitigationScore,
    headerMetrics,
    accountDomains,
    customFormulas: data.customFormulas ?? [],
    displayNameMetrics,
    messageIdMetrics,
    mailAuthSignalReasons,
  });

  return {
    result,
    parsed,
    metrics,
    fromDomain,
    fromLocalPart,
    messageIdDomain,
    headerMetrics,
    displayNameMetrics,
    fromParseMetrics,
    messageIdMetrics,
  };
}

// Used when mail-auth-signal cannot extract a domain (e.g. single-label hosts such
// as 'user@localhost' where normalizeDomain requires a dot).
function extractFromDomainFallback(fromHeader) {
  const addr = parseMailboxAddress(fromHeader);
  return addr.split('@')[1] ?? '';
}

function extractFromLocalPart(fromHeader) {
  const addr = parseMailboxAddress(fromHeader);
  return addr.split('@')[0] ?? '';
}
