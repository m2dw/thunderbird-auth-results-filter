import {
  PROTECTION_STATES,
  STATUS_SAMPLE_SIZE,
  NO_AR_MIN_SAMPLE,
  MAX_LOGGED_AUTHSERV_IDS,
  extractAuthservIds,
  authservIdsTruncated,
  classifyEntryAuth,
  summarizeAccountMail,
  getConfirmedHost,
  deriveAccountProtectionStatus,
  summarizeProtection,
} from '../src/modules/protectionStatus.js';
import { analyzeMailAuthSignals, adaptAuthResults } from '../src/modules/mailAuthSignalAdapter.js';
import { extractRegistrableDomain } from '../src/core/psl.js';
import { isTrustedAuthservId } from '../src/core/trust.js';

const exact = value => ({ value, matchType: 'exact' });
const domain = value => ({ value, matchType: 'domain' });
const entry = (accountId, authservIds) => ({ accountId, authservIds });

function derive(overrides = {}) {
  return deriveAccountProtectionStatus({
    accountId: 'account1',
    trustedDomains: [],
    accountSetup: {},
    decisionLog: [],
    ...overrides,
  });
}

describe('extractAuthservIds', () => {
  const ar = authservId => ({ authservId, results: [] });

  // Same parse path the background script uses for scoring.
  function parseHeaders(headers) {
    const { metrics } = analyzeMailAuthSignals({
      headers: { from: 'Alice <alice@example.com>', 'authentication-results': headers },
      getRegistrableDomain: extractRegistrableDomain,
    });
    return adaptAuthResults(metrics.authenticationResults);
  }

  test('collects unique lowercased authserv-ids from parsed results', () => {
    expect(extractAuthservIds([
      ar('MX.Example.com'),
      ar('mx.example.com'),
      ar('other.example'),
    ], [])).toEqual(['mx.example.com', 'other.example']);
  });

  test('is bounded and ignores malformed input', () => {
    const parsed = Array.from({ length: 20 }, (_, i) => ar(`h${i}.example`));
    expect(extractAuthservIds(parsed, [])).toHaveLength(MAX_LOGGED_AUTHSERV_IDS);
    expect(extractAuthservIds([null, 42, ar(''), { authservId: 7 }], [])).toEqual([]);
    expect(extractAuthservIds(undefined, [])).toEqual([]);
    expect(extractAuthservIds([ar('a'.repeat(300))], [])).toEqual([]);
  });

  test('keeps a trusted id even when it follows the storage bound', () => {
    const parsed = [
      ...Array.from({ length: MAX_LOGGED_AUTHSERV_IDS }, (_, i) => ar(`u${i}.example`)),
      ar('mx.example.com'),
    ];
    const trusted = [exact('mx.example.com')];
    const ids = extractAuthservIds(parsed, trusted);
    expect(ids).toHaveLength(MAX_LOGGED_AUTHSERV_IDS);
    expect(ids).toContain('mx.example.com');
    expect(classifyEntryAuth(entry('account1', ids), trusted)).toBe('trusted');
    expect(derive({
      trustedDomains: trusted,
      decisionLog: [entry('account1', ids)],
    }).state).toBe(PROTECTION_STATES.ACTIVE);
  });

  test('marks truncation so a server confirmed later is not reported as unseen', () => {
    const provider = 'mx.example.com';
    const parsed = [
      ...Array.from({ length: MAX_LOGGED_AUTHSERV_IDS }, (_, i) => ar(`u${i}.example`)),
      ar(provider),
    ];
    // Logged before the user trusted anything: the provider's id is dropped.
    const logged = {
      ...entry('account1', extractAuthservIds(parsed, [])),
      authservIdsTruncated: authservIdsTruncated(parsed),
    };
    expect(logged.authservIds).not.toContain(provider);
    expect(logged.authservIdsTruncated).toBe(true);
    expect(authservIdsTruncated(parsed.slice(0, MAX_LOGGED_AUTHSERV_IDS))).toBe(false);
    expect(authservIdsTruncated(undefined)).toBe(false);

    const trusted = [exact(provider)];
    const s = derive({
      trustedDomains: trusted,
      accountSetup: { account1: { host: provider, confirmedAt: 1 } },
      decisionLog: [logged],
    });
    expect(s.state).toBe(PROTECTION_STATES.AWAITING_MAIL);
    expect(s.mismatch).toBe(false);
    expect(s.mail.unknown).toBe(1);
    // Truncation never yields trust on its own.
    expect(s.state).not.toBe(PROTECTION_STATES.ACTIVE);
  });

  test('matches the scoring parser for a malformed authserv-id', () => {
    const trusted = [exact('mx.example.com')];
    const parsed = parseHeaders(['mx.example.com junk; dmarc=pass header.from=example.com']);
    const ids = extractAuthservIds(parsed, trusted);
    // Scoring does not trust the parsed id, so status must not either.
    expect(parsed.some(r => isTrustedAuthservId(r.authservId, trusted))).toBe(false);
    expect(ids).not.toContain('mx.example.com');
    expect(derive({
      trustedDomains: trusted,
      decisionLog: [entry('account1', ids)],
    }).state).not.toBe(PROTECTION_STATES.ACTIVE);
  });

  test('a well-formed trusted header from the parser is recorded', () => {
    const trusted = [exact('mx.example.com')];
    const ids = extractAuthservIds(
      parseHeaders(['mx.example.com; dmarc=pass header.from=example.com']),
      trusted,
    );
    expect(ids).toEqual(['mx.example.com']);
  });
});

describe('classifyEntryAuth', () => {
  test('re-evaluates against the current trusted list', () => {
    const e = entry('account1', ['mx.example.com']);
    expect(classifyEntryAuth(e, [])).toBe('untrusted');
    expect(classifyEntryAuth(e, [exact('mx.example.com')])).toBe('trusted');
    expect(classifyEntryAuth(e, [domain('example.com')])).toBe('trusted');
  });

  test('any trusted id among several counts as trusted', () => {
    const e = entry('account1', ['forged.example', 'mx.example.com']);
    expect(classifyEntryAuth(e, [exact('mx.example.com')])).toBe('trusted');
  });

  test('empty authservIds is "none"', () => {
    expect(classifyEntryAuth(entry('account1', []), [exact('mx.example.com')])).toBe('none');
  });

  test('legacy entries fall back to the single authservId field', () => {
    expect(classifyEntryAuth({ authservId: 'mx.example.com' }, [exact('mx.example.com')])).toBe('trusted');
    expect(classifyEntryAuth({ authservId: 'mx.example.com' }, [])).toBe('untrusted');
    expect(classifyEntryAuth({ authservId: '' }, [])).toBe('none');
  });

  test('truncated entries without a trusted stored id are unknown, not untrusted', () => {
    const e = { ...entry('account1', ['u0.example']), authservIdsTruncated: true };
    expect(classifyEntryAuth(e, [exact('mx.example.com')])).toBe('unknown');
    expect(classifyEntryAuth(e, [exact('u0.example')])).toBe('trusted');
    // With nothing trusted, no dropped id can be trusted either.
    expect(classifyEntryAuth(e, [])).toBe('untrusted');
  });

  test('look-alike hosts are not trusted', () => {
    const trusted = [exact('mx.example.com')];
    expect(classifyEntryAuth(entry('a', ['evil-mx.example.com']), trusted)).toBe('untrusted');
    expect(classifyEntryAuth(entry('a', ['mx.example.com.evil']), trusted)).toBe('untrusted');
  });
});

describe('summarizeAccountMail', () => {
  test('counts only entries for the requested account', () => {
    const log = [
      entry('account1', ['mx.example.com']),
      entry('account2', ['mx.example.com']),
      entry('account1', []),
      { authservId: 'mx.example.com' }, // legacy, unattributed
    ];
    expect(summarizeAccountMail(log, 'account1', [exact('mx.example.com')])).toEqual({
      total: 2, trusted: 1, untrusted: 0, unknown: 0, none: 1, hostSeen: 0, hostPossiblySeen: 0,
    });
  });

  test('is limited to STATUS_SAMPLE_SIZE most recent entries', () => {
    const log = [
      ...Array.from({ length: STATUS_SAMPLE_SIZE }, () => entry('account1', [])),
      entry('account1', ['mx.example.com']),
    ];
    const s = summarizeAccountMail(log, 'account1', [exact('mx.example.com')]);
    expect(s.total).toBe(STATUS_SAMPLE_SIZE);
    expect(s.trusted).toBe(0);
  });

  test('counts occurrences of a host when requested', () => {
    const log = [
      entry('account1', ['mx.example.com']),
      entry('account1', ['other.example']),
      entry('account1', ['MX.example.com']),
    ];
    expect(summarizeAccountMail(log, 'account1', [], 'mx.example.com').hostSeen).toBe(2);
  });

  test('counts truncated entries without the host as possibly seen', () => {
    const log = [
      { ...entry('account1', ['u0.example']), authservIdsTruncated: true },
      entry('account1', ['other.example']),
    ];
    const s = summarizeAccountMail(log, 'account1', [exact('mx.example.com')], 'mx.example.com');
    expect(s.hostSeen).toBe(0);
    expect(s.hostPossiblySeen).toBe(1);
    expect(s.unknown).toBe(1);
    expect(s.untrusted).toBe(1);
  });
});

describe('getConfirmedHost', () => {
  test('returns the confirmed host only while it is still trusted', () => {
    const setup = { account1: { host: 'mx.example.com', confirmedAt: 1 } };
    expect(getConfirmedHost(setup, 'account1', [exact('mx.example.com')])).toBe('mx.example.com');
    expect(getConfirmedHost(setup, 'account1', [])).toBeNull();
    expect(getConfirmedHost(setup, 'account2', [exact('mx.example.com')])).toBeNull();
  });

  test('ignores inherited properties', () => {
    expect(getConfirmedHost({}, 'constructor', [exact('mx.example.com')])).toBeNull();
    expect(getConfirmedHost({}, '__proto__', [exact('mx.example.com')])).toBeNull();
  });
});

describe('deriveAccountProtectionStatus', () => {
  test('new user with nothing configured → not_configured', () => {
    const s = derive();
    expect(s.state).toBe(PROTECTION_STATES.NOT_CONFIGURED);
    expect(s.mismatch).toBe(false);
  });

  test('trusted server seen in recent mail → active', () => {
    const s = derive({
      trustedDomains: [exact('mx.example.com')],
      decisionLog: [entry('account1', ['mx.example.com'])],
    });
    expect(s.state).toBe(PROTECTION_STATES.ACTIVE);
  });

  test('trusted server configured but no mail yet → awaiting_mail, not active', () => {
    const s = derive({ trustedDomains: [exact('mx.example.com')] });
    expect(s.state).toBe(PROTECTION_STATES.AWAITING_MAIL);
    expect(s.state).not.toBe(PROTECTION_STATES.ACTIVE);
  });

  test('confirmed host without mail → awaiting_mail with confirmedHost', () => {
    const s = derive({
      trustedDomains: [exact('mx.example.com')],
      accountSetup: { account1: { host: 'mx.example.com', confirmedAt: 1 } },
    });
    expect(s.state).toBe(PROTECTION_STATES.AWAITING_MAIL);
    expect(s.confirmedHost).toBe('mx.example.com');
  });

  test('mail carries only unconfirmed servers and nothing trusted → needs_confirmation', () => {
    const s = derive({ decisionLog: [entry('account1', ['mx.example.com'])] });
    expect(s.state).toBe(PROTECTION_STATES.NEEDS_CONFIRMATION);
    expect(s.mismatch).toBe(false);
  });

  test('trusted server configured but mail checked by a different server → failure (mismatch)', () => {
    const s = derive({
      trustedDomains: [exact('mail.example.com')],
      accountSetup: { account1: { host: 'mail.example.com', confirmedAt: 1 } },
      decisionLog: [entry('account1', ['mx.provider.example'])],
    });
    expect(s.state).toBe(PROTECTION_STATES.NEEDS_CONFIRMATION);
    expect(s.mismatch).toBe(true);
  });

  test('enough recent mail without any Authentication-Results → no_usable_ar', () => {
    const log = Array.from({ length: NO_AR_MIN_SAMPLE }, () => entry('account1', []));
    expect(derive({ decisionLog: log }).state).toBe(PROTECTION_STATES.NO_USABLE_AR);
    expect(derive({ decisionLog: log, trustedDomains: [exact('mx.example.com')] }).state)
      .toBe(PROTECTION_STATES.NO_USABLE_AR);
  });

  test('too few messages without results is not yet reported as unsupported', () => {
    const log = Array.from({ length: NO_AR_MIN_SAMPLE - 1 }, () => entry('account1', []));
    expect(derive({ decisionLog: log }).state).toBe(PROTECTION_STATES.NOT_CONFIGURED);
  });

  test('failure and unsupported states are distinct from successful setup', () => {
    const trustedDomains = [exact('mx.example.com')];
    const states = new Set([
      derive({ trustedDomains, decisionLog: [entry('account1', ['mx.example.com'])] }).state,
      derive({ trustedDomains, decisionLog: [entry('account1', ['other.example'])] }).state,
      derive({ trustedDomains, decisionLog: Array.from({ length: 5 }, () => entry('account1', [])) }).state,
      derive({ trustedDomains }).state,
      derive().state,
    ]);
    expect(states.size).toBe(5);
  });

  test('status is per account', () => {
    const trustedDomains = [exact('mx.example.com')];
    const decisionLog = [entry('account1', ['mx.example.com']), entry('account2', ['mx.other.example'])];
    expect(derive({ accountId: 'account1', trustedDomains, decisionLog }).state).toBe(PROTECTION_STATES.ACTIVE);
    expect(derive({ accountId: 'account2', trustedDomains, decisionLog }).state).toBe(PROTECTION_STATES.NEEDS_CONFIRMATION);
  });

  test('removing a trusted entry invalidates an earlier confirmation', () => {
    const s = derive({
      trustedDomains: [],
      accountSetup: { account1: { host: 'mx.example.com', confirmedAt: 1 } },
    });
    expect(s.state).toBe(PROTECTION_STATES.NOT_CONFIGURED);
    expect(s.confirmedHost).toBeNull();
  });
});

describe('no-auto-trust rule', () => {
  test('deriving status never modifies trusted entries or setup records', () => {
    const trustedDomains = [];
    const accountSetup = {};
    const decisionLog = Array.from({ length: 30 }, () => entry('account1', ['attacker.example']));
    const snapshot = JSON.stringify({ trustedDomains, accountSetup, decisionLog });
    const s = derive({ trustedDomains, accountSetup, decisionLog });
    expect(JSON.stringify({ trustedDomains, accountSetup, decisionLog })).toBe(snapshot);
    expect(s.state).toBe(PROTECTION_STATES.NEEDS_CONFIRMATION);
    expect(s.state).not.toBe(PROTECTION_STATES.ACTIVE);
    expect(s.confirmedHost).toBeNull();
  });

  test('a received authserv-id alone never makes an account active', () => {
    const decisionLog = [entry('account1', ['mx.example.com'])];
    expect(derive({ decisionLog }).state).not.toBe(PROTECTION_STATES.ACTIVE);
  });

  test('a setup record for an untrusted host does not count as confirmed', () => {
    const s = derive({
      accountSetup: { account1: { host: 'mx.example.com', confirmedAt: 1 } },
      decisionLog: [entry('account1', ['mx.example.com'])],
    });
    expect(s.state).toBe(PROTECTION_STATES.NEEDS_CONFIRMATION);
  });
});

describe('summarizeProtection', () => {
  test('reports partial protection', () => {
    expect(summarizeProtection([{ state: 'active' }, { state: 'not_configured' }])).toEqual({
      total: 2, active: 1, inactive: 1, allActive: false,
    });
  });

  test('all active', () => {
    expect(summarizeProtection([{ state: 'active' }]).allActive).toBe(true);
  });

  test('no accounts is never "all active"', () => {
    expect(summarizeProtection([]).allActive).toBe(false);
  });
});
