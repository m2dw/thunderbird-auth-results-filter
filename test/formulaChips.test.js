import { CHIP_GROUPS } from '../src/options/formulaChips.js';

describe('CHIP_GROUPS structure', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(CHIP_GROUPS)).toBe(true);
    expect(CHIP_GROUPS.length).toBeGreaterThan(0);
  });

  test('all groups have a non-empty labelKey string', () => {
    for (const group of CHIP_GROUPS) {
      expect(typeof group.labelKey).toBe('string');
      expect(group.labelKey.length).toBeGreaterThan(0);
    }
  });

  test('all groups have a non-empty chips array', () => {
    for (const group of CHIP_GROUPS) {
      expect(Array.isArray(group.chips)).toBe(true);
      expect(group.chips.length).toBeGreaterThan(0);
    }
  });

  test('all chips have a non-empty snippet string', () => {
    for (const group of CHIP_GROUPS) {
      for (const chip of group.chips) {
        expect(typeof chip.snippet).toBe('string');
        expect(chip.snippet.length).toBeGreaterThan(0);
      }
    }
  });

  test('no duplicate snippet strings across all groups', () => {
    const snippets = CHIP_GROUPS.flatMap(g => g.chips.map(c => c.snippet));
    expect(new Set(snippets).size).toBe(snippets.length);
  });
});

describe('CHIP_GROUPS required function snippets', () => {
  let snippets;
  beforeAll(() => {
    snippets = new Set(CHIP_GROUPS.flatMap(g => g.chips.map(c => c.snippet)));
  });

  test('includes has()', () => expect(snippets.has('has("score.reason.key")')).toBe(true));
  test('includes scoreOf()', () => expect(snippets.has('scoreOf("score.reason.key")')).toBe(true));
  test('includes min()', () => expect(snippets.has('min(a, b)')).toBe(true));
  test('includes max()', () => expect(snippets.has('max(a, b)')).toBe(true));
  test('includes clamp()', () => expect(snippets.has('clamp(value, min, max)')).toBe(true));
});

describe('CHIP_GROUPS required From field snippets', () => {
  let snippets;
  beforeAll(() => {
    snippets = new Set(CHIP_GROUPS.flatMap(g => g.chips.map(c => c.snippet)));
  });

  test('includes from.domain', () => expect(snippets.has('from.domain')).toBe(true));
  test('includes from.registrableDomain', () => expect(snippets.has('from.registrableDomain')).toBe(true));
  test('includes from.subdomainDepth', () => expect(snippets.has('from.subdomainDepth')).toBe(true));
  test('includes from.leftLabelEntropy', () => expect(snippets.has('from.leftLabelEntropy')).toBe(true));
  test('includes from.localPart', () => expect(snippets.has('from.localPart')).toBe(true));
});

describe('CHIP_GROUPS required alignment field snippets', () => {
  let snippets;
  beforeAll(() => {
    snippets = new Set(CHIP_GROUPS.flatMap(g => g.chips.map(c => c.snippet)));
  });

  test('includes alignment.spfAligned', () => expect(snippets.has('alignment.spfAligned')).toBe(true));
  test('includes alignment.anyDkimAligned', () => expect(snippets.has('alignment.anyDkimAligned')).toBe(true));
  test('includes alignment.anyAuthAligned', () => expect(snippets.has('alignment.anyAuthAligned')).toBe(true));
});

describe('CHIP_GROUPS required Message-ID field snippets', () => {
  let snippets;
  beforeAll(() => {
    snippets = new Set(CHIP_GROUPS.flatMap(g => g.chips.map(c => c.snippet)));
  });

  test('includes messageId.domain', () => expect(snippets.has('messageId.domain')).toBe(true));
  test('includes messageId.registrableDomain', () => expect(snippets.has('messageId.registrableDomain')).toBe(true));
  test('includes messageId.matchesFromDomain', () => expect(snippets.has('messageId.matchesFromDomain')).toBe(true));
});

describe('CHIP_GROUPS required general and header snippets', () => {
  let snippets;
  beforeAll(() => {
    snippets = new Set(CHIP_GROUPS.flatMap(g => g.chips.map(c => c.snippet)));
  });

  test('includes headers.hasListHeaders', () => expect(snippets.has('headers.hasListHeaders')).toBe(true));
  test('includes baseScore', () => expect(snippets.has('baseScore')).toBe(true));
  test('includes verdict', () => expect(snippets.has('verdict')).toBe(true));
});
