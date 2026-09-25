/**
 * Pure helpers for the guided trusted-server setup.
 *
 * The guided setup lets the user pick an account, choose a server name from
 * account-derived (and optionally MX-derived) hints or type one, review a
 * local configuration check, and then explicitly confirm it.  Only an explicit
 * confirmation can add a trusted entry; nothing here reads received headers
 * to decide what to trust.
 *
 * Confirmations are stored in settings.accountSetup as
 *   { [accountId]: { host: string, confirmedAt: number } }
 * and bounded to MAX_ACCOUNT_SETUP_ENTRIES entries.
 */

import { isTrustedAuthservId } from '../core/trust.js';
import { extractRegistrableDomain } from '../core/psl.js';
import { isValidHostname } from '../options/trustedEntryValidation.js';
import { extractEmailDomain } from './setupSuggestions.js';
import { validTrustedEntries } from './protectionStatus.js';

export const MAX_ACCOUNT_SETUP_ENTRIES = 50;
const MAX_ACCOUNT_ID_LENGTH = 200;
const MAX_HOST_LENGTH = 253;

/**
 * Sanitize a stored accountSetup map.  Malformed entries are dropped and the
 * map is capped to the MAX_ACCOUNT_SETUP_ENTRIES most recently confirmed.
 *
 * @param {unknown} raw
 * @returns {Object<string, {host: string, confirmedAt: number}>}
 */
export function sanitizeAccountSetup(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const entries = [];
  for (const [accountId, record] of Object.entries(raw)) {
    if (!accountId || accountId.length > MAX_ACCOUNT_ID_LENGTH) continue;
    if (!record || typeof record !== 'object') continue;
    const host = typeof record.host === 'string' ? record.host.trim().toLowerCase() : '';
    if (!host || host.length > MAX_HOST_LENGTH || !isValidHostname(host)) continue;
    const confirmedAt = Number.isFinite(record.confirmedAt) ? record.confirmedAt : 0;
    entries.push([accountId, { host, confirmedAt }]);
  }
  entries.sort((a, b) => b[1].confirmedAt - a[1].confirmedAt);
  return Object.fromEntries(entries.slice(0, MAX_ACCOUNT_SETUP_ENTRIES));
}

/**
 * Reduce Thunderbird account objects to the accounts that can receive mail
 * scored by this add-on (those with at least one identity email address).
 *
 * @param {Array} accounts - browser.accounts.list() result.
 * @returns {Array<{id: string, name: string, emails: string[], domains: string[]}>}
 */
export function listSetupAccounts(accounts) {
  if (!Array.isArray(accounts)) return [];
  const result = [];
  for (const account of accounts) {
    if (!account || typeof account.id !== 'string') continue;
    const emails = (account.identities ?? [])
      .map(i => i?.email)
      .filter(e => typeof e === 'string' && e.includes('@'));
    if (emails.length === 0) continue;
    const domains = [...new Set(emails.map(extractEmailDomain).filter(Boolean))];
    result.push({ id: account.id, name: account.name ?? account.id, emails, domains });
  }
  return result;
}

/**
 * Explicitly confirm a trusted server for an account.
 *
 * Adds `{ value: host, matchType: 'exact' }` to the trusted list unless the
 * host is already covered by an existing entry, records the confirmation in
 * settings.accountSetup, and drops any candidates now covered.
 *
 * Returns `{ ok: false, error }` without modifying anything when:
 *   - `confirmed` is not exactly `true`   → 'confirmation_required'
 *   - `accountId` is missing              → 'missing_account'
 *   - `host` is empty                     → 'missing_host'
 *   - `host` is not a valid hostname      → 'invalid_host'
 *
 * @param {object} data - Full storage object.
 * @param {object} params
 * @param {string}  params.accountId
 * @param {string}  params.host
 * @param {boolean} params.confirmed - Must be true (explicit user confirmation).
 * @param {number}  [params.now]
 * @returns {{ ok: true, data: object, added: boolean } | { ok: false, error: string }}
 */
export function confirmTrustedServerSetup(data, { accountId, host, confirmed, now = Date.now() } = {}) {
  if (confirmed !== true) return { ok: false, error: 'confirmation_required' };
  if (typeof accountId !== 'string' || !accountId || accountId.length > MAX_ACCOUNT_ID_LENGTH) {
    return { ok: false, error: 'missing_account' };
  }
  const value = typeof host === 'string' ? host.trim().toLowerCase() : '';
  if (!value) return { ok: false, error: 'missing_host' };
  if (value.length > MAX_HOST_LENGTH || !isValidHostname(value)) {
    return { ok: false, error: 'invalid_host' };
  }

  const currentTrusted = Array.isArray(data?.trustedDomains) ? data.trustedDomains : [];
  const alreadyCovered = isTrustedAuthservId(value, validTrustedEntries(currentTrusted));
  const newEntry = { value, matchType: 'exact' };
  const trustedDomains = alreadyCovered ? currentTrusted : [...currentTrusted, newEntry];
  const candidates = (Array.isArray(data?.candidates) ? data.candidates : []).filter(
    c => !(c && typeof c.authservId === 'string' && isTrustedAuthservId(c.authservId, [newEntry])),
  );

  const settings = data?.settings ?? {};
  const accountSetup = sanitizeAccountSetup({
    ...(settings.accountSetup ?? {}),
    [accountId]: { host: value, confirmedAt: now },
  });

  return {
    ok: true,
    added: !alreadyCovered,
    data: {
      ...data,
      trustedDomains,
      candidates,
      settings: { ...settings, accountSetup },
    },
  };
}

/**
 * Build the local configuration check shown in the guided setup.
 *
 * Uses only local information: the account's email domains, setup hints
 * (heuristic and, if the user opted in, MX), the trusted list, and the
 * account's recent mail summary.  No network access.
 *
 * Each item is `{ key, level, params }` where level is 'ok' | 'warn' | 'info'
 * and key maps to an i18n message `guided_check_<key>`.
 *
 * @param {object} params
 * @param {string}   params.host
 * @param {string[]} params.accountDomains
 * @param {Array<{host: string, source: string}>} params.suggestions
 * @param {Array}    params.trustedDomains
 * @param {{ total: number, trusted: number, untrusted: number, unknown?: number, none: number,
 *   hostSeen: number, hostPossiblySeen?: number }} params.mail
 * @returns {Array<{key: string, level: 'ok'|'warn'|'info', params: string[]}>}
 */
export function buildSetupCheck({ host, accountDomains, suggestions, trustedDomains, mail }) {
  const items = [];
  const domains = Array.isArray(accountDomains) ? accountDomains : [];
  const value = typeof host === 'string' ? host.trim().toLowerCase() : '';

  if (domains.length > 0) {
    items.push({ key: 'account_domains', level: 'ok', params: [domains.join(', ')] });
  } else {
    items.push({ key: 'account_domains_none', level: 'warn', params: [] });
  }

  if (!mail || mail.total === 0) {
    items.push({ key: 'mail_none_yet', level: 'info', params: [] });
  } else {
    items.push({
      key: 'mail_summary',
      level: mail.trusted > 0 ? 'ok' : 'info',
      params: [String(mail.total), String(mail.trusted), String(mail.untrusted), String(mail.none)],
    });
    if (mail.unknown > 0) {
      items.push({ key: 'mail_unrecorded', level: 'info', params: [String(mail.unknown)] });
    }
    if (mail.none === mail.total) {
      items.push({ key: 'mail_no_ar', level: 'warn', params: [] });
    }
  }

  if (!value) return items;

  if (!isValidHostname(value) || value.length > MAX_HOST_LENGTH) {
    items.push({ key: 'host_invalid', level: 'warn', params: [value] });
    return items;
  }

  if (isTrustedAuthservId(value, validTrustedEntries(trustedDomains))) {
    items.push({ key: 'host_already_trusted', level: 'info', params: [value] });
  }

  const list = Array.isArray(suggestions) ? suggestions : [];
  const match = list.find(s => s && s.host === value);
  if (match?.source === 'mx') {
    items.push({ key: 'host_matches_mx', level: 'ok', params: [value] });
  } else if (match) {
    items.push({ key: 'host_matches_hint', level: 'ok', params: [value] });
  } else {
    const hostReg = extractRegistrableDomain(value);
    const related = hostReg && (
      domains.some(d => extractRegistrableDomain(d) === hostReg)
      || list.some(s => s && s.source === 'mx' && extractRegistrableDomain(s.host) === hostReg)
    );
    if (related) {
      items.push({ key: 'host_related_domain', level: 'ok', params: [hostReg] });
    } else {
      items.push({ key: 'host_unrelated', level: 'warn', params: [value] });
    }
  }

  if (mail && mail.total > 0 && mail.none < mail.total) {
    if (mail.hostSeen > 0) {
      items.push({ key: 'host_seen', level: 'info', params: [String(mail.hostSeen), String(mail.total)] });
    } else if (mail.hostPossiblySeen > 0) {
      // Some entries dropped IDs beyond the storage bound; absence is not evidence.
      items.push({ key: 'host_possibly_seen', level: 'info', params: [value, String(mail.hostPossiblySeen)] });
    } else {
      items.push({ key: 'host_not_seen', level: 'warn', params: [value] });
    }
  }

  return items;
}
