import { readFileSync } from 'node:fs';
import {
  MAX_ACCOUNT_SETUP_ENTRIES,
  sanitizeAccountSetup,
  listSetupAccounts,
  confirmTrustedServerSetup,
  buildSetupCheck,
} from '../src/modules/accountSetup.js';
import { PROTECTION_STATES } from '../src/modules/protectionStatus.js';

const exact = value => ({ value, matchType: 'exact' });

function baseData(overrides = {}) {
  return {
    trustedDomains: [],
    candidates: [],
    decisionLog: [],
    settings: { moveToReview: true, accountSetup: {} },
    ...overrides,
  };
}

describe('sanitizeAccountSetup', () => {
  test('keeps valid records and normalizes host case', () => {
    expect(sanitizeAccountSetup({ account1: { host: 'MX.Example.com', confirmedAt: 5 } }))
      .toEqual({ account1: { host: 'mx.example.com', confirmedAt: 5 } });
  });

  test('drops malformed records', () => {
    expect(sanitizeAccountSetup({
      a: null,
      b: { host: '' },
      c: { host: 'not a host' },
      d: { host: 42 },
      [`${'x'.repeat(201)}`]: { host: 'mx.example.com', confirmedAt: 1 },
    })).toEqual({});
    expect(sanitizeAccountSetup(null)).toEqual({});
    expect(sanitizeAccountSetup([{ host: 'mx.example.com' }])).toEqual({});
    expect(sanitizeAccountSetup('x')).toEqual({});
  });

  test('is bounded to the most recently confirmed entries', () => {
    const raw = {};
    for (let i = 0; i < MAX_ACCOUNT_SETUP_ENTRIES + 10; i++) {
      raw[`account${i}`] = { host: `mx${i}.example.com`, confirmedAt: i };
    }
    const result = sanitizeAccountSetup(raw);
    expect(Object.keys(result)).toHaveLength(MAX_ACCOUNT_SETUP_ENTRIES);
    expect(result.account0).toBeUndefined();
    expect(result[`account${MAX_ACCOUNT_SETUP_ENTRIES + 9}`]).toBeDefined();
  });
});

describe('listSetupAccounts', () => {
  test('keeps only accounts with an identity email and extracts domains', () => {
    const accounts = [
      { id: 'account1', name: 'Work', identities: [{ email: 'me@Example.com' }, { email: 'alias@example.com' }] },
      { id: 'account2', name: 'Local Folders', identities: [] },
      { id: 'account3', name: 'Feeds' },
    ];
    expect(listSetupAccounts(accounts)).toEqual([
      { id: 'account1', name: 'Work', emails: ['me@Example.com', 'alias@example.com'], domains: ['example.com'] },
    ]);
    expect(listSetupAccounts(null)).toEqual([]);
  });
});

describe('confirmTrustedServerSetup', () => {
  const now = 1_700_000_000_000;

  test('requires explicit confirmation', () => {
    const data = baseData();
    for (const confirmed of [undefined, false, 'true', 1]) {
      const result = confirmTrustedServerSetup(data, {
        accountId: 'account1', host: 'mx.example.com', confirmed, now,
      });
      expect(result).toEqual({ ok: false, error: 'confirmation_required' });
    }
    expect(data.trustedDomains).toEqual([]);
  });

  test('validates account and host', () => {
    const data = baseData();
    expect(confirmTrustedServerSetup(data, { host: 'mx.example.com', confirmed: true }).error)
      .toBe('missing_account');
    expect(confirmTrustedServerSetup(data, { accountId: 'a', host: '  ', confirmed: true }).error)
      .toBe('missing_host');
    expect(confirmTrustedServerSetup(data, { accountId: 'a', host: 'bad host', confirmed: true }).error)
      .toBe('invalid_host');
  });

  test('adds an exact trusted entry and records the confirmation', () => {
    const data = baseData({
      candidates: [
        { authservId: 'mx.example.com', registrableDomain: 'example.com', lastSeen: 1 },
        { authservId: 'other.example.com', registrableDomain: 'example.com', lastSeen: 1 },
      ],
    });
    const result = confirmTrustedServerSetup(data, {
      accountId: 'account1', host: ' MX.Example.com ', confirmed: true, now,
    });
    expect(result.ok).toBe(true);
    expect(result.added).toBe(true);
    expect(result.data.trustedDomains).toEqual([exact('mx.example.com')]);
    expect(result.data.settings.accountSetup).toEqual({
      account1: { host: 'mx.example.com', confirmedAt: now },
    });
    expect(result.data.candidates.map(c => c.authservId)).toEqual(['other.example.com']);
    // Other settings are preserved; input is not mutated.
    expect(result.data.settings.moveToReview).toBe(true);
    expect(data.trustedDomains).toEqual([]);
  });

  test('does not duplicate an entry that already covers the host', () => {
    const data = baseData({ trustedDomains: [{ value: 'example.com', matchType: 'domain' }] });
    const result = confirmTrustedServerSetup(data, {
      accountId: 'account1', host: 'mx.example.com', confirmed: true, now,
    });
    expect(result.ok).toBe(true);
    expect(result.added).toBe(false);
    expect(result.data.trustedDomains).toEqual([{ value: 'example.com', matchType: 'domain' }]);
    expect(result.data.settings.accountSetup.account1.host).toBe('mx.example.com');
  });

  test('correcting setup later replaces the account confirmation and keeps other trust', () => {
    const first = confirmTrustedServerSetup(baseData(), {
      accountId: 'account1', host: 'mail.example.com', confirmed: true, now,
    }).data;
    const second = confirmTrustedServerSetup(first, {
      accountId: 'account1', host: 'mx.example.com', confirmed: true, now: now + 1,
    }).data;
    expect(second.settings.accountSetup.account1).toEqual({ host: 'mx.example.com', confirmedAt: now + 1 });
    expect(second.trustedDomains).toEqual([exact('mail.example.com'), exact('mx.example.com')]);
  });

  test('ignores authserv-ids from received mail: only the given host is trusted', () => {
    const data = baseData({
      decisionLog: [{ accountId: 'account1', authservIds: ['attacker.example'] }],
    });
    const result = confirmTrustedServerSetup(data, {
      accountId: 'account1', host: 'mx.example.com', confirmed: true, now,
    });
    expect(result.data.trustedDomains).toEqual([exact('mx.example.com')]);
    expect(JSON.stringify(result.data.trustedDomains)).not.toContain('attacker.example');
  });
});

describe('buildSetupCheck', () => {
  const suggestions = [
    { host: 'mx1.provider.example', source: 'mx', domain: 'example.com' },
    { host: 'mail.example.com', source: 'heuristic', domain: 'example.com' },
  ];
  const emptyMail = { total: 0, trusted: 0, untrusted: 0, none: 0, hostSeen: 0 };
  const keys = items => items.map(i => i.key);

  test('reports account domains and missing mail without a host', () => {
    expect(keys(buildSetupCheck({
      host: '', accountDomains: ['example.com'], suggestions, trustedDomains: [], mail: emptyMail,
    }))).toEqual(['account_domains', 'mail_none_yet']);
    expect(keys(buildSetupCheck({
      host: '', accountDomains: [], suggestions: [], trustedDomains: [], mail: null,
    }))).toEqual(['account_domains_none', 'mail_none_yet']);
  });

  test('recognizes MX, heuristic, related, and unrelated hosts', () => {
    const base = { accountDomains: ['example.com'], suggestions, trustedDomains: [], mail: emptyMail };
    expect(keys(buildSetupCheck({ ...base, host: 'mx1.provider.example' }))).toContain('host_matches_mx');
    expect(keys(buildSetupCheck({ ...base, host: 'mail.example.com' }))).toContain('host_matches_hint');
    expect(keys(buildSetupCheck({ ...base, host: 'in.example.com' }))).toContain('host_related_domain');
    expect(keys(buildSetupCheck({ ...base, host: 'mx2.provider.example' }))).toContain('host_related_domain');
    const unrelated = buildSetupCheck({ ...base, host: 'mx.unrelated.test' });
    expect(unrelated.find(i => i.key === 'host_unrelated').level).toBe('warn');
  });

  test('flags invalid and already-trusted hosts', () => {
    const base = { accountDomains: ['example.com'], suggestions, mail: emptyMail };
    expect(keys(buildSetupCheck({ ...base, host: 'bad host', trustedDomains: [] }))).toContain('host_invalid');
    expect(keys(buildSetupCheck({ ...base, host: 'mail.example.com', trustedDomains: [exact('mail.example.com')] })))
      .toContain('host_already_trusted');
  });

  test('reports recent mail facts', () => {
    const base = { accountDomains: ['example.com'], suggestions, trustedDomains: [] };
    const noAr = buildSetupCheck({ ...base, host: '', mail: { total: 5, trusted: 0, untrusted: 0, none: 5, hostSeen: 0 } });
    expect(keys(noAr)).toEqual(['account_domains', 'mail_summary', 'mail_no_ar']);

    const seen = buildSetupCheck({
      ...base, host: 'mail.example.com', mail: { total: 4, trusted: 0, untrusted: 4, none: 0, hostSeen: 3 },
    });
    expect(seen.find(i => i.key === 'host_seen').params).toEqual(['3', '4']);

    const notSeen = buildSetupCheck({
      ...base, host: 'mail.example.com', mail: { total: 4, trusted: 0, untrusted: 4, none: 0, hostSeen: 0 },
    });
    expect(keys(notSeen)).toContain('host_not_seen');
  });

  test('does not report a host as unseen when IDs were dropped from the log', () => {
    const base = { accountDomains: ['example.com'], suggestions, trustedDomains: [] };
    const items = buildSetupCheck({
      ...base,
      host: 'mail.example.com',
      mail: { total: 4, trusted: 0, untrusted: 2, unknown: 2, none: 0, hostSeen: 0, hostPossiblySeen: 2 },
    });
    expect(keys(items)).not.toContain('host_not_seen');
    expect(items.find(i => i.key === 'host_possibly_seen').params).toEqual(['mail.example.com', '2']);
    expect(items.find(i => i.key === 'mail_unrecorded').params).toEqual(['2']);
  });
});

describe('locale coverage for status and guided setup', () => {
  const en = JSON.parse(readFileSync(new URL('../src/_locales/en/messages.json', import.meta.url), 'utf8'));
  const ja = JSON.parse(readFileSync(new URL('../src/_locales/ja/messages.json', import.meta.url), 'utf8'));

  const required = [
    ...Object.values(PROTECTION_STATES).flatMap(s => [`status_state_${s}`, `status_state_${s}_detail`]),
    'status_state_mismatch_detail',
    'status_overall_all_active',
    'status_overall_partial',
    'status_accounts_unavailable',
    'status_confirmed_host',
    'status_mail_counts',
    'status_mail_unrecorded',
    'popup_status_inactive',
    'popup_btn_open_setup',
    ...['confirmation_required', 'missing_account', 'missing_host', 'invalid_host']
      .map(e => `guided_setup_error_${e}`),
    ...['account_domains', 'account_domains_none', 'mail_none_yet', 'mail_summary', 'mail_unrecorded',
      'mail_no_ar', 'host_invalid', 'host_already_trusted', 'host_matches_mx', 'host_matches_hint',
      'host_related_domain', 'host_unrelated', 'host_seen', 'host_possibly_seen', 'host_not_seen']
      .map(k => `guided_check_${k}`),
  ];

  test.each(required)('%s exists in en and ja', key => {
    expect(en[key]?.message).toBeTruthy();
    expect(ja[key]?.message).toBeTruthy();
  });

  test('options.html __MSG_ keys exist in en and ja', () => {
    const html = readFileSync(new URL('../src/options/options.html', import.meta.url), 'utf8');
    const keysInHtml = [...html.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map(m => m[1]);
    const missing = keysInHtml.filter(k => !en[k] || !ja[k]);
    expect(missing.filter(k => /guided|authserv/.test(k))).toEqual([]);
  });
});
