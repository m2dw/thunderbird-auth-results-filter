import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import {
  collectFolderMessageIds,
  collectMessageIds,
  collectSelectedMessageIds,
  createScopeRegistry,
  folderFromMenuInfo,
  parseAnalysisLimit,
  parseSentDateRange,
  sanitizeFolder,
} from '../src/modules/ruleMatchScope.js';
import {
  MAX_RULE_MATCH_BATCH,
  RULE_MATCH_HARD_LIMIT,
  analyzeMessagesForRuleReport,
  createMessageReader,
} from '../src/modules/ruleMatchAnalysis.js';

const INBOX = { id: 'acct1://INBOX', accountId: 'acct1', path: '/INBOX', name: 'Inbox', type: 'inbox', subFolders: [{ accountId: 'acct1', path: '/INBOX/Sub', name: 'Sub' }] };
const ARCHIVE = { accountId: 'acct1', path: '/Archive', name: 'Archive' };

const msg = (id, folder = INBOX, date = new Date('2026-11-10T00:00:00Z')) => ({ id, folder, date });

// Builds a paginated MessageList API double from an array of pages.
function pagedApi(pages, extra = {}) {
  const calls = { continueList: [], abortList: [], list: [], query: [] };
  const byId = new Map(pages.map((messages, i) => [`list-${i}`, { messages, id: i + 1 < pages.length ? `list-${i + 1}` : null }]));
  const first = { messages: pages[0] ?? [], id: pages.length > 1 ? 'list-1' : null };
  const api = {
    messages: {
      list: async folder => { calls.list.push(folder); return first; },
      query: async info => { calls.query.push(info); return first; },
      continueList: async id => { calls.continueList.push(id); return byId.get(id); },
      abortList: async id => { calls.abortList.push(id); },
      ...extra,
    },
  };
  return { api, calls, first };
}

describe('folderFromMenuInfo', () => {
  test('uses the clicked folder even when several folders are affected', () => {
    expect(folderFromMenuInfo({ selectedFolders: [INBOX, ARCHIVE], selectedFolder: ARCHIVE })).toEqual(ARCHIVE);
  });

  test('uses a single selectedFolders entry when no clicked folder is given', () => {
    expect(folderFromMenuInfo({ selectedFolders: [INBOX] })).toEqual({
      id: 'acct1://INBOX', accountId: 'acct1', path: '/INBOX', name: 'Inbox', type: 'inbox',
    });
  });

  test('does not guess among several folders without a clicked folder', () => {
    expect(folderFromMenuInfo({ selectedFolders: [INBOX, ARCHIVE] })).toBeNull();
  });

  test('falls back to the single-folder selectedFolder property', () => {
    expect(folderFromMenuInfo({ selectedFolder: ARCHIVE })).toEqual(ARCHIVE);
  });

  test('never includes subfolders', () => {
    expect(folderFromMenuInfo({ selectedFolder: INBOX })).not.toHaveProperty('subFolders');
  });

  test('returns null for an account row or empty selection', () => {
    expect(folderFromMenuInfo({ selectedAccount: { id: 'acct1' } })).toBeNull();
    expect(folderFromMenuInfo({ selectedFolders: [] })).toBeNull();
    expect(sanitizeFolder({ name: 'no identity' })).toBeNull();
  });
});

describe('collectMessageIds', () => {
  test('follows pagination and keeps message order', async () => {
    const { api, calls, first } = pagedApi([[msg(1), msg(2)], [msg(3)], [msg(4, ARCHIVE)]]);
    const out = await collectMessageIds(first, api.messages.continueList, { limit: 10 });
    expect(out.messageIds).toEqual([1, 2, 3, 4]);
    expect(out.truncated).toBe(false);
    expect(calls.continueList).toEqual(['list-1', 'list-2']);
    expect(out.folders.map(f => f.path)).toEqual(['/INBOX', '/Archive']);
  });

  test('keeps IDs up to the limit and counts the rest of the scope as excluded', async () => {
    const { api, calls, first } = pagedApi([[msg(1), msg(2)], [msg(3), msg(4)], [msg(5)]]);
    const out = await collectMessageIds(first, api.messages.continueList, {
      limit: 3,
      abortList: api.messages.abortList,
    });
    expect(out.messageIds).toEqual([1, 2, 3]);
    expect(out).toMatchObject({ excluded: 2, truncated: true });
    // Every page is read so the excluded count covers the whole scope.
    expect(calls.continueList).toEqual(['list-1', 'list-2']);
    expect(calls.abortList).toEqual([]);
  });

  test('a scope one over the limit reports one excluded message', async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => i + 1);
    const pages = [];
    for (let i = 0; i < ids.length; i += 100) pages.push(ids.slice(i, i + 100).map(id => msg(id)));
    const { api, first } = pagedApi(pages);
    const out = await collectMessageIds(first, api.messages.continueList, { limit: 1000 });
    expect(out.messageIds).toHaveLength(1000);
    expect(out).toMatchObject({ excluded: 1, truncated: true });
    expect(out.messageIds.length + out.excluded).toBe(1001);
  });

  test('exactly the limit is not truncated', async () => {
    const { api, first } = pagedApi([[msg(1), msg(2)]]);
    const out = await collectMessageIds(first, api.messages.continueList, { limit: 2 });
    expect(out).toMatchObject({ messageIds: [1, 2], excluded: 0, truncated: false });
  });

  test('cancellation while counting excluded messages stops paging', async () => {
    const controller = new AbortController();
    let resolvePage;
    const pending = new Promise(resolve => { resolvePage = resolve; });
    const promise = collectMessageIds({ messages: [msg(1), msg(2)], id: 'list-1' }, () => pending, {
      limit: 1,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    expect(await promise).toMatchObject({ messageIds: [1], excluded: 1, cancelled: true });
    resolvePage(null);
  });

  test('duplicates of kept IDs beyond the limit are not excluded', async () => {
    const { api, first } = pagedApi([[msg(1), msg(2)], [msg(3), msg(1)], [msg(2), msg(4)]]);
    const out = await collectMessageIds(first, api.messages.continueList, { limit: 2 });
    expect(out).toMatchObject({ messageIds: [1, 2], excluded: 2, truncated: true });
    expect(out.messageIds.length + out.excluded).toBe(4);
  });

  test('entries beyond the limit are counted without retaining their IDs', async () => {
    // IDs past the limit are not tracked (bounded memory), so each listing counts.
    const { api, first } = pagedApi([[msg(1), msg(2)], [msg(3), msg(3)]]);
    const out = await collectMessageIds(first, api.messages.continueList, { limit: 2 });
    expect(out).toMatchObject({ messageIds: [1, 2], excluded: 2, truncated: true });
  });

  test('reports the messages counted after each page', async () => {
    const { api, first } = pagedApi([[msg(1), msg(2)], [msg(2), msg(3)], [msg(4)]]);
    const progress = [];
    await collectMessageIds(first, api.messages.continueList, {
      limit: 2,
      onProgress: p => progress.push(p.collected),
    });
    expect(progress).toEqual([2, 3, 4]);
  });

  test('skips duplicate and invalid IDs', async () => {
    const { api, first } = pagedApi([[msg(1), msg(1), { id: 'x' }, null, msg(2)]]);
    const out = await collectMessageIds(first, api.messages.continueList);
    expect(out.messageIds).toEqual([1, 2]);
  });

  test('returns each kept message\'s listed account ID, aligned with messageIds', async () => {
    const other = { accountId: 'acct2', path: '/Junk', name: 'Junk' };
    const out = await collectMessageIds(
      { messages: [msg(1), msg(2, other), msg(3, null), msg(4)], id: null },
      async () => null,
      { limit: 3 },
    );
    expect(out.messageIds).toEqual([1, 2, 3]);
    expect(out.accountIds).toEqual(['acct1', 'acct2', null]);
  });

  test('a missing list yields no messages', async () => {
    const out = await collectMessageIds(null, async () => null);
    expect(out).toEqual({ messageIds: [], accountIds: [], excluded: 0, truncated: false, cancelled: false, folders: [] });
  });

  test('cancellation during pagination stops paging and releases the list', async () => {
    const controller = new AbortController();
    let resolvePage;
    const pending = new Promise(resolve => { resolvePage = resolve; });
    const continueCalls = [];
    const abortCalls = [];
    const promise = collectMessageIds({ messages: [msg(1)], id: 'list-1' }, id => {
      continueCalls.push(id);
      return pending;
    }, { signal: controller.signal, abortList: async id => { abortCalls.push(id); } });
    await Promise.resolve();
    controller.abort();
    const out = await promise;
    expect(out).toMatchObject({ messageIds: [1], cancelled: true, truncated: false });
    expect(continueCalls).toEqual(['list-1']);
    // The list being continued is released as soon as cancellation wins.
    expect(abortCalls).toEqual(['list-1']);
    // The page that arrives after cancellation is released, not followed.
    resolvePage({ messages: [msg(2)], id: 'list-2' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(abortCalls).toEqual(['list-1', 'list-2']);
    expect(continueCalls).toEqual(['list-1']);
  });

  test('cancellation releases the active list when its next page never resolves', async () => {
    const controller = new AbortController();
    const abortCalls = [];
    const promise = collectMessageIds(
      { messages: [msg(1)], id: 'list-1' },
      () => new Promise(() => {}),
      { signal: controller.signal, abortList: async id => { abortCalls.push(id); } },
    );
    await Promise.resolve();
    controller.abort();
    expect(await promise).toMatchObject({ messageIds: [1], cancelled: true });
    expect(abortCalls).toEqual(['list-1']);
  });

  test('records folders of messages beyond the limit', async () => {
    const pages = [];
    for (let i = 0; i < 1000; i += 100) {
      pages.push(Array.from({ length: 100 }, (_, j) => msg(i + j + 1)));
    }
    pages.push([msg(1001, ARCHIVE)]);
    const { api, first } = pagedApi(pages);
    const out = await collectMessageIds(first, api.messages.continueList, { limit: 1000 });
    expect(out).toMatchObject({ excluded: 1, truncated: true });
    expect(out.folders.map(f => f.path)).toEqual(['/INBOX', '/Archive']);
  });

  test('an already aborted signal releases the list without paging', async () => {
    const controller = new AbortController();
    controller.abort();
    const { api, calls, first } = pagedApi([[msg(1)], [msg(2)]]);
    const out = await collectMessageIds(first, api.messages.continueList, {
      signal: controller.signal,
      abortList: api.messages.abortList,
    });
    expect(out).toMatchObject({ messageIds: [], cancelled: true });
    expect(calls.continueList).toEqual([]);
    expect(calls.abortList).toEqual(['list-1']);
  });
});

describe('collectSelectedMessageIds', () => {
  test('analyzes exactly the targeted messages, including later pages', async () => {
    const { api, first } = pagedApi([[msg(10), msg(11)], [msg(12, ARCHIVE)]]);
    const out = await collectSelectedMessageIds(api, { selectedMessages: first });
    expect(out.messageIds).toEqual([10, 11, 12]);
    expect(out.folders).toHaveLength(2);
  });

  test('applies the processing limit', async () => {
    const { api, first } = pagedApi([[msg(10), msg(11), msg(12)]]);
    const out = await collectSelectedMessageIds(api, { selectedMessages: first }, { limit: 2 });
    expect(out).toMatchObject({ messageIds: [10, 11], excluded: 1, truncated: true });
  });

  test('cancellation stops paging through the selection and releases the list', async () => {
    const controller = new AbortController();
    const { api, calls, first } = pagedApi([[msg(10)], [msg(11)], [msg(12)]], {
      continueList: async id => {
        calls.continueList.push(id);
        controller.abort();
        return { messages: [msg(11)], id: 'list-2' };
      },
    });
    const out = await collectSelectedMessageIds(api, { selectedMessages: first }, { signal: controller.signal });
    expect(out).toMatchObject({ cancelled: true });
    expect(calls.continueList).toEqual(['list-1']);
    expect(calls.abortList).toEqual(['list-2']);
  });
});

// Local calendar-day helpers: the date range uses local day boundaries.
const localStart = (y, m, d) => new Date(y, m - 1, d);
const localEnd = (y, m, d) => new Date(new Date(y, m - 1, d + 1).getTime() - 1);

describe('parseSentDateRange', () => {
  test('both sides blank is unbounded', () => {
    expect(parseSentDateRange('', '')).toEqual({ fromDate: null, toDate: null });
    expect(parseSentDateRange()).toEqual({ fromDate: null, toDate: null });
  });

  test('From starts at local midnight; Through includes its whole local day', () => {
    const range = parseSentDateRange('2026-11-01', '2026-11-18');
    expect(range.fromDate.getTime()).toBe(localStart(2026, 11, 1).getTime());
    expect(range.toDate.getTime()).toBe(localEnd(2026, 11, 18).getTime());
    expect(range.toDate.getDate()).toBe(18);
    expect(range.toDate.getHours()).toBe(23);
  });

  test('one-sided bounds leave the other side open', () => {
    expect(parseSentDateRange('2026-11-01', '')).toEqual({ fromDate: localStart(2026, 11, 1), toDate: null });
    expect(parseSentDateRange('', '2026-11-18')).toEqual({ fromDate: null, toDate: localEnd(2026, 11, 18) });
  });

  test('future dates are allowed and the same day is a valid range', () => {
    expect(parseSentDateRange('2030-01-01', '2030-12-31').toDate.getFullYear()).toBe(2030);
    const day = parseSentDateRange('2026-11-18', '2026-11-18');
    expect(day.toDate.getTime() - day.fromDate.getTime()).toBe(localEnd(2026, 11, 18) - localStart(2026, 11, 18));
  });

  test('years 0001-0099 are not remapped to 1901-1999', () => {
    const range = parseSentDateRange('0001-01-01', '0099-12-31');
    expect(range.error).toBeUndefined();
    expect(range.fromDate.getFullYear()).toBe(1);
    expect([range.fromDate.getMonth(), range.fromDate.getDate(), range.fromDate.getHours()]).toEqual([0, 1, 0]);
    expect(range.toDate.getFullYear()).toBe(99);
    expect([range.toDate.getMonth(), range.toDate.getDate(), range.toDate.getHours()]).toEqual([11, 31, 23]);
    expect(parseSentDateRange('', '0050-02-28').toDate.getFullYear()).toBe(50);
    expect(parseSentDateRange('0099-12-31', '1999-12-31').error).toBeUndefined();
    expect(parseSentDateRange('1999-12-31', '0099-12-31')).toEqual({ error: 'inverted' });
    expect(parseSentDateRange('0004-02-29', '').fromDate.getDate()).toBe(29);
    expect(parseSentDateRange('0001-02-29', '')).toEqual({ error: 'invalid-from' });
  });

  test('rejects invalid and inverted dates', () => {
    expect(parseSentDateRange('2026-02-30', '')).toEqual({ error: 'invalid-from' });
    expect(parseSentDateRange('11/01/2026', '')).toEqual({ error: 'invalid-from' });
    expect(parseSentDateRange('', '2026-13-01')).toEqual({ error: 'invalid-through' });
    expect(parseSentDateRange('', 'tomorrow')).toEqual({ error: 'invalid-through' });
    expect(parseSentDateRange('2026-11-19', '2026-11-18')).toEqual({ error: 'inverted' });
  });
});

describe('parseAnalysisLimit', () => {
  test('accepts whole numbers from 1 to the hard ceiling', () => {
    expect(parseAnalysisLimit('1000')).toEqual({ limit: 1000, effective: 1000 });
    expect(parseAnalysisLimit(' 1 ')).toEqual({ limit: 1, effective: 1 });
    expect(parseAnalysisLimit(String(RULE_MATCH_HARD_LIMIT))).toEqual({ limit: RULE_MATCH_HARD_LIMIT, effective: RULE_MATCH_HARD_LIMIT });
  });

  test('"No user limit" keeps the hard ceiling', () => {
    expect(parseAnalysisLimit('', true)).toEqual({ limit: null, effective: RULE_MATCH_HARD_LIMIT });
    expect(parseAnalysisLimit('abc', true)).toEqual({ limit: null, effective: RULE_MATCH_HARD_LIMIT });
  });

  test.each(['', '0', '-5', '1.5', '1e3', 'abc', String(RULE_MATCH_HARD_LIMIT + 1)])('rejects %p', value => {
    expect(parseAnalysisLimit(value)).toEqual({ error: 'invalid-limit' });
  });
});

describe('collectFolderMessageIds', () => {
  test('a sent-date range queries only that folder with both bounds', async () => {
    const { fromDate, toDate } = parseSentDateRange('2026-11-01', '2026-11-18');
    const inRange = msg(1, INBOX, localStart(2026, 11, 10));
    const before = msg(2, INBOX, new Date(fromDate.getTime() - 1));
    const lastMs = msg(3, INBOX, localEnd(2026, 11, 18));
    const after = msg(4, INBOX, localStart(2026, 11, 19));
    const firstMs = msg(5, INBOX, localStart(2026, 11, 1));
    const { api, calls } = pagedApi([[inRange, before, lastMs, after, firstMs]]);
    const out = await collectFolderMessageIds(api, INBOX, { fromDate, toDate });
    expect(calls.list).toHaveLength(0);
    expect(calls.query).toHaveLength(1);
    // Query bounds are widened by 1 ms because query() filters are exclusive.
    expect(calls.query[0]).toEqual({
      folder: expect.any(Object),
      fromDate: new Date(fromDate.getTime() - 1),
      toDate: new Date(toDate.getTime() + 1),
      includeSubFolders: false,
    });
    expect(calls.query[0].folder).not.toHaveProperty('subFolders');
    expect(calls.query[0].folder.path).toBe('/INBOX');
    // Out-of-range messages are excluded even if the backend returned them;
    // both end days are inclusive.
    expect(out.messageIds).toEqual([1, 3, 5]);
  });

  test('boundary instants survive query() exclusive after/before semantics', async () => {
    const { fromDate, toDate } = parseSentDateRange('2026-11-01', '2026-11-18');
    const firstMs = msg(1, INBOX, localStart(2026, 11, 1));
    const lastMs = msg(2, INBOX, localEnd(2026, 11, 18));
    const before = msg(3, INBOX, new Date(fromDate.getTime() - 1));
    const after = msg(4, INBOX, localStart(2026, 11, 19));
    const all = [firstMs, lastMs, before, after];
    const calls = [];
    // Applies Thunderbird's documented semantics: fromDate = "after",
    // toDate = "before", both strict.
    const query = async info => {
      calls.push(info);
      const messages = all.filter(m => (!info.fromDate || m.date > info.fromDate)
        && (!info.toDate || m.date < info.toDate));
      return { messages, id: null };
    };
    const api = { messages: { query, list: async () => { throw new Error('list not expected'); }, continueList: async () => null } };
    const out = await collectFolderMessageIds(api, INBOX, { fromDate, toDate });
    expect(calls).toHaveLength(1);
    expect(out.messageIds).toEqual([1, 2]);

    const fromOnly = await collectFolderMessageIds(api, INBOX, { fromDate, toDate: null });
    expect(fromOnly.messageIds).toEqual([1, 2, 4]);
    const throughOnly = await collectFolderMessageIds(api, INBOX, { fromDate: null, toDate });
    expect(throughOnly.messageIds).toEqual([1, 2, 3]);
  });

  test('a From-only range has no implicit upper bound, so future dates are included', async () => {
    const { fromDate, toDate } = parseSentDateRange('2026-11-01', '');
    const future = msg(1, INBOX, new Date('2099-01-01T00:00:00Z'));
    const old = msg(2, INBOX, new Date('2020-01-01T00:00:00Z'));
    const { api, calls } = pagedApi([[future, old]]);
    const out = await collectFolderMessageIds(api, INBOX, { fromDate, toDate });
    expect(calls.query[0]).not.toHaveProperty('toDate');
    expect(calls.query[0].fromDate).toEqual(new Date(fromDate.getTime() - 1));
    expect(out.messageIds).toEqual([1]);
  });

  test('a Through-only range has no lower bound and may lie in the future', async () => {
    const { fromDate, toDate } = parseSentDateRange('', '2030-06-30');
    const ancient = msg(1, INBOX, new Date('1990-01-01T00:00:00Z'));
    const tooLate = msg(2, INBOX, localStart(2030, 7, 1));
    const { api, calls } = pagedApi([[ancient, tooLate]]);
    const out = await collectFolderMessageIds(api, INBOX, { fromDate, toDate });
    expect(calls.query[0]).not.toHaveProperty('fromDate');
    expect(calls.query[0].toDate).toEqual(new Date(toDate.getTime() + 1));
    expect(out.messageIds).toEqual([1]);
  });

  test('a dated run leaves out messages without a usable date', async () => {
    const { fromDate, toDate } = parseSentDateRange('2026-11-01', '');
    const { api } = pagedApi([[{ id: 1, folder: INBOX, date: 'garbage' }, msg(2, INBOX, localStart(2026, 11, 2))]]);
    const out = await collectFolderMessageIds(api, INBOX, { fromDate, toDate });
    expect(out.messageIds).toEqual([2]);
  });

  test('without a date range the folder is listed and never date-filtered', async () => {
    const outliers = [
      msg(1, INBOX, new Date('1970-01-01T00:00:00Z')),
      msg(2, INBOX, new Date('2999-12-31T00:00:00Z')),
      { id: 3, folder: INBOX, date: 'not a date' },
    ];
    const { api, calls } = pagedApi([outliers, [msg(4)]]);
    const out = await collectFolderMessageIds(api, INBOX, {});
    expect(calls.query).toHaveLength(0);
    expect(calls.list).toHaveLength(1);
    expect(out.messageIds).toEqual([1, 2, 3, 4]);
  });

  test('count only: an outlier Date does not make a message ineligible at the cap', async () => {
    const { api } = pagedApi([[msg(1, INBOX, new Date('1970-01-01T00:00:00Z')), msg(2), msg(3)]]);
    const out = await collectFolderMessageIds(api, INBOX, { limit: 2 });
    // Listing order decides, not the Date header.
    expect(out).toMatchObject({ messageIds: [1, 2], excluded: 1, truncated: true });
  });

  test('the date range is applied before the limit', async () => {
    const { fromDate, toDate } = parseSentDateRange('2026-11-01', '2026-11-30');
    const inside = d => msg(d, INBOX, localStart(2026, 11, d));
    const outside = id => msg(id, INBOX, localStart(2026, 10, 1));
    const { api } = pagedApi([[outside(100), inside(1), outside(101), inside(2)], [inside(3), outside(102), inside(4)]]);
    const out = await collectFolderMessageIds(api, INBOX, { fromDate, toDate, limit: 2 });
    // Out-of-range messages neither take a slot nor count as over the limit.
    expect(out).toMatchObject({ messageIds: [1, 2], excluded: 2, truncated: true });
  });

  test('defaults to 1,000 messages; "No user limit" stops at the hard ceiling', async () => {
    const total = RULE_MATCH_HARD_LIMIT + 250;
    const pages = [];
    for (let i = 0; i < total; i += 500) {
      pages.push(Array.from({ length: Math.min(500, total - i) }, (_, j) => msg(i + j + 1)));
    }
    const byDefault = await collectFolderMessageIds(pagedApi(pages).api, INBOX, {});
    expect(byDefault.messageIds).toHaveLength(MAX_RULE_MATCH_BATCH);
    expect(byDefault.excluded).toBe(total - MAX_RULE_MATCH_BATCH);
    const unlimited = await collectFolderMessageIds(pagedApi(pages).api, INBOX, { limit: null });
    expect(unlimited.messageIds).toHaveLength(RULE_MATCH_HARD_LIMIT);
    expect(unlimited.messageIds[0]).toBe(1);
    expect(unlimited.messageIds.at(-1)).toBe(RULE_MATCH_HARD_LIMIT);
    expect(unlimited).toMatchObject({ excluded: 250, truncated: true });
  });

  test('rejects invalid limits and date bounds at the execution boundary', async () => {
    const { api, calls } = pagedApi([[msg(1)]]);
    for (const limit of [0, -1, 2.5, RULE_MATCH_HARD_LIMIT + 1, '100']) {
      await expect(collectFolderMessageIds(api, INBOX, { limit })).rejects.toThrow(RangeError);
    }
    await expect(collectFolderMessageIds(api, INBOX, { fromDate: new Date('x') })).rejects.toThrow(TypeError);
    await expect(collectFolderMessageIds(api, INBOX, { toDate: '2026-11-18' })).rejects.toThrow(TypeError);
    await expect(collectFolderMessageIds(api, INBOX, {
      fromDate: localStart(2026, 11, 19), toDate: localEnd(2026, 11, 18),
    })).rejects.toThrow(RangeError);
    expect(calls.list).toHaveLength(0);
    expect(calls.query).toHaveLength(0);
  });

  test('reports collection progress per page', async () => {
    const progress = [];
    const { api } = pagedApi([[msg(1), msg(2)], [msg(3)]]);
    await collectFolderMessageIds(api, INBOX, { onProgress: p => progress.push(p.collected) });
    expect(progress).toEqual([2, 3]);
  });

  test('works without messages.abortList (older Thunderbird)', async () => {
    const { api } = pagedApi([[msg(1), msg(2)], [msg(3)]], { abortList: undefined });
    const out = await collectFolderMessageIds(api, INBOX, { limit: 1 });
    expect(out).toMatchObject({ messageIds: [1], excluded: 2, truncated: true });
  });

  test('cancellation while the first page is pending returns a cancelled result', async () => {
    const controller = new AbortController();
    let resolveList;
    const abortCalls = [];
    const api = {
      messages: {
        list: () => new Promise(resolve => { resolveList = resolve; }),
        continueList: async () => { throw new Error('must not paginate'); },
        abortList: async id => { abortCalls.push(id); },
      },
    };
    const promise = collectFolderMessageIds(api, INBOX, { signal: controller.signal });
    controller.abort();
    await expect(promise).resolves.toEqual({ messageIds: [], accountIds: [], excluded: 0, truncated: false, cancelled: true, folders: [] });
    resolveList({ messages: [msg(1)], id: 'list-1' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(abortCalls).toEqual(['list-1']);
  });

});

describe('folder analysis end to end (large synthetic folder)', () => {
  const HEADERS = {
    from: ['Alice <alice@example.com>'],
    'message-id': ['<abc@example.com>'],
    'authentication-results': ['mx.example.net; spf=fail smtp.mailfrom=alice@example.com'],
  };

  function syntheticFolder(total, { failIds = new Set(), dateOf = () => new Date('2026-11-10T12:00:00Z') } = {}) {
    const pages = [];
    for (let i = 0; i < total; i += 1000) {
      pages.push(Array.from({ length: Math.min(1000, total - i) }, (_, j) => msg(i + j + 1, INBOX, dateOf(i + j + 1))));
    }
    const { api, calls } = pagedApi(pages);
    const headerReads = [];
    api.messages.getHeaders = async id => {
      headerReads.push(id);
      if (failIds.has(id)) throw new Error('read failed');
      return HEADERS;
    };
    api.messages.get = async id => ({ id, folder: INBOX });
    return { api, calls, headerReads };
  }

  const assess = async ({ headers }) => ({
    result: {
      score: 60,
      classification: 'review',
      scoreReasons: headers ? [{ key: 'auth.spf.fail', delta: 60, layer: 'L1' }] : [],
    },
  });

  async function run(api, scopeOpts, maxMessages, signal) {
    const scope = await collectFolderMessageIds(api, INBOX, scopeOpts);
    const report = await analyzeMessagesForRuleReport(scope.messageIds, {
      accountIds: scope.accountIds,
      loadSnapshot: async () => ({}),
      readMessage: createMessageReader(api),
      assess,
      maxMessages,
      signal,
    });
    return { scope, report };
  }

  test('reads raw headers only for messages selected for analysis', async () => {
    const failIds = new Set([2, 5]);
    const { api, headerReads } = syntheticFolder(25000, { failIds });
    const { scope, report } = await run(api, { limit: 300 }, 300);
    expect(scope).toMatchObject({ excluded: 25000 - 300, truncated: true });
    expect(headerReads).toHaveLength(300);
    expect(Math.max(...headerReads)).toBe(300);
    // Failed reads consume a slot and stay separate from cap exclusions.
    expect(report).toMatchObject({ requested: 300, analyzed: 298, failed: 2, overLimit: 0 });
    expect(report.rules.find(r => r.key === 'auth.spf.fail').matchCount).toBe(298);
  });

  test('a sent-date range with a cap reads only in-range messages up to the cap', async () => {
    // Odd IDs fall in November 2026, even IDs in 2025.
    const dateOf = id => (id % 2 ? new Date(2026, 10, 15) : new Date(2025, 0, 1));
    const { api, headerReads } = syntheticFolder(20000, { dateOf });
    const { fromDate, toDate } = parseSentDateRange('2026-11-01', '2026-11-30');
    const { scope } = await run(api, { fromDate, toDate, limit: 50 }, 50);
    expect(headerReads).toHaveLength(50);
    expect(headerReads.every(id => id % 2 === 1)).toBe(true);
    expect(scope.excluded).toBe(10000 - 50);
  });

  test('no user limit analyzes up to the hard ceiling', async () => {
    const { api, headerReads } = syntheticFolder(RULE_MATCH_HARD_LIMIT + 10);
    const { scope, report } = await run(api, { limit: null }, null);
    expect(headerReads).toHaveLength(RULE_MATCH_HARD_LIMIT);
    expect(scope.excluded).toBe(10);
    expect(report).toMatchObject({ analyzed: RULE_MATCH_HARD_LIMIT, limit: RULE_MATCH_HARD_LIMIT });
    expect(report.rules.find(r => r.key === 'auth.spf.fail').messages).toHaveLength(RULE_MATCH_HARD_LIMIT);
  });

  test('cancellation during a large run stops further header reads', async () => {
    const { api, headerReads } = syntheticFolder(RULE_MATCH_HARD_LIMIT);
    const signal = { aborted: false };
    const original = api.messages.getHeaders;
    api.messages.getHeaders = async id => {
      if (headerReads.length >= 100) signal.aborted = true;
      return original(id);
    };
    const { report } = await run(api, { limit: null }, null, signal);
    expect(report.cancelled).toBe(true);
    expect(headerReads.length).toBeLessThan(110);
    expect(report.analyzed + report.skipped).toBe(RULE_MATCH_HARD_LIMIT);
  });
});

describe('createScopeRegistry', () => {
  test('returns stored scopes by token and null for unknown tokens', () => {
    const reg = createScopeRegistry();
    const token = reg.add({ kind: 'folder' });
    expect(reg.get(token)).toEqual({ kind: 'folder' });
    expect(reg.get('nope')).toBeNull();
    expect(reg.get(undefined)).toBeNull();
  });

  test('is bounded, evicting the oldest scope', () => {
    const reg = createScopeRegistry({ maxEntries: 2 });
    const a = reg.add({ n: 1 });
    const b = reg.add({ n: 2 });
    const c = reg.add({ n: 3 });
    expect(reg.size).toBe(2);
    expect(reg.get(a)).toBeNull();
    expect(reg.get(b)).toEqual({ n: 2 });
    expect(reg.get(c)).toEqual({ n: 3 });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe('parseSentDateRange across a midnight DST transition', () => {
  test('Through date ends at its own last millisecond in America/Havana', () => {
    const moduleUrl = pathToFileURL(`${process.cwd()}/src/modules/ruleMatchScope.js`).href;
    const script = `
      const { parseSentDateRange } = await import(${JSON.stringify(moduleUrl)});
      const { fromDate, toDate } = parseSentDateRange('2026-03-07', '2026-03-07');
      console.log(JSON.stringify({
        from: fromDate.getTime(),
        to: toDate.getTime(),
        nextStart: new Date(2026, 2, 8, 1, 0, 0, 0).getTime(),
        nextDay0130: new Date(2026, 2, 8, 1, 30).getTime(),
      }));`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: 'America/Havana' },
      encoding: 'utf8',
    });
    const r = JSON.parse(out);
    expect(r.to).toBe(r.nextStart - 1);
    expect(r.to).toBeGreaterThan(r.from);
    expect(r.nextDay0130).toBeGreaterThan(r.to);
  });
});
