import {
  MAX_RULE_MATCH_BATCH,
  RULE_MATCH_HARD_LIMIT,
  analyzeMessagesForRuleReport,
  resolveRuleMatchLimit,
  runRuleMatchAnalysis,
  serveRuleMatchReportPort,
  createMessageReader,
} from '../src/modules/ruleMatchAnalysis.js';
import { assessMessage } from '../src/modules/messageAssessment.js';
import { DEFAULTS } from '../src/modules/storage.js';

function snapshot(settings = {}) {
  const data = structuredClone(DEFAULTS);
  data.trustedDomains = [{ value: 'mx.example.net', matchType: 'exact' }];
  data.settings = { ...data.settings, ...settings };
  return data;
}

const FAILING = {
  from: ['Alice <alice@example.com>'],
  'message-id': ['<abc@example.com>'],
  'authentication-results': [
    'mx.example.net; spf=fail smtp.mailfrom=alice@example.com; dkim=none; dmarc=fail header.from=example.com',
  ],
};

const DOUBLE_UNTRUSTED = {
  from: ['Bob <bob@example.org>'],
  'message-id': ['<def@example.org>'],
  'authentication-results': [
    'mx.untrusted-a.test; spf=pass smtp.mailfrom=bob@example.org',
    'mx.untrusted-b.test; dkim=pass header.d=example.org',
  ],
};

function readerFor(map) {
  return async id => (id in map ? { accountId: 'account1', headers: map[id] } : null);
}

function totalsAddUp(report) {
  return report.analyzed + report.failed + report.skipped + report.overLimit === report.requested;
}

describe('analyzeMessagesForRuleReport', () => {
  test('reassesses old messages with the current settings snapshot, loaded once', async () => {
    let loads = 0;
    const data = snapshot();
    // decisionLog is empty: no historical entry is needed.
    const report = await analyzeMessagesForRuleReport([1, 2], {
      loadSnapshot: async () => { loads++; return data; },
      readMessage: readerFor({ 1: FAILING, 2: FAILING }),
    });
    expect(loads).toBe(1);
    expect(report).toMatchObject({ requested: 2, analyzed: 2, failed: 0, skipped: 0, cancelled: false });
    expect(report.layers).toEqual(['L1', 'L2', 'L3', 'L4', 'L5']);

    const direct = await assessMessage({ headers: FAILING, accountId: 'account1', data });
    const spf = report.rules.find(r => r.key === 'auth.spf.fail');
    expect(spf.matchCount).toBe(2);
    expect(spf.messages.map(m => m.messageId)).toEqual([1, 2]);
    expect(spf.messages[0].score).toBe(direct.result.score);
    expect(spf.messages[0].classification).toBe(direct.result.classification);
    // Every reason key from the direct assessment appears in the report.
    const reportKeys = report.rules.map(r => r.key);
    for (const r of direct.result.scoreReasons) expect(reportKeys).toContain(r.key);
  });

  test('uses the settings snapshot rather than any historical result', async () => {
    const zeroSpf = snapshot();
    zeroSpf.settings.authScores.spf.fail = 0;
    zeroSpf.decisionLog = [{ score: 999, scoreReasons: [{ key: 'sender.rule', delta: 999 }] }];

    const report = await analyzeMessagesForRuleReport([1], {
      loadSnapshot: async () => zeroSpf,
      readMessage: readerFor({ 1: FAILING }),
    });
    const direct = await assessMessage({ headers: FAILING, accountId: 'account1', data: zeroSpf });
    const spf = report.rules.find(r => r.key === 'auth.spf.fail');
    // Explicit zero-delta match is still counted.
    expect(spf).toMatchObject({ matchCount: 1, zeroDeltaMatchCount: 1, totalDelta: 0 });
    expect(spf.messages[0].score).toBe(direct.result.score);
    expect(report.rules.some(r => r.key === 'sender.rule')).toBe(false);
  });

  test('does not flag a pass rule as diagnostic when its configured score is nonzero', async () => {
    const PASSING = {
      from: ['Alice <alice@example.com>'],
      'message-id': ['<pass@example.com>'],
      'authentication-results': ['mx.example.net; spf=pass smtp.mailfrom=alice@example.com'],
    };
    const defaults = await analyzeMessagesForRuleReport([1], {
      loadSnapshot: async () => snapshot(),
      readMessage: readerFor({ 1: PASSING }),
    });
    expect(defaults.rules.find(r => r.key === 'auth.spf.pass')).toMatchObject({ diagnostic: true, totalDelta: 0 });

    const scored = snapshot();
    scored.settings.authScores.spf.pass = 20;
    const report = await analyzeMessagesForRuleReport([1], {
      loadSnapshot: async () => scored,
      readMessage: readerFor({ 1: PASSING }),
    });
    const direct = await assessMessage({ headers: PASSING, accountId: 'account1', data: scored });
    const pass = report.rules.find(r => r.key === 'auth.spf.pass');
    expect(pass).toMatchObject({ diagnostic: false, type: 'risk', totalDelta: 20, zeroDeltaMatchCount: 0 });
    expect(pass.messages[0].score).toBe(direct.result.score);
  });

  test('counts duplicate reasons once per message and each message individually', async () => {
    const report = await analyzeMessagesForRuleReport([5, 6], {
      loadSnapshot: async () => snapshot(),
      readMessage: readerFor({ 5: DOUBLE_UNTRUSTED, 6: DOUBLE_UNTRUSTED }),
    });
    const untrusted = report.rules.find(r => r.key === 'authserv.untrusted');
    expect(untrusted).toMatchObject({ matchCount: 2, diagnostic: true, layer: 'L1' });
    expect(untrusted.messages.map(m => m.occurrences)).toEqual([2, 2]);
  });

  test('accounts failed reads separately and never as zero-score messages', async () => {
    const report = await analyzeMessagesForRuleReport([1, 2, 3, 4], {
      loadSnapshot: async () => snapshot(),
      readMessage: async id => {
        if (id === 2) throw new Error('boom');
        if (id === 3) return null;
        return { accountId: null, headers: FAILING };
      },
      concurrency: 2,
    });
    expect(report).toMatchObject({ requested: 4, analyzed: 2, failed: 2, skipped: 0 });
    expect(report.failedMessages).toEqual([
      { messageId: 2, reason: 'read-failed' },
      { messageId: 3, reason: 'not-found' },
    ]);
    const classifiedTotal = Object.values(report.classifications).reduce((a, b) => a + b, 0);
    expect(classifiedTotal).toBe(2);
    for (const rule of report.rules) {
      for (const m of rule.messages) expect([1, 4]).toContain(m.messageId);
    }
    expect(totalsAddUp(report)).toBe(true);
  });

  test('reports assessment errors as failures', async () => {
    const report = await analyzeMessagesForRuleReport([1], {
      loadSnapshot: async () => snapshot(),
      readMessage: readerFor({ 1: FAILING }),
      assess: async () => { throw new Error('bad'); },
    });
    expect(report.failedMessages).toEqual([{ messageId: 1, reason: 'assessment-failed' }]);
    expect(report.rules).toEqual([]);
  });

  test('skips invalid and duplicate IDs and counts over-limit IDs separately', async () => {
    const report = await analyzeMessagesForRuleReport([1, 1, 'x', -1, 2, 3], {
      loadSnapshot: async () => snapshot(),
      readMessage: readerFor({ 1: FAILING, 2: FAILING, 3: FAILING }),
      maxMessages: 2,
    });
    expect(report).toMatchObject({ requested: 6, analyzed: 2, skipped: 3, overLimit: 1, limit: 2, failed: 0 });
    expect(report.skippedMessages.map(s => s.reason).sort()).toEqual(
      ['duplicate', 'invalid-id', 'invalid-id'],
    );
    expect(totalsAddUp(report)).toBe(true);
  });

  test('the limit counts read attempts: failed reads consume a slot', async () => {
    const reads = [];
    const report = await analyzeMessagesForRuleReport([1, 2, 3, 4], {
      loadSnapshot: async () => snapshot(),
      readMessage: async id => {
        reads.push(id);
        if (id === 1) throw new Error('boom');
        return { accountId: 'account1', headers: FAILING };
      },
      maxMessages: 2,
    });
    expect(reads.sort()).toEqual([1, 2]);
    expect(report).toMatchObject({ requested: 4, analyzed: 1, failed: 1, skipped: 0, overLimit: 2 });
    expect(report.rules.find(r => r.key === 'auth.spf.fail').matchCount).toBe(1);
    expect(totalsAddUp(report)).toBe(true);
  });

  test('defaults to 1,000 messages and caps "No user limit" at the hard ceiling', async () => {
    const ids = Array.from({ length: RULE_MATCH_HARD_LIMIT + 5 }, (_, i) => i + 1);
    const readMessage = async () => ({ accountId: 'account1', headers: FAILING });
    const assess = async () => ({ result: { score: 0, classification: 'normal', scoreReasons: [] } });
    const byDefault = await analyzeMessagesForRuleReport(ids.slice(0, 1001), {
      loadSnapshot: async () => snapshot(), readMessage, assess, concurrency: 8,
    });
    expect(byDefault).toMatchObject({ analyzed: MAX_RULE_MATCH_BATCH, overLimit: 1, limit: MAX_RULE_MATCH_BATCH });
    const unlimited = await analyzeMessagesForRuleReport(ids, {
      loadSnapshot: async () => snapshot(), readMessage, assess, concurrency: 8, maxMessages: null,
    });
    expect(unlimited).toMatchObject({ analyzed: RULE_MATCH_HARD_LIMIT, overLimit: 5, limit: RULE_MATCH_HARD_LIMIT });
  });

  test.each([0, -1, 1.5, RULE_MATCH_HARD_LIMIT + 1, '10', NaN, Infinity])(
    'rejects an invalid analysis limit (%p) before reading anything',
    async maxMessages => {
      let reads = 0;
      await expect(analyzeMessagesForRuleReport([1], {
        loadSnapshot: async () => snapshot(),
        readMessage: async () => { reads++; return null; },
        maxMessages,
      })).rejects.toThrow(RangeError);
      expect(reads).toBe(0);
    },
  );

  test('does not load settings when there is nothing to analyze', async () => {
    let loads = 0;
    const report = await analyzeMessagesForRuleReport([], {
      loadSnapshot: async () => { loads++; return snapshot(); },
      readMessage: readerFor({}),
    });
    expect(loads).toBe(0);
    expect(report).toMatchObject({ requested: 0, analyzed: 0, failed: 0, skipped: 0, rules: [] });
  });

  test('rejects non-array input', async () => {
    await expect(analyzeMessagesForRuleReport(null, {})).rejects.toThrow(TypeError);
  });

  test('stops between messages on cancellation and reports the rest as skipped', async () => {
    const signal = { aborted: false };
    const progress = [];
    const report = await analyzeMessagesForRuleReport([1, 2, 3], {
      loadSnapshot: async () => snapshot(),
      readMessage: readerFor({ 1: FAILING, 2: FAILING, 3: FAILING }),
      concurrency: 1,
      signal,
      onProgress: p => { progress.push(p); signal.aborted = true; },
    });
    expect(report).toMatchObject({ requested: 3, analyzed: 1, failed: 0, skipped: 2, cancelled: true });
    expect(report.skippedMessages).toEqual([
      { messageId: 2, reason: 'cancelled' },
      { messageId: 3, reason: 'cancelled' },
    ]);
    expect(progress).toEqual([{ requested: 3, total: 3, completed: 1, analyzed: 1, failed: 0, skipped: 0, overLimit: 0 }]);
  });

  test('reads headers with bounded concurrency and reports progress per message', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const ids = Array.from({ length: 10 }, (_, i) => i + 1);
    const progress = [];
    const report = await analyzeMessagesForRuleReport(ids, {
      loadSnapshot: async () => snapshot(),
      readMessage: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(r => setTimeout(r, 2));
        inFlight--;
        return { accountId: null, headers: FAILING };
      },
      concurrency: 3,
      onProgress: p => progress.push(p.completed),
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(progress).toEqual(ids);
    expect(report.analyzed).toBe(10);
    expect(report.rules.find(r => r.key === 'auth.spf.fail').messages.map(m => m.messageId)).toEqual(ids);
  });

  test('memoizes lookups per run', async () => {
    const calls = [];
    await analyzeMessagesForRuleReport([1, 2, 3], {
      loadSnapshot: async () => snapshot(),
      readMessage: readerFor({ 1: FAILING, 2: FAILING, 3: FAILING }),
      lookups: { getAccountDomains: async id => { calls.push(id); return []; } },
    });
    expect(calls).toEqual(['account1']);
  });
});

function fakeBrowser(messages) {
  const writes = [];
  const record = name => async (...args) => { writes.push(name); return args; };
  return {
    writes,
    messages: {
      get: async function (id) { this._reads.push(['get', id]); return messages[id] ? { id, folder: { accountId: 'account1' } } : null; },
      getFull: async function (id) { this._reads.push(['getFull', id]); return { headers: messages[id], parts: [] }; },
      _reads: [],
      move: record('messages.move'),
      update: record('messages.update'),
      delete: record('messages.delete'),
    },
    notifications: { create: record('notifications.create') },
    storage: { local: { set: record('storage.local.set') } },
  };
}

describe('runRuleMatchAnalysis (read-only)', () => {
  test('uses only messages.get/getFull and leaves folders, flags, notifications, and storage unchanged', async () => {
    const api = fakeBrowser({ 1: FAILING, 2: DOUBLE_UNTRUSTED });
    const data = snapshot();
    const before = structuredClone(data);
    const report = await runRuleMatchAnalysis([1, 2, 3], {
      browserApi: api,
      loadSnapshot: async () => data,
    });
    expect(report).toMatchObject({ requested: 3, analyzed: 2, failed: 1 });
    expect(api.writes).toEqual([]);
    expect(data).toEqual(before);
    expect(api.messages._reads.map(r => r[0]).sort()).toEqual(['get', 'get', 'get', 'getFull', 'getFull']);
  });

  test('createMessageReader treats missing headers as a read failure', async () => {
    const reader = createMessageReader({
      messages: { get: async () => ({ folder: {} }), getFull: async () => ({}) },
    });
    await expect(reader(1)).rejects.toThrow();
  });
});

const SENDER_HEADERS = {
  from: ['"Support Team" <support@mail.example.com>'],
  sender: ['bounce@bulk.example.net'],
  'reply-to': ['help@example.org'],
  'return-path': ['<bounce@bulk.example.net>'],
  'message-id': ['<xyz@bulk.example.net>'],
  'authentication-results': [
    'mx.example.net; spf=softfail smtp.mailfrom=bulk.example.net; dkim=pass header.d=bulk.example.net; dmarc=fail header.from=example.com',
    'mx.untrusted.test; spf=pass smtp.mailfrom=example.com',
  ],
};

function fastBrowser(messages, { getHeaders, getFull } = {}) {
  const reads = [];
  return {
    reads,
    messages: {
      get: async id => { reads.push(['get', id]); return messages[id] ? { id, folder: { accountId: 'account1' } } : null; },
      getHeaders: getHeaders ?? (async id => {
        reads.push(['getHeaders', id]);
        if (!messages[id]) throw new Error(`Message not found: ${id}`);
        return structuredClone(messages[id]);
      }),
      getFull: getFull ?? (async id => {
        reads.push(['getFull', id]);
        if (!messages[id]) throw new Error(`Message not found: ${id}`);
        return { headers: structuredClone(messages[id]), parts: [] };
      }),
    },
  };
}

describe('createMessageReader fast path', () => {
  test('uses getHeaders instead of getFull when available', async () => {
    const api = fastBrowser({ 1: FAILING });
    const read = await createMessageReader(api)(1);
    expect(read).toEqual({ accountId: 'account1', headers: FAILING });
    expect(api.reads).toEqual([['get', 1], ['getHeaders', 1]]);
  });

  test('falls back to getFull on older Thunderbird without getHeaders', async () => {
    const api = fastBrowser({ 1: FAILING });
    delete api.messages.getHeaders;
    const read = await createMessageReader(api)(1);
    expect(read).toEqual({ accountId: 'account1', headers: FAILING });
    expect(api.reads).toEqual([['get', 1], ['getFull', 1]]);
  });

  test('a getHeaders error is a read failure and is not retried via getFull', async () => {
    const api = fastBrowser({ 1: FAILING }, { getHeaders: async () => { throw new Error('io error'); } });
    const report = await runRuleMatchAnalysis([1], { browserApi: api, loadSnapshot: async () => snapshot() });
    expect(report).toMatchObject({ analyzed: 0, failed: 1, failedMessages: [{ messageId: 1, reason: 'read-failed' }] });
    expect(api.reads.filter(r => r[0] === 'getFull')).toEqual([]);
  });

  test('missing getHeaders result is a read failure', async () => {
    const api = fastBrowser({ 1: FAILING }, { getHeaders: async () => null });
    await expect(createMessageReader(api)(1)).rejects.toThrow('message headers unavailable');
    expect(api.reads.filter(r => r[0] === 'getFull')).toEqual([]);
  });

  test('reads decoded RFC 2047 headers with getHeaders alone, matching getFull', async () => {
    // Both APIs decode encoded-words by default, so no second read is needed.
    const decoded = { ...FAILING, from: ['サポート <alice@example.com>'] };
    const fast = fastBrowser({ 1: decoded });
    const legacy = fastBrowser({ 1: decoded });
    delete legacy.messages.getHeaders;
    const [fastRead, legacyRead] = await Promise.all([
      createMessageReader(fast)(1),
      createMessageReader(legacy)(1),
    ]);
    expect(fastRead).toEqual(legacyRead);
    expect(fast.reads).toEqual([['get', 1], ['getHeaders', 1]]);
  });

  test('a known account ID skips messages.get', async () => {
    const api = fastBrowser({ 1: FAILING });
    const read = await createMessageReader(api)(1, 'account2');
    expect(read).toEqual({ accountId: 'account2', headers: FAILING });
    expect(api.reads).toEqual([['getHeaders', 1]]);
  });

  test('with a known account ID, a message deleted since enumeration is still not found', async () => {
    const api = fastBrowser({ 1: FAILING });
    const report = await runRuleMatchAnalysis([1, 2], {
      browserApi: api,
      accountIds: ['account1', 'account1'],
      loadSnapshot: async () => snapshot(),
    });
    expect(report).toMatchObject({ analyzed: 1, failed: 1, failedMessages: [{ messageId: 2, reason: 'not-found' }] });
  });

  test('with a known account ID, a read error on an existing message stays read-failed', async () => {
    const api = fastBrowser({ 1: FAILING }, { getHeaders: async () => { throw new Error('io error'); } });
    const report = await runRuleMatchAnalysis([1], {
      browserApi: api,
      accountIds: ['account1'],
      loadSnapshot: async () => snapshot(),
    });
    expect(report.failedMessages).toEqual([{ messageId: 1, reason: 'read-failed' }]);
  });

  test('getHeaders, getFull, and account-hinted paths produce identical reports', async () => {
    const messages = { 1: FAILING, 2: DOUBLE_UNTRUSTED, 3: SENDER_HEADERS };
    const data = snapshot();
    const run = (api, extra = {}) => runRuleMatchAnalysis([1, 2, 3, 4], {
      browserApi: api, loadSnapshot: async () => data, ...extra,
    });
    const legacy = fastBrowser(messages);
    delete legacy.messages.getHeaders;
    const strip = ({ timings, ...rest }) => rest;
    const slow = strip(await run(legacy));
    const fast = strip(await run(fastBrowser(messages)));
    const hinted = strip(await run(fastBrowser(messages), { accountIds: ['account1', 'account1', 'account1', 'account1'] }));
    expect(slow).toMatchObject({ requested: 4, analyzed: 3, failed: 1 });
    expect(fast).toEqual(slow);
    expect(hinted).toEqual(slow);
  });
});

describe('analyzeMessagesForRuleReport account hints and timings', () => {
  test('passes aligned account IDs to the reader and ignores invalid hints', async () => {
    const seen = [];
    await analyzeMessagesForRuleReport([1, 2, 3, 1], {
      loadSnapshot: async () => snapshot(),
      accountIds: ['a1', '', 42, 'dup'],
      readMessage: async (id, accountId) => { seen.push([id, accountId]); return { accountId: 'account1', headers: FAILING }; },
      concurrency: 1,
    });
    expect(seen).toEqual([[1, 'a1'], [2, null], [3, null]]);
  });

  test('reports non-negative local timings without message data', async () => {
    const report = await analyzeMessagesForRuleReport([1], {
      loadSnapshot: async () => snapshot(),
      readMessage: readerFor({ 1: FAILING }),
    });
    expect(Object.keys(report.timings).sort()).toEqual(['assessMs', 'elapsedMs', 'readMs']);
    for (const v of Object.values(report.timings)) expect(v).toBeGreaterThanOrEqual(0);
  });

  test('counts time spent in assessments that throw', async () => {
    const report = await analyzeMessagesForRuleReport([1], {
      loadSnapshot: async () => snapshot(),
      readMessage: readerFor({ 1: FAILING }),
      assess: async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
        throw new Error('bad');
      },
    });
    expect(report.failedMessages).toEqual([{ messageId: 1, reason: 'assessment-failed' }]);
    expect(report.timings.assessMs).toBeGreaterThanOrEqual(20);
  });
});

function fakePort() {
  const listeners = { message: [], disconnect: [] };
  return {
    posted: [],
    postMessage(msg) { this.posted.push(msg); },
    onMessage: { addListener: fn => listeners.message.push(fn) },
    onDisconnect: { addListener: fn => listeners.disconnect.push(fn) },
    send: msg => Promise.all(listeners.message.map(fn => fn(msg))),
    disconnect: () => listeners.disconnect.forEach(fn => fn()),
  };
}

describe('serveRuleMatchReportPort', () => {
  test('posts progress then the result for a start request', async () => {
    const port = fakePort();
    serveRuleMatchReportPort(port, async (ids, { onProgress }) => {
      onProgress({ completed: 1 });
      return { requested: ids.length };
    });
    await port.send({ type: 'start', messageIds: [1, 2] });
    expect(port.posted).toEqual([
      { type: 'progress', progress: { completed: 1 } },
      { type: 'result', report: { requested: 2 } },
    ]);
  });

  test('cancel and disconnect abort the signal; second start is ignored', async () => {
    const port = fakePort();
    const seen = [];
    serveRuleMatchReportPort(port, async (ids, { signal }) => {
      seen.push(signal);
      await port.send({ type: 'cancel' });
      return { aborted: signal.aborted };
    });
    await port.send({ type: 'start', messageIds: [] });
    await port.send({ type: 'start', messageIds: [] });
    expect(seen).toHaveLength(1);
    expect(port.posted).toEqual([{ type: 'result', report: { aborted: true } }]);

    const port2 = fakePort();
    let sig;
    serveRuleMatchReportPort(port2, async (ids, { signal }) => { sig = signal; port2.disconnect(); return {}; });
    await port2.send({ type: 'start', messageIds: [] });
    expect(sig.aborted).toBe(true);
  });

  test('forwards account IDs from the start request to the run', async () => {
    const port = fakePort();
    let received;
    serveRuleMatchReportPort(port, async (ids, { accountIds }) => { received = accountIds; return {}; });
    await port.send({ type: 'start', messageIds: [1], accountIds: ['account1'] });
    expect(received).toEqual(['account1']);
  });

  test('validates maxMessages at the port and forwards the effective limit', async () => {
    const received = [];
    const run = async (ids, { maxMessages }) => { received.push(maxMessages); return {}; };
    for (const maxMessages of [undefined, null, 250]) {
      const port = fakePort();
      serveRuleMatchReportPort(port, run);
      await port.send({ type: 'start', messageIds: [1], maxMessages });
    }
    expect(received).toEqual([MAX_RULE_MATCH_BATCH, RULE_MATCH_HARD_LIMIT, 250]);

    const port = fakePort();
    serveRuleMatchReportPort(port, run);
    await port.send({ type: 'start', messageIds: [1], maxMessages: RULE_MATCH_HARD_LIMIT + 1 });
    expect(received).toHaveLength(3);
    expect(port.posted).toEqual([{ type: 'error', error: expect.stringContaining('analysis limit') }]);
  });

  test('resolveRuleMatchLimit maps defaults and rejects out-of-range values', () => {
    expect(resolveRuleMatchLimit(undefined)).toBe(MAX_RULE_MATCH_BATCH);
    expect(resolveRuleMatchLimit(null)).toBe(RULE_MATCH_HARD_LIMIT);
    expect(resolveRuleMatchLimit(1)).toBe(1);
    expect(resolveRuleMatchLimit(RULE_MATCH_HARD_LIMIT)).toBe(RULE_MATCH_HARD_LIMIT);
    expect(() => resolveRuleMatchLimit(0)).toThrow(RangeError);
    expect(() => resolveRuleMatchLimit(RULE_MATCH_HARD_LIMIT + 1)).toThrow(RangeError);
  });

  test('posts an error message when the run throws', async () => {
    const port = fakePort();
    serveRuleMatchReportPort(port, async () => { throw new TypeError('messageIds must be an array'); });
    await port.send({ type: 'start' });
    expect(port.posted).toEqual([{ type: 'error', error: 'messageIds must be an array' }]);
  });
});
