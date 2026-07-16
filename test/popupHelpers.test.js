import { findLogEntryByRfcMessageId, findInboxFolder, isInReviewFolder, reasonContextPairs, buildWhitelistEntry, primaryReasons, buildProtectiveFacts } from '../src/modules/popupHelpers.js';

// ─── findLogEntryByRfcMessageId ───────────────────────────────────────────────

describe('findLogEntryByRfcMessageId', () => {
  const makeEntry = (rfcMessageId, extra = {}) => ({
    score: 0,
    classification: 'normal',
    messageIdentity: { rfcMessageId },
    ...extra,
  });

  test('returns null for null rfcMessageId', () =>
    expect(findLogEntryByRfcMessageId([], null)).toBeNull());

  test('returns null for undefined rfcMessageId', () =>
    expect(findLogEntryByRfcMessageId([], undefined)).toBeNull());

  test('returns null for empty string rfcMessageId', () =>
    expect(findLogEntryByRfcMessageId([], '')).toBeNull());

  test('returns null for whitespace-only rfcMessageId', () =>
    expect(findLogEntryByRfcMessageId([], '   ')).toBeNull());

  test('returns null for non-array decisionLog', () =>
    expect(findLogEntryByRfcMessageId(null, '<a@b.com>')).toBeNull());

  test('returns null when log is empty', () =>
    expect(findLogEntryByRfcMessageId([], '<a@b.com>')).toBeNull());

  test('returns matching entry', () => {
    const entry = makeEntry('<msg-1@example.com>');
    expect(findLogEntryByRfcMessageId([entry], '<msg-1@example.com>')).toBe(entry);
  });

  test('returns null when no entry matches', () => {
    const entry = makeEntry('<msg-1@example.com>');
    expect(findLogEntryByRfcMessageId([entry], '<msg-2@example.com>')).toBeNull();
  });

  test('returns first matching entry when multiple match', () => {
    const first = makeEntry('<dup@example.com>', { score: 10 });
    const second = makeEntry('<dup@example.com>', { score: 20 });
    expect(findLogEntryByRfcMessageId([first, second], '<dup@example.com>')).toBe(first);
  });

  test('trims whitespace from needle', () => {
    const entry = makeEntry('<msg@example.com>');
    expect(findLogEntryByRfcMessageId([entry], '  <msg@example.com>  ')).toBe(entry);
  });

  test('trims whitespace from stored rfcMessageId', () => {
    const entry = makeEntry('  <msg@example.com>  ');
    expect(findLogEntryByRfcMessageId([entry], '<msg@example.com>')).toBe(entry);
  });

  test('returns null when entry has null messageIdentity', () => {
    const entry = { messageIdentity: null };
    expect(findLogEntryByRfcMessageId([entry], '<a@b.com>')).toBeNull();
  });

  test('returns null when entry messageIdentity has null rfcMessageId', () => {
    const entry = { messageIdentity: { rfcMessageId: null } };
    expect(findLogEntryByRfcMessageId([entry], '<a@b.com>')).toBeNull();
  });

  test('returns null when entry has no messageIdentity property', () => {
    const entry = { score: 0 };
    expect(findLogEntryByRfcMessageId([entry], '<a@b.com>')).toBeNull();
  });

  test('matching is case-sensitive', () => {
    const entry = makeEntry('<Msg@Example.Com>');
    expect(findLogEntryByRfcMessageId([entry], '<msg@example.com>')).toBeNull();
    expect(findLogEntryByRfcMessageId([entry], '<Msg@Example.Com>')).toBe(entry);
  });

  test('skips non-matching entries before finding a match', () => {
    const a = makeEntry('<a@x.com>');
    const b = makeEntry('<b@x.com>');
    const c = makeEntry('<c@x.com>');
    expect(findLogEntryByRfcMessageId([a, b, c], '<c@x.com>')).toBe(c);
  });
});

// ─── findInboxFolder ─────────────────────────────────────────────────────────

describe('findInboxFolder', () => {
  test('returns null for null input', () =>
    expect(findInboxFolder(null)).toBeNull());

  test('returns null for empty array', () =>
    expect(findInboxFolder([])).toBeNull());

  test('finds inbox at top level', () => {
    const inbox = { type: 'inbox', id: 'f1', name: 'Inbox' };
    const folders = [{ type: 'sent', id: 'f0' }, inbox];
    expect(findInboxFolder(folders)).toBe(inbox);
  });

  test('finds inbox in subFolders', () => {
    const inbox = { type: 'inbox', id: 'f2', name: 'Inbox' };
    const folders = [
      { type: 'sent', id: 'f0', subFolders: [inbox] },
    ];
    expect(findInboxFolder(folders)).toBe(inbox);
  });

  test('finds inbox nested two levels deep', () => {
    const inbox = { type: 'inbox', id: 'deep' };
    const folders = [
      { type: 'sent', id: 'f0', subFolders: [
        { type: 'trash', id: 'f1', subFolders: [inbox] },
      ]},
    ];
    expect(findInboxFolder(folders)).toBe(inbox);
  });

  test('returns null when no inbox type exists', () => {
    const folders = [
      { type: 'sent', id: 'f0' },
      { type: 'trash', id: 'f1', subFolders: [{ type: 'drafts', id: 'f2' }] },
    ];
    expect(findInboxFolder(folders)).toBeNull();
  });

  test('handles folders with no subFolders property', () => {
    const inbox = { type: 'inbox', id: 'f1' };
    const folders = [{ type: 'sent', id: 'f0' }, inbox];
    expect(findInboxFolder(folders)).toBe(inbox);
  });

  test('handles subFolders: null gracefully', () => {
    const inbox = { type: 'inbox', id: 'f1' };
    const folders = [{ type: 'sent', id: 'f0', subFolders: null }, inbox];
    expect(findInboxFolder(folders)).toBe(inbox);
  });
});

// ─── reasonContextPairs ───────────────────────────────────────────────────────

describe('reasonContextPairs', () => {
  test('returns empty array for reason with only standard fields', () => {
    expect(reasonContextPairs({ key: 'auth.dmarc.fail', label: 'DMARC fail', delta: 25 })).toEqual([]);
  });

  test('returns extra fields as key-value pairs', () => {
    const reason = { key: 'auth.dmarc.fail', label: 'DMARC fail', delta: 25, authservId: 'mx.example.com' };
    expect(reasonContextPairs(reason)).toEqual([{ key: 'authservId', value: 'mx.example.com' }]);
  });

  test('converts non-string values to strings', () => {
    const reason = { key: 'k', label: 'l', delta: 0, count: 3 };
    expect(reasonContextPairs(reason)).toEqual([{ key: 'count', value: '3' }]);
  });

  test('converts array values to comma-separated string', () => {
    const reason = { key: 'k', label: 'l', delta: 0, dkimDomains: ['a.com', 'b.com'] };
    expect(reasonContextPairs(reason)).toEqual([{ key: 'dkimDomains', value: 'a.com, b.com' }]);
  });

  test('handles multiple extra context fields', () => {
    const reason = {
      key: 'identity.spfMailFromMismatch',
      label: 'SPF MAIL FROM differs from From',
      delta: 15,
      fromRegistrableDomain: 'example.com',
      spfMailFromDomain: 'sender.net',
    };
    const pairs = reasonContextPairs(reason);
    expect(pairs).toHaveLength(2);
    expect(pairs).toContainEqual({ key: 'fromRegistrableDomain', value: 'example.com' });
    expect(pairs).toContainEqual({ key: 'spfMailFromDomain', value: 'sender.net' });
  });

  test('does not include key, label, or delta in output', () => {
    const reason = { key: 'k', label: 'l', delta: 5, extra: 'yes' };
    const pairs = reasonContextPairs(reason);
    const keys = pairs.map(p => p.key);
    expect(keys).not.toContain('key');
    expect(keys).not.toContain('label');
    expect(keys).not.toContain('delta');
    expect(keys).toContain('extra');
  });

  test('handles empty object', () => {
    expect(reasonContextPairs({})).toEqual([]);
  });
});

// ─── isInReviewFolder ─────────────────────────────────────────────────────────

describe('isInReviewFolder', () => {
  const settings = {
    reviewFolders: { 'account1': 'folder-review-123' },
  };

  test('returns false for null folder', () =>
    expect(isInReviewFolder(null, settings)).toBe(false));

  test('returns false for undefined folder', () =>
    expect(isInReviewFolder(undefined, settings)).toBe(false));

  test('returns true when folder id matches configured reviewFolders entry', () =>
    expect(isInReviewFolder({ id: 'folder-review-123', accountId: 'account1', name: 'Auth Review' }, settings)).toBe(true));

  test('returns false when folder id does not match configured reviewFolders entry', () =>
    expect(isInReviewFolder({ id: 'folder-inbox-456', accountId: 'account1', name: 'INBOX' }, settings)).toBe(false));

  test('falls back to name check when account has no reviewFolders entry', () =>
    expect(isInReviewFolder({ id: 'some-id', accountId: 'account2', name: 'Auth Review' }, settings)).toBe(true));

  test('returns false when name is not Auth Review and no reviewFolders entry', () =>
    expect(isInReviewFolder({ id: 'some-id', accountId: 'account2', name: 'INBOX' }, settings)).toBe(false));

  test('returns false when folder name is Auth Review but id differs from configured id', () => {
    expect(isInReviewFolder({ id: 'wrong-id', accountId: 'account1', name: 'Auth Review' }, settings)).toBe(false);
  });

  test('returns true with null settings when folder name is Auth Review', () =>
    expect(isInReviewFolder({ id: 'x', accountId: 'a', name: 'Auth Review' }, null)).toBe(true));

  test('returns false with null settings when folder name is not Auth Review', () =>
    expect(isInReviewFolder({ id: 'x', accountId: 'a', name: 'INBOX' }, null)).toBe(false));

  test('returns false when folder name is undefined and no reviewFolders entry', () =>
    expect(isInReviewFolder({ id: 'x', accountId: 'account2' }, settings)).toBe(false));
});

// ─── buildWhitelistEntry ──────────────────────────────────────────────────────

describe('buildWhitelistEntry', () => {
  test('returns null for null input', () =>
    expect(buildWhitelistEntry(null)).toBeNull());

  test('returns null for undefined input', () =>
    expect(buildWhitelistEntry(undefined)).toBeNull());

  test('returns null for empty string', () =>
    expect(buildWhitelistEntry('')).toBeNull());

  test('returns null when address has no @ sign', () =>
    expect(buildWhitelistEntry('notanemail')).toBeNull());

  test('returns exact-match entry for valid address', () =>
    expect(buildWhitelistEntry('user@example.com')).toEqual({ value: 'user@example.com', matchType: 'exact' }));

  test('lowercases the address value', () =>
    expect(buildWhitelistEntry('User@Example.COM')).toEqual({ value: 'user@example.com', matchType: 'exact' }));

  test('trims surrounding whitespace', () =>
    expect(buildWhitelistEntry('  user@example.com  ')).toEqual({ value: 'user@example.com', matchType: 'exact' }));

  test('matchType is always exact', () =>
    expect(buildWhitelistEntry('a@b.com')?.matchType).toBe('exact'));
});

// ─── primaryReasons ───────────────────────────────────────────────────────────

describe('primaryReasons', () => {
  test('returns empty array for null input', () =>
    expect(primaryReasons(null)).toEqual([]));

  test('returns empty array for non-array input', () =>
    expect(primaryReasons('bad')).toEqual([]));

  test('returns empty array for empty array', () =>
    expect(primaryReasons([])).toEqual([]));

  test('excludes zero-delta reasons', () => {
    const reasons = [
      { key: 'authserv.untrusted', delta: 0, label: 'Untrusted authserv' },
      { key: 'auth.dmarc.fail', delta: 15, label: 'DMARC fail' },
    ];
    const result = primaryReasons(reasons);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('auth.dmarc.fail');
  });

  test('sorts by descending absolute delta', () => {
    const reasons = [
      { key: 'a', delta: 10 },
      { key: 'b', delta: 40 },
      { key: 'c', delta: 25 },
    ];
    const result = primaryReasons(reasons);
    expect(result.map(r => r.key)).toEqual(['b', 'c', 'a']);
  });

  test('treats negative deltas by absolute value', () => {
    const reasons = [
      { key: 'mitigation', delta: -30 },
      { key: 'signal', delta: 20 },
    ];
    const result = primaryReasons(reasons);
    expect(result[0].key).toBe('mitigation');
    expect(result[1].key).toBe('signal');
  });

  test('returns at most 3 by default', () => {
    const reasons = [
      { key: 'a', delta: 10 },
      { key: 'b', delta: 20 },
      { key: 'c', delta: 30 },
      { key: 'd', delta: 40 },
    ];
    expect(primaryReasons(reasons)).toHaveLength(3);
  });

  test('respects custom limit', () => {
    const reasons = [
      { key: 'a', delta: 10 },
      { key: 'b', delta: 20 },
      { key: 'c', delta: 30 },
      { key: 'd', delta: 40 },
    ];
    expect(primaryReasons(reasons, 2)).toHaveLength(2);
  });

  test('returns fewer than limit when not enough non-zero reasons', () => {
    const reasons = [
      { key: 'a', delta: 10 },
      { key: 'b', delta: 0 },
    ];
    expect(primaryReasons(reasons, 3)).toHaveLength(1);
  });

  test('does not mutate the input array', () => {
    const reasons = [
      { key: 'a', delta: 10 },
      { key: 'b', delta: 30 },
    ];
    const copy = [...reasons];
    primaryReasons(reasons);
    expect(reasons).toEqual(copy);
  });

  test('returns original reason objects (not copies)', () => {
    const r = { key: 'a', delta: 15, label: 'A' };
    expect(primaryReasons([r])[0]).toBe(r);
  });
});

// ─── buildProtectiveFacts ─────────────────────────────────────────────────────

describe('buildProtectiveFacts', () => {
  test('returns empty array for null entry', () =>
    expect(buildProtectiveFacts(null)).toEqual([]));

  test('returns empty array for non-object entry', () =>
    expect(buildProtectiveFacts('bad')).toEqual([]));

  test('returns empty array for empty entry with no score', () =>
    expect(buildProtectiveFacts({})).toEqual([]));

  test('includes mitigation fact for each negative-delta reason', () => {
    const entry = {
      score: 5,
      scoreReasons: [
        { key: 'composite.delegatedDkimAlignedRouteConsistent', delta: -30 },
        { key: 'auth.dmarc.fail', delta: 15 },
      ],
    };
    const facts = buildProtectiveFacts(entry);
    const mitigations = facts.filter(f => f.factKey === 'mitigation');
    expect(mitigations).toHaveLength(1);
    expect(mitigations[0]).toEqual({
      factKey: 'mitigation',
      scoreKey: 'composite.delegatedDkimAlignedRouteConsistent',
      delta: -30,
    });
  });

  test('does not include positive-delta reasons as mitigations', () => {
    const entry = {
      score: 15,
      scoreReasons: [{ key: 'auth.dmarc.fail', delta: 15 }],
    };
    const facts = buildProtectiveFacts(entry);
    expect(facts.every(f => f.factKey !== 'mitigation')).toBe(true);
  });

  test('does not include zero-delta reasons as mitigations', () => {
    const entry = {
      score: 0,
      scoreReasons: [{ key: 'authserv.untrusted', delta: 0 }],
    };
    const facts = buildProtectiveFacts(entry);
    expect(facts.every(f => f.factKey !== 'mitigation')).toBe(true);
  });

  test('includes multiple mitigation facts in order', () => {
    const entry = {
      score: 10,
      scoreReasons: [
        { key: 'composite.dkimAlignedLexicalMitigation', delta: -30 },
        { key: 'composite.dmarcFailDkimAlignedListMitigation', delta: -15 },
        { key: 'auth.dmarc.fail', delta: 15 },
      ],
    };
    const facts = buildProtectiveFacts(entry);
    const mitigations = facts.filter(f => f.factKey === 'mitigation');
    expect(mitigations).toHaveLength(2);
    expect(mitigations[0].scoreKey).toBe('composite.dkimAlignedLexicalMitigation');
    expect(mitigations[1].scoreKey).toBe('composite.dmarcFailDkimAlignedListMitigation');
  });

  test('includes dkimAligned fact when anyDkimAligned is true and risk reasons present', () => {
    const entry = {
      score: 15,
      scoreReasons: [{ key: 'auth.dmarc.fail', delta: 15 }],
      alignmentMetrics: { anyDkimAligned: true },
    };
    expect(buildProtectiveFacts(entry)).toContainEqual({ factKey: 'dkimAligned' });
  });

  test('omits dkimAligned fact when no risk reasons present', () => {
    const entry = {
      score: 0,
      scoreReasons: [],
      alignmentMetrics: { anyDkimAligned: true },
    };
    expect(buildProtectiveFacts(entry).some(f => f.factKey === 'dkimAligned')).toBe(false);
  });

  test('omits dkimAligned fact when anyDkimAligned is false', () => {
    const entry = {
      score: 15,
      scoreReasons: [{ key: 'auth.dmarc.fail', delta: 15 }],
      alignmentMetrics: { anyDkimAligned: false },
    };
    expect(buildProtectiveFacts(entry).some(f => f.factKey === 'dkimAligned')).toBe(false);
  });

  test('omits dkimAligned fact when alignmentMetrics is absent', () => {
    const entry = {
      score: 15,
      scoreReasons: [{ key: 'auth.dmarc.fail', delta: 15 }],
    };
    expect(buildProtectiveFacts(entry).some(f => f.factKey === 'dkimAligned')).toBe(false);
  });

  test('includes noTrustedAuth fact when only untrusted entries, no auth.* entries', () => {
    const entry = {
      score: 0,
      scoreReasons: [{ key: 'authserv.untrusted', delta: 0 }],
    };
    expect(buildProtectiveFacts(entry)).toContainEqual({ factKey: 'noTrustedAuth' });
  });

  test('omits noTrustedAuth fact when auth.* entries are present alongside untrusted', () => {
    const entry = {
      score: 15,
      scoreReasons: [
        { key: 'authserv.untrusted', delta: 0 },
        { key: 'auth.dmarc.fail', delta: 15 },
      ],
    };
    expect(buildProtectiveFacts(entry).some(f => f.factKey === 'noTrustedAuth')).toBe(false);
  });

  test('omits noTrustedAuth fact when no authserv.untrusted entry', () => {
    const entry = { score: 0, scoreReasons: [] };
    expect(buildProtectiveFacts(entry).some(f => f.factKey === 'noTrustedAuth')).toBe(false);
  });

  test('includes belowThreshold Review fact for score > 0 below reviewThreshold', () => {
    const entry = {
      score: 35,
      scoreReasons: [{ key: 'auth.dmarc.fail', delta: 35 }],
    };
    expect(buildProtectiveFacts(entry)).toContainEqual({
      factKey: 'belowThreshold',
      score: 35,
      threshold: 50,
      thresholdName: 'Review',
    });
  });

  test('includes belowThreshold High-risk fact for score between review and high-risk', () => {
    const entry = {
      score: 75,
      scoreReasons: [{ key: 'auth.spf.fail', delta: 75 }],
    };
    expect(buildProtectiveFacts(entry)).toContainEqual({
      factKey: 'belowThreshold',
      score: 75,
      threshold: 100,
      thresholdName: 'High-risk',
    });
  });

  test('omits belowThreshold fact when score is 0', () => {
    const entry = { score: 0, scoreReasons: [] };
    expect(buildProtectiveFacts(entry).some(f => f.factKey === 'belowThreshold')).toBe(false);
  });

  test('omits belowThreshold fact when score reaches the high-risk threshold', () => {
    const entry = { score: 100, scoreReasons: [{ key: 'auth.spf.fail', delta: 100 }] };
    expect(buildProtectiveFacts(entry).some(f => f.factKey === 'belowThreshold')).toBe(false);
  });

  test('omits belowThreshold fact when score exceeds the high-risk threshold', () => {
    const entry = { score: 150, scoreReasons: [{ key: 'auth.spf.fail', delta: 150 }] };
    expect(buildProtectiveFacts(entry).some(f => f.factKey === 'belowThreshold')).toBe(false);
  });

  test('respects custom reviewThreshold option', () => {
    const entry = { score: 30, scoreReasons: [{ key: 'auth.dmarc.fail', delta: 30 }] };
    const facts = buildProtectiveFacts(entry, { reviewThreshold: 40, highRiskThreshold: 80 });
    expect(facts).toContainEqual({
      factKey: 'belowThreshold',
      score: 30,
      threshold: 40,
      thresholdName: 'Review',
    });
  });

  test('mitigations appear before structural facts in output', () => {
    const entry = {
      score: 35,
      scoreReasons: [
        { key: 'composite.delegatedDkimAlignedRouteConsistent', delta: -30 },
        { key: 'auth.dmarc.fail', delta: 15 },
        { key: 'auth.spf.fail', delta: 50 },
      ],
      alignmentMetrics: { anyDkimAligned: false },
    };
    const facts = buildProtectiveFacts(entry);
    const mitigIdx = facts.findIndex(f => f.factKey === 'mitigation');
    const threshIdx = facts.findIndex(f => f.factKey === 'belowThreshold');
    expect(mitigIdx).toBeGreaterThanOrEqual(0);
    expect(threshIdx).toBeGreaterThan(mitigIdx);
  });

  test('handles null alignmentMetrics gracefully', () => {
    const entry = {
      score: 15,
      scoreReasons: [{ key: 'auth.dmarc.fail', delta: 15 }],
      alignmentMetrics: null,
    };
    expect(() => buildProtectiveFacts(entry)).not.toThrow();
  });

  test('handles non-object alignmentMetrics gracefully', () => {
    const entry = {
      score: 15,
      scoreReasons: [{ key: 'auth.dmarc.fail', delta: 15 }],
      alignmentMetrics: 'bad',
    };
    expect(() => buildProtectiveFacts(entry)).not.toThrow();
  });

  test('returns no facts for a clean entry with score 0 and no relevant conditions', () => {
    const entry = {
      score: 0,
      scoreReasons: [],
      alignmentMetrics: { anyDkimAligned: false },
    };
    expect(buildProtectiveFacts(entry)).toEqual([]);
  });
});
