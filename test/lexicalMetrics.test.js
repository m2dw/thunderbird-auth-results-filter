import { computeLexicalMetrics } from '../src/core/lexicalMetrics.js';
import { computeLexicalHeuristics } from '../src/vendor/mail-auth-signal.esm.js';

// ─── computeLexicalMetrics ────────────────────────────────────────────────────
//
// This module now exports only supplemental fields not covered by the package's
// computeLexicalHeuristics. The following fields were removed and are now
// sourced from mail-auth-signal:
//   entropy / shannonEntropy, normalizedEntropy, maxConsonantRun,
//   maxRepeatedCharRun, uniqueCharRatio.
//
// See parity tests below for evidence that the package values are equivalent.

describe('computeLexicalMetrics', () => {

  // ── Return shape ──

  test('returns all expected keys', () => {
    const keys = Object.keys(computeLexicalMetrics('abc'));
    expect(keys).toEqual([
      'length', 'alphaLength', 'digitCount', 'digitRatio',
      'vowelCount', 'vowelRatioAlphaOnly',
      'uniqueCharCount',
      'hasLongHexLikeRun', 'letterDigitTransitionCount',
      'hyphenCount', 'hyphenRatio',
    ]);
  });

  // ── Empty / falsy input ──

  test('empty string: all numeric metrics are 0, bool false', () => {
    const m = computeLexicalMetrics('');
    expect(m.length).toBe(0);
    expect(m.alphaLength).toBe(0);
    expect(m.digitCount).toBe(0);
    expect(m.digitRatio).toBe(0);
    expect(m.vowelCount).toBe(0);
    expect(m.vowelRatioAlphaOnly).toBe(0);
    expect(m.uniqueCharCount).toBe(0);
    expect(m.hasLongHexLikeRun).toBe(false);
    expect(m.letterDigitTransitionCount).toBe(0);
    expect(m.hyphenCount).toBe(0);
    expect(m.hyphenRatio).toBe(0);
  });

  test('null / undefined input returns zero-safe metrics', () => {
    expect(() => computeLexicalMetrics(null)).not.toThrow();
    expect(() => computeLexicalMetrics(undefined)).not.toThrow();
    expect(computeLexicalMetrics(null).length).toBe(0);
  });

  // ── Issue #22 spec examples ──

  test('xfg8392a: basic metrics', () => {
    const m = computeLexicalMetrics('xfg8392a');
    expect(m.length).toBe(8);
    expect(m.digitCount).toBe(4); // 8, 3, 9, 2
    expect(m.digitRatio).toBeCloseTo(0.5, 2);
    expect(m.alphaLength).toBe(4); // x, f, g, a
    // vowels in aeiouy: a=yes → vowelCount=1
    expect(m.vowelCount).toBe(1);
    expect(m.vowelRatioAlphaOnly).toBeCloseTo(0.25, 2);
    // hex run: f(yes), 8(yes,digit), 3(yes,digit), 9(yes,digit), 2(yes,digit), a(yes) → run=5 (x breaks first; run=1 for x? no: x is not hex)
    // x(no-hex,breaks), f(hex,run=1,no-digit), g(not-hex,breaks), 8(hex,run=1,digit), 3(hex,run=2,digit), 9(hex,run=3,digit), 2(hex,run=4,digit), a(hex,run=5,digit present)
    // 5 < 6 → false
    expect(m.hasLongHexLikeRun).toBe(false);
    // transitions: x(letter)→8(digit)=1, 2(digit)→a(letter)=2
    expect(m.letterDigitTransitionCount).toBe(2);
  });

  test('dh73jsk: transitions and consonants', () => {
    const m = computeLexicalMetrics('dh73jsk');
    expect(m.length).toBe(7);
    expect(m.digitCount).toBe(2); // 7, 3
    expect(m.alphaLength).toBe(5); // d, h, j, s, k
    // vowels in aeiouy among d,h,j,s,k: none
    expect(m.vowelCount).toBe(0);
    expect(m.vowelRatioAlphaOnly).toBe(0);
    // transitions: dh(letter) → 7(digit) = 1, 3(digit) → j(letter) = 2
    expect(m.letterDigitTransitionCount).toBe(2);
    expect(m.hasLongHexLikeRun).toBe(false);
  });

  test('support: typical benign local part', () => {
    const m = computeLexicalMetrics('support');
    expect(m.length).toBe(7);
    expect(m.digitCount).toBe(0);
    expect(m.digitRatio).toBe(0);
    expect(m.alphaLength).toBe(7);
    // vowels: u, o → 2; y not present
    expect(m.vowelCount).toBe(2);
    expect(m.letterDigitTransitionCount).toBe(0);
    expect(m.hasLongHexLikeRun).toBe(false);
  });

  test('admin: vowels include a and i', () => {
    const m = computeLexicalMetrics('admin');
    expect(m.length).toBe(5);
    expect(m.digitCount).toBe(0);
    // vowels in aeiouy: a, i → 2
    expect(m.vowelCount).toBe(2);
    expect(m.hasLongHexLikeRun).toBe(false);
    expect(m.letterDigitTransitionCount).toBe(0);
  });

  test('taro.yamada: vowel counting includes y', () => {
    const m = computeLexicalMetrics('taro.yamada');
    expect(m.length).toBe(11);
    expect(m.digitCount).toBe(0);
    // vowels in aeiouy: a, o, y, a, a, a = 6 (y counted as vowel)
    expect(m.vowelCount).toBe(6);
    expect(m.hasLongHexLikeRun).toBe(false);
  });

  // ── hasLongHexLikeRun ──

  test('abcdef: 6 hex chars but NO digit → hasLongHexLikeRun false', () => {
    expect(computeLexicalMetrics('abcdef').hasLongHexLikeRun).toBe(false);
  });

  test('abc123: 6 hex chars with digits → hasLongHexLikeRun true', () => {
    expect(computeLexicalMetrics('abc123').hasLongHexLikeRun).toBe(true);
  });

  test('deadbeef: 8 hex chars no digit → hasLongHexLikeRun false', () => {
    expect(computeLexicalMetrics('deadbeef').hasLongHexLikeRun).toBe(false);
  });

  test('deadbeef42: 10 hex chars with digits → hasLongHexLikeRun true', () => {
    expect(computeLexicalMetrics('deadbeef42').hasLongHexLikeRun).toBe(true);
  });

  test('run of exactly 5 hex+digit chars → false (below threshold)', () => {
    // 'abc12': a,b,c,1,2 → run=5 with digits, but 5 < 6
    expect(computeLexicalMetrics('abc12').hasLongHexLikeRun).toBe(false);
  });

  test('hex run broken by non-hex char resets correctly', () => {
    // 'abcx123456': abc(3 hex, no digit), x breaks, 123456(6 hex with digit) → true
    expect(computeLexicalMetrics('abcx123456').hasLongHexLikeRun).toBe(true);
  });

  // ── Letter/digit transitions (symbol-skip semantics) ──

  test('a-1: symbol does not reset last alpha type → 1 transition', () => {
    expect(computeLexicalMetrics('a-1').letterDigitTransitionCount).toBe(1);
  });

  test('a1b: two transitions (letter→digit, digit→letter)', () => {
    expect(computeLexicalMetrics('a1b').letterDigitTransitionCount).toBe(2);
  });

  test('abc: no digits → 0 transitions', () => {
    expect(computeLexicalMetrics('abc').letterDigitTransitionCount).toBe(0);
  });

  test('123: no letters → 0 transitions', () => {
    expect(computeLexicalMetrics('123').letterDigitTransitionCount).toBe(0);
  });

  test('a--1--b: multiple symbols between same types → counted correctly', () => {
    // a(letter) → --1(digit via symbol skip): 1 transition, 1(digit) → --b(letter): 2 transitions
    expect(computeLexicalMetrics('a--1--b').letterDigitTransitionCount).toBe(2);
  });

  // ── Rounding ──

  test('floating-point fields have at most 3 decimal places', () => {
    const m = computeLexicalMetrics('xfg8392a');
    const dp = n => (String(n).split('.')[1] ?? '').length;
    expect(dp(m.digitRatio)).toBeLessThanOrEqual(3);
    expect(dp(m.vowelRatioAlphaOnly)).toBeLessThanOrEqual(3);
  });

  // ── hyphenCount / hyphenRatio ──

  test('no hyphens → hyphenCount 0, hyphenRatio 0', () => {
    const m = computeLexicalMetrics('abc123');
    expect(m.hyphenCount).toBe(0);
    expect(m.hyphenRatio).toBe(0);
  });

  test('single hyphen counts correctly', () => {
    const m = computeLexicalMetrics('ai-maiko');
    expect(m.hyphenCount).toBe(1);
    expect(m.hyphenRatio).toBeCloseTo(1 / 8, 3);
  });

  test('multiple hyphens counted and ratio computed', () => {
    // 'a-b-c-d': 7 chars, 3 hyphens → ratio ≈ 0.429
    const m = computeLexicalMetrics('a-b-c-d');
    expect(m.hyphenCount).toBe(3);
    expect(m.hyphenRatio).toBeCloseTo(3 / 7, 3);
  });

  test('ai-maiko-me: 2 hyphens in 11 chars', () => {
    const m = computeLexicalMetrics('ai-maiko-me');
    expect(m.hyphenCount).toBe(2);
    expect(m.length).toBe(11);
    expect(m.hyphenRatio).toBeCloseTo(2 / 11, 3);
  });

  test('hyphenRatio rounds to at most 3 decimal places', () => {
    const m = computeLexicalMetrics('a-b-c-d');
    const dp = n => (String(n).split('.')[1] ?? '').length;
    expect(dp(m.hyphenRatio)).toBeLessThanOrEqual(3);
  });

  // ── Case normalisation ──

  test('uppercase input is normalised to lowercase before analysis', () => {
    const lower = computeLexicalMetrics('abc123');
    const upper = computeLexicalMetrics('ABC123');
    expect(upper.uniqueCharCount).toBe(lower.uniqueCharCount);
  });

  // ── Intentionally retained local behaviors ──

  test('vowelRatioAlphaOnly uses aeiouy: y counted as vowel', () => {
    // 'system' → s,y,s,t,e,m — y and e are vowels → 2/6
    const m = computeLexicalMetrics('system');
    expect(m.vowelCount).toBe(2); // y, e
    expect(m.vowelRatioAlphaOnly).toBeCloseTo(2 / 6, 3);
  });

  test('letterDigitTransitionCount symbol-skip differs from package letterDigitTransitions', () => {
    // 'a-1': symbol-skip semantics → 1 transition locally
    // package letterDigitTransitions: adjacent-only → 0 transitions
    const local = computeLexicalMetrics('a-1');
    const pkg   = computeLexicalHeuristics('a-1');
    expect(local.letterDigitTransitionCount).toBe(1);
    expect(pkg.letterDigitTransitions).toBe(0);
  });

});

// ─── computeLexicalHeuristics – parity with removed computeLexicalMetrics fields ───
//
// These tests confirm that mail-auth-signal's computeLexicalHeuristics produces
// equivalent results for the five fields removed from computeLexicalMetrics.
// They justify the migration of those fields to the package.

describe('computeLexicalHeuristics – parity with removed computeLexicalMetrics fields', () => {

  // ── maxConsonantRun ──

  test('maxConsonantRun: xfg8392a — x,f,g = 3 consonants before digit break', () => {
    expect(computeLexicalHeuristics('xfg8392a').maxConsonantRun).toBe(3);
  });

  test('maxConsonantRun: strength — ngth = 4 consonants', () => {
    expect(computeLexicalHeuristics('strength').maxConsonantRun).toBe(4);
  });

  test('maxConsonantRun: bc-df — non-letter breaks run → 2', () => {
    expect(computeLexicalHeuristics('bc-df').maxConsonantRun).toBe(2);
  });

  test('maxConsonantRun: all-vowel string → 0', () => {
    expect(computeLexicalHeuristics('aeiou').maxConsonantRun).toBe(0);
  });

  // ── maxRepeatedCharRun ──

  test('maxRepeatedCharRun: no repeated chars → 1', () => {
    expect(computeLexicalHeuristics('abcd').maxRepeatedCharRun).toBe(1);
  });

  test('maxRepeatedCharRun: aab → 2', () => {
    expect(computeLexicalHeuristics('aab').maxRepeatedCharRun).toBe(2);
  });

  test('maxRepeatedCharRun: aaab → 3', () => {
    expect(computeLexicalHeuristics('aaab').maxRepeatedCharRun).toBe(3);
  });

  // ── uniqueCharRatio ──

  test('uniqueCharRatio: abc — 3 unique / 3 chars = 1.0', () => {
    expect(computeLexicalHeuristics('abc').uniqueCharRatio).toBeCloseTo(1.0, 3);
  });

  test('uniqueCharRatio: aaa — 1 unique / 3 chars ≈ 0.333', () => {
    expect(computeLexicalHeuristics('aaa').uniqueCharRatio).toBeCloseTo(1 / 3, 3);
  });

  // ── shannonEntropy (was entropy in computeLexicalMetrics) ──

  test('shannonEntropy: abcd — 4 distinct chars → 2.0 bits', () => {
    expect(computeLexicalHeuristics('abcd').shannonEntropy).toBeCloseTo(2.0, 3);
  });

  test('shannonEntropy: aabb — H = 1.0 bit', () => {
    expect(computeLexicalHeuristics('aabb').shannonEntropy).toBeCloseTo(1.0, 3);
  });

  test('shannonEntropy: empty string → 0', () => {
    expect(computeLexicalHeuristics('').shannonEntropy).toBe(0);
  });

  // ── normalizedEntropy (length >= 6 agrees with local formula) ──

  test('normalizedEntropy: abcdef (length 6, all distinct) → 1.0', () => {
    expect(computeLexicalHeuristics('abcdef').normalizedEntropy).toBeCloseTo(1.0, 2);
  });

  test('normalizedEntropy: empty string → 0', () => {
    expect(computeLexicalHeuristics('').normalizedEntropy).toBe(0);
  });

  test('normalizedEntropy: single char → 0 (log2(1) = 0, handled as length <= 1)', () => {
    expect(computeLexicalHeuristics('a').normalizedEntropy).toBe(0);
  });

  // Note: for length 2-5 the package formula (entropy/log2(length)) differs from
  // the old local formula which applied a (length/6) ramp-down factor for
  // length < 6. This is an intentional semantic change at short lengths only.

});

// ─── Integration: computeHeuristicMetrics lexicalMetrics merges package + supplemental ─

import { computeHeuristicMetrics } from '../src/core/heuristics.js';

describe('computeHeuristicMetrics – lexicalMetrics integration', () => {
  test('fromLocalPart includes nested lexicalMetrics', () => {
    const m = computeHeuristicMetrics({ fromLocalPart: 'xfg8392a' });
    expect(m.fromLocalPart.lexicalMetrics).toBeDefined();
    expect(typeof m.fromLocalPart.lexicalMetrics).toBe('object');
  });

  test('each fromDomainLabels entry includes nested lexicalMetrics', () => {
    const m = computeHeuristicMetrics({ fromDomain: 'wlikqkgi.auth.ltazy.com' });
    for (const label of m.fromDomainLabels) {
      expect(label.lexicalMetrics).toBeDefined();
    }
  });

  test('existing fromLocalPart fields are unchanged', () => {
    const m = computeHeuristicMetrics({ fromLocalPart: 'ryiosz' });
    const lp = m.fromLocalPart;
    expect(lp.value).toBe('ryiosz');
    expect(lp.length).toBe(6);
    expect(lp.entropy).toBeCloseTo(2.585, 2);
    expect(lp.vowelRatio).toBeCloseTo(0.333, 2);
    expect(lp.maxConsonantRun).toBe(2);
  });

  test('existing fromDomainLabels fields are unchanged', () => {
    const m = computeHeuristicMetrics({ fromDomain: 'ddjxlt.com' });
    const ddjxlt = m.fromDomainLabels[0];
    expect(ddjxlt.label).toBe('ddjxlt');
    expect(ddjxlt.length).toBe(6);
    expect(ddjxlt.entropy).toBeCloseTo(2.252, 2);
    expect(ddjxlt.vowelRatio).toBe(0);
    expect(ddjxlt.maxConsonantRun).toBe(6);
  });

  test('lexicalMetrics in fromLocalPart reflects full local part (not letters-only)', () => {
    // 'ai-maiko-me' has hyphens; lexicalMetrics should see them
    const m = computeHeuristicMetrics({ fromLocalPart: 'ai-maiko-me' });
    // length is total char count (from supplemental)
    expect(m.fromLocalPart.lexicalMetrics.length).toBe(11);
    // but the top-level .length is letters-only (9)
    expect(m.fromLocalPart.length).toBe(9);
  });

  test('lexicalMetrics contains package fields (shannonEntropy, maxConsonantRun, etc.)', () => {
    const m = computeHeuristicMetrics({ fromLocalPart: 'xfg8392a' });
    const lm = m.fromLocalPart.lexicalMetrics;
    expect(lm).toHaveProperty('shannonEntropy');
    expect(lm).toHaveProperty('normalizedEntropy');
    expect(lm).toHaveProperty('maxConsonantRun');
    expect(lm).toHaveProperty('maxRepeatedCharRun');
    expect(lm).toHaveProperty('uniqueCharRatio');
    expect(lm).toHaveProperty('letterDigitTransitions');
    expect(lm).toHaveProperty('vowelRatio');
  });

  test('lexicalMetrics contains supplemental fields (digitRatio, hyphenCount, etc.)', () => {
    const m = computeHeuristicMetrics({ fromLocalPart: 'xfg8392a' });
    const lm = m.fromLocalPart.lexicalMetrics;
    expect(lm).toHaveProperty('digitRatio');
    expect(lm).toHaveProperty('hyphenCount');
    expect(lm).toHaveProperty('hyphenRatio');
    expect(lm).toHaveProperty('hasLongHexLikeRun');
    expect(lm).toHaveProperty('letterDigitTransitionCount');
    expect(lm).toHaveProperty('vowelRatioAlphaOnly');
    expect(lm).toHaveProperty('uniqueCharCount');
  });

  test('domain label lexicalMetrics also merges both sources', () => {
    const m = computeHeuristicMetrics({ fromDomain: 'wlikqkgi.auth.ltazy.com' });
    const lm = m.fromDomainLabels[0].lexicalMetrics; // wlikqkgi
    expect(lm).toHaveProperty('shannonEntropy');
    expect(lm).toHaveProperty('maxConsonantRun');
    expect(lm).toHaveProperty('hasLongHexLikeRun');
    expect(lm).toHaveProperty('hyphenCount');
  });
});
