import { assessMessage } from '../src/modules/messageAssessment.js';
import { DEFAULTS } from '../src/modules/storage.js';

function snapshot(overrides = {}) {
  const data = structuredClone(DEFAULTS);
  data.trustedDomains = [{ value: 'mx.example.net', matchType: 'exact' }];
  return { ...data, ...overrides, settings: { ...data.settings, ...(overrides.settings ?? {}) } };
}

const FAILING_HEADERS = {
  from: ['Alice <alice@example.com>'],
  'message-id': ['<abc@example.com>'],
  'authentication-results': [
    'mx.example.net; spf=fail smtp.mailfrom=alice@example.com; dkim=none; dmarc=fail header.from=example.com',
  ],
};

describe('assessMessage', () => {
  test('scores trusted Authentication-Results with current auth scores', async () => {
    const { result, fromDomain, fromLocalPart } = await assessMessage({ headers: FAILING_HEADERS, data: snapshot() });
    const keys = result.scoreReasons.map(r => r.key);
    expect(fromDomain).toBe('example.com');
    expect(fromLocalPart).toBe('alice');
    expect(keys).toEqual(expect.arrayContaining(['auth.spf.fail', 'auth.dkim.none', 'auth.dmarc.fail']));
    expect(result.score).toBeGreaterThanOrEqual(50 + 5 + 15);
  });

  test('untrusted Authentication-Results are diagnostic only', async () => {
    const { result } = await assessMessage({
      headers: FAILING_HEADERS,
      data: snapshot({ trustedDomains: [] }),
    });
    const untrusted = result.scoreReasons.filter(r => r.key === 'authserv.untrusted');
    expect(untrusted).toHaveLength(1);
    expect(untrusted[0].delta).toBe(0);
    expect(result.scoreReasons.some(r => r.key.startsWith('auth.'))).toBe(false);
  });

  test('is deterministic for identical input and settings', async () => {
    const a = await assessMessage({ headers: FAILING_HEADERS, data: snapshot() });
    const b = await assessMessage({ headers: FAILING_HEADERS, data: snapshot() });
    expect(b.result).toEqual(a.result);
  });

  test('consults the address book only when the setting is enabled', async () => {
    const calls = [];
    const isEmailInAddressBook = async address => { calls.push(address); return true; };
    const off = await assessMessage({
      headers: FAILING_HEADERS,
      data: snapshot(),
      lookups: { isEmailInAddressBook },
    });
    expect(calls).toEqual([]);
    expect(off.result.scoreReasons.some(r => r.key === 'whitelist.addressBook')).toBe(false);

    const on = await assessMessage({
      headers: FAILING_HEADERS,
      data: snapshot({ settings: { addressBookWhitelistEnabled: true } }),
      lookups: { isEmailInAddressBook },
    });
    expect(calls).toEqual(['alice@example.com']);
    expect(on.result.scoreReasons.some(r => r.key === 'whitelist.addressBook')).toBe(true);
    expect(on.result.score).toBe(off.result.score - 50);
  });

  test('passes the account id to getAccountDomains', async () => {
    const calls = [];
    const getAccountDomains = async accountId => { calls.push(accountId); return ['example.org']; };
    await assessMessage({
      headers: FAILING_HEADERS,
      accountId: 'account1',
      data: snapshot(),
      lookups: { getAccountDomains },
    });
    expect(calls).toEqual(['account1']);
  });
});
