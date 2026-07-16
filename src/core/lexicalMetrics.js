/**
 * Supplemental lexical metrics for Layer 3 observability.
 *
 * Computes DGA-like lexical features not covered by mail-auth-signal's
 * computeLexicalHeuristics. The following fields were present in earlier
 * versions of this module and are now sourced from the package instead:
 *   - Shannon entropy        → shannonEntropy    (computeLexicalHeuristics)
 *   - Normalized entropy     → normalizedEntropy (computeLexicalHeuristics)
 *   - Max consonant run      → maxConsonantRun   (computeLexicalHeuristics)
 *   - Max repeated-char run  → maxRepeatedCharRun (computeLexicalHeuristics)
 *   - Unique-char ratio      → uniqueCharRatio   (computeLexicalHeuristics)
 *
 * Intentionally retained local behaviors (differ from package equivalents):
 *   - vowelRatioAlphaOnly: uses vowel set aeiouy (includes 'y') vs the
 *     package's aeiou-only vowelRatio.
 *   - letterDigitTransitionCount: symbol-skip semantics — a non-alpha,
 *     non-digit character does not reset the tracked previous type, so
 *     'a-1' counts as one transition. The package's letterDigitTransitions
 *     tests only adjacent characters, giving 0 for 'a-1'.
 *   - hasLongHexLikeRun, digitRatio, hyphenCount, hyphenRatio: no package
 *     equivalent.
 *
 * In computeHeuristicMetrics() the output of this module is merged with
 * computeLexicalHeuristics() from mail-auth-signal so that the combined
 * lexicalMetrics field carries both sets of fields.
 *
 * All floating-point outputs are rounded to at most 3 decimal places.
 */

const VOWELS = new Set('aeiouy');
const HEX_CHARS = new Set('0123456789abcdef');

/** Round n to at most 3 decimal places. */
function r3(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Compute supplemental lexical metrics for a single string.
 *
 * The input is lowercased before analysis. Pass the raw local-part or domain
 * label; do not pre-strip letters.
 *
 * Fields migrated to mail-auth-signal's computeLexicalHeuristics and removed
 * from this function: entropy, normalizedEntropy, maxConsonantRun,
 * maxRepeatedCharRun, uniqueCharRatio.
 *
 * @param {string} input
 * @returns {{
 *   length:                     number,
 *   alphaLength:                number,
 *   digitCount:                 number,
 *   digitRatio:                 number,
 *   vowelCount:                 number,
 *   vowelRatioAlphaOnly:        number,
 *   uniqueCharCount:            number,
 *   hasLongHexLikeRun:          boolean,
 *   letterDigitTransitionCount: number,
 *   hyphenCount:                number,
 *   hyphenRatio:                number
 * }}
 */
export function computeLexicalMetrics(input) {
  if (!input) {
    return {
      length: 0,
      alphaLength: 0,
      digitCount: 0,
      digitRatio: 0,
      vowelCount: 0,
      vowelRatioAlphaOnly: 0,
      uniqueCharCount: 0,
      hasLongHexLikeRun: false,
      letterDigitTransitionCount: 0,
      hyphenCount: 0,
      hyphenRatio: 0,
    };
  }

  const s = input.toLowerCase();
  const n = s.length;

  // ── Per-character pass ────────────────────────────────────────────────────

  let alphaLength = 0;
  let digitCount = 0;
  let vowelCount = 0;

  // Hex-like run tracking.
  let hexRunLen = 0;
  let hexRunHasDigit = false;
  let hasLongHexLikeRun = false;

  // Letter/digit transition tracking (symbols don't reset lastAlphaType).
  let letterDigitTransitionCount = 0;
  let lastAlphaType = null; // 'letter' | 'digit'

  // Hyphen tracking.
  let hyphenCount = 0;

  for (let i = 0; i < n; i++) {
    const c = s[i];
    const isLetter = c >= 'a' && c <= 'z';
    const isDigit  = c >= '0' && c <= '9';
    const isHex    = HEX_CHARS.has(c);

    // Alpha / digit / vowel counts.
    if (isLetter) {
      alphaLength++;
      if (VOWELS.has(c)) vowelCount++;
    } else if (isDigit) {
      digitCount++;
    }

    // Hex-like run.
    if (isHex) {
      hexRunLen++;
      if (isDigit) hexRunHasDigit = true;
    } else {
      if (hexRunLen >= 6 && hexRunHasDigit) hasLongHexLikeRun = true;
      hexRunLen = 0;
      hexRunHasDigit = false;
    }

    // Hyphen count.
    if (c === '-') hyphenCount++;

    // Letter/digit transitions (symbols don't reset lastAlphaType).
    if (isLetter) {
      if (lastAlphaType === 'digit') letterDigitTransitionCount++;
      lastAlphaType = 'letter';
    } else if (isDigit) {
      if (lastAlphaType === 'letter') letterDigitTransitionCount++;
      lastAlphaType = 'digit';
    }
  }

  // Check the final hex run.
  if (hexRunLen >= 6 && hexRunHasDigit) hasLongHexLikeRun = true;

  // ── Derived metrics ───────────────────────────────────────────────────────

  const hyphenRatio         = n > 0          ? r3(hyphenCount / n)           : 0;
  const digitRatio          = n > 0          ? r3(digitCount  / n)           : 0;
  const vowelRatioAlphaOnly = alphaLength > 0 ? r3(vowelCount  / alphaLength) : 0;
  const uniqueCharCount     = new Set(s).size;

  return {
    length: n,
    alphaLength,
    digitCount,
    digitRatio,
    vowelCount,
    vowelRatioAlphaOnly,
    uniqueCharCount,
    hasLongHexLikeRun,
    letterDigitTransitionCount,
    hyphenCount,
    hyphenRatio,
  };
}
