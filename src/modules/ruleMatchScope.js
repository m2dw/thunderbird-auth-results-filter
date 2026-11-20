/**
 * Scope selection for the rule match report.
 *
 * Resolves the messages a context-menu action targets into an explicit,
 * bounded list of Thunderbird message IDs:
 *
 *   - "Analyze this folder" (folder_pane): the clicked folder only (no
 *     subfolders), optionally restricted to a sent-date range, up to a
 *     per-run analysis limit.
 *   - "Analyze selected messages" (message_list): exactly the messages in
 *     OnClickData.selectedMessages, following MessageList pagination.
 *
 * Read-only: only messages.list / messages.query / messages.continueList (and
 * messages.abortList when available) are used. Messages are never moved.
 *
 * See SPEC.md "Rule Match Report" → "Entry points".
 */

import { MAX_RULE_MATCH_BATCH, RULE_MATCH_HARD_LIMIT, resolveRuleMatchLimit } from './ruleMatchAnalysis.js';

export const ANALYZE_FOLDER_MENU_ID = 'arf-analyze-folder';
export const ANALYZE_SELECTION_MENU_ID = 'arf-analyze-selection';
export const RULE_MATCH_SCOPE_MESSAGE = 'rule-match-report-scope';
export const RULE_MATCH_SCOPE_CANCEL_MESSAGE = 'rule-match-report-scope-cancel';

const DATE_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a native `<input type="date">` value (YYYY-MM-DD) as a local
 * calendar day.
 *
 * @param {string} value
 * @returns {{ start: Date, end: Date }|null} `start` is local midnight of the
 *   day, `end` its last millisecond; null when the value is not a real date.
 */
function localDay(value) {
  const m = DATE_INPUT_RE.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  // setFullYear avoids the Date constructor mapping years 0–99 to 1900–1999.
  const localDate = d => {
    const date = new Date(2000, 0, 1);
    date.setFullYear(year, month, d);
    return date;
  };
  const start = localDate(day);
  // Rejects overflowing days such as 2026-02-30 (which Date rolls over).
  if (start.getFullYear() !== year || start.getMonth() !== month || start.getDate() !== day) return null;
  // Subtract on the epoch, not via a local setter, so a skipped midnight (DST) cannot spill into the next day.
  const end = new Date(localDate(day + 1).getTime() - 1);
  return { start, end };
}

/**
 * Validate the optional "Sent date" From / Through inputs.
 *
 * A blank side is unbounded; there is no implicit upper bound of "now", so
 * future dates are allowed. From includes its whole local day from midnight;
 * Through includes its whole local day up to its last millisecond.
 *
 * @param {string} [from]    - `<input type="date">` value, or '' for no lower bound.
 * @param {string} [through] - `<input type="date">` value, or '' for no upper bound.
 * @returns {{ fromDate: Date|null, toDate: Date|null }|{ error: 'invalid-from'|'invalid-through'|'inverted' }}
 */
export function parseSentDateRange(from = '', through = '') {
  const fromText = String(from ?? '').trim();
  const throughText = String(through ?? '').trim();
  const fromDay = fromText ? localDay(fromText) : null;
  if (fromText && !fromDay) return { error: 'invalid-from' };
  const throughDay = throughText ? localDay(throughText) : null;
  if (throughText && !throughDay) return { error: 'invalid-through' };
  if (fromDay && throughDay && fromDay.start > throughDay.start) return { error: 'inverted' };
  return { fromDate: fromDay?.start ?? null, toDate: throughDay?.end ?? null };
}

/**
 * Validate the folder-analysis limit inputs.
 *
 * @param {string|number} value - Requested maximum (ignored when `noLimit`).
 * @param {boolean} [noLimit]   - "No user limit": the product ceiling applies.
 * @returns {{ limit: number|null, effective: number }|{ error: 'invalid-limit' }}
 *   `limit` is what the analysis port receives (null = no user limit);
 *   `effective` is the number of messages that can actually be analyzed.
 */
export function parseAnalysisLimit(value, noLimit = false) {
  if (noLimit) return { limit: null, effective: RULE_MATCH_HARD_LIMIT };
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return { error: 'invalid-limit' };
  const limit = Number(text);
  if (limit < 1 || limit > RULE_MATCH_HARD_LIMIT) return { error: 'invalid-limit' };
  return { limit, effective: limit };
}

// MailFolder properties forwarded to messages.list / messages.query. Only known
// schema properties are kept so a structured-cloned folder stays valid input.
const FOLDER_FIELDS = ['id', 'accountId', 'path', 'name', 'type', 'specialUse', 'isRoot', 'isTag', 'isUnified', 'isVirtual', 'isFavorite'];

/**
 * Return a plain copy of a MailFolder without subfolders, or null when the
 * value is not a usable folder.
 *
 * @param {object|null|undefined} folder
 * @returns {object|null}
 */
export function sanitizeFolder(folder) {
  if (!folder || typeof folder !== 'object') return null;
  if (typeof folder.accountId !== 'string' || typeof folder.path !== 'string') {
    if (typeof folder.id !== 'string') return null;
  }
  const out = {};
  for (const field of FOLDER_FIELDS) {
    if (folder[field] !== undefined) out[field] = folder[field];
  }
  return out;
}

/**
 * Pick the folder targeted by a folder_pane context-menu click.
 *
 * OnClickData.selectedFolder identifies the folder the menu was opened on, so
 * it is used whenever present (it is also the only folder property before
 * Thunderbird 128). OnClickData.selectedFolders lists every folder affected by
 * the action; it is used only when it names exactly one folder. Several
 * affected folders without a clicked folder are ambiguous, so no folder is
 * guessed.
 *
 * @param {object} info - menus.OnClickData
 * @returns {object|null} Sanitized MailFolder, or null (e.g. an account row
 *   or an ambiguous multi-folder selection).
 */
export function folderFromMenuInfo(info) {
  const clicked = sanitizeFolder(info?.selectedFolder);
  if (clicked) return clicked;
  if (Array.isArray(info?.selectedFolders) && info.selectedFolders.length === 1) {
    return sanitizeFolder(info.selectedFolders[0]);
  }
  return null;
}

function folderKey(folder) {
  return folder.id ?? `${folder.accountId}\u0000${folder.path}`;
}

const ABORTED = Symbol('aborted');

/** Promise resolving to ABORTED once `signal` aborts, or null without a signal. */
function whenAborted(signal) {
  if (!signal) return null;
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise(resolve => {
    signal.addEventListener?.('abort', () => resolve(ABORTED), { once: true });
  });
}

function listReleaser(abortList) {
  return async listId => {
    if (!listId || typeof abortList !== 'function') return;
    try { await abortList(listId); } catch { /* list already released */ }
  };
}

/**
 * Await a MessageList page unless cancellation wins. When cancellation wins,
 * the list being continued (`currentListId`) is released right away so a page
 * that never resolves does not leave it active; a page that arrives later is
 * released too so Thunderbird stops paginating it.
 */
async function awaitPage(pending, aborted, release, currentListId = null) {
  if (!aborted) return pending;
  const result = await Promise.race([pending, aborted]);
  if (result === ABORTED) {
    // Not awaited: cancellation must not wait on Thunderbird.
    if (currentListId) release(currentListId);
    Promise.resolve(pending).then(
      page => (page?.id && page.id !== currentListId ? release(page.id) : undefined),
      () => {},
    );
  }
  return result;
}

/**
 * Collect message IDs from a (possibly paginated) MessageList.
 *
 * Keeps at most `limit` IDs. Messages beyond the limit are not kept but are
 * still counted in `excluded`, so the report can state the real scope size;
 * `truncated` is true when `excluded` > 0. Duplicates of a kept ID are skipped.
 * Entries beyond the limit are counted per listing without tracking their IDs,
 * so memory stays bounded by `limit` (Thunderbird message lists do not repeat
 * a message, so this equals the distinct count in practice). `folders` covers
 * every message listed, including excluded ones. When `signal` aborts, pagination
 * stops, the active list is released (even if its pending page never
 * resolves), and `cancelled` is true.
 *
 * @param {{ id?: string|null, messages: object[] }|null} firstPage
 * @param {(listId: string) => Promise<object>} continueList
 * @param {object} [opts]
 * @param {number} [opts.limit]
 * @param {(listId: string) => Promise<void>} [opts.abortList]
 * @param {(message: object) => boolean} [opts.filter] - Keep only messages passing this test.
 * @param {AbortSignal} [opts.signal]
 * @param {(progress: { collected: number }) => void} [opts.onProgress] - Called after each page
 *   with the number of messages counted so far (kept plus excluded).
 * @returns {Promise<{ messageIds: number[], accountIds: Array<string|null>, excluded: number, truncated: boolean, cancelled: boolean, folders: object[] }>}
 *   `accountIds[i]` is the listed account of `messageIds[i]`, or null.
 */
export async function collectMessageIds(firstPage, continueList, opts = {}) {
  const { limit = MAX_RULE_MATCH_BATCH, abortList, filter, signal, onProgress } = opts;
  const release = listReleaser(abortList);
  const aborted = whenAborted(signal);
  const messageIds = [];
  const accountIds = [];
  const kept = new Set();
  const folders = new Map();
  let excluded = 0;
  let cancelled = false;
  let page = firstPage;

  while (page) {
    if (signal?.aborted) {
      cancelled = true;
      await release(page.id);
      break;
    }
    for (const message of page.messages ?? []) {
      if (!Number.isInteger(message?.id) || kept.has(message.id)) continue;
      if (filter && !filter(message)) continue;
      // Folders are recorded across the whole scope, including messages beyond
      // the limit, so the report never labels a mixed selection as one folder.
      const folder = sanitizeFolder(message.folder);
      if (folder && !folders.has(folderKey(folder))) folders.set(folderKey(folder), folder);
      if (messageIds.length >= limit) {
        // Counted but not retained: the excluded part of the scope stays
        // visible in the report totals. IDs beyond the limit are not tracked,
        // so memory stays bounded by `limit`.
        excluded++;
        continue;
      }
      kept.add(message.id);
      messageIds.push(message.id);
      // Reused by the analysis so it need not look each message up again.
      accountIds.push(folder?.accountId ?? null);
    }
    onProgress?.({ collected: messageIds.length + excluded });
    if (!page.id) break;
    const next = await awaitPage(continueList(page.id), aborted, release, page.id);
    if (next === ABORTED) {
      cancelled = true;
      break;
    }
    page = next;
  }

  return { messageIds, accountIds, excluded, truncated: excluded > 0, cancelled, folders: [...folders.values()] };
}

function messageTime(message) {
  const d = message?.date instanceof Date ? message.date : new Date(message?.date);
  return d.getTime();
}

const QUERY_BOUND_MARGIN_MS = 1;

function validBound(date) {
  return date === null || (date instanceof Date && Number.isFinite(date.getTime()));
}

/**
 * Resolve the messages of one folder (subfolders excluded) for analysis.
 *
 * Date eligibility uses Thunderbird's indexed `MessageHeader.date` (from the
 * sender's `Date:` header) only; raw headers are never read here. With either
 * bound, `messages.query()` receives just the given bounds, each widened by
 * 1 ms because its filters are exclusive (no implicit upper bound of now), and
 * the exact inclusive bounds are re-checked client-side. Without a
 * bound, `messages.list()` is used and no message is date-filtered, so an
 * outlier `Date:` cannot make a message ineligible.
 *
 * The date range is applied before the limit: the first `limit` eligible
 * messages in Thunderbird's listing order are kept and the rest only counted.
 *
 * @param {object} browserApi
 * @param {object} folder - MailFolder from the menu click.
 * @param {object} [opts]
 * @param {Date|null} [opts.fromDate] - Inclusive lower bound; null = unbounded.
 * @param {Date|null} [opts.toDate]   - Inclusive upper bound; null = unbounded.
 * @param {number|null} [opts.limit]  - See resolveRuleMatchLimit(); null = no user limit.
 * @param {AbortSignal} [opts.signal] - Cancels collection between pages.
 * @param {(progress: { collected: number }) => void} [opts.onProgress]
 */
export async function collectFolderMessageIds(browserApi, folder, opts = {}) {
  const { fromDate = null, toDate = null, signal, onProgress } = opts;
  const limit = resolveRuleMatchLimit(opts.limit);
  const target = sanitizeFolder(folder);
  if (!target) throw new TypeError('folder is required');
  if (!validBound(fromDate) || !validBound(toDate)) throw new TypeError('date bounds must be valid Dates or null');
  if (fromDate && toDate && fromDate > toDate) throw new RangeError('fromDate is after toDate');
  const dated = Boolean(fromDate || toDate);
  const api = browserApi.messages;
  const abortList = typeof api.abortList === 'function' ? id => api.abortList(id) : undefined;
  const cancelledResult = { messageIds: [], accountIds: [], excluded: 0, truncated: false, cancelled: true, folders: [] };
  if (signal?.aborted) return cancelledResult;
  // messages.query() documents fromDate/toDate as exclusive "after"/"before"
  // filters, so widen each by 1 ms to keep the inclusive boundary instants;
  // the client-side check below restores the exact range.
  const queryInfo = { folder: target, includeSubFolders: false };
  if (fromDate) queryInfo.fromDate = new Date(fromDate.getTime() - QUERY_BOUND_MARGIN_MS);
  if (toDate) queryInfo.toDate = new Date(toDate.getTime() + QUERY_BOUND_MARGIN_MS);
  const firstPage = await awaitPage(
    dated ? api.query(queryInfo) : api.list(target),
    whenAborted(signal),
    listReleaser(abortList),
  );
  if (firstPage === ABORTED) return cancelledResult;
  // query() already applies the bounds; the client-side check keeps the range
  // exact even if a backend ignores either bound. A message without a usable
  // date cannot be shown to be in range, so it is left out of a dated run.
  const from = fromDate?.getTime() ?? -Infinity;
  const to = toDate?.getTime() ?? Infinity;
  const filter = dated
    ? message => {
      const time = messageTime(message);
      return Number.isFinite(time) && time >= from && time <= to;
    }
    : undefined;
  return collectMessageIds(firstPage, id => api.continueList(id), {
    limit,
    filter,
    abortList,
    signal,
    onProgress,
  });
}

/**
 * Resolve exactly the messages a message_list context-menu action targets.
 *
 * @param {object} browserApi
 * @param {object} info - menus.OnClickData
 * @param {object} [opts]
 * @param {number} [opts.limit]
 * @param {AbortSignal} [opts.signal] - Cancels collection between pages.
 * @param {(progress: { collected: number }) => void} [opts.onProgress]
 */
export async function collectSelectedMessageIds(browserApi, info, opts = {}) {
  const { limit = MAX_RULE_MATCH_BATCH, signal, onProgress } = opts;
  const api = browserApi.messages;
  return collectMessageIds(info?.selectedMessages ?? null, id => api.continueList(id), {
    limit,
    abortList: typeof api.abortList === 'function' ? id => api.abortList(id) : undefined,
    signal,
    onProgress,
  });
}

/**
 * Bounded in-memory registry of report scopes, keyed by an opaque token that
 * is passed to the report tab in its URL. Never persisted.
 *
 * @param {object} [opts]
 * @param {number} [opts.maxEntries]
 * @param {() => string} [opts.createToken]
 */
export function createScopeRegistry({ maxEntries = 20, createToken } = {}) {
  const scopes = new Map();
  let counter = 0;
  const makeToken = createToken ?? (() => {
    counter += 1;
    const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    return `${counter}-${random}`;
  });
  return {
    add(scope) {
      const token = makeToken();
      scopes.set(token, scope);
      while (scopes.size > maxEntries) scopes.delete(scopes.keys().next().value);
      return token;
    },
    get(token) {
      return typeof token === 'string' ? scopes.get(token) ?? null : null;
    },
    get size() {
      return scopes.size;
    },
  };
}
