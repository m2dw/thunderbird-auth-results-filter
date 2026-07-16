/**
 * Pure formatting helpers for decision log display and export.
 * No browser APIs — fully unit-testable.
 */

/**
 * Format a numeric score delta with an explicit sign.
 * Examples: 50 → "+50", -10 → "-10", 0 → "0"
 *
 * @param {number} n
 * @returns {string}
 */
export function formatDelta(n) {
  if (n > 0) return `+${n}`;
  return String(n);
}

/**
 * Build a compact top-reasons summary string for display in the log row.
 * Uses currentDelta when available (recalculated), else falls back to delta.
 * Reasons with zero effective delta are excluded.
 * Results sorted by absolute effective delta descending; top maxCount shown.
 *
 * @param {Array<{key: string, label?: string, delta: number, currentDelta?: number}>} reasons
 * @param {number} [maxCount=3]
 * @returns {string}  e.g. "SPF fail: +60 · DMARC fail: +25" or "" for empty/all-zero
 */
export function buildTopReasonsSummary(reasons, maxCount = 3) {
  if (!Array.isArray(reasons) || reasons.length === 0) return '';

  const nonZero = reasons
    .map(r => ({ r, effectiveDelta: r.currentDelta ?? r.delta }))
    .filter(({ effectiveDelta }) => effectiveDelta !== 0)
    .sort((a, b) => Math.abs(b.effectiveDelta) - Math.abs(a.effectiveDelta))
    .slice(0, maxCount);

  if (nonZero.length === 0) return '';

  return nonZero
    .map(({ r, effectiveDelta }) => `${r.label ?? r.key}: ${formatDelta(effectiveDelta)}`)
    .join(' · ');
}

/**
 * Return the most recent `limit` entries from a log stored newest-first.
 * Entries are returned in the same newest-first order within the slice.
 *
 * @param {Array} log   Full log array (newest entry at index 0).
 * @param {number} limit Maximum number of entries to return.
 * @returns {Array}
 */
export function sliceRecentLog(log, limit) {
  if (!Array.isArray(log) || limit <= 0) return [];
  return log.slice(0, limit);
}

/**
 * Return whether there are more log entries beyond what is currently rendered.
 *
 * @param {number} totalCount    Total entries stored in the log.
 * @param {number} renderedCount Number of entries currently visible in the UI.
 * @returns {boolean}
 */
export function logHasMore(totalCount, renderedCount) {
  return totalCount > renderedCount;
}

/**
 * Format a single score reason as a compact human-readable string.
 * Includes the label (or key as fallback), the original delta, and optional context.
 *
 * @param {{ key: string, label?: string, delta: number, authservId?: string, domain?: string, matchType?: string, matchedLabel?: string }} reason
 * @returns {string}
 */
export function formatScoreReasonSummary(reason) {
  const label = reason.label ?? reason.key;
  const delta = formatDelta(reason.delta);
  const parts = [`${label}: ${delta}`];

  if (reason.authservId) {
    parts.push(`(${reason.authservId})`);
  } else if (reason.key === 'heuristic.randomFromDomainLabel') {
    if (reason.matchedLabel) parts.push(`(label: ${reason.matchedLabel})`);
  } else if (reason.domain) {
    const matchType = reason.matchType ? ` ${reason.matchType}` : '';
    parts.push(`(${reason.domain}${matchType})`);
  }

  return parts.join(' ');
}
