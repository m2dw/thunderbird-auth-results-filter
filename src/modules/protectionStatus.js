/**
 * Pure helpers for deriving per-account protection status.
 *
 * Status answers one question for each account: "Is authentication-based
 * scoring (Layer 1) actually working for this account right now?"  It is
 * derived from:
 *
 *   - the user's trusted authentication-server list (trustedDomains),
 *   - the user's explicit guided-setup confirmations (settings.accountSetup),
 *   - recent decision-log entries for the account (accountId + authservIds).
 *
 * Log entries are re-evaluated against the CURRENT trusted list, so confirming
 * a server is reflected immediately for mail that already carried it.
 *
 * These helpers never add, modify, or trust anything.  Received headers are
 * only read to describe the current state; they cannot change the trusted list.
 */

import { isTrustedAuthservId } from '../core/trust.js';

export const PROTECTION_STATES = Object.freeze({
  /** Recent mail for the account carries results from a trusted server. */
  ACTIVE: 'active',
  /** No trusted server applies and no recent mail indicates otherwise. */
  NOT_CONFIGURED: 'not_configured',
  /** A trusted server is configured but no recent mail has verified it yet. */
  AWAITING_MAIL: 'awaiting_mail',
  /** Recent mail carries results only from servers the user has not confirmed. */
  NEEDS_CONFIRMATION: 'needs_confirmation',
  /** Recent mail carries no Authentication-Results headers at all. */
  NO_USABLE_AR: 'no_usable_ar',
});

/** Number of most recent log entries per account used for status derivation. */
export const STATUS_SAMPLE_SIZE = 20;

/**
 * Minimum number of recent messages without any Authentication-Results header
 * before the provider is reported as not supplying usable results.
 */
export const NO_AR_MIN_SAMPLE = 5;

/** Bounds for the authserv-id list stored per decision-log entry. */
export const MAX_LOGGED_AUTHSERV_IDS = 5;
export const MAX_AUTHSERV_ID_LENGTH = 253;

/**
 * Return only well-formed trusted entries.
 *
 * @param {Array} trustedDomains
 * @returns {Array<{value: string, matchType: 'exact'|'domain'}>}
 */
export function validTrustedEntries(trustedDomains) {
  if (!Array.isArray(trustedDomains)) return [];
  return trustedDomains.filter(
    d => d && typeof d === 'object' && typeof d.value === 'string'
      && (d.matchType === 'exact' || d.matchType === 'domain'),
  );
}

/**
 * Collect the unique, lowercased authserv-ids from the SAME parsed
 * Authentication-Results used for scoring, bounded for storage in the decision
 * log.  Using the parser's authserv-id (not a raw first token) keeps status in
 * agreement with what scoring actually trusts.
 *
 * IDs trusted at write time are kept ahead of untrusted ones so the bound never
 * drops the evidence that scoring used a trusted header.
 *
 * @param {Array<{authservId: string}>} parsedAuthResults - from adaptAuthResults().
 * @param {Array} trustedDomains
 * @returns {string[]}
 */
export function extractAuthservIds(parsedAuthResults, trustedDomains) {
  const trusted = validTrustedEntries(trustedDomains);
  const trustedIds = new Set();
  const otherIds = new Set();
  for (const id of collectAuthservIds(parsedAuthResults)) {
    (isTrustedAuthservId(id, trusted) ? trustedIds : otherIds).add(id);
  }
  return [...trustedIds, ...otherIds].slice(0, MAX_LOGGED_AUTHSERV_IDS);
}

/**
 * Whether extractAuthservIds() drops IDs for these results because of the
 * MAX_LOGGED_AUTHSERV_IDS bound.  Stored with the log entry so a later reader
 * does not treat a dropped ID's absence as evidence that it was not seen.
 *
 * @param {Array<{authservId: string}>} parsedAuthResults
 * @returns {boolean}
 */
export function authservIdsTruncated(parsedAuthResults) {
  return collectAuthservIds(parsedAuthResults).size > MAX_LOGGED_AUTHSERV_IDS;
}

function collectAuthservIds(parsedAuthResults) {
  const ids = new Set();
  if (!Array.isArray(parsedAuthResults)) return ids;
  for (const ar of parsedAuthResults) {
    const id = typeof ar?.authservId === 'string' ? ar.authservId.toLowerCase() : '';
    if (!id || id.length > MAX_AUTHSERV_ID_LENGTH) continue;
    ids.add(id);
  }
  return ids;
}

/**
 * Classify a decision-log entry's authentication results against the current
 * trusted list.
 *
 * Entries written by this version carry `authservIds` (possibly empty).
 * Older entries only carry the first `authservId` and are classified from it.
 *
 * An entry marked `authservIdsTruncated` with no currently trusted stored ID is
 * 'unknown' while any trusted entry exists: a dropped ID may be one the user
 * trusted after the message was logged.  It is neither trusted nor untrusted
 * evidence.
 *
 * @param {object} entry
 * @param {Array}  trustedDomains
 * @returns {'trusted'|'untrusted'|'unknown'|'none'}
 */
export function classifyEntryAuth(entry, trustedDomains) {
  const trusted = validTrustedEntries(trustedDomains);
  let ids;
  if (Array.isArray(entry?.authservIds)) {
    ids = entry.authservIds.filter(id => typeof id === 'string' && id);
  } else if (typeof entry?.authservId === 'string' && entry.authservId) {
    ids = [entry.authservId];
  } else {
    ids = [];
  }
  if (ids.length === 0) return 'none';
  if (ids.some(id => isTrustedAuthservId(id, trusted))) return 'trusted';
  if (entry.authservIdsTruncated === true && trusted.length > 0) return 'unknown';
  return 'untrusted';
}

/**
 * Summarize recent mail for one account.
 *
 * `hostPossiblySeen` counts truncated entries that do not list the host: the
 * host may have been among the dropped IDs.
 *
 * @param {Array}  decisionLog    - Newest-first decision log.
 * @param {string} accountId
 * @param {Array}  trustedDomains
 * @param {string} [host]         - Optional host to count occurrences of (informational).
 * @returns {{ total: number, trusted: number, untrusted: number, unknown: number, none: number,
 *   hostSeen: number, hostPossiblySeen: number }}
 */
export function summarizeAccountMail(decisionLog, accountId, trustedDomains, host) {
  const summary = {
    total: 0, trusted: 0, untrusted: 0, unknown: 0, none: 0, hostSeen: 0, hostPossiblySeen: 0,
  };
  if (!Array.isArray(decisionLog) || !accountId) return summary;
  const hostLower = typeof host === 'string' ? host.trim().toLowerCase() : '';
  for (const entry of decisionLog) {
    if (summary.total >= STATUS_SAMPLE_SIZE) break;
    if (!entry || entry.accountId !== accountId) continue;
    summary.total++;
    summary[classifyEntryAuth(entry, trustedDomains)]++;
    if (hostLower) {
      const ids = Array.isArray(entry.authservIds)
        ? entry.authservIds
        : [entry.authservId];
      if (ids.some(id => typeof id === 'string' && id.toLowerCase() === hostLower)) {
        summary.hostSeen++;
      } else if (entry.authservIdsTruncated === true) {
        summary.hostPossiblySeen++;
      }
    }
  }
  return summary;
}

/**
 * Return the host the user explicitly confirmed for this account, but only if
 * it is still covered by the trusted list.  A confirmation whose trusted entry
 * was later removed no longer counts.
 *
 * @param {object} accountSetup   - settings.accountSetup map.
 * @param {string} accountId
 * @param {Array}  trustedDomains
 * @returns {string|null}
 */
export function getConfirmedHost(accountSetup, accountId, trustedDomains) {
  if (!accountSetup || typeof accountSetup !== 'object' || !accountId) return null;
  if (!Object.prototype.hasOwnProperty.call(accountSetup, accountId)) return null;
  const host = accountSetup[accountId]?.host;
  if (typeof host !== 'string' || !host) return null;
  return isTrustedAuthservId(host, validTrustedEntries(trustedDomains)) ? host : null;
}

/**
 * Derive the protection status of a single account.
 *
 * Precedence:
 *   1. ACTIVE              — any recent message has results from a trusted server.
 *   2. NEEDS_CONFIRMATION  — recent messages have results, but none from a trusted server.
 *   3. NO_USABLE_AR        — at least NO_AR_MIN_SAMPLE recent messages and none had results.
 *   4. AWAITING_MAIL       — a trusted server is configured but not yet seen for this account
 *                            (including when recent entries are only 'unknown' because of truncation).
 *   5. NOT_CONFIGURED      — otherwise.
 *
 * @param {object} params
 * @param {string} params.accountId
 * @param {Array}  params.trustedDomains
 * @param {object} [params.accountSetup]
 * @param {Array}  [params.decisionLog]
 * @returns {{
 *   accountId: string,
 *   state: string,
 *   confirmedHost: string|null,
 *   trustedCount: number,
 *   mismatch: boolean,
 *   mail: { total: number, trusted: number, untrusted: number, unknown: number, none: number,
 *     hostSeen: number, hostPossiblySeen: number },
 * }}
 */
export function deriveAccountProtectionStatus({ accountId, trustedDomains, accountSetup, decisionLog }) {
  const trusted = validTrustedEntries(trustedDomains);
  const confirmedHost = getConfirmedHost(accountSetup, accountId, trusted);
  const mail = summarizeAccountMail(decisionLog, accountId, trusted);

  let state;
  if (mail.trusted > 0) {
    state = PROTECTION_STATES.ACTIVE;
  } else if (mail.untrusted > 0) {
    state = PROTECTION_STATES.NEEDS_CONFIRMATION;
  } else if (mail.total >= NO_AR_MIN_SAMPLE && mail.none === mail.total) {
    state = PROTECTION_STATES.NO_USABLE_AR;
  } else if (confirmedHost || trusted.length > 0) {
    state = PROTECTION_STATES.AWAITING_MAIL;
  } else {
    state = PROTECTION_STATES.NOT_CONFIGURED;
  }

  return {
    accountId,
    state,
    confirmedHost,
    trustedCount: trusted.length,
    // A configured/confirmed server exists, yet recent mail was checked by a
    // different server.  Shown as a failure rather than a fresh setup prompt.
    mismatch: state === PROTECTION_STATES.NEEDS_CONFIRMATION
      && (confirmedHost !== null || trusted.length > 0),
    mail,
  };
}

/**
 * Summarize statuses across all accounts.
 *
 * @param {Array<{state: string}>} statuses
 * @returns {{ total: number, active: number, inactive: number, allActive: boolean }}
 */
export function summarizeProtection(statuses) {
  const list = Array.isArray(statuses) ? statuses : [];
  const active = list.filter(s => s?.state === PROTECTION_STATES.ACTIVE).length;
  return {
    total: list.length,
    active,
    inactive: list.length - active,
    allActive: list.length > 0 && active === list.length,
  };
}
