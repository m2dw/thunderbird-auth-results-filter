import {
  deriveExportVerdict,
  buildUnknownExportState,
  buildExportPayload,
  normalizeRfcMessageId,
  buildHeaderMessageIdQueryValues,
  chooseBestMessageQueryResult,
} from '../src/modules/logExport.js';

// ─── normalizeRfcMessageId ────────────────────────────────────────────────────

describe('normalizeRfcMessageId', () => {
  test('strips angle brackets', () => {
    expect(normalizeRfcMessageId('<abc@example.com>')).toBe('abc@example.com');
  });

  test('real-world Message-ID with angle brackets', () => {
    expect(normalizeRfcMessageId('<20211203000000.151550283.1000.758486@mkrm.rakuten.com>'))
      .toBe('20211203000000.151550283.1000.758486@mkrm.rakuten.com');
  });

  test('value without angle brackets is unchanged', () => {
    expect(normalizeRfcMessageId('abc@example.com')).toBe('abc@example.com');
  });

  test('trims leading/trailing whitespace', () => {
    expect(normalizeRfcMessageId('  <abc@example.com>  ')).toBe('abc@example.com');
  });

  test('non-string passthrough', () => {
    expect(normalizeRfcMessageId(null)).toBe(null);
    expect(normalizeRfcMessageId(undefined)).toBe(undefined);
  });
});

// ─── buildHeaderMessageIdQueryValues ─────────────────────────────────────────

describe('buildHeaderMessageIdQueryValues', () => {
  test('bracketed value → two variants [raw, stripped]', () => {
    expect(buildHeaderMessageIdQueryValues('<abc@example.com>')).toEqual([
      '<abc@example.com>',
      'abc@example.com',
    ]);
  });

  test('non-bracketed value → one variant only (no duplicate)', () => {
    expect(buildHeaderMessageIdQueryValues('abc@example.com')).toEqual([
      'abc@example.com',
    ]);
  });

  test('real-world bracketed Message-ID → two variants', () => {
    const raw = '<20211203000000.151550283.1000.758486@mkrm.rakuten.com>';
    expect(buildHeaderMessageIdQueryValues(raw)).toEqual([
      raw,
      '20211203000000.151550283.1000.758486@mkrm.rakuten.com',
    ]);
  });

  test('empty string → empty array', () => {
    expect(buildHeaderMessageIdQueryValues('')).toEqual([]);
  });

  test('whitespace-only string → empty array', () => {
    expect(buildHeaderMessageIdQueryValues('   ')).toEqual([]);
  });

  test('non-string → empty array', () => {
    expect(buildHeaderMessageIdQueryValues(null)).toEqual([]);
    expect(buildHeaderMessageIdQueryValues(undefined)).toEqual([]);
  });
});

// ─── chooseBestMessageQueryResult ────────────────────────────────────────────

describe('chooseBestMessageQueryResult', () => {
  const msgA = { id: 1, folder: { accountId: 'acc-1', name: 'Inbox' } };
  const msgB = { id: 2, folder: { accountId: 'acc-2', name: 'Inbox' } };
  const msgC = { id: 3, folder: { accountId: 'acc-1', name: 'Junk' } };

  test('returns null for empty list', () => {
    expect(chooseBestMessageQueryResult([], 'acc-1')).toBeNull();
  });

  test('returns null for null/undefined list', () => {
    expect(chooseBestMessageQueryResult(null, 'acc-1')).toBeNull();
    expect(chooseBestMessageQueryResult(undefined, 'acc-1')).toBeNull();
  });

  test('prefers message from matching accountId', () => {
    expect(chooseBestMessageQueryResult([msgB, msgA], 'acc-1')).toBe(msgA);
  });

  test('returns first message when no accountId match', () => {
    expect(chooseBestMessageQueryResult([msgA, msgB], 'acc-99')).toBe(msgA);
  });

  test('returns first message when initialAccountId is null', () => {
    expect(chooseBestMessageQueryResult([msgB, msgA], null)).toBe(msgB);
  });

  test('prefers first matching account when multiple messages share same accountId', () => {
    expect(chooseBestMessageQueryResult([msgB, msgA, msgC], 'acc-1')).toBe(msgA);
  });

  test('single message always returned regardless of accountId', () => {
    expect(chooseBestMessageQueryResult([msgA], 'acc-99')).toBe(msgA);
    expect(chooseBestMessageQueryResult([msgA], null)).toBe(msgA);
  });

  test('message with no folder does not crash', () => {
    const noFolder = { id: 4, folder: null };
    expect(chooseBestMessageQueryResult([noFolder], 'acc-1')).toBe(noFolder);
  });
});

// ─── deriveExportVerdict ──────────────────────────────────────────────────────

describe('deriveExportVerdict', () => {
  test('junk folder type → spam', () => {
    expect(deriveExportVerdict({ type: 'junk', name: 'Junk' })).toBe('spam');
  });

  test('folder named "Auth Review" → undecided', () => {
    expect(deriveExportVerdict({ type: 'other', name: 'Auth Review' })).toBe('undecided');
  });

  test('Auth Review name takes precedence over junk folder type (new precedence)', () => {
    // Per issue #65: review folder checks come before the folder-type junk fallback.
    // When junk flag is unavailable (null), Auth Review name wins over folder type junk.
    expect(deriveExportVerdict({ type: 'junk', name: 'Auth Review' })).toBe('undecided');
  });

  test('inbox folder → ham', () => {
    expect(deriveExportVerdict({ type: 'inbox', name: 'Inbox' })).toBe('ham');
  });

  test('normal folder → ham', () => {
    expect(deriveExportVerdict({ type: 'other', name: 'Archive' })).toBe('ham');
  });

  test('null folder → unknown', () => {
    expect(deriveExportVerdict(null)).toBe('unknown');
  });

  test('undefined folder → unknown', () => {
    expect(deriveExportVerdict(undefined)).toBe('unknown');
  });

  test('empty object folder (no type/name) → ham (not unknown)', () => {
    // A found folder with no recognisable type/name defaults to ham
    expect(deriveExportVerdict({})).toBe('ham');
  });

  // ── Configured review folder IDs (P2 fix) ──

  test('folder ID in reviewFolderIds → undecided regardless of name', () => {
    const reviewFolderIds = new Set(['folder-review-42']);
    expect(deriveExportVerdict(
      { type: 'other', name: 'My Mail Reviews', id: 'folder-review-42' },
      reviewFolderIds,
    )).toBe('undecided');
  });

  test('folder ID not in reviewFolderIds and not named Auth Review → ham', () => {
    const reviewFolderIds = new Set(['folder-review-42']);
    expect(deriveExportVerdict(
      { type: 'other', name: 'Archive', id: 'folder-archive-99' },
      reviewFolderIds,
    )).toBe('ham');
  });

  test('configured reviewFolderIds takes precedence over junk folder type (new precedence)', () => {
    // Per issue #65: review folder check comes before the folder-type junk fallback.
    // When junk flag is unavailable, a folder in reviewFolderIds wins over type junk.
    const reviewFolderIds = new Set(['folder-review-42']);
    expect(deriveExportVerdict(
      { type: 'junk', name: 'Junk', id: 'folder-review-42' },
      reviewFolderIds,
    )).toBe('undecided');
  });

  test('Auth Review name fallback still works when reviewFolderIds is empty', () => {
    expect(deriveExportVerdict({ type: 'other', name: 'Auth Review' })).toBe('undecided');
  });

  test('multiple accounts: folder ID from either account matches', () => {
    const reviewFolderIds = new Set(['folder-acc1-review', 'folder-acc2-review']);
    expect(deriveExportVerdict(
      { type: 'other', name: 'Pending', id: 'folder-acc2-review' },
      reviewFolderIds,
    )).toBe('undecided');
  });

  // ── Junk flag precedence (Issue #65) ─────────────────────────────────────

  test('junk=true in a non-junk folder → spam', () => {
    expect(deriveExportVerdict(
      { type: 'other', name: 'Archive' },
      new Set(),
      true,
    )).toBe('spam');
  });

  test('junk=true in a configured review folder → spam (junk flag wins)', () => {
    const reviewFolderIds = new Set(['folder-review-42']);
    expect(deriveExportVerdict(
      { type: 'other', name: 'My Reviews', id: 'folder-review-42' },
      reviewFolderIds,
      true,
    )).toBe('spam');
  });

  test('junk=true overrides Auth Review name → spam', () => {
    expect(deriveExportVerdict(
      { type: 'other', name: 'Auth Review' },
      new Set(),
      true,
    )).toBe('spam');
  });

  test('junk=false in configured review folder → undecided (junk=false does not force ham)', () => {
    const reviewFolderIds = new Set(['folder-review-42']);
    expect(deriveExportVerdict(
      { type: 'other', name: 'My Reviews', id: 'folder-review-42' },
      reviewFolderIds,
      false,
    )).toBe('undecided');
  });

  test('junk=false in Auth Review folder → undecided', () => {
    expect(deriveExportVerdict(
      { type: 'other', name: 'Auth Review' },
      new Set(),
      false,
    )).toBe('undecided');
  });

  test('junk=false in normal folder → ham', () => {
    expect(deriveExportVerdict(
      { type: 'inbox', name: 'Inbox' },
      new Set(),
      false,
    )).toBe('ham');
  });

  test('junk=null in junk-type folder → spam (folder-type fallback)', () => {
    expect(deriveExportVerdict(
      { type: 'junk', name: 'Junk' },
      new Set(),
      null,
    )).toBe('spam');
  });

  test('junk=null, no folder → unknown', () => {
    expect(deriveExportVerdict(null, new Set(), null)).toBe('unknown');
  });

  test('junk=true, null folder → spam', () => {
    expect(deriveExportVerdict(null, new Set(), true)).toBe('spam');
  });

  test('omitting junk arg preserves legacy folder-type behavior', () => {
    expect(deriveExportVerdict({ type: 'junk', name: 'Junk' })).toBe('spam');
    expect(deriveExportVerdict({ type: 'other', name: 'Auth Review' })).toBe('undecided');
    expect(deriveExportVerdict({ type: 'inbox', name: 'Inbox' })).toBe('ham');
    expect(deriveExportVerdict(null)).toBe('unknown');
  });
});

// ─── buildUnknownExportState ──────────────────────────────────────────────────

describe('buildUnknownExportState', () => {
  test('found is false', () => {
    expect(buildUnknownExportState('not_found').found).toBe(false);
  });

  test('exportVerdict is unknown', () => {
    expect(buildUnknownExportState('not_found').exportVerdict).toBe('unknown');
  });

  test('reason is stored', () => {
    expect(buildUnknownExportState('no_message_id').reason).toBe('no_message_id');
    expect(buildUnknownExportState('lookup_error').reason).toBe('lookup_error');
  });

  test('default reason is not_found', () => {
    expect(buildUnknownExportState().reason).toBe('not_found');
  });
});

// ─── buildExportPayload ───────────────────────────────────────────────────────

describe('buildExportPayload', () => {
  const mockData = {
    settings: { moveToReview: true, authScores: {} },
  };
  const mockEntries = [
    { timestamp: 1000, score: 0, exportState: { found: false, exportVerdict: 'unknown', reason: 'not_found' } },
    { timestamp: 2000, score: 50, exportState: { found: true, exportVerdict: 'spam' } },
  ];

  test('schemaVersion is 1', () => {
    const p = buildExportPayload(mockData, mockEntries, '0.2.12');
    expect(p.schemaVersion).toBe(1);
  });

  test('exportedAt is an ISO string', () => {
    const p = buildExportPayload(mockData, mockEntries, '0.2.12');
    expect(typeof p.exportedAt).toBe('string');
    expect(() => new Date(p.exportedAt)).not.toThrow();
    expect(new Date(p.exportedAt).toISOString()).toBe(p.exportedAt);
  });

  test('addonVersion is stored', () => {
    const p = buildExportPayload(mockData, mockEntries, '0.2.12');
    expect(p.addonVersion).toBe('0.2.12');
  });

  test('settings are included', () => {
    const p = buildExportPayload(mockData, mockEntries, '0.2.12');
    expect(p.settings).toEqual(mockData.settings);
  });

  test('decisionLog entries are passed through with exportState', () => {
    const p = buildExportPayload(mockData, mockEntries, '0.2.12');
    expect(p.decisionLog).toHaveLength(2);
    expect(p.decisionLog[0].exportState.exportVerdict).toBe('unknown');
    expect(p.decisionLog[1].exportState.exportVerdict).toBe('spam');
  });

  test('entry without messageIdentity passes through safely', () => {
    // Simulates a legacy log entry that predates messageIdentity
    const legacyEntry = {
      timestamp: 500,
      score: 0,
      exportState: buildUnknownExportState('no_message_id'),
    };
    const p = buildExportPayload(mockData, [legacyEntry], '0.2.12');
    expect(p.decisionLog[0].exportState.exportVerdict).toBe('unknown');
    expect(p.decisionLog[0].exportState.reason).toBe('no_message_id');
  });

  test('settings fall back to empty object when absent from data', () => {
    const p = buildExportPayload({}, mockEntries, '0.2.12');
    expect(p.settings).toEqual({});
  });

  // ── domainParts preservation (Issue #54) ─────────────────────────────────

  test('preserves heuristicMetrics.fromDomain.domainParts through export', () => {
    const domainParts = {
      registrableDomain: 'ddjxlt.com',
      publicSuffix: 'com',
      subdomain: 'qsiysuud.notice',
      subdomainDepth: 2,
      isIcann: true,
      isPrivate: false,
    };
    const entry = {
      timestamp: 1000,
      fromDomain: 'qsiysuud.notice.ddjxlt.com',
      score: 20,
      heuristicMetrics: {
        fromDomain: { value: 'qsiysuud.notice.ddjxlt.com', domainParts },
        fromLocalPart: null,
        fromDomainLabels: [],
      },
      exportState: { found: false, exportVerdict: 'unknown', reason: 'not_found' },
    };
    const p = buildExportPayload({ settings: {} }, [entry], '0.2.6');
    const dp = p.decisionLog[0].heuristicMetrics.fromDomain.domainParts;
    expect(dp.registrableDomain).toBe('ddjxlt.com');
    expect(dp.publicSuffix).toBe('com');
    expect(dp.subdomain).toBe('qsiysuud.notice');
    expect(dp.subdomainDepth).toBe(2);
    expect(dp.isIcann).toBe(true);
    expect(dp.isPrivate).toBe(false);
  });

  test('preserves heuristicMetrics.fromDomain.domainParts for simple domain (example.com)', () => {
    const entry = {
      timestamp: 1000,
      fromDomain: 'example.com',
      score: 0,
      heuristicMetrics: {
        fromDomain: {
          value: 'example.com',
          domainParts: {
            registrableDomain: 'example.com',
            publicSuffix: 'com',
            subdomain: null,
            subdomainDepth: 0,
            isIcann: true,
            isPrivate: false,
          },
        },
        fromLocalPart: null,
        fromDomainLabels: [],
      },
      exportState: { found: false, exportVerdict: 'unknown', reason: 'not_found' },
    };
    const p = buildExportPayload({ settings: {} }, [entry], '0.2.6');
    const dp = p.decisionLog[0].heuristicMetrics.fromDomain.domainParts;
    expect(dp.registrableDomain).toBe('example.com');
    expect(dp.subdomainDepth).toBe(0);
    expect(dp.subdomain).toBeNull();
  });

  test('entry without heuristicMetrics passes through safely', () => {
    const entry = {
      timestamp: 1000,
      fromDomain: 'example.com',
      score: 0,
      exportState: { found: false, exportVerdict: 'unknown', reason: 'not_found' },
    };
    const p = buildExportPayload({ settings: {} }, [entry], '0.2.6');
    expect(p.decisionLog[0].heuristicMetrics).toBeUndefined();
  });
});
