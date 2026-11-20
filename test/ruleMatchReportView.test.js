import {
  ALL_LAYERS,
  DEFAULT_SORT,
  DRILLDOWN_PAGE_SIZE,
  filterRuleRows,
  findRule,
  matchShare,
  normalizeSort,
  pageItems,
  reportState,
  settleCollectedScope,
  sortRuleRows,
  toggleSort,
  withScopeExclusions,
} from '../src/core/ruleMatchReportView.js';

// One rule per layer plus ties, listed out of canonical order on purpose.
const RULES = [
  { key: 'sender.rule', layer: 'L5', matchCount: 3, diagnostic: false },
  { key: 'heuristic.zzz', layer: 'L3', matchCount: 7, diagnostic: false },
  { key: 'auth.spf.pass', layer: 'L1', matchCount: 3, diagnostic: true },
  { key: 'composite.aaa', layer: 'L4', matchCount: 1, diagnostic: false },
  { key: 'identity.mmm', layer: 'L2', matchCount: 7, diagnostic: false },
  { key: 'auth.spf.fail', layer: 'L1', matchCount: 3, diagnostic: false },
];
const CANONICAL = ['auth.spf.pass', 'auth.spf.fail', 'identity.mmm', 'heuristic.zzz', 'composite.aaa', 'sender.rule'];
const keys = rows => rows.map(r => r.key);

describe('sortRuleRows', () => {
  test('defaults to most matches first with canonical tie-breaking', () => {
    expect(DEFAULT_SORT).toEqual({ key: 'matches', direction: 'desc' });
    expect(keys(sortRuleRows(RULES))).toEqual([
      'identity.mmm', 'heuristic.zzz',
      'auth.spf.pass', 'auth.spf.fail', 'sender.rule',
      'composite.aaa',
    ]);
  });

  test('matches ascending keeps canonical order within ties', () => {
    expect(keys(sortRuleRows(RULES, { key: 'matches', direction: 'asc' }))).toEqual([
      'composite.aaa',
      'auth.spf.pass', 'auth.spf.fail', 'sender.rule',
      'identity.mmm', 'heuristic.zzz',
    ]);
  });

  test('rule order ascending groups L1 through L5 canonically', () => {
    expect(keys(sortRuleRows(RULES, { key: 'rule', direction: 'asc' }))).toEqual(CANONICAL);
  });

  test('rule order descending is the exact reverse', () => {
    expect(keys(sortRuleRows(RULES, { key: 'rule', direction: 'desc' }))).toEqual([...CANONICAL].reverse());
  });

  test('is deterministic regardless of input order and does not mutate input', () => {
    const shuffled = [...RULES].reverse();
    const before = keys(shuffled);
    for (const sort of [{ key: 'matches', direction: 'desc' }, { key: 'matches', direction: 'asc' }, { key: 'rule', direction: 'asc' }]) {
      expect(keys(sortRuleRows(shuffled, sort))).toEqual(keys(sortRuleRows(RULES, sort)));
    }
    expect(keys(shuffled)).toEqual(before);
  });
});

describe('toggleSort / normalizeSort', () => {
  test('activating the active column flips the direction', () => {
    expect(toggleSort({ key: 'matches', direction: 'desc' }, 'matches')).toEqual({ key: 'matches', direction: 'asc' });
    expect(toggleSort({ key: 'matches', direction: 'asc' }, 'matches')).toEqual({ key: 'matches', direction: 'desc' });
    expect(toggleSort({ key: 'rule', direction: 'asc' }, 'rule')).toEqual({ key: 'rule', direction: 'desc' });
  });

  test('a new column starts in its natural direction', () => {
    expect(toggleSort({ key: 'matches', direction: 'desc' }, 'rule')).toEqual({ key: 'rule', direction: 'asc' });
    expect(toggleSort({ key: 'rule', direction: 'desc' }, 'matches')).toEqual({ key: 'matches', direction: 'desc' });
  });

  test('invalid input falls back to the default', () => {
    expect(normalizeSort({ key: 'bogus', direction: 'sideways' })).toEqual(DEFAULT_SORT);
    expect(normalizeSort(undefined)).toEqual(DEFAULT_SORT);
  });
});

describe('filterRuleRows', () => {
  test('all layers keeps every rule', () => {
    expect(filterRuleRows(RULES, { layer: ALL_LAYERS })).toHaveLength(RULES.length);
  });

  test('a layer filter keeps only that layer', () => {
    expect(keys(filterRuleRows(RULES, { layer: 'L1' }))).toEqual(['auth.spf.pass', 'auth.spf.fail']);
    expect(keys(filterRuleRows(RULES, { layer: 'L5' }))).toEqual(['sender.rule']);
  });

  test('an unknown layer value is treated as all layers', () => {
    expect(filterRuleRows(RULES, { layer: 'L9' })).toHaveLength(RULES.length);
  });

  test('diagnostic-only entries can be hidden', () => {
    expect(keys(filterRuleRows(RULES, { layer: 'L1', includeDiagnostic: false }))).toEqual(['auth.spf.fail']);
  });
});

describe('matchShare', () => {
  test('is the share of analyzed messages', () => {
    expect(matchShare(10, 120)).toBeCloseTo(10 / 120);
    expect(matchShare(0, 5)).toBe(0);
  });

  test('is null when nothing was analyzed', () => {
    expect(matchShare(0, 0)).toBeNull();
  });
});

describe('reportState', () => {
  const base = { requested: 3, analyzed: 3, failed: 0, skipped: 0, cancelled: false };

  test('complete when every requested message was analyzed', () => {
    expect(reportState(base)).toBe('complete');
  });

  test('empty when the scope held no messages', () => {
    expect(reportState({ ...base, requested: 0, analyzed: 0 })).toBe('empty');
  });

  test('partial on failures, skips, over-limit messages, or a truncated scope', () => {
    expect(reportState({ ...base, analyzed: 2, failed: 1 })).toBe('partial');
    expect(reportState({ ...base, analyzed: 2, skipped: 1 })).toBe('partial');
    expect(reportState({ ...base, analyzed: 2, overLimit: 1 })).toBe('partial');
    expect(reportState(base, { truncated: true })).toBe('partial');
  });

  test('cancelled takes precedence', () => {
    expect(reportState({ ...base, analyzed: 1, skipped: 2, cancelled: true })).toBe('cancelled');
    expect(reportState({ ...base, analyzed: 0, skipped: 3, cancelled: true })).toBe('cancelled');
  });
});

describe('withScopeExclusions', () => {
  test('a 1,001-message scope reports 1,001 requested and 1 over the limit', () => {
    const batch = { requested: 1000, analyzed: 1000, failed: 0, skipped: 0, overLimit: 0, cancelled: false, rules: RULES };
    const report = withScopeExclusions(batch, 1);
    expect(report).toMatchObject({ requested: 1001, analyzed: 1000, failed: 0, skipped: 0, overLimit: 1 });
    expect(report.rules).toBe(RULES);
    expect(report.analyzed + report.failed + report.skipped + report.overLimit).toBe(report.requested);
    expect(reportState(report)).toBe('partial');
    // The batch result itself is not mutated.
    expect(batch).toMatchObject({ requested: 1000, overLimit: 0 });
  });

  test('cap exclusions stay separate from read failures and skips', () => {
    const batch = { requested: 1000, analyzed: 990, failed: 10, skipped: 0, overLimit: 0 };
    expect(withScopeExclusions(batch, 250)).toMatchObject({ requested: 1250, failed: 10, skipped: 0, overLimit: 250 });
  });

  test('excluded messages also count toward a cancelled report', () => {
    const batch = { requested: 1000, analyzed: 40, failed: 0, skipped: 960, cancelled: true };
    expect(withScopeExclusions(batch, 5)).toMatchObject({ requested: 1005, analyzed: 40, skipped: 960, overLimit: 5, cancelled: true });
  });

  test('no exclusions leave the report unchanged', () => {
    const batch = { requested: 3, analyzed: 3, failed: 0, skipped: 0 };
    expect(withScopeExclusions(batch, 0)).toBe(batch);
    expect(withScopeExclusions(batch)).toBe(batch);
    expect(withScopeExclusions(batch, -2)).toBe(batch);
  });
});

describe('pageItems', () => {
  const items = Array.from({ length: 10000 }, (_, i) => i + 1);

  test('returns one bounded page with 1-based positions', () => {
    expect(pageItems(items, 0)).toMatchObject({ page: 0, pageCount: 100, start: 1, end: 100, total: 10000 });
    expect(pageItems(items, 0).items).toHaveLength(DRILLDOWN_PAGE_SIZE);
    const last = pageItems(items.slice(0, 250), 2);
    expect(last).toMatchObject({ page: 2, pageCount: 3, start: 201, end: 250 });
    expect(last.items[0]).toBe(201);
  });

  test('clamps the page to the available range', () => {
    expect(pageItems(items.slice(0, 150), 99)).toMatchObject({ page: 1, start: 101, end: 150 });
    expect(pageItems(items.slice(0, 150), -3)).toMatchObject({ page: 0, start: 1 });
    expect(pageItems(items.slice(0, 150), NaN)).toMatchObject({ page: 0 });
  });

  test('an empty list is a single empty page', () => {
    expect(pageItems([], 0)).toEqual({ items: [], page: 0, pageCount: 1, start: 0, end: 0, total: 0 });
    expect(pageItems(undefined, 0)).toMatchObject({ total: 0, pageCount: 1 });
  });
});

describe('settleCollectedScope', () => {
  const completed = { kind: 'selection', messageIds: [1, 2], excluded: 0, truncated: false, folders: [] };

  test('a Cancel that lands after collection finished cancels the completed scope', () => {
    const settled = settleCollectedScope(completed, { cancelRequested: true });
    expect(settled).toMatchObject({ kind: 'selection', cancelled: true });
    // The background's scope object is not mutated.
    expect(completed.cancelled).toBeUndefined();
  });

  test('without a Cancel the completed scope is analyzed as is', () => {
    expect(settleCollectedScope(completed, { cancelRequested: false })).toBe(completed);
    expect(settleCollectedScope(completed)).toBe(completed);
  });

  test('missing, error, and already-cancelled scopes are left unchanged', () => {
    expect(settleCollectedScope(null, { cancelRequested: true })).toBeNull();
    const error = { kind: 'error', error: 'boom' };
    expect(settleCollectedScope(error, { cancelRequested: true })).toBe(error);
    const cancelled = { ...completed, cancelled: true };
    expect(settleCollectedScope(cancelled, { cancelRequested: true })).toBe(cancelled);
  });
});

test('findRule returns the aggregate for drill-down', () => {
  expect(findRule({ rules: RULES }, 'sender.rule')).toBe(RULES[0]);
  expect(findRule({ rules: RULES }, 'missing')).toBeNull();
});
