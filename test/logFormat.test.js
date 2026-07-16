import { formatDelta, formatScoreReasonSummary, buildTopReasonsSummary, sliceRecentLog, logHasMore } from '../src/modules/logFormat.js';

// ─── formatDelta ─────────────────────────────────────────────────────────────

describe('formatDelta', () => {
  test('positive number gets a + prefix', () => {
    expect(formatDelta(50)).toBe('+50');
  });

  test('zero has no prefix', () => {
    expect(formatDelta(0)).toBe('0');
  });

  test('negative number is represented as-is', () => {
    expect(formatDelta(-10)).toBe('-10');
  });

  test('large positive', () => {
    expect(formatDelta(100)).toBe('+100');
  });

  test('large negative', () => {
    expect(formatDelta(-200)).toBe('-200');
  });
});

// ─── formatScoreReasonSummary ─────────────────────────────────────────────────

describe('formatScoreReasonSummary', () => {
  test('uses label when present', () => {
    const r = { key: 'auth.dmarc.fail', label: 'DMARC fail', delta: 40 };
    expect(formatScoreReasonSummary(r)).toBe('DMARC fail: +40');
  });

  test('falls back to key when label is absent', () => {
    const r = { key: 'auth.spf.fail', delta: 60 };
    expect(formatScoreReasonSummary(r)).toBe('auth.spf.fail: +60');
  });

  test('includes authservId in parentheses', () => {
    const r = { key: 'authserv.untrusted', label: 'Untrusted authserv-id', delta: 50, authservId: 'mail.example.com' };
    expect(formatScoreReasonSummary(r)).toBe('Untrusted authserv-id: +50 (mail.example.com)');
  });

  test('heuristic.randomFromDomainLabel: includes matched label', () => {
    const r = {
      key: 'heuristic.randomFromDomainLabel',
      label: 'Random-looking From domain label',
      delta: 20,
      matchedLabel: 'xkjzqvw',
    };
    expect(formatScoreReasonSummary(r)).toBe('Random-looking From domain label: +20 (label: xkjzqvw)');
  });

  test('sender.rule: includes domain and matchType', () => {
    const r = { key: 'sender.rule', label: 'Sender domain rule', delta: -100, domain: 'example.co.jp', matchType: 'suffix' };
    expect(formatScoreReasonSummary(r)).toBe('Sender domain rule: -100 (example.co.jp suffix)');
  });

  test('sender.rule: domain without matchType', () => {
    const r = { key: 'sender.rule', label: 'Sender domain rule', delta: 50, domain: 'suspicious.cn' };
    expect(formatScoreReasonSummary(r)).toBe('Sender domain rule: +50 (suspicious.cn)');
  });

  test('entry with zero delta', () => {
    const r = { key: 'auth.dmarc.pass', label: 'DMARC pass', delta: 0 };
    expect(formatScoreReasonSummary(r)).toBe('DMARC pass: 0');
  });

  test('reason without optional context fields', () => {
    const r = { key: 'heuristic.randomFromLocalPart', label: 'Random-looking From local part', delta: 10 };
    expect(formatScoreReasonSummary(r)).toBe('Random-looking From local part: +10');
  });
});

// ─── buildTopReasonsSummary ───────────────────────────────────────────────────

describe('buildTopReasonsSummary', () => {
  test('returns empty string for empty array', () => {
    expect(buildTopReasonsSummary([])).toBe('');
  });

  test('returns empty string for non-array input', () => {
    expect(buildTopReasonsSummary(null)).toBe('');
    expect(buildTopReasonsSummary(undefined)).toBe('');
  });

  test('returns empty string when all deltas are zero', () => {
    const reasons = [
      { key: 'auth.dmarc.pass', label: 'DMARC pass', delta: 0, currentDelta: 0 },
      { key: 'auth.spf.pass', label: 'SPF pass', delta: 0, currentDelta: 0 },
    ];
    expect(buildTopReasonsSummary(reasons)).toBe('');
  });

  test('uses label and currentDelta for a single reason', () => {
    const reasons = [{ key: 'auth.spf.fail', label: 'SPF fail', delta: 60, currentDelta: 60 }];
    expect(buildTopReasonsSummary(reasons)).toBe('SPF fail: +60');
  });

  test('falls back to key when label is absent', () => {
    const reasons = [{ key: 'auth.spf.fail', delta: 60, currentDelta: 60 }];
    expect(buildTopReasonsSummary(reasons)).toBe('auth.spf.fail: +60');
  });

  test('uses currentDelta when present, ignoring original delta', () => {
    const reasons = [{ key: 'auth.dmarc.fail', label: 'DMARC fail', delta: 50, currentDelta: 25 }];
    expect(buildTopReasonsSummary(reasons)).toBe('DMARC fail: +25');
  });

  test('falls back to delta when currentDelta is absent', () => {
    const reasons = [{ key: 'auth.dmarc.fail', label: 'DMARC fail', delta: 50 }];
    expect(buildTopReasonsSummary(reasons)).toBe('DMARC fail: +50');
  });

  test('sorts by absolute effective delta descending', () => {
    const reasons = [
      { key: 'auth.dmarc.fail', label: 'DMARC fail', delta: 25, currentDelta: 25 },
      { key: 'auth.spf.fail', label: 'SPF fail', delta: 60, currentDelta: 60 },
      { key: 'heuristic.randomFromLocalPart', label: 'Random local', delta: 10, currentDelta: 10 },
    ];
    expect(buildTopReasonsSummary(reasons)).toBe('SPF fail: +60 · DMARC fail: +25 · Random local: +10');
  });

  test('limits output to maxCount (default 3)', () => {
    const reasons = [
      { key: 'a', label: 'A', delta: 10, currentDelta: 10 },
      { key: 'b', label: 'B', delta: 20, currentDelta: 20 },
      { key: 'c', label: 'C', delta: 30, currentDelta: 30 },
      { key: 'd', label: 'D', delta: 40, currentDelta: 40 },
    ];
    expect(buildTopReasonsSummary(reasons)).toBe('D: +40 · C: +30 · B: +20');
  });

  test('respects custom maxCount', () => {
    const reasons = [
      { key: 'a', label: 'A', delta: 10, currentDelta: 10 },
      { key: 'b', label: 'B', delta: 20, currentDelta: 20 },
    ];
    expect(buildTopReasonsSummary(reasons, 1)).toBe('B: +20');
  });

  test('excludes zero-delta reasons and includes non-zero ones', () => {
    const reasons = [
      { key: 'auth.dmarc.pass', label: 'DMARC pass', delta: 0, currentDelta: 0 },
      { key: 'auth.spf.fail', label: 'SPF fail', delta: 60, currentDelta: 60 },
    ];
    expect(buildTopReasonsSummary(reasons)).toBe('SPF fail: +60');
  });

  test('handles negative deltas (mitigations)', () => {
    const reasons = [
      { key: 'whitelist.manual', label: 'Manual whitelist', delta: -50, currentDelta: -50 },
      { key: 'auth.spf.fail', label: 'SPF fail', delta: 60, currentDelta: 60 },
    ];
    expect(buildTopReasonsSummary(reasons)).toBe('SPF fail: +60 · Manual whitelist: -50');
  });

  test('treats negative deltas by absolute value for sort order', () => {
    const reasons = [
      { key: 'a', label: 'A', delta: 30, currentDelta: 30 },
      { key: 'b', label: 'B', delta: -50, currentDelta: -50 },
    ];
    expect(buildTopReasonsSummary(reasons)).toBe('B: -50 · A: +30');
  });
});

// ─── sliceRecentLog ───────────────────────────────────────────────────────────

describe('sliceRecentLog', () => {
  test('returns empty array for non-array input', () => {
    expect(sliceRecentLog(null, 10)).toEqual([]);
    expect(sliceRecentLog(undefined, 10)).toEqual([]);
  });

  test('returns empty array when limit is zero or negative', () => {
    expect(sliceRecentLog([1, 2, 3], 0)).toEqual([]);
    expect(sliceRecentLog([1, 2, 3], -1)).toEqual([]);
  });

  test('returns empty array for empty log', () => {
    expect(sliceRecentLog([], 50)).toEqual([]);
  });

  test('returns all entries when log is smaller than limit', () => {
    const log = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(sliceRecentLog(log, 50)).toEqual(log);
  });

  test('returns the most recent limit entries (head of the array)', () => {
    // Log is stored newest-first: id:5 is the most recent entry
    const log = [{ id: 5 }, { id: 4 }, { id: 3 }, { id: 2 }, { id: 1 }];
    expect(sliceRecentLog(log, 3)).toEqual([{ id: 5 }, { id: 4 }, { id: 3 }]);
  });

  test('preserves newest-first order within the returned slice', () => {
    // Log is stored newest-first: id:9 is the most recent entry
    const log = Array.from({ length: 10 }, (_, i) => ({ id: 9 - i }));
    const result = sliceRecentLog(log, 4);
    expect(result).toEqual([{ id: 9 }, { id: 8 }, { id: 7 }, { id: 6 }]);
  });

  test('returns the full array when limit equals log length', () => {
    const log = [{ id: 0 }, { id: 1 }];
    expect(sliceRecentLog(log, 2)).toEqual(log);
  });
});

// ─── logHasMore ──────────────────────────────────────────────────────────────

describe('logHasMore', () => {
  test('returns false when all entries are rendered', () => {
    expect(logHasMore(50, 50)).toBe(false);
  });

  test('returns false when rendered count exceeds total (defensive)', () => {
    expect(logHasMore(10, 50)).toBe(false);
  });

  test('returns true when some entries are not yet rendered', () => {
    expect(logHasMore(100, 50)).toBe(true);
  });

  test('returns false for empty log', () => {
    expect(logHasMore(0, 0)).toBe(false);
  });

  test('returns true when one entry remains unrendered', () => {
    expect(logHasMore(51, 50)).toBe(true);
  });
});
