import { isTrustedAuthservId } from '../src/core/trust.js';
import { extractRegistrableDomain } from '../src/core/psl.js';

// Shorthand helpers to keep tests readable.
const exact = value => ({ value, matchType: 'exact' });
const domain = value => ({ value, matchType: 'domain' });

describe('isTrustedAuthservId — domain matchType', () => {
  test('exact match of the trusted domain itself', () => {
    expect(isTrustedAuthservId('example.co.jp', [domain('example.co.jp')])).toBe(true);
  });

  test('direct subdomain match', () => {
    expect(isTrustedAuthservId('mail.example.co.jp', [domain('example.co.jp')])).toBe(true);
  });

  test('deep subdomain match', () => {
    expect(isTrustedAuthservId('mx1.mail.example.co.jp', [domain('example.co.jp')])).toBe(true);
  });

  test('rejects evil prefix (not a subdomain)', () => {
    expect(isTrustedAuthservId('evil-example.co.jp', [domain('example.co.jp')])).toBe(false);
  });

  test('rejects evil suffix appended after a dot', () => {
    expect(isTrustedAuthservId('example.co.jp.evil.com', [domain('example.co.jp')])).toBe(false);
  });

  test('rejects unrelated domain', () => {
    expect(isTrustedAuthservId('other.com', [domain('example.co.jp')])).toBe(false);
  });

  test('rejects sibling registrable domain under co.jp', () => {
    expect(isTrustedAuthservId('mail.sibling.co.jp', [domain('example.co.jp')])).toBe(false);
  });

  test('private suffix (blogspot.com): trusts subdomains of the same blog', () => {
    expect(isTrustedAuthservId('mail.myblog.blogspot.com', [domain('myblog.blogspot.com')])).toBe(true);
  });

  test('private suffix (blogspot.com): does not trust a different blog under the same private suffix', () => {
    expect(isTrustedAuthservId('mail.yourblog.blogspot.com', [domain('myblog.blogspot.com')])).toBe(false);
  });

  test('matches against a list of trusted domain entries', () => {
    expect(isTrustedAuthservId('mail.foo.com', [domain('example.co.jp'), domain('foo.com')])).toBe(true);
  });

  test('returns false for empty trusted list', () => {
    expect(isTrustedAuthservId('mail.example.com', [])).toBe(false);
  });

  test('matching is case-insensitive', () => {
    expect(isTrustedAuthservId('Mail.EXAMPLE.CO.JP', [domain('example.co.jp')])).toBe(true);
  });

  test('trusted value stored in uppercase is still matched', () => {
    expect(isTrustedAuthservId('mail.example.com', [domain('EXAMPLE.COM')])).toBe(true);
  });
});

describe('isTrustedAuthservId — exact matchType', () => {
  test('exact entry trusts the host itself', () => {
    expect(isTrustedAuthservId('mail.example.com', [exact('mail.example.com')])).toBe(true);
  });

  test('exact entry does NOT trust a subdomain of the host', () => {
    expect(isTrustedAuthservId('evil.mail.example.com', [exact('mail.example.com')])).toBe(false);
  });

  test('exact entry does NOT trust a sibling host', () => {
    expect(isTrustedAuthservId('other.example.com', [exact('mail.example.com')])).toBe(false);
  });

  test('exact entry is case-insensitive', () => {
    expect(isTrustedAuthservId('Mail.EXAMPLE.COM', [exact('mail.example.com')])).toBe(true);
  });

  test('mixed list: exact and domain entries both work', () => {
    const trusted = [exact('mx.corp.example'), domain('trusted.org')];
    expect(isTrustedAuthservId('mx.corp.example', trusted)).toBe(true);
    expect(isTrustedAuthservId('sub.mx.corp.example', trusted)).toBe(false);
    expect(isTrustedAuthservId('smtp.trusted.org', trusted)).toBe(true);
  });
});

describe('isTrustedAuthservId — malformed entries', () => {
  test('null entry is ignored', () => {
    expect(isTrustedAuthservId('mail.example.com', [null])).toBe(false);
  });

  test('undefined entry is ignored', () => {
    expect(isTrustedAuthservId('mail.example.com', [undefined])).toBe(false);
  });

  test('plain string entry is ignored (no legacy string support)', () => {
    expect(isTrustedAuthservId('example.com', ['example.com'])).toBe(false);
  });

  test('entry missing value is ignored', () => {
    expect(isTrustedAuthservId('mail.example.com', [{ matchType: 'exact' }])).toBe(false);
  });

  test('entry with non-string value is ignored', () => {
    expect(isTrustedAuthservId('mail.example.com', [{ value: 42, matchType: 'exact' }])).toBe(false);
  });

  test('entry with unknown matchType is ignored', () => {
    expect(isTrustedAuthservId('mail.example.com', [{ value: 'mail.example.com', matchType: 'wildcard' }])).toBe(false);
  });

  test('malformed entry in a list does not prevent valid entry from matching', () => {
    expect(isTrustedAuthservId('mail.example.com', [null, exact('mail.example.com')])).toBe(true);
  });
});

describe('extractRegistrableDomain (spec examples)', () => {
  test('mail1.foo.example.co.jp → example.co.jp', () => {
    expect(extractRegistrableDomain('mail1.foo.example.co.jp')).toBe('example.co.jp');
  });

  test('mail1.foo.bar.example.jp → example.jp', () => {
    expect(extractRegistrableDomain('mail1.foo.bar.example.jp')).toBe('example.jp');
  });

  test('mail.example.com → example.com', () => {
    expect(extractRegistrableDomain('mail.example.com')).toBe('example.com');
  });

  test('smtp.example.co.uk → example.co.uk', () => {
    expect(extractRegistrableDomain('smtp.example.co.uk')).toBe('example.co.uk');
  });

  test('second-level domain with no subdomain returns itself', () => {
    expect(extractRegistrableDomain('example.co.jp')).toBe('example.co.jp');
  });

  test('single label returns null', () => {
    expect(extractRegistrableDomain('com')).toBeNull();
  });

  test('empty string returns null', () => {
    expect(extractRegistrableDomain('')).toBeNull();
  });

  test('public suffix alone returns null', () => {
    expect(extractRegistrableDomain('co.jp')).toBeNull();
  });

  test('private suffix (blogspot.com) is treated as a suffix: blog label becomes registrable domain', () => {
    expect(extractRegistrableDomain('mail.myblog.blogspot.com')).toBe('myblog.blogspot.com');
  });

  test('private suffix alone (blogspot.com) returns null', () => {
    expect(extractRegistrableDomain('blogspot.com')).toBeNull();
  });
});
