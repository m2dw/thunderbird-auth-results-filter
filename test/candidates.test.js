import { readFileSync } from 'node:fs';
import { prunedCandidates, MAX_CANDIDATES } from '../src/modules/candidates.js';

describe('prunedCandidates', () => {
  test('returns the same list when at or under the limit', () => {
    const candidates = [{ authservId: 'a', registrableDomain: 'a.com', firstSeen: 1, lastSeen: 1 }];
    expect(prunedCandidates(candidates)).toHaveLength(1);
  });

  test('prunes to MAX_CANDIDATES when over the limit', () => {
    const candidates = Array.from({ length: MAX_CANDIDATES + 5 }, (_, i) => ({
      authservId: `mail${i}.example.com`,
      registrableDomain: 'example.com',
      firstSeen: i,
      lastSeen: i,
    }));
    expect(prunedCandidates(candidates)).toHaveLength(MAX_CANDIDATES);
  });

  test('removes the oldest entries by lastSeen', () => {
    const candidates = Array.from({ length: MAX_CANDIDATES + 1 }, (_, i) => ({
      authservId: `mail${i}.example.com`,
      registrableDomain: 'example.com',
      firstSeen: i,
      lastSeen: i,
    }));
    const pruned = prunedCandidates(candidates);
    // Oldest entry (lastSeen = 0) must be gone
    expect(pruned.some(c => c.authservId === 'mail0.example.com')).toBe(false);
    // Most recent entry must be kept
    expect(pruned.some(c => c.authservId === `mail${MAX_CANDIDATES}.example.com`)).toBe(true);
  });

  test('does not mutate the input array', () => {
    const candidates = Array.from({ length: MAX_CANDIDATES + 1 }, (_, i) => ({
      authservId: `mail${i}.example.com`,
      registrableDomain: 'example.com',
      firstSeen: i,
      lastSeen: i,
    }));
    const copy = candidates.map(c => ({ ...c }));
    prunedCandidates(candidates);
    expect(candidates).toEqual(copy);
  });

  test('MAX_CANDIDATES is 50', () => {
    expect(MAX_CANDIDATES).toBe(50);
  });
});

describe('background candidate collection disabled', () => {
  test('background.js does not reference candidateUpdates', () => {
    const src = readFileSync(new URL('../src/background/background.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/candidateUpdates/);
  });
});
