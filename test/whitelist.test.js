import {
  matchesWhitelistEntry,
  applyManualWhitelist,
  applyAddressBookWhitelist,
  DEFAULT_WHITELIST_MITIGATION,
  DEFAULT_ADDRESS_BOOK_MITIGATION,
  MAX_WHITELIST_ENTRIES,
} from '../src/core/whitelist.js';
import {
  scoreMessage,
  recalculateScoreReasons,
  DEFAULT_AUTH_SCORES,
  DEFAULT_WHITELIST_MITIGATION as SCORING_DEFAULT,
  DEFAULT_ADDRESS_BOOK_MITIGATION as SCORING_AB_DEFAULT,
} from '../src/core/scoring.js';

describe('DEFAULT_WHITELIST_MITIGATION', () => {
  test('is -50', () => expect(DEFAULT_WHITELIST_MITIGATION).toBe(-50));
  test('scoring re-exports same value', () => expect(SCORING_DEFAULT).toBe(-50));
});

describe('MAX_WHITELIST_ENTRIES', () => {
  test('is a positive integer', () => {
    expect(Number.isInteger(MAX_WHITELIST_ENTRIES)).toBe(true);
    expect(MAX_WHITELIST_ENTRIES).toBeGreaterThan(0);
  });
  test('is 100', () => expect(MAX_WHITELIST_ENTRIES).toBe(100));
});

describe('matchesWhitelistEntry', () => {
  test('exact match — same address', () =>
    expect(matchesWhitelistEntry('user@example.com', { value: 'user@example.com', matchType: 'exact' })).toBe(true));

  test('exact match — case-insensitive', () =>
    expect(matchesWhitelistEntry('User@Example.COM', { value: 'user@example.com', matchType: 'exact' })).toBe(true));

  test('exact match — different address returns false', () =>
    expect(matchesWhitelistEntry('other@example.com', { value: 'user@example.com', matchType: 'exact' })).toBe(false));

  test('unknown matchType returns false', () =>
    expect(matchesWhitelistEntry('user@example.com', { value: 'user@example.com', matchType: 'domain' })).toBe(false));

  test('domain-only entry does not match full address', () =>
    expect(matchesWhitelistEntry('user@example.com', { value: 'example.com', matchType: 'exact' })).toBe(false));
});

describe('applyManualWhitelist', () => {
  test('no entries → score 0, empty reasons', () => {
    const r = applyManualWhitelist({ senderAddress: 'user@example.com', whitelistEntries: [] });
    expect(r.score).toBe(0);
    expect(r.scoreReasons).toEqual([]);
  });

  test('matching entry → default mitigation -50', () => {
    const r = applyManualWhitelist({
      senderAddress: 'user@example.com',
      whitelistEntries: [{ value: 'user@example.com', matchType: 'exact' }],
    });
    expect(r.score).toBe(-50);
    expect(r.scoreReasons).toHaveLength(1);
    expect(r.scoreReasons[0].key).toBe('whitelist.manual');
    expect(r.scoreReasons[0].delta).toBe(-50);
    expect(r.scoreReasons[0].matchedValue).toBe('user@example.com');
    expect(r.scoreReasons[0].matchType).toBe('exact');
    expect(r.scoreReasons[0].label).toBe('Manual whitelist');
  });

  test('configurable -100 mitigation', () => {
    const r = applyManualWhitelist({
      senderAddress: 'user@example.com',
      whitelistEntries: [{ value: 'user@example.com', matchType: 'exact' }],
      mitigationScore: -100,
    });
    expect(r.score).toBe(-100);
    expect(r.scoreReasons[0].delta).toBe(-100);
  });

  test('no match → score 0', () => {
    const r = applyManualWhitelist({
      senderAddress: 'other@example.com',
      whitelistEntries: [{ value: 'user@example.com', matchType: 'exact' }],
    });
    expect(r.score).toBe(0);
    expect(r.scoreReasons).toHaveLength(0);
  });

  test('first matching entry fires; only one reason added', () => {
    const r = applyManualWhitelist({
      senderAddress: 'user@example.com',
      whitelistEntries: [
        { value: 'user@example.com', matchType: 'exact' },
        { value: 'user@example.com', matchType: 'exact' },
      ],
    });
    expect(r.scoreReasons).toHaveLength(1);
  });
});

describe('scoreMessage — whitelist integration', () => {
  const base = {
    trustedDomains: [{ value: 'example.com', matchType: 'domain' }],
    senderDomain: 'example.com',
    senderLocalPart: 'user',
    senderDomainRules: [],
    parsedAuthResults: [],
    authScores: DEFAULT_AUTH_SCORES,
  };

  test('whitelisted sender reduces score by default -50', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [
        { authservId: 'mail.example.com', results: [{ method: 'dmarc', result: 'fail' }] },
      ],
      whitelistEntries: [{ value: 'user@example.com', matchType: 'exact' }],
    });
    // dmarc.fail = 40, whitelist = -50 → net = -10
    expect(r.scoreReasons.some(r => r.key === 'whitelist.manual')).toBe(true);
    const wlReason = r.scoreReasons.find(r => r.key === 'whitelist.manual');
    expect(wlReason.delta).toBe(-50);
  });

  test('configurable -100 mitigation in scoreMessage', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [
        { authservId: 'mail.example.com', results: [{ method: 'dmarc', result: 'fail' }] },
      ],
      whitelistEntries: [{ value: 'user@example.com', matchType: 'exact' }],
      whitelistMitigationScore: -100,
    });
    const wlReason = r.scoreReasons.find(r => r.key === 'whitelist.manual');
    expect(wlReason.delta).toBe(-100);
  });

  test('non-matching address — no whitelist reason', () => {
    const r = scoreMessage({
      ...base,
      whitelistEntries: [{ value: 'other@example.com', matchType: 'exact' }],
    });
    expect(r.scoreReasons.some(r => r.key === 'whitelist.manual')).toBe(false);
  });

  test('empty whitelistEntries — no whitelist reason', () => {
    const r = scoreMessage({ ...base, whitelistEntries: [] });
    expect(r.scoreReasons.some(r => r.key === 'whitelist.manual')).toBe(false);
  });

  test('whitelist does not hard-bypass — score can still be positive', () => {
    // spf.fail=60, whitelist=-50 → net=10, still normal but score is positive
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [
        {
          authservId: 'mail.example.com',
          results: [
            { method: 'spf', result: 'fail' },
            { method: 'dmarc', result: 'fail' },
          ],
        },
      ],
      whitelistEntries: [{ value: 'user@example.com', matchType: 'exact' }],
    });
    // spf.fail=60 + dmarc.fail=40 - whitelist=50 = 50 (review) or lower depending on L3
    expect(r.scoreReasons.some(r => r.key === 'whitelist.manual')).toBe(true);
    // Score is not zero — whitelist is not a hard bypass
    const wlDelta = r.scoreReasons.find(r => r.key === 'whitelist.manual').delta;
    expect(wlDelta).toBe(-50);
  });
});

describe('recalculateScoreReasons — whitelist.manual', () => {
  test('re-derives delta from current whitelistMitigationScore', () => {
    const entry = {
      scoreReasons: [{ key: 'whitelist.manual', label: 'Manual whitelist', delta: -50, matchedValue: 'u@e.com', matchType: 'exact' }],
    };
    const result = recalculateScoreReasons(entry, { whitelistMitigationScore: -100 });
    expect(result[0].currentDelta).toBe(-100);
    expect(result[0].deltaChanged).toBe(true);
  });

  test('unchanged when mitigation score matches stored delta', () => {
    const entry = {
      scoreReasons: [{ key: 'whitelist.manual', delta: -50 }],
    };
    const result = recalculateScoreReasons(entry, { whitelistMitigationScore: -50 });
    expect(result[0].currentDelta).toBe(-50);
    expect(result[0].deltaChanged).toBe(false);
  });

  test('defaults to -50 when whitelistMitigationScore not provided', () => {
    const entry = {
      scoreReasons: [{ key: 'whitelist.manual', delta: -50 }],
    };
    const result = recalculateScoreReasons(entry);
    expect(result[0].currentDelta).toBe(-50);
  });
});

describe('DEFAULT_ADDRESS_BOOK_MITIGATION', () => {
  test('is -50', () => expect(DEFAULT_ADDRESS_BOOK_MITIGATION).toBe(-50));
  test('scoring re-exports same value', () => expect(SCORING_AB_DEFAULT).toBe(-50));
});

describe('applyAddressBookWhitelist', () => {
  test('not in address book → score 0, empty reasons', () => {
    const r = applyAddressBookWhitelist({ isInAddressBook: false });
    expect(r.score).toBe(0);
    expect(r.scoreReasons).toEqual([]);
  });

  test('in address book → default mitigation -50', () => {
    const r = applyAddressBookWhitelist({ isInAddressBook: true });
    expect(r.score).toBe(-50);
    expect(r.scoreReasons).toHaveLength(1);
    expect(r.scoreReasons[0].key).toBe('whitelist.addressBook');
    expect(r.scoreReasons[0].delta).toBe(-50);
    expect(r.scoreReasons[0].label).toBe('Address book contact');
  });

  test('configurable mitigation score', () => {
    const r = applyAddressBookWhitelist({ isInAddressBook: true, mitigationScore: -75 });
    expect(r.score).toBe(-75);
    expect(r.scoreReasons[0].delta).toBe(-75);
  });
});

describe('scoreMessage — address-book whitelist integration', () => {
  const base = {
    trustedDomains: [{ value: 'example.com', matchType: 'domain' }],
    senderDomain: 'example.com',
    senderLocalPart: 'user',
    senderDomainRules: [],
    parsedAuthResults: [],
    authScores: DEFAULT_AUTH_SCORES,
  };

  test('disabled (default) — no address-book reason even when isInAddressBook true', () => {
    // isInAddressBook default is false, so no reason is added
    const r = scoreMessage({ ...base });
    expect(r.scoreReasons.some(r => r.key === 'whitelist.addressBook')).toBe(false);
  });

  test('enabled with match — adds whitelist.addressBook reason with -50 delta', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [
        { authservId: 'mail.example.com', results: [{ method: 'dmarc', result: 'fail' }] },
      ],
      isInAddressBook: true,
    });
    expect(r.scoreReasons.some(r => r.key === 'whitelist.addressBook')).toBe(true);
    const abReason = r.scoreReasons.find(r => r.key === 'whitelist.addressBook');
    expect(abReason.delta).toBe(-50);
  });

  test('enabled with configurable mitigation', () => {
    const r = scoreMessage({
      ...base,
      isInAddressBook: true,
      addressBookMitigationScore: -80,
    });
    const abReason = r.scoreReasons.find(r => r.key === 'whitelist.addressBook');
    expect(abReason.delta).toBe(-80);
  });

  test('not in address book — no address-book reason', () => {
    const r = scoreMessage({ ...base, isInAddressBook: false });
    expect(r.scoreReasons.some(r => r.key === 'whitelist.addressBook')).toBe(false);
  });

  test('address-book and manual whitelist are separate reasons', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [
        { authservId: 'mail.example.com', results: [{ method: 'dmarc', result: 'fail' }] },
      ],
      whitelistEntries: [{ value: 'user@example.com', matchType: 'exact' }],
      isInAddressBook: true,
    });
    expect(r.scoreReasons.some(r => r.key === 'whitelist.manual')).toBe(true);
    expect(r.scoreReasons.some(r => r.key === 'whitelist.addressBook')).toBe(true);
  });

  test('address-book does not hard-bypass — score can still be positive', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [
        {
          authservId: 'mail.example.com',
          results: [
            { method: 'spf', result: 'fail' },
            { method: 'dmarc', result: 'fail' },
          ],
        },
      ],
      isInAddressBook: true,
    });
    const abReason = r.scoreReasons.find(r => r.key === 'whitelist.addressBook');
    expect(abReason.delta).toBe(-50);
    // spf.fail=60 + dmarc.fail=40 - ab=50 = 50 (review), mitigation is not a hard bypass
    expect(r.score).toBeGreaterThan(0);
  });

  test('malformed sender (empty localPart) with isInAddressBook true still applies mitigation', () => {
    const r = scoreMessage({
      ...base,
      senderLocalPart: '',
      isInAddressBook: true,
    });
    expect(r.scoreReasons.some(r => r.key === 'whitelist.addressBook')).toBe(true);
  });
});

describe('recalculateScoreReasons — whitelist.addressBook', () => {
  test('re-derives delta from current addressBookMitigationScore', () => {
    const entry = {
      scoreReasons: [{ key: 'whitelist.addressBook', label: 'Address book contact', delta: -50 }],
    };
    const result = recalculateScoreReasons(entry, { addressBookMitigationScore: -80 });
    expect(result[0].currentDelta).toBe(-80);
    expect(result[0].deltaChanged).toBe(true);
  });

  test('unchanged when mitigation score matches stored delta', () => {
    const entry = {
      scoreReasons: [{ key: 'whitelist.addressBook', delta: -50 }],
    };
    const result = recalculateScoreReasons(entry, { addressBookMitigationScore: -50 });
    expect(result[0].currentDelta).toBe(-50);
    expect(result[0].deltaChanged).toBe(false);
  });

  test('defaults to -50 when addressBookMitigationScore not provided', () => {
    const entry = {
      scoreReasons: [{ key: 'whitelist.addressBook', delta: -50 }],
    };
    const result = recalculateScoreReasons(entry);
    expect(result[0].currentDelta).toBe(-50);
  });
});
