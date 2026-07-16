/**
 * English character bigram naturalness model for domain label analysis.
 *
 * Provides log-only metrics (avgNegLogProb) for detecting random/DGA-generated
 * domain labels. Higher avgNegLogProb indicates less natural (more random) labels.
 *
 * Based on approximate English character bigram conditional frequencies derived
 * from standard English text analysis. Not used for scoring; recorded in
 * heuristicMetrics for observability only.
 *
 * Design notes:
 *   - Only lowercase alpha characters [a-z] are considered; digits, hyphens,
 *     and other characters are stripped before analysis.
 *   - BIGRAM_MIN_ALPHA_LENGTH guards against false signals on short labels.
 *   - All values are rounded to at most 3 decimal places.
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const CHAR_TO_IDX = new Map([...ALPHABET].map((c, i) => [c, i]));

/**
 * Minimum number of alpha characters in a label to produce a meaningful score.
 * Labels with fewer alpha characters return null (not applicable).
 */
export const BIGRAM_MIN_ALPHA_LENGTH = 4;

/**
 * Approximate English character bigram pseudo-counts.
 * ROWS = c1 (a–z), COLUMNS = c2 (a–z).
 *
 * Values represent relative transition frequencies from c1 to c2 in English
 * text, with a floor of 1 (Laplace smoothing) for all pairs to avoid -Infinity.
 * Based on standard English bigram frequency analysis.
 *
 * Selected higher values reflect well-known English transitions such as:
 *   th, he, in, er, an, re, on, st, en, nd, ng …
 */
const RAW_COUNTS = [
  //  a   b   c   d   e   f   g   h   i   j   k   l   m   n   o   p   q   r   s   t   u   v   w   x   y   z
  [  1,  2,  5,  8,  3,  3,  3,  2,  5,  1,  2,  8,  5, 12,  3,  3,  1, 11,  9, 10,  3,  4,  2,  1,  3,  1], // a
  [  9,  1,  1,  1, 11,  1,  1,  1, 10,  1,  1, 14,  1,  1, 10,  1,  1, 10,  3,  2, 11,  1,  1,  1,  5,  1], // b
  [  9,  1,  1,  1, 12,  1,  1, 22,  7,  1,  8,  5,  1,  1, 14,  1,  1,  8,  3,  4,  5,  1,  1,  1,  1,  1], // c
  [  8,  1,  1,  1, 17,  1,  2,  3, 12,  1,  3,  4,  3,  3,  9,  1,  1,  7,  5,  4,  5,  1,  3,  1,  2,  1], // d
  [  8,  1,  5,  9,  3,  2,  2,  1,  3,  1,  2,  8,  4, 13,  3,  2,  1, 15, 12,  7,  2,  4,  2,  3,  2,  1], // e
  [  9,  1,  1,  1, 10,  5,  1,  1, 11,  1,  1,  4,  1,  1, 18,  1,  1, 15,  3,  2,  7,  1,  1,  1,  2,  1], // f
  [  8,  1,  1,  1, 20,  1,  2, 10,  7,  1,  1,  3,  2,  2,  9,  1,  1, 11,  9,  2,  3,  1,  1,  1,  3,  1], // g
  [ 14,  1,  1,  1, 38,  1,  1,  1, 12,  1,  1,  2,  2,  2, 10,  1,  1,  2,  2,  2,  7,  1,  1,  1,  1,  1], // h
  [  5,  2,  8,  5,  6,  3,  4,  1,  1,  1,  3,  7,  5, 22,  8,  3,  1,  5, 14,  9,  2,  3,  1,  2,  1,  1], // i
  [  8,  1,  1,  1, 12,  1,  1,  1,  4,  1,  1,  2,  1,  1, 14,  1,  1,  1,  1,  1, 28,  1,  1,  1,  1,  1], // j
  [  1,  1,  1,  1, 27,  1,  1,  1, 11,  1,  1,  7,  1,  8,  1,  1,  1,  1,  9,  1,  1,  1,  1,  1,  4,  1], // k
  [  7,  1,  1,  6, 24,  2,  1,  1, 12,  1,  1, 14,  1,  2,  7,  1,  1,  1,  5,  2,  3,  2,  2,  1,  8,  1], // l
  [ 17,  2,  1,  1, 14,  1,  1,  1, 13,  1,  1,  2,  2,  2, 12,  8,  1,  2,  3,  2,  2,  1,  1,  1,  3,  1], // m
  [  6,  1,  7, 14, 10,  2, 12,  2,  7,  1,  1,  1,  1,  1,  3,  1,  1,  1,  9, 11,  2,  1,  2,  1,  2,  1], // n
  [  2,  2,  3,  3,  2, 10,  3,  1,  3,  1,  1,  3,  5, 19,  2,  3,  1, 10,  7,  7,  8,  3,  5,  1,  2,  1], // o
  [  9,  1,  1,  1, 13,  1,  1,  8,  6,  1,  1,  9,  1,  1, 10,  2,  1, 19,  3,  2,  3,  1,  1,  1,  2,  1], // p
  [  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1, 90,  1,  1,  1,  1,  1], // q (u dominant)
  [ 10,  1,  1,  1, 23,  2,  2,  1, 14,  1,  2,  3,  2,  6, 12,  2,  1,  2,  8,  6,  2,  2,  2,  1,  3,  1], // r
  [  8,  1,  5,  2, 13,  2,  1,  9, 11,  1,  1,  3,  2,  2,  5,  3,  1,  2,  6, 17,  4,  1,  3,  1,  2,  1], // s
  [  7,  1,  1,  1, 15,  1,  1, 28, 11,  1,  1,  3,  1,  1, 11,  1,  1,  4,  6,  2,  3,  1,  2,  1,  2,  1], // t
  [  2,  2,  5,  4,  8,  2,  4,  1,  3,  1,  1,  9,  3, 16,  2,  5,  1, 17, 11, 13,  1,  2,  1,  1,  2,  1], // u
  [ 11,  1,  1,  1, 41,  1,  1,  1, 22,  1,  1,  2,  1,  1,  7,  1,  1,  2,  1,  1,  1,  1,  1,  1,  3,  1], // v
  [ 17,  1,  1,  2, 13,  1,  1, 13, 16,  1,  1,  3,  1,  7, 11,  1,  1,  3,  3,  2,  1,  1,  1,  1,  2,  1], // w
  [  8,  1,  7,  1, 10,  2,  1,  1, 11,  1,  1,  3,  1,  1,  2, 14,  1,  1,  2, 12,  2,  1,  1,  1,  1,  1], // x
  [  1,  2,  3,  3, 15,  3,  2,  1,  7,  1,  1,  5,  5,  5, 13,  2,  1,  3, 16,  3,  2,  1,  2,  1,  1,  1], // y
  [ 10,  1,  1,  1, 24,  1,  1,  1, 14,  1,  1,  2,  2,  2,  7,  1,  1,  2,  2,  2,  3,  1,  1,  1,  2,  7], // z
];

// Pre-compute log2 conditional probability table from raw counts.
const LOG2_TABLE = RAW_COUNTS.map(row => {
  const rowSum = row.reduce((a, b) => a + b, 0);
  return row.map(count => Math.log2(count / rowSum));
});

/**
 * Compute bigram naturalness metrics for a domain label.
 *
 * Strips non-alpha characters and applies the English bigram model to the
 * remaining lowercase letters. Returns null when the alpha character count
 * is below BIGRAM_MIN_ALPHA_LENGTH (not enough data for a meaningful score).
 *
 * A higher avgNegLogProb indicates lower naturalness (more random character
 * transitions relative to English text).
 *
 * @param {string} label - Domain label or string to analyse (any case).
 * @returns {{ avgNegLogProb: number, bigramCount: number } | null}
 */
export function computeBigramMetrics(label) {
  if (!label) return null;
  const s = label.toLowerCase().replace(/[^a-z]/g, '');
  if (s.length < BIGRAM_MIN_ALPHA_LENGTH) return null;

  let totalNegLogProb = 0;
  let count = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const c1 = CHAR_TO_IDX.get(s[i]);
    const c2 = CHAR_TO_IDX.get(s[i + 1]);
    if (c1 === undefined || c2 === undefined) continue;
    totalNegLogProb -= LOG2_TABLE[c1][c2];
    count++;
  }

  if (count === 0) return null;
  return {
    avgNegLogProb: Math.round((totalNegLogProb / count) * 1000) / 1000,
    bigramCount: count,
  };
}
