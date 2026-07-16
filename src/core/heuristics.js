/**
 * Layer 3: Sender Heuristics
 *
 * Detects machine-generated-looking RFC5322 From identities using local,
 * offline signals: character entropy, vowel ratio, and consonant run length.
 *
 * These are weak-to-moderate additive signals. The layer total is capped so
 * that Layer 3 alone cannot push a message to high-risk. All contributions
 * are recorded in scoreReasons for log display and tuning.
 *
 * Scoring still checks all domain labels without PSL context (intentional:
 * subdomain-depth scoring rules have not been decided yet). However,
 * computeHeuristicMetrics() does record PSL-backed domain parts via
 * getDomainParts() so that subdomain depth can be observed in logs before
 * any scoring changes are made.
 */

import { computeLexicalHeuristics } from '../vendor/mail-auth-signal.esm.js';
import { getDomainParts } from './domainParts.js';
import { computeLexicalMetrics } from './lexicalMetrics.js';
import { computeBigramMetrics } from './bigramNaturalness.js';

/** Vowels used for vowel-ratio and consonant-run calculations. */
const VOWELS = new Set('aeiou');

/** Default Layer 3 heuristic score values. */
export const DEFAULT_HEURISTIC_SCORES = {
  randomFromDomainLabel: 15,
  randomFromLocalPart: 5,
  layer3Cap: 25,
};

/** Maximum total score contribution from Layer 3 (default). */
export const LAYER3_CAP = DEFAULT_HEURISTIC_SCORES.layer3Cap;

/**
 * Compute Shannon entropy of a string.
 * Returns 0 for empty input.
 *
 * @param {string} str
 * @returns {number}
 */
export function entropy(str) {
  if (!str) return 0;
  const freq = new Map();
  for (const c of str) freq.set(c, (freq.get(c) ?? 0) + 1);
  return [...freq.values()].reduce((sum, count) => {
    const p = count / str.length;
    return sum - p * Math.log2(p);
  }, 0);
}

/**
 * Compute the ratio of vowel characters (a, e, i, o, u) in a string.
 * Returns 0 for empty input.
 *
 * @param {string} str - Should be pre-lowercased for consistent results.
 * @returns {number}
 */
export function vowelRatio(str) {
  if (!str) return 0;
  const vowels = [...str].filter(c => VOWELS.has(c)).length;
  return vowels / str.length;
}

/**
 * Compute the length of the longest run of consecutive consonant letters
 * (letters that are not a, e, i, o, u). Non-letter characters break runs.
 *
 * @param {string} str - Should be pre-lowercased for consistent results.
 * @returns {number}
 */
export function maxConsonantRun(str) {
  let max = 0;
  let run = 0;
  for (const c of str) {
    if (c >= 'a' && c <= 'z' && !VOWELS.has(c)) {
      if (++run > max) max = run;
    } else {
      run = 0;
    }
  }
  return max;
}

/**
 * Return true if a single domain label looks machine-generated.
 *
 * Rule:
 *   label.length >= 6
 *   AND entropy(label) >= 2.3
 *   AND (vowelRatio(label) <= 0.20 OR maxConsonantRun(label) >= 4)
 *
 * @param {string} label - A single dot-separated domain label (lowercased).
 * @returns {boolean}
 */
export function isRandomLookingLabel(label) {
  if (label.length < 6) return false;
  if (entropy(label) < 2.3) return false;
  return vowelRatio(label) <= 0.20 || maxConsonantRun(label) >= 4;
}

/**
 * Return true if an RFC5322 From local part looks machine-generated.
 *
 * Rule (applied to letters-only view, lowercased):
 *   letters.length >= 5
 *   AND entropy(letters) >= 2.2
 *   AND (
 *     vowelRatio(letters) <= 0.25
 *     OR maxConsonantRun(letters) >= 4
 *     OR localPart matches /^[A-Z]{5,}$/
 *   )
 *
 * @param {string} localPart - The local part before '@', original case.
 * @returns {boolean}
 */
export function isRandomLookingLocalPart(localPart) {
  if (!localPart) return false;
  const letters = localPart.replace(/[^a-zA-Z]/g, '').toLowerCase();
  if (letters.length < 5) return false;
  if (entropy(letters) < 2.2) return false;
  return (
    vowelRatio(letters) <= 0.25 ||
    maxConsonantRun(letters) >= 4 ||
    /^[A-Z]{5,}$/.test(localPart)
  );
}

/**
 * Round a number to at most `places` decimal places.
 * Trailing zeros are dropped (e.g. 2.500 → 2.5, 2.000 → 2).
 *
 * @param {number} n
 * @param {number} [places=3]
 * @returns {number}
 */
function round(n, places = 3) {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

/**
 * Compute raw heuristic metrics for a From address without applying any
 * threshold or scoring. Returns all per-label domain data (short labels included)
 * so the caller can observe the full distribution and tune thresholds later.
 *
 * The returned metrics are intended for logging / data collection only and are
 * NOT used in scoring decisions.
 *
 * @param {object} opts
 * @param {string} [opts.fromDomain]    - RFC5322 From domain (lowercased).
 * @param {string} [opts.fromLocalPart] - RFC5322 From local part, original case.
 * @returns {{
 *   fromDomain: { value: string, domainParts: object } | null,
 *   fromLocalPart: { value: string, length: number, entropy: number, vowelRatio: number, maxConsonantRun: number } | null,
 *   fromDomainLabels: Array<{ label: string, length: number, entropy: number, vowelRatio: number, maxConsonantRun: number }>
 * }}
 */
export function computeHeuristicMetrics({ fromDomain = '', fromLocalPart = '' } = {}) {
  // Domain: PSL-backed decomposition for subdomain-depth observation.
  let fromDomainMetrics = null;
  if (fromDomain) {
    const parts = getDomainParts(fromDomain);
    fromDomainMetrics = {
      value: fromDomain,
      domainParts: {
        registrableDomain: parts.registrableDomain,
        publicSuffix: parts.publicSuffix,
        subdomain: parts.subdomain,
        subdomainDepth: parts.subdomainDepth,
        isIcann: parts.isIcann,
        isPrivate: parts.isPrivate,
      },
    };
  }

  // Local part: operate on letters-only lowercase view (same view used for scoring).
  // lexicalMetrics merges mail-auth-signal computeLexicalHeuristics (core fields)
  // with computeLexicalMetrics (supplemental fields not in the package).
  let localPartMetrics = null;
  if (fromLocalPart) {
    const letters = fromLocalPart.replace(/[^a-zA-Z]/g, '').toLowerCase();
    const lh = computeLexicalHeuristics(fromLocalPart);
    const lm = computeLexicalMetrics(fromLocalPart);
    // Log-only boolean flags — observability only, no scoring.
    // Length guard (>= 6) prevents false flags on short benign local parts.
    const lenGuard = lm.length >= 6;
    localPartMetrics = {
      value: fromLocalPart,
      length: letters.length,
      entropy: round(entropy(letters)),
      vowelRatio: round(vowelRatio(letters)),
      maxConsonantRun: maxConsonantRun(letters),
      lexicalMetrics: { ...lh, ...lm },
      highDigitRatio: lenGuard && lm.digitRatio >= 0.3,
      highLetterDigitTransitions: lenGuard && lm.letterDigitTransitionCount >= 3,
      hyphenHeavy: lm.hyphenCount >= 2 && lm.hyphenRatio >= 0.25,
    };
  }

  // Domain labels: record each non-empty label, longest-first order is preserved as-is.
  const domainLabels = fromDomain
    ? fromDomain.split('.').filter(l => l.length > 0).map(label => {
        const lh = computeLexicalHeuristics(label);
        const dlm = computeLexicalMetrics(label);
        return {
          label,
          length: label.length,
          entropy: round(entropy(label)),
          vowelRatio: round(vowelRatio(label)),
          maxConsonantRun: maxConsonantRun(label),
          lexicalMetrics: { ...lh, ...dlm },
          // Log-only flag: label has multiple hyphens relative to its length.
          hyphenHeavyLabel: dlm.hyphenCount >= 2 && label.length >= 6,
          // Log-only bigram naturalness metric; null when alpha length < 4.
          bigramMetrics: computeBigramMetrics(label),
        };
      })
    : [];

  return { fromDomain: fromDomainMetrics, fromLocalPart: localPartMetrics, fromDomainLabels: domainLabels };
}

/**
 * Score Layer 3 sender heuristics for a message's From address.
 *
 * Checks each domain label and the local part independently. Only the first
 * matching domain label is reported to avoid duplicate domain-label reasons.
 * The total is capped at LAYER3_CAP.
 *
 * Returns { score, scoreReasons } where scoreReasons carries the raw
 * per-signal deltas before the cap. When the cap is not triggered (the common
 * case), score equals the sum of all deltas.
 *
 * @param {object} opts
 * @param {string} [opts.fromDomain]       - RFC5322 From domain (lowercased).
 * @param {string} [opts.fromLocalPart]    - RFC5322 From local part, original case.
 * @param {object} [opts.heuristicScores]  - Configurable score values; falls back to DEFAULT_HEURISTIC_SCORES.
 * @returns {{ score: number, scoreReasons: Array }}
 */
export function scoreLayer3({ fromDomain = '', fromLocalPart = '', heuristicScores } = {}) {
  const scores = { ...DEFAULT_HEURISTIC_SCORES, ...heuristicScores };
  const scoreReasons = [];
  let totalDelta = 0;

  // Check domain labels for random-looking patterns.
  // All labels are checked; only the first match is reported.
  const labels = fromDomain.split('.');
  for (const label of labels) {
    if (isRandomLookingLabel(label)) {
      const delta = scores.randomFromDomainLabel;
      scoreReasons.push({
        key: 'heuristic.randomFromDomainLabel',
        label: 'Random-looking From domain label',
        delta,
        domain: fromDomain,
        matchedLabel: label,
      });
      totalDelta += delta;
      break;
    }
  }

  // Check the local part for random-looking patterns.
  if (isRandomLookingLocalPart(fromLocalPart)) {
    const delta = scores.randomFromLocalPart;
    scoreReasons.push({
      key: 'heuristic.randomFromLocalPart',
      label: 'Random-looking From local part',
      delta,
    });
    totalDelta += delta;
  }

  return { score: Math.min(totalDelta, scores.layer3Cap), scoreReasons };
}
