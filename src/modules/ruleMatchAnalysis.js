/**
 * Read-only on-demand analysis for the rule match report.
 *
 * Reassesses a bounded batch of explicit Thunderbird message IDs from their
 * headers using the same assessMessage() pipeline as new mail, with one
 * settings snapshot per run, and aggregates the results per rule.
 *
 * Read-only: this module never moves or flags messages, never shows
 * notifications, and never writes storage or the decision log. The report is
 * held in memory and returned to the caller only.
 *
 * See SPEC.md "Rule Match Report" for the return contract.
 */

import { assessMessage } from './messageAssessment.js';
import { aggregateRuleMatches, RULE_LAYERS } from '../core/ruleMatchReport.js';

export const RULE_MATCH_REPORT_PORT = 'rule-match-report';
/** Default per-run analysis limit (selections, and folders unless changed). */
export const MAX_RULE_MATCH_BATCH = 1000;
/** Product ceiling: no run analyzes more messages, even with "No user limit". */
export const RULE_MATCH_HARD_LIMIT = 10000;
export const DEFAULT_RULE_MATCH_CONCURRENCY = 4;
export const MAX_RULE_MATCH_CONCURRENCY = 8;

/**
 * Validate a per-run analysis limit at an execution boundary.
 *
 * undefined → MAX_RULE_MATCH_BATCH; null ("No user limit") →
 * RULE_MATCH_HARD_LIMIT; otherwise an integer in 1..RULE_MATCH_HARD_LIMIT.
 *
 * @param {number|null|undefined} limit
 * @returns {number} Effective limit.
 * @throws {RangeError} For any other value.
 */
export function resolveRuleMatchLimit(limit) {
  if (limit === undefined) return MAX_RULE_MATCH_BATCH;
  if (limit === null) return RULE_MATCH_HARD_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > RULE_MATCH_HARD_LIMIT) {
    throw new RangeError(`analysis limit must be an integer from 1 to ${RULE_MATCH_HARD_LIMIT}`);
  }
  return limit;
}

function requireHeaders(headers) {
  if (typeof headers !== 'object' || headers === null) {
    throw new Error('message headers unavailable');
  }
  return headers;
}

/**
 * Build a read-only message reader on top of the Thunderbird messages API.
 * Uses only messages.get(), messages.getHeaders() (when available), and
 * messages.getFull().
 *
 * Headers come from messages.getHeaders() when the API exists, so the full MIME
 * structure is not parsed just to score headers. getHeaders() decodes RFC 2047
 * encoded-words by default, as getFull() does for its headers, so one read per
 * message is enough. getFull() is used only when getHeaders() is unavailable
 * (older Thunderbird). A failed getHeaders() call is a read failure; it is never
 * retried via getFull().
 *
 * The account ID comes from messages.get() unless the caller passes the one
 * already known from scope enumeration. With a known account ID, messages.get()
 * is only called after a failed read, to report a message deleted since
 * enumeration as not found (as without the hint).
 *
 * @param {object} browserApi - The `browser` global (or a test double).
 * @returns {(messageId: number, accountId?: string|null) => Promise<{ accountId: string|null, headers: object }|null>}
 *   Resolves null when the message no longer exists.
 */
export function createMessageReader(browserApi) {
  const api = browserApi.messages;
  const canGetHeaders = typeof api.getHeaders === 'function';

  const readHeaders = async messageId => {
    if (canGetHeaders) return requireHeaders(await api.getHeaders(messageId));
    return requireHeaders((await api.getFull(messageId))?.headers);
  };

  return async (messageId, knownAccountId) => {
    if (typeof knownAccountId !== 'string' || knownAccountId === '') {
      const header = await api.get(messageId);
      if (!header) return null;
      return { accountId: header.folder?.accountId ?? null, headers: await readHeaders(messageId) };
    }
    try {
      return { accountId: knownAccountId, headers: await readHeaders(messageId) };
    } catch (e) {
      const missing = await Promise.resolve()
        .then(() => api.get(messageId))
        .then(header => !header, () => false);
      if (missing) return null;
      throw e;
    }
  };
}

const now = () => globalThis.performance?.now?.() ?? Date.now();

// Memoize a single-argument async lookup for the duration of one run so the
// same sender / account is resolved once and consistently across messages.
function memoizeAsync(fn) {
  if (typeof fn !== 'function') return undefined;
  const cache = new Map();
  return arg => {
    if (!cache.has(arg)) cache.set(arg, Promise.resolve().then(() => fn(arg)));
    return cache.get(arg);
  };
}

/**
 * Analyze a batch of message IDs and return the rule match report.
 *
 * @param {number[]} messageIds - Explicit Thunderbird message IDs, in display order.
 * @param {object} deps
 * @param {() => Promise<object>} deps.loadSnapshot - Returns the storage snapshot; called once per run.
 * @param {(id: number, accountId?: string|null) => Promise<{accountId, headers}|null>} deps.readMessage
 * @param {Array<string|null>} [deps.accountIds] - Account IDs known from scope
 *   enumeration, aligned with messageIds; passed to readMessage as a hint.
 * @param {object} [deps.lookups] - { isEmailInAddressBook, getAccountDomains } (memoized per run).
 * @param {number} [deps.concurrency]  - Parallel header reads, clamped to 1..MAX_RULE_MATCH_CONCURRENCY.
 * @param {number|null} [deps.maxMessages] - Batch bound (see resolveRuleMatchLimit());
 *   unique valid IDs beyond it are counted in `overLimit`, separately from
 *   `failed` and `skipped`.
 * @param {(progress: object) => void} [deps.onProgress] - Called after each message settles.
 * @param {{ aborted: boolean }} [deps.signal] - Cancellation; checked before each message starts.
 * @param {Function} [deps.assess] - Assessment function (defaults to assessMessage).
 * @returns {Promise<object>} Report; see SPEC.md "Rule Match Report".
 */
export async function analyzeMessagesForRuleReport(messageIds, deps) {
  if (!Array.isArray(messageIds)) throw new TypeError('messageIds must be an array');
  const {
    loadSnapshot,
    readMessage,
    accountIds,
    lookups = {},
    concurrency = DEFAULT_RULE_MATCH_CONCURRENCY,
    maxMessages,
    onProgress,
    signal,
    assess = assessMessage,
  } = deps ?? {};
  const limit = resolveRuleMatchLimit(maxMessages);

  const startedAt = now();
  const requested = messageIds.length;
  const skippedMessages = [];
  const queue = [];
  const seen = new Set();
  const accountHints = new Map();
  const hints = Array.isArray(accountIds) ? accountIds : [];
  // IDs beyond the limit are only counted, so memory stays bounded by `limit`.
  let overLimit = 0;

  for (const [i, id] of messageIds.entries()) {
    if (typeof hints[i] === 'string' && hints[i] !== '' && Number.isInteger(id) && !seen.has(id)) {
      accountHints.set(id, hints[i]);
    }
    if (!Number.isInteger(id) || id < 0) {
      skippedMessages.push({ messageId: id ?? null, reason: 'invalid-id' });
    } else if (seen.has(id)) {
      skippedMessages.push({ messageId: id, reason: 'duplicate' });
    } else if (queue.length >= limit) {
      overLimit++;
    } else {
      seen.add(id);
      queue.push(id);
    }
  }

  // One settings snapshot per run: every message is scored against the same data.
  const data = queue.length > 0 ? await loadSnapshot() : null;
  const runLookups = {
    isEmailInAddressBook: memoizeAsync(lookups.isEmailInAddressBook),
    getAccountDomains: memoizeAsync(lookups.getAccountDomains),
  };

  const outcomes = new Array(queue.length);
  const failedMessages = [];
  let analyzed = 0;
  let failed = 0;
  let completed = 0;
  let next = 0;
  // Local diagnostics only: summed per-message read/assess time (across
  // concurrent workers) and run wall time, in milliseconds. No message data.
  const timings = { readMs: 0, assessMs: 0, elapsedMs: 0 };

  const reportProgress = () => {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress({
        requested,
        total: queue.length,
        completed,
        analyzed,
        failed,
        skipped: skippedMessages.length,
        overLimit,
      });
    } catch {
      // Progress observers must not interrupt analysis.
    }
  };

  const processOne = async (index) => {
    const messageId = queue[index];
    let read;
    const readStart = now();
    try {
      read = await readMessage(messageId, accountHints.get(messageId) ?? null);
    } catch {
      return { messageId, failure: 'read-failed' };
    } finally {
      timings.readMs += now() - readStart;
    }
    if (!read) return { messageId, failure: 'not-found' };
    const assessStart = now();
    try {
      const { result } = await assess({
        headers: read.headers,
        accountId: read.accountId ?? null,
        data,
        lookups: runLookups,
      });
      return {
        messageId,
        assessed: {
          messageId,
          score: result.score,
          classification: result.classification,
          scoreReasons: result.scoreReasons,
        },
      };
    } catch {
      return { messageId, failure: 'assessment-failed' };
    } finally {
      timings.assessMs += now() - assessStart;
    }
  };

  const worker = async () => {
    while (next < queue.length) {
      if (signal?.aborted) return;
      const index = next++;
      const outcome = await processOne(index);
      outcomes[index] = outcome;
      if (outcome.failure) {
        failed++;
        failedMessages.push({ messageId: outcome.messageId, reason: outcome.failure });
      } else {
        analyzed++;
      }
      completed++;
      reportProgress();
    }
  };

  const workerCount = Math.min(
    Math.max(1, Math.floor(Number(concurrency)) || 1),
    MAX_RULE_MATCH_CONCURRENCY,
    Math.max(queue.length, 1),
  );
  await Promise.all(Array.from({ length: workerCount }, worker));

  // Messages never started because of cancellation are skipped, not failed,
  // and are never counted as zero-score messages.
  const cancelled = Boolean(signal?.aborted) && completed < queue.length;
  for (let i = 0; i < queue.length; i++) {
    if (!outcomes[i]) skippedMessages.push({ messageId: queue[i], reason: 'cancelled' });
  }

  const assessedList = outcomes.filter(o => o?.assessed).map(o => o.assessed);
  const classifications = { normal: 0, review: 0, 'high-risk': 0 };
  for (const a of assessedList) {
    if (a.classification in classifications) classifications[a.classification]++;
  }

  // Order failures by request order for a stable contract regardless of concurrency.
  const order = new Map(queue.map((id, i) => [id, i]));
  failedMessages.sort((a, b) => order.get(a.messageId) - order.get(b.messageId));
  const rules = aggregateRuleMatches(assessedList);
  timings.elapsedMs = now() - startedAt;

  return {
    requested,
    analyzed,
    failed,
    skipped: skippedMessages.length,
    overLimit,
    limit,
    cancelled,
    layers: [...RULE_LAYERS],
    classifications,
    rules,
    failedMessages,
    skippedMessages,
    timings,
  };
}

/**
 * Run the analysis against the Thunderbird API.
 *
 * @param {number[]} messageIds
 * @param {object} opts
 * @param {object} opts.browserApi   - The `browser` global.
 * @param {() => Promise<object>} opts.loadSnapshot - readStorageSnapshot (never writes storage).
 * @param {Array<string|null>} [opts.accountIds] - Aligned with messageIds.
 * @param {object} [opts.lookups]
 * @param {Function} [opts.onProgress]
 * @param {{ aborted: boolean }} [opts.signal]
 * @param {number} [opts.concurrency]
 * @param {number|null} [opts.maxMessages] - Validated by resolveRuleMatchLimit().
 */
export function runRuleMatchAnalysis(messageIds, { browserApi, ...rest }) {
  return analyzeMessagesForRuleReport(messageIds, {
    ...rest,
    readMessage: createMessageReader(browserApi),
  });
}

/**
 * Serve one rule-match-report connection (runtime.connect port named
 * RULE_MATCH_REPORT_PORT).
 *
 * Client → background:
 *   { type: 'start', messageIds: number[], accountIds?: Array<string|null>,
 *     maxMessages?: number|null }            (first 'start' only; later ones ignored;
 *                                             an invalid maxMessages is an error)
 *   { type: 'cancel' }                        (disconnecting also cancels)
 * Background → client:
 *   { type: 'progress', progress }
 *   { type: 'result', report }
 *   { type: 'error', error: string }
 *
 * @param {object} port
 * @param {(messageIds: number[], opts: { accountIds, maxMessages, signal, onProgress }) => Promise<object>} run
 */
export function serveRuleMatchReportPort(port, run) {
  const signal = { aborted: false };
  let started = false;
  const post = msg => {
    if (signal.aborted && msg.type === 'progress') return;
    try { port.postMessage(msg); } catch { /* port closed */ }
  };

  port.onDisconnect.addListener(() => { signal.aborted = true; });
  port.onMessage.addListener(async msg => {
    if (msg?.type === 'cancel') {
      signal.aborted = true;
      return;
    }
    if (msg?.type !== 'start' || started) return;
    started = true;
    try {
      const report = await run(msg.messageIds, {
        accountIds: msg.accountIds,
        maxMessages: resolveRuleMatchLimit(msg.maxMessages),
        signal,
        onProgress: progress => post({ type: 'progress', progress }),
      });
      post({ type: 'result', report });
    } catch (e) {
      post({ type: 'error', error: String(e?.message ?? e) });
    }
  });
}
