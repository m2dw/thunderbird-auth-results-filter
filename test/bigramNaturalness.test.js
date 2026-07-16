import {
  computeBigramMetrics,
  BIGRAM_MIN_ALPHA_LENGTH,
} from '../src/core/bigramNaturalness.js';

// ─── BIGRAM_MIN_ALPHA_LENGTH ─────────────────────────────────────────────────

describe('BIGRAM_MIN_ALPHA_LENGTH', () => {
  test('is 4', () => {
    expect(BIGRAM_MIN_ALPHA_LENGTH).toBe(4);
  });
});

// ─── computeBigramMetrics — null guards ──────────────────────────────────────

describe('computeBigramMetrics — null guards', () => {
  test('returns null for empty string', () => {
    expect(computeBigramMetrics('')).toBeNull();
  });

  test('returns null for null/undefined', () => {
    expect(computeBigramMetrics(null)).toBeNull();
    expect(computeBigramMetrics(undefined)).toBeNull();
  });

  test('returns null for labels with fewer than 4 alpha characters', () => {
    expect(computeBigramMetrics('abc')).toBeNull();   // 3 alpha chars
    expect(computeBigramMetrics('ab')).toBeNull();
    expect(computeBigramMetrics('a')).toBeNull();
  });

  test('returns null for short TLD labels like "com", "net", "org"', () => {
    expect(computeBigramMetrics('com')).toBeNull();
    expect(computeBigramMetrics('net')).toBeNull();
    expect(computeBigramMetrics('org')).toBeNull();
  });

  test('returns null when alpha chars after stripping are fewer than 4', () => {
    // 'a-b-c' → alpha = 'abc' (3 chars) → null
    expect(computeBigramMetrics('a-b-c')).toBeNull();
  });

  test('returns result for label with exactly 4 alpha characters', () => {
    // 'abcd' → 4 alpha chars → valid, 3 bigrams
    const result = computeBigramMetrics('abcd');
    expect(result).not.toBeNull();
    expect(result.bigramCount).toBe(3);
  });
});

// ─── computeBigramMetrics — output shape ────────────────────────────────────

describe('computeBigramMetrics — output shape', () => {
  test('returns { avgNegLogProb, bigramCount }', () => {
    const result = computeBigramMetrics('example');
    expect(result).toHaveProperty('avgNegLogProb');
    expect(result).toHaveProperty('bigramCount');
  });

  test('bigramCount equals alpha length minus 1', () => {
    // 'front' → 5 alpha chars → 4 bigrams
    const result = computeBigramMetrics('front');
    expect(result.bigramCount).toBe(4);
  });

  test('avgNegLogProb is a positive number', () => {
    const result = computeBigramMetrics('front');
    expect(result.avgNegLogProb).toBeGreaterThan(0);
  });

  test('avgNegLogProb is rounded to at most 3 decimal places', () => {
    const result = computeBigramMetrics('example');
    const dp = n => (String(n).split('.')[1] ?? '').length;
    expect(dp(result.avgNegLogProb)).toBeLessThanOrEqual(3);
  });

  test('strips non-alpha characters before analysis', () => {
    // 'front' and 'fr-ont' should give the same result
    const a = computeBigramMetrics('front');
    const b = computeBigramMetrics('fr-ont');
    expect(a.avgNegLogProb).toBe(b.avgNegLogProb);
    expect(a.bigramCount).toBe(b.bigramCount);
  });

  test('is case-insensitive', () => {
    const lower = computeBigramMetrics('front');
    const upper = computeBigramMetrics('FRONT');
    expect(lower.avgNegLogProb).toBe(upper.avgNegLogProb);
  });
});

// ─── computeBigramMetrics — naturalness ordering ────────────────────────────
//
// Random DGA labels should have higher avgNegLogProb (less natural) than
// word-like labels. Values here are checked against known-good ranges derived
// from the static bigram table; exact values may shift if the table changes.

describe('computeBigramMetrics — naturalness ordering', () => {
  // ── Word-like labels (natural) ──

  test('"front" has low avgNegLogProb (natural label)', () => {
    const result = computeBigramMetrics('front');
    expect(result.avgNegLogProb).toBeLessThan(3.5);
  });

  test('"github" has moderate-low avgNegLogProb (natural brand label)', () => {
    const result = computeBigramMetrics('github');
    expect(result.avgNegLogProb).toBeLessThan(4.5);
  });

  test('"example" has moderate-low avgNegLogProb', () => {
    const result = computeBigramMetrics('example');
    expect(result.avgNegLogProb).toBeLessThan(4.5);
  });

  // ── Random DGA labels (unnatural) ──

  test('"qsiysuud" has high avgNegLogProb (random label)', () => {
    const result = computeBigramMetrics('qsiysuud');
    expect(result.avgNegLogProb).toBeGreaterThan(4.5);
  });

  test('"ddjxlt" has high avgNegLogProb (random label)', () => {
    const result = computeBigramMetrics('ddjxlt');
    expect(result.avgNegLogProb).toBeGreaterThan(5.0);
  });

  test('"rwnuvdic" has high avgNegLogProb (random label)', () => {
    const result = computeBigramMetrics('rwnuvdic');
    expect(result.avgNegLogProb).toBeGreaterThan(4.5);
  });

  test('"wlikqkgi" has high avgNegLogProb (random label)', () => {
    const result = computeBigramMetrics('wlikqkgi');
    expect(result.avgNegLogProb).toBeGreaterThan(4.5);
  });

  // ── Ordering checks ──

  test('random labels rank higher than "front"', () => {
    const front = computeBigramMetrics('front').avgNegLogProb;
    expect(computeBigramMetrics('qsiysuud').avgNegLogProb).toBeGreaterThan(front);
    expect(computeBigramMetrics('ddjxlt').avgNegLogProb).toBeGreaterThan(front);
    expect(computeBigramMetrics('rwnuvdic').avgNegLogProb).toBeGreaterThan(front);
  });

  test('random labels rank higher than "example"', () => {
    const example = computeBigramMetrics('example').avgNegLogProb;
    expect(computeBigramMetrics('qsiysuud').avgNegLogProb).toBeGreaterThan(example);
    expect(computeBigramMetrics('rwnuvdic').avgNegLogProb).toBeGreaterThan(example);
  });
});

// ─── computeBigramMetrics — false-positive regression checks ────────────────
//
// "switchbot" and "front" may trigger Layer 3 entropy/consonant-run heuristics
// yet represent legitimate brand labels. The bigram metric should score them
// lower than the random labels they could be confused with, providing signal
// for future false-positive mitigation. These are log-only checks — no scoring
// change is made in this issue.

describe('computeBigramMetrics — switchbot / front regression', () => {
  test('"switchbot" avgNegLogProb is lower than "qsiysuud"', () => {
    const switchbot = computeBigramMetrics('switchbot').avgNegLogProb;
    const qsiysuud  = computeBigramMetrics('qsiysuud').avgNegLogProb;
    expect(switchbot).toBeLessThan(qsiysuud);
  });

  test('"switchbot" avgNegLogProb is lower than "rwnuvdic"', () => {
    const switchbot = computeBigramMetrics('switchbot').avgNegLogProb;
    const rwnuvdic  = computeBigramMetrics('rwnuvdic').avgNegLogProb;
    expect(switchbot).toBeLessThan(rwnuvdic);
  });

  test('"front" avgNegLogProb is lower than "switchbot"', () => {
    const front     = computeBigramMetrics('front').avgNegLogProb;
    const switchbot = computeBigramMetrics('switchbot').avgNegLogProb;
    expect(front).toBeLessThan(switchbot);
  });

  test('"front" has lower avgNegLogProb than all tested random labels', () => {
    const front = computeBigramMetrics('front').avgNegLogProb;
    for (const label of ['qsiysuud', 'ddjxlt', 'rwnuvdic', 'wlikqkgi']) {
      expect(front).toBeLessThan(computeBigramMetrics(label).avgNegLogProb);
    }
  });
});

// ─── computeHeuristicMetrics integration ────────────────────────────────────

import { computeHeuristicMetrics } from '../src/core/heuristics.js';

describe('computeHeuristicMetrics — bigramMetrics in fromDomainLabels', () => {
  test('each fromDomainLabels entry has a bigramMetrics property', () => {
    const { fromDomainLabels } = computeHeuristicMetrics({ fromDomain: 'example.com' });
    for (const entry of fromDomainLabels) {
      expect(entry).toHaveProperty('bigramMetrics');
    }
  });

  test('short labels (< 4 alpha chars) have bigramMetrics: null', () => {
    // 'com' → 3 alpha chars → null
    const { fromDomainLabels } = computeHeuristicMetrics({ fromDomain: 'example.com' });
    const com = fromDomainLabels.find(e => e.label === 'com');
    expect(com.bigramMetrics).toBeNull();
  });

  test('long labels have bigramMetrics with avgNegLogProb', () => {
    const { fromDomainLabels } = computeHeuristicMetrics({ fromDomain: 'example.com' });
    const example = fromDomainLabels.find(e => e.label === 'example');
    expect(example.bigramMetrics).not.toBeNull();
    expect(example.bigramMetrics).toHaveProperty('avgNegLogProb');
    expect(example.bigramMetrics).toHaveProperty('bigramCount');
  });

  test('random label "qsiysuud" has higher avgNegLogProb than "example" in domain labels', () => {
    const { fromDomainLabels: rLabels } = computeHeuristicMetrics({
      fromDomain: 'qsiysuud.notice.ddjxlt.com',
    });
    const { fromDomainLabels: nLabels } = computeHeuristicMetrics({
      fromDomain: 'example.com',
    });
    const qsiysuud = rLabels.find(e => e.label === 'qsiysuud');
    const example  = nLabels.find(e => e.label === 'example');
    expect(qsiysuud.bigramMetrics.avgNegLogProb).toBeGreaterThan(
      example.bigramMetrics.avgNegLogProb,
    );
  });

  test('bigramMetrics is present on all domain labels (wlikqkgi.auth.ltazy.com)', () => {
    const { fromDomainLabels } = computeHeuristicMetrics({ fromDomain: 'wlikqkgi.auth.ltazy.com' });
    // 'wlikqkgi' has 8 alpha chars — should produce bigramMetrics
    expect(fromDomainLabels[0].bigramMetrics).not.toBeNull();
    // Short labels like 'com' produce null
    const com = fromDomainLabels.find(e => e.label === 'com');
    expect(com.bigramMetrics).toBeNull();
  });
});
