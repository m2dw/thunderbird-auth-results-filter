import { computeJaro, computeJaroWinkler } from '../src/vendor/mail-auth-signal.esm.js';

// ─── computeJaro ─────────────────────────────────────────────────────────────

describe('computeJaro', () => {
  test('identical strings → 1.0', () => {
    expect(computeJaro('abc', 'abc')).toBe(1);
  });

  test('empty strings → 1.0 (vacuously identical)', () => {
    expect(computeJaro('', '')).toBe(1);
  });

  test('one empty string → 0.0', () => {
    expect(computeJaro('abc', '')).toBe(0);
    expect(computeJaro('', 'abc')).toBe(0);
  });

  test('completely different strings → 0.0', () => {
    // No characters match within any window
    expect(computeJaro('abc', 'xyz')).toBe(0);
  });

  test('MARTHA vs MARHTA (classic transposition example) ≈ 0.944', () => {
    // Classic Jaro example from the literature
    const sim = computeJaro('MARTHA', 'MARHTA');
    expect(sim).toBeCloseTo(0.944, 2);
  });

  test('DWAYNE vs DUANE ≈ 0.822', () => {
    const sim = computeJaro('DWAYNE', 'DUANE');
    expect(sim).toBeCloseTo(0.822, 2);
  });

  test('DIXON vs DICKSONX ≈ 0.767', () => {
    const sim = computeJaro('DIXON', 'DICKSONX');
    expect(sim).toBeCloseTo(0.767, 2);
  });

  test('american vs americanexpress (prefix match)', () => {
    const sim = computeJaro('american', 'americanexpress');
    expect(sim).toBeGreaterThan(0.8);
  });
});

// ─── computeJaroWinkler ──────────────────────────────────────────────────────

describe('computeJaroWinkler', () => {
  test('identical strings → 1.0', () => {
    expect(computeJaroWinkler('americanexpress', 'americanexpress')).toBe(1);
  });

  test('empty strings → 1.0', () => {
    expect(computeJaroWinkler('', '')).toBe(1);
  });

  test('one empty string → 0.0', () => {
    expect(computeJaroWinkler('paypal', '')).toBe(0);
  });

  test('MARTHA vs MARHTA: JW higher than Jaro due to common prefix', () => {
    const jaro = computeJaro('MARTHA', 'MARHTA');
    const jw = computeJaroWinkler('MARTHA', 'MARHTA');
    expect(jw).toBeGreaterThan(jaro);
  });

  test('americanexpress vs americanexpress → 1.0', () => {
    expect(computeJaroWinkler('americanexpress', 'americanexpress')).toBe(1);
  });

  test('paypal vs paypal → 1.0', () => {
    expect(computeJaroWinkler('paypal', 'paypal')).toBe(1);
  });

  test('americanexpress vs workbidrun → very low score', () => {
    expect(computeJaroWinkler('americanexpress', 'workbidrun')).toBeLessThan(0.5);
  });

  test('microsoft vs microsofft (one-char typo) → high score', () => {
    const sim = computeJaroWinkler('microsoft', 'microsofft');
    expect(sim).toBeGreaterThan(0.9);
  });

  test('result is rounded to 4 decimal places', () => {
    const sim = computeJaroWinkler('paypal', 'paypals');
    // Should not have more than 4 decimal places
    const str = sim.toString();
    const decimals = str.includes('.') ? str.split('.')[1].length : 0;
    expect(decimals).toBeLessThanOrEqual(4);
  });

  test('prefix bonus: strings with common prefix score higher than those without', () => {
    // 'paypal' vs 'paypalx' shares prefix 'paypal' (4 counted, up to prefixMaxLen)
    // 'paypal' vs 'xaypal' shares no prefix
    const withPrefix = computeJaroWinkler('paypal', 'paypalx');
    const withoutPrefix = computeJaroWinkler('paypal', 'xaypal');
    expect(withPrefix).toBeGreaterThan(withoutPrefix);
  });

  test('prefixScalingFactor=0 produces Jaro similarity (no prefix bonus)', () => {
    const jaro = computeJaro('MARTHA', 'MARHTA');
    const jw = computeJaroWinkler('MARTHA', 'MARHTA', 0);
    // Both are rounded to 4 decimal places; compare within that tolerance.
    expect(jw).toBeCloseTo(jaro, 4);
  });

  test('americanexpress vs amazon → score below 0.75 (different brands)', () => {
    expect(computeJaroWinkler('americanexpress', 'amazon')).toBeLessThan(0.75);
  });
});
