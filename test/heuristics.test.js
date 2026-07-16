import {
  entropy,
  vowelRatio,
  maxConsonantRun,
  isRandomLookingLabel,
  isRandomLookingLocalPart,
  scoreLayer3,
  computeHeuristicMetrics,
  LAYER3_CAP,
} from '../src/core/heuristics.js';

// ─── entropy ─────────────────────────────────────────────────────────────────

describe('entropy', () => {
  test('returns 0 for empty string', () => {
    expect(entropy('')).toBe(0);
  });

  test('returns 0 for single-character string', () => {
    expect(entropy('a')).toBe(0);
  });

  test('returns log2(n) for string of n distinct characters', () => {
    // 'abcd' has 4 unique chars → H = log2(4) = 2
    expect(entropy('abcd')).toBeCloseTo(2.0);
  });

  test('returns log2(2) = 1 for two equal halves', () => {
    // 'aabb' → p(a)=0.5, p(b)=0.5 → H = 1
    expect(entropy('aabb')).toBeCloseTo(1.0);
  });

  test('returns positive value for typical random-looking string', () => {
    // 'wlikqkgi' (a spam domain label): entropy > 2
    expect(entropy('wlikqkgi')).toBeGreaterThan(2.0);
  });
});

// ─── vowelRatio ───────────────────────────────────────────────────────────────

describe('vowelRatio', () => {
  test('returns 0 for empty string', () => {
    expect(vowelRatio('')).toBe(0);
  });

  test('returns 0 for all-consonant string', () => {
    expect(vowelRatio('bcdfg')).toBe(0);
  });

  test('returns 1 for all-vowel string', () => {
    expect(vowelRatio('aeiou')).toBe(1);
  });

  test('computes correct ratio', () => {
    // 'hello' → e, o = 2 vowels / 5 chars = 0.4
    expect(vowelRatio('hello')).toBeCloseTo(0.4);
  });

  test('treats vowels case-insensitively when pre-lowercased', () => {
    expect(vowelRatio('aeiou')).toBeCloseTo(1.0);
  });
});

// ─── maxConsonantRun ──────────────────────────────────────────────────────────

describe('maxConsonantRun', () => {
  test('returns 0 for empty string', () => {
    expect(maxConsonantRun('')).toBe(0);
  });

  test('returns 0 for all-vowel string', () => {
    expect(maxConsonantRun('aeiou')).toBe(0);
  });

  test('returns correct run for simple case', () => {
    // 'strength' → str=3, ngth=4 → max=4
    expect(maxConsonantRun('strength')).toBe(4);
  });

  test('non-letter characters break consonant runs', () => {
    // 'bc-df' → bc=2, df=2
    expect(maxConsonantRun('bc-df')).toBe(2);
  });

  test('kqkg consonant run is 4', () => {
    // 'wlikqkgi': w-l=2 (break at i), k-q-k-g=4 (break at i) → max=4
    expect(maxConsonantRun('wlikqkgi')).toBe(4);
  });

  test('all-consonant string returns its length', () => {
    expect(maxConsonantRun('czfrcpvp')).toBe(8);
  });
});

// ─── isRandomLookingLabel ─────────────────────────────────────────────────────

describe('isRandomLookingLabel', () => {
  test('returns false for labels shorter than 6 characters', () => {
    expect(isRandomLookingLabel('pvp')).toBe(false);
    expect(isRandomLookingLabel('abc')).toBe(false);
  });

  test('returns false for low-entropy label', () => {
    // 'aaaaaa' → entropy = 0 < 2.3
    expect(isRandomLookingLabel('aaaaaa')).toBe(false);
  });

  test('returns false for normal domain labels', () => {
    expect(isRandomLookingLabel('example')).toBe(false);
    expect(isRandomLookingLabel('github')).toBe(false);
    expect(isRandomLookingLabel('google')).toBe(false);
  });

  test('returns true for all-consonant random label (wlikqkgi)', () => {
    expect(isRandomLookingLabel('wlikqkgi')).toBe(true);
  });

  test('returns true for oynfczlq (low vowel ratio)', () => {
    // o is the only vowel → ratio ~0.125
    expect(isRandomLookingLabel('oynfczlq')).toBe(true);
  });

  test('returns true for czfrcpvp (all consonants)', () => {
    expect(isRandomLookingLabel('czfrcpvp')).toBe(true);
  });

  test('returns true for lfldwlkj (all consonants)', () => {
    expect(isRandomLookingLabel('lfldwlkj')).toBe(true);
  });

  test('returns true for mpqxyt (all consonants, length 6)', () => {
    expect(isRandomLookingLabel('mpqxyt')).toBe(true);
  });

  test('returns true for ownqxg (very low vowel ratio)', () => {
    expect(isRandomLookingLabel('ownqxg')).toBe(true);
  });

  test('returns true for mpqxyt (all consonants, from spam example)', () => {
    // 'mpqxyt' — triggering label in 'stadbihn.admin.mpqxyt.com'
    expect(isRandomLookingLabel('mpqxyt')).toBe(true);
  });
});

// ─── isRandomLookingLocalPart ─────────────────────────────────────────────────

describe('isRandomLookingLocalPart', () => {
  test('returns false for empty string', () => {
    expect(isRandomLookingLocalPart('')).toBe(false);
  });

  test('returns false for short local parts', () => {
    expect(isRandomLookingLocalPart('info')).toBe(false);  // 4 letters
    expect(isRandomLookingLocalPart('ab')).toBe(false);
  });

  test('returns false for benign local part: info', () => {
    expect(isRandomLookingLocalPart('info')).toBe(false);
  });

  test('returns false for benign local part: support', () => {
    expect(isRandomLookingLocalPart('support')).toBe(false);
  });

  test('returns false for benign local part: newsletter', () => {
    expect(isRandomLookingLocalPart('newsletter')).toBe(false);
  });

  test('returns false for name-like local part: jinji-shinsa', () => {
    expect(isRandomLookingLocalPart('jinji-shinsa')).toBe(false);
  });

  test('returns false for name-like local part: ai-maiko-me', () => {
    expect(isRandomLookingLocalPart('ai-maiko-me')).toBe(false);
  });

  test('returns true for all-uppercase random: CAQLEV', () => {
    expect(isRandomLookingLocalPart('CAQLEV')).toBe(true);
  });

  test('returns true for all-uppercase random: QKFUGT', () => {
    expect(isRandomLookingLocalPart('QKFUGT')).toBe(true);
  });

  test('returns true for all-uppercase random: WQIZXZ', () => {
    expect(isRandomLookingLocalPart('WQIZXZ')).toBe(true);
  });

  test('returns true for uumcwt (high consonant run)', () => {
    // u-u-m-c-w-t → mcwt = 4
    expect(isRandomLookingLocalPart('uumcwt')).toBe(true);
  });
});

// ─── scoreLayer3 ─────────────────────────────────────────────────────────────

describe('scoreLayer3', () => {
  test('returns zero score for empty input', () => {
    const { score, scoreReasons } = scoreLayer3({});
    expect(score).toBe(0);
    expect(scoreReasons).toHaveLength(0);
  });

  test('returns zero score for benign sender: info@example.com', () => {
    const { score } = scoreLayer3({ fromDomain: 'example.com', fromLocalPart: 'info' });
    expect(score).toBe(0);
  });

  test('returns zero score for benign sender: support@example.co.jp', () => {
    const { score } = scoreLayer3({ fromDomain: 'example.co.jp', fromLocalPart: 'support' });
    expect(score).toBe(0);
  });

  test('returns zero score for benign sender: newsletter@github.com', () => {
    const { score } = scoreLayer3({ fromDomain: 'github.com', fromLocalPart: 'newsletter' });
    expect(score).toBe(0);
  });

  test('returns zero score for benign sender: jinji-shinsa@pvp.jp', () => {
    const { score } = scoreLayer3({ fromDomain: 'pvp.jp', fromLocalPart: 'jinji-shinsa' });
    expect(score).toBe(0);
  });

  // ── Spam samples ──

  test('uumcwt@wlikqkgi.auth.ltazy.com scores domain + local part', () => {
    const { score, scoreReasons } = scoreLayer3({
      fromDomain: 'wlikqkgi.auth.ltazy.com',
      fromLocalPart: 'uumcwt',
    });
    expect(score).toBe(20);
    expect(scoreReasons.some(r => r.key === 'heuristic.randomFromDomainLabel')).toBe(true);
    expect(scoreReasons.some(r => r.key === 'heuristic.randomFromLocalPart')).toBe(true);
  });

  test('CAQLEV@oynfczlq.my.shjiushihg.com scores domain + local part', () => {
    const { score, scoreReasons } = scoreLayer3({
      fromDomain: 'oynfczlq.my.shjiushihg.com',
      fromLocalPart: 'CAQLEV',
    });
    expect(score).toBe(20);
    expect(scoreReasons).toHaveLength(2);
  });

  test('QKFUGT@czfrcpvp.shipping.glrsx.com scores domain + local part', () => {
    const { score } = scoreLayer3({
      fromDomain: 'czfrcpvp.shipping.glrsx.com',
      fromLocalPart: 'QKFUGT',
    });
    expect(score).toBe(20);
  });

  test('info@lfldwlkj.com scores domain only', () => {
    const { score, scoreReasons } = scoreLayer3({
      fromDomain: 'lfldwlkj.com',
      fromLocalPart: 'info',
    });
    expect(score).toBe(15);
    expect(scoreReasons).toHaveLength(1);
    expect(scoreReasons[0].key).toBe('heuristic.randomFromDomainLabel');
    expect(scoreReasons[0].matchedLabel).toBe('lfldwlkj');
  });

  test('ai-maiko-me@ownqxg.cn scores domain only', () => {
    const { score, scoreReasons } = scoreLayer3({
      fromDomain: 'ownqxg.cn',
      fromLocalPart: 'ai-maiko-me',
    });
    expect(score).toBe(15);
    expect(scoreReasons[0].key).toBe('heuristic.randomFromDomainLabel');
  });

  test('WQIZXZ@stadbihn.admin.mpqxyt.com scores domain + local part', () => {
    const { score } = scoreLayer3({
      fromDomain: 'stadbihn.admin.mpqxyt.com',
      fromLocalPart: 'WQIZXZ',
    });
    expect(score).toBe(20);
  });

  // ── Domain label context fields ──

  test('domain reason includes domain and matchedLabel fields', () => {
    const { scoreReasons } = scoreLayer3({
      fromDomain: 'wlikqkgi.auth.ltazy.com',
      fromLocalPart: '',
    });
    const reason = scoreReasons[0];
    expect(reason.domain).toBe('wlikqkgi.auth.ltazy.com');
    expect(reason.matchedLabel).toBe('wlikqkgi');
  });

  test('only first matching domain label is reported', () => {
    // Both 'czfrcpvp' and potentially other labels might match; only one reason.
    const { scoreReasons } = scoreLayer3({
      fromDomain: 'czfrcpvp.shipping.glrsx.com',
      fromLocalPart: '',
    });
    const domainReasons = scoreReasons.filter(r => r.key === 'heuristic.randomFromDomainLabel');
    expect(domainReasons).toHaveLength(1);
  });

  // ── Layer 3 cap ──

  test('LAYER3_CAP is 25', () => {
    expect(LAYER3_CAP).toBe(25);
  });

  test('score does not exceed LAYER3_CAP', () => {
    // With current scoring (domain + local = 20) the cap is not reached by default,
    // but the implementation must not exceed it when custom scores push past the cap.
    const { score } = scoreLayer3({
      fromDomain: 'wlikqkgi.auth.ltazy.com',
      fromLocalPart: 'uumcwt',
    });
    expect(score).toBeLessThanOrEqual(LAYER3_CAP);
  });

  // ── Configurable heuristic scores ──

  test('uses custom randomFromDomainLabel score', () => {
    const { score, scoreReasons } = scoreLayer3({
      fromDomain: 'wlikqkgi.auth.ltazy.com',
      fromLocalPart: '',
      heuristicScores: { randomFromDomainLabel: 5, randomFromLocalPart: 10, layer3Cap: 40 },
    });
    expect(score).toBe(5);
    expect(scoreReasons[0].delta).toBe(5);
  });

  test('uses custom randomFromLocalPart score', () => {
    const { score, scoreReasons } = scoreLayer3({
      fromDomain: 'example.com',
      fromLocalPart: 'CAQLEV',
      heuristicScores: { randomFromDomainLabel: 20, randomFromLocalPart: 3, layer3Cap: 40 },
    });
    expect(score).toBe(3);
    expect(scoreReasons[0].delta).toBe(3);
  });

  test('respects custom layer3Cap', () => {
    // domain(20) + local(10) = 30; cap=15 → score capped at 15
    const { score } = scoreLayer3({
      fromDomain: 'wlikqkgi.auth.ltazy.com',
      fromLocalPart: 'uumcwt',
      heuristicScores: { randomFromDomainLabel: 20, randomFromLocalPart: 10, layer3Cap: 15 },
    });
    expect(score).toBe(15);
  });

  test('falls back to defaults when heuristicScores is undefined', () => {
    const { score } = scoreLayer3({
      fromDomain: 'wlikqkgi.auth.ltazy.com',
      fromLocalPart: 'uumcwt',
      heuristicScores: undefined,
    });
    expect(score).toBe(20); // 15 + 5
  });

  test('falls back to default for missing keys in partial heuristicScores', () => {
    // Only override one key; others should use DEFAULT_HEURISTIC_SCORES
    const { score } = scoreLayer3({
      fromDomain: 'wlikqkgi.auth.ltazy.com',
      fromLocalPart: '',
      heuristicScores: { randomFromDomainLabel: 7 },
    });
    expect(score).toBe(7);
  });
});

// ─── computeHeuristicMetrics ──────────────────────────────────────────────────

describe('computeHeuristicMetrics', () => {
  test('returns empty metrics for empty input', () => {
    const m = computeHeuristicMetrics({});
    expect(m.fromDomain).toBeNull();
    expect(m.fromLocalPart).toBeNull();
    expect(m.fromDomainLabels).toEqual([]);
  });

  test('returns null fromLocalPart when fromLocalPart is empty string', () => {
    const { fromLocalPart } = computeHeuristicMetrics({ fromDomain: 'example.com', fromLocalPart: '' });
    expect(fromLocalPart).toBeNull();
  });

  test('fromLocalPart contains value, length, entropy, vowelRatio, maxConsonantRun', () => {
    const { fromLocalPart } = computeHeuristicMetrics({ fromLocalPart: 'ryiosz' });
    expect(fromLocalPart.value).toBe('ryiosz');
    expect(fromLocalPart.length).toBe(6);        // 6 letters
    expect(fromLocalPart.entropy).toBeCloseTo(2.585, 2);
    expect(fromLocalPart.vowelRatio).toBeCloseTo(0.333, 2);
    expect(fromLocalPart.maxConsonantRun).toBe(2); // sz
  });

  test('fromLocalPart.length counts letters only (strips non-letters)', () => {
    // 'ai-maiko-me' → letters = 'aimaikome' (9 letters; hyphens stripped)
    const { fromLocalPart } = computeHeuristicMetrics({ fromLocalPart: 'ai-maiko-me' });
    expect(fromLocalPart.value).toBe('ai-maiko-me');
    expect(fromLocalPart.length).toBe(9);
  });

  test('fromDomainLabels has one entry per dot-separated label', () => {
    const { fromDomainLabels } = computeHeuristicMetrics({ fromDomain: 'wlikqkgi.auth.ltazy.com' });
    expect(fromDomainLabels).toHaveLength(4);
    expect(fromDomainLabels[0].label).toBe('wlikqkgi');
    expect(fromDomainLabels[1].label).toBe('auth');
    expect(fromDomainLabels[2].label).toBe('ltazy');
    expect(fromDomainLabels[3].label).toBe('com');
  });

  test('each domain label entry contains length, entropy, vowelRatio, maxConsonantRun', () => {
    const { fromDomainLabels } = computeHeuristicMetrics({ fromDomain: 'ddjxlt.com' });
    const ddjxlt = fromDomainLabels[0];
    expect(ddjxlt.label).toBe('ddjxlt');
    expect(ddjxlt.length).toBe(6);
    expect(ddjxlt.entropy).toBeCloseTo(2.252, 2);
    expect(ddjxlt.vowelRatio).toBe(0);
    expect(ddjxlt.maxConsonantRun).toBe(6); // all consonants
  });

  test('short labels (< 6) are still included in fromDomainLabels', () => {
    // Issue #10: metrics record all labels for data collection; no filtering by length
    const { fromDomainLabels } = computeHeuristicMetrics({ fromDomain: 'sub.example.com' });
    const labels = fromDomainLabels.map(l => l.label);
    expect(labels).toContain('sub');
    expect(labels).toContain('com');
  });

  test('metrics are recorded even when Layer 3 score is 0', () => {
    // 'info@example.com': neither domain nor local-part triggers heuristics
    const m = computeHeuristicMetrics({ fromDomain: 'example.com', fromLocalPart: 'info' });
    // fromLocalPart is still computed
    expect(m.fromLocalPart).not.toBeNull();
    expect(m.fromLocalPart.value).toBe('info');
    // fromDomainLabels still lists all labels
    expect(m.fromDomainLabels.length).toBeGreaterThan(0);
  });

  test('numeric fields are rounded to at most 3 decimal places', () => {
    const { fromLocalPart } = computeHeuristicMetrics({ fromLocalPart: 'ryiosz' });
    // 2.585 rounds to exactly 3 dp; verify no more than 3 dp
    const dp = n => (String(n).split('.')[1] ?? '').length;
    expect(dp(fromLocalPart.entropy)).toBeLessThanOrEqual(3);
    expect(dp(fromLocalPart.vowelRatio)).toBeLessThanOrEqual(3);
  });

  test('full example from Issue #10: ryiosz@qsiysuud.notice.ddjxlt.com', () => {
    const m = computeHeuristicMetrics({
      fromDomain: 'qsiysuud.notice.ddjxlt.com',
      fromLocalPart: 'ryiosz',
    });
    expect(m.fromLocalPart.value).toBe('ryiosz');
    expect(m.fromLocalPart.length).toBe(6);

    const labels = m.fromDomainLabels.map(l => l.label);
    expect(labels).toEqual(['qsiysuud', 'notice', 'ddjxlt', 'com']);

    const ddjxlt = m.fromDomainLabels.find(l => l.label === 'ddjxlt');
    expect(ddjxlt.vowelRatio).toBe(0);
    expect(ddjxlt.maxConsonantRun).toBe(6);
  });

  // ── fromDomain (Issue #16) ────────────────────────────────────────────────

  test('fromDomain is null when fromDomain is empty', () => {
    const m = computeHeuristicMetrics({ fromLocalPart: 'info' });
    expect(m.fromDomain).toBeNull();
  });

  test('fromDomain contains value and domainParts', () => {
    const m = computeHeuristicMetrics({ fromDomain: 'example.com' });
    expect(m.fromDomain).not.toBeNull();
    expect(m.fromDomain.value).toBe('example.com');
    expect(m.fromDomain.domainParts).toBeDefined();
  });

  test('fromDomain.domainParts has all expected keys', () => {
    const { domainParts } = computeHeuristicMetrics({ fromDomain: 'example.com' }).fromDomain;
    expect(domainParts).toHaveProperty('registrableDomain');
    expect(domainParts).toHaveProperty('publicSuffix');
    expect(domainParts).toHaveProperty('subdomain');
    expect(domainParts).toHaveProperty('subdomainDepth');
    expect(domainParts).toHaveProperty('isIcann');
    expect(domainParts).toHaveProperty('isPrivate');
  });

  test('example.com: subdomainDepth 0, registrableDomain example.com', () => {
    const { domainParts } = computeHeuristicMetrics({ fromDomain: 'example.com' }).fromDomain;
    expect(domainParts.registrableDomain).toBe('example.com');
    expect(domainParts.publicSuffix).toBe('com');
    expect(domainParts.subdomain).toBeNull();
    expect(domainParts.subdomainDepth).toBe(0);
    expect(domainParts.isIcann).toBe(true);
    expect(domainParts.isPrivate).toBe(false);
  });

  test('qsiysuud.notice.ddjxlt.com: registrableDomain ddjxlt.com, subdomainDepth 2', () => {
    const { domainParts } = computeHeuristicMetrics({ fromDomain: 'qsiysuud.notice.ddjxlt.com' }).fromDomain;
    expect(domainParts.registrableDomain).toBe('ddjxlt.com');
    expect(domainParts.publicSuffix).toBe('com');
    expect(domainParts.subdomain).toBe('qsiysuud.notice');
    expect(domainParts.subdomainDepth).toBe(2);
  });

  test('fromDomainLabels are unchanged alongside new fromDomain field', () => {
    const m = computeHeuristicMetrics({ fromDomain: 'qsiysuud.notice.ddjxlt.com' });
    // Existing per-label data is still present and correct
    expect(m.fromDomainLabels.map(l => l.label)).toEqual(['qsiysuud', 'notice', 'ddjxlt', 'com']);
    // New fromDomain is also present
    expect(m.fromDomain.domainParts.registrableDomain).toBe('ddjxlt.com');
  });

  test('empty fromDomain does not throw and fromDomain is null', () => {
    expect(() => computeHeuristicMetrics({ fromDomain: '' })).not.toThrow();
    expect(computeHeuristicMetrics({ fromDomain: '' }).fromDomain).toBeNull();
  });

  // ── Log-only boolean flags (Issue #116) ──────────────────────────────────

  test('fromLocalPart contains highDigitRatio, highLetterDigitTransitions, hyphenHeavy', () => {
    const { fromLocalPart } = computeHeuristicMetrics({ fromLocalPart: 'info' });
    expect(fromLocalPart).toHaveProperty('highDigitRatio');
    expect(fromLocalPart).toHaveProperty('highLetterDigitTransitions');
    expect(fromLocalPart).toHaveProperty('hyphenHeavy');
  });

  test('benign short local parts do not trigger digit flags: info (length 4)', () => {
    const { fromLocalPart } = computeHeuristicMetrics({ fromLocalPart: 'info' });
    expect(fromLocalPart.highDigitRatio).toBe(false);
    expect(fromLocalPart.highLetterDigitTransitions).toBe(false);
  });

  test('benign local part admin (length 5) does not trigger digit flags', () => {
    const { fromLocalPart } = computeHeuristicMetrics({ fromLocalPart: 'admin' });
    expect(fromLocalPart.highDigitRatio).toBe(false);
    expect(fromLocalPart.highLetterDigitTransitions).toBe(false);
  });

  test('benign local part noreply (length 7, 0 digits) does not trigger highDigitRatio', () => {
    const { fromLocalPart } = computeHeuristicMetrics({ fromLocalPart: 'noreply' });
    expect(fromLocalPart.highDigitRatio).toBe(false);
  });

  test('highDigitRatio true when digitRatio >= 0.3 and length >= 6', () => {
    // 'abc123': 6 chars, 3 digits → digitRatio = 0.5
    const { fromLocalPart } = computeHeuristicMetrics({ fromLocalPart: 'abc123' });
    expect(fromLocalPart.highDigitRatio).toBe(true);
  });

  test('highDigitRatio false when digitRatio < 0.3', () => {
    // 'support1': 8 chars, 1 digit → digitRatio = 0.125
    const { fromLocalPart } = computeHeuristicMetrics({ fromLocalPart: 'support1' });
    expect(fromLocalPart.highDigitRatio).toBe(false);
  });

  test('highLetterDigitTransitions true for alternating letter/digit pattern', () => {
    // 'a1b2c3d': 7 chars, 6 transitions
    const { fromLocalPart } = computeHeuristicMetrics({ fromLocalPart: 'a1b2c3d' });
    expect(fromLocalPart.highLetterDigitTransitions).toBe(true);
  });

  test('highLetterDigitTransitions false for block-style digit suffix', () => {
    // 'abc1234': 7 chars, 1 transition only (abc → 1)
    const { fromLocalPart } = computeHeuristicMetrics({ fromLocalPart: 'abc1234' });
    expect(fromLocalPart.highLetterDigitTransitions).toBe(false);
  });

  test('hyphenHeavy true when hyphenCount >= 2 and hyphenRatio >= 0.25', () => {
    // 'a-b-c-d': 7 chars, 3 hyphens → ratio ≈ 0.43
    const { fromLocalPart } = computeHeuristicMetrics({ fromLocalPart: 'a-b-c-d' });
    expect(fromLocalPart.hyphenHeavy).toBe(true);
  });

  test('hyphenHeavy false for ai-maiko-me (2 hyphens, ratio ~0.18)', () => {
    // 'ai-maiko-me': 11 chars, 2 hyphens → ratio ≈ 0.18 < 0.25
    const { fromLocalPart } = computeHeuristicMetrics({ fromLocalPart: 'ai-maiko-me' });
    expect(fromLocalPart.hyphenHeavy).toBe(false);
  });

  test('hyphenHeavy false for single-hyphen local part', () => {
    const { fromLocalPart } = computeHeuristicMetrics({ fromLocalPart: 'jinji-shinsa' });
    expect(fromLocalPart.hyphenHeavy).toBe(false);
  });

  test('fromDomainLabels entries contain hyphenHeavyLabel', () => {
    const { fromDomainLabels } = computeHeuristicMetrics({ fromDomain: 'example.com' });
    for (const entry of fromDomainLabels) {
      expect(entry).toHaveProperty('hyphenHeavyLabel');
    }
  });

  test('hyphenHeavyLabel false for labels with no hyphens', () => {
    const { fromDomainLabels } = computeHeuristicMetrics({ fromDomain: 'wlikqkgi.auth.com' });
    for (const entry of fromDomainLabels) {
      expect(entry.hyphenHeavyLabel).toBe(false);
    }
  });

  test('hyphenHeavyLabel true for label with 2+ hyphens and length >= 6', () => {
    // 'my-mail-srv.example.com' → 'my-mail-srv' has 2 hyphens and length 11
    const { fromDomainLabels } = computeHeuristicMetrics({ fromDomain: 'my-mail-srv.example.com' });
    const label = fromDomainLabels.find(e => e.label === 'my-mail-srv');
    expect(label.hyphenHeavyLabel).toBe(true);
  });

  test('hyphenHeavyLabel false for single-hyphen label', () => {
    // 'my-company.example.com' → 'my-company' has 1 hyphen
    const { fromDomainLabels } = computeHeuristicMetrics({ fromDomain: 'my-company.example.com' });
    const label = fromDomainLabels.find(e => e.label === 'my-company');
    expect(label.hyphenHeavyLabel).toBe(false);
  });

  test('hyphenHeavyLabel false for short label even with 2 hyphens', () => {
    // A label shorter than 6 chars with 2 hyphens is edge-case; guard by length
    // 'a-b-c': 5 chars, 2 hyphens → length < 6, not flagged
    const { fromDomainLabels } = computeHeuristicMetrics({ fromDomain: 'a-b-c.example.com' });
    const label = fromDomainLabels.find(e => e.label === 'a-b-c');
    expect(label.hyphenHeavyLabel).toBe(false);
  });

  // ── Multi-part suffix and subdomain depth (Issue #54) ────────────────────

  test('example.co.jp: multi-part suffix, subdomainDepth 0, registrableDomain example.co.jp', () => {
    const { domainParts } = computeHeuristicMetrics({ fromDomain: 'example.co.jp' }).fromDomain;
    expect(domainParts.registrableDomain).toBe('example.co.jp');
    expect(domainParts.publicSuffix).toBe('co.jp');
    expect(domainParts.subdomain).toBeNull();
    expect(domainParts.subdomainDepth).toBe(0);
  });

  test('mail.example.co.jp: multi-part suffix with subdomain, subdomainDepth 1', () => {
    const { domainParts } = computeHeuristicMetrics({ fromDomain: 'mail.example.co.jp' }).fromDomain;
    expect(domainParts.registrableDomain).toBe('example.co.jp');
    expect(domainParts.publicSuffix).toBe('co.jp');
    expect(domainParts.subdomain).toBe('mail');
    expect(domainParts.subdomainDepth).toBe(1);
  });
});
