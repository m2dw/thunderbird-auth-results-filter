/**
 * Presentation helpers for the rule match report tab (pure).
 *
 * Sorting, layer filtering, share-of-analyzed computation, and result-state
 * classification over the report returned by analyzeMessagesForRuleReport().
 * See SPEC.md "Rule Match Report" → "Report tab".
 */

import { compareRuleKeys, RULE_LAYERS } from './ruleMatchReport.js';

export const SORT_KEYS = ['matches', 'rule'];
export const SORT_DIRECTIONS = ['asc', 'desc'];
export const DEFAULT_SORT = Object.freeze({ key: 'matches', direction: 'desc' });
export const ALL_LAYERS = 'all';

/**
 * Normalize a sort request, falling back to the default (most matches first).
 *
 * @param {{ key?: string, direction?: string }} [sort]
 * @returns {{ key: 'matches'|'rule', direction: 'asc'|'desc' }}
 */
export function normalizeSort(sort) {
  const key = SORT_KEYS.includes(sort?.key) ? sort.key : DEFAULT_SORT.key;
  const direction = SORT_DIRECTIONS.includes(sort?.direction)
    ? sort.direction
    : (key === 'rule' ? 'asc' : DEFAULT_SORT.direction);
  return { key, direction };
}

/**
 * Next sort state after the user activates a column header: the active column
 * toggles its direction; a new column starts in its natural direction
 * (rule order ascending, matches descending).
 *
 * @param {{ key: string, direction: string }} current
 * @param {'matches'|'rule'} key
 */
export function toggleSort(current, key) {
  const cur = normalizeSort(current);
  if (cur.key === key) return { key, direction: cur.direction === 'asc' ? 'desc' : 'asc' };
  return normalizeSort({ key });
}

/**
 * Sort rule aggregates.
 *
 * - 'rule': canonical rule order (L1→L5, then rank within layer, then key);
 *   'desc' is the exact reverse.
 * - 'matches': by matchCount; ties are always broken by canonical rule order
 *   ascending, in both directions, so equal counts keep a stable L1→L5 order.
 *
 * Returns a new array; the input is not modified.
 *
 * @param {Array<{ key: string, matchCount: number }>} rules
 * @param {{ key?: string, direction?: string }} [sort]
 */
export function sortRuleRows(rules, sort) {
  const { key, direction } = normalizeSort(sort);
  const sign = direction === 'asc' ? 1 : -1;
  const rows = [...(rules ?? [])];
  if (key === 'rule') {
    return rows.sort((a, b) => sign * compareRuleKeys(a.key, b.key));
  }
  return rows.sort((a, b) => {
    const diff = (a.matchCount ?? 0) - (b.matchCount ?? 0);
    if (diff !== 0) return sign * diff;
    return compareRuleKeys(a.key, b.key);
  });
}

/**
 * Filter rule aggregates by layer and diagnostic visibility.
 *
 * @param {Array<{ layer: string|null, diagnostic?: boolean }>} rules
 * @param {object} [opts]
 * @param {string} [opts.layer] - 'all' (default) or one of RULE_LAYERS.
 * @param {boolean} [opts.includeDiagnostic] - Default true.
 */
export function filterRuleRows(rules, { layer = ALL_LAYERS, includeDiagnostic = true } = {}) {
  const byLayer = RULE_LAYERS.includes(layer) ? layer : ALL_LAYERS;
  return (rules ?? []).filter(rule =>
    (byLayer === ALL_LAYERS || rule.layer === byLayer) &&
    (includeDiagnostic || !rule.diagnostic));
}

/**
 * Share of analyzed messages matching a rule, in [0, 1], or null when no
 * message was analyzed.
 *
 * @param {number} matchCount
 * @param {number} analyzed
 * @returns {number|null}
 */
export function matchShare(matchCount, analyzed) {
  if (!Number.isFinite(analyzed) || analyzed <= 0) return null;
  return Math.max(0, Math.min(1, (matchCount ?? 0) / analyzed));
}

/**
 * Classify a finished report for display.
 *
 * - 'cancelled': the user cancelled before every queued message was processed.
 * - 'empty':     the scope held no messages.
 * - 'partial':   some requested messages were not analyzed (failed, skipped,
 *                over the limit, or the scope exceeded the processing limit).
 * - 'complete':  every message in the scope was analyzed.
 *
 * @param {object} report
 * @param {{ truncated?: boolean }} [scope]
 * @returns {'cancelled'|'empty'|'partial'|'complete'}
 */
export function reportState(report, scope = {}) {
  if (report?.cancelled) return 'cancelled';
  if (!scope?.truncated && (report?.requested ?? 0) === 0) return 'empty';
  if ((report?.failed ?? 0) > 0 || (report?.skipped ?? 0) > 0 || (report?.overLimit ?? 0) > 0 || scope?.truncated) {
    return 'partial';
  }
  return 'complete';
}

/**
 * Settle the scope returned once the background finishes collecting a
 * selection. Cancel clicked after collection finished, but before the tab
 * noticed, never reaches the background, so it is applied here instead of
 * starting the analysis.
 *
 * @param {object|null} scope - Scope from the background, or null if gone.
 * @param {{ cancelRequested?: boolean }} [opts]
 * @returns {object|null}
 */
export function settleCollectedScope(scope, { cancelRequested = false } = {}) {
  if (!cancelRequested || !scope || scope.kind === 'error' || scope.cancelled) return scope;
  return { ...scope, cancelled: true };
}

/**
 * Report totals for the whole scope. Messages beyond the processing limit
 * never reach the batch analysis, so they are added to `requested` and
 * `overLimit` here; analyzed, failed, skipped, and per-rule counts are
 * unchanged, so cap exclusions stay separate from read failures.
 *
 * @param {object} report - Batch result.
 * @param {number} [excluded] - Scope messages left out by the processing limit.
 * @returns {object}
 */
export function withScopeExclusions(report, excluded = 0) {
  const extra = Number.isInteger(excluded) && excluded > 0 ? excluded : 0;
  if (!report || extra === 0) return report;
  return {
    ...report,
    requested: (report.requested ?? 0) + extra,
    overLimit: (report.overLimit ?? 0) + extra,
  };
}

export const DRILLDOWN_PAGE_SIZE = 100;

/**
 * One page of a rule's matching messages for the drill-down list.
 *
 * @param {Array} items
 * @param {number} page - Zero-based; clamped to the available pages.
 * @param {number} [pageSize]
 * @returns {{ items: Array, page: number, pageCount: number, start: number, end: number, total: number }}
 *   `start` / `end` are 1-based positions of the first / last item shown (0 when empty).
 */
export function pageItems(items, page, pageSize = DRILLDOWN_PAGE_SIZE) {
  const list = items ?? [];
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(list.length / size));
  const current = Math.min(Math.max(0, Math.floor(page) || 0), pageCount - 1);
  const offset = current * size;
  const slice = list.slice(offset, offset + size);
  return {
    items: slice,
    page: current,
    pageCount,
    start: slice.length ? offset + 1 : 0,
    end: offset + slice.length,
    total: list.length,
  };
}

/**
 * Rule aggregate for a key, used by the drill-down view.
 *
 * @param {object} report
 * @param {string} key
 */
export function findRule(report, key) {
  return (report?.rules ?? []).find(rule => rule.key === key) ?? null;
}
