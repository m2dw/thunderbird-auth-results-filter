import { isValidHostname, validateTrustedEntry, getPromotableRegistrableDomain } from '../src/options/trustedEntryValidation.js';

describe('isValidHostname', () => {
  test('accepts a simple domain', () => {
    expect(isValidHostname('example.com')).toBe(true);
  });

  test('accepts a multi-label hostname', () => {
    expect(isValidHostname('mail.example.co.jp')).toBe(true);
  });

  test('accepts a hostname with hyphens', () => {
    expect(isValidHostname('mail-server.example.com')).toBe(true);
  });

  test('accepts a single-label hostname', () => {
    expect(isValidHostname('localhost')).toBe(true);
  });

  test('rejects empty string', () => {
    expect(isValidHostname('')).toBe(false);
  });

  test('rejects a label starting with hyphen', () => {
    expect(isValidHostname('-example.com')).toBe(false);
  });

  test('rejects a label ending with hyphen', () => {
    expect(isValidHostname('example-.com')).toBe(false);
  });

  test('rejects consecutive dots', () => {
    expect(isValidHostname('example..com')).toBe(false);
  });

  test('rejects trailing dot', () => {
    expect(isValidHostname('example.com.')).toBe(false);
  });

  test('rejects spaces', () => {
    expect(isValidHostname('example .com')).toBe(false);
  });

  test('rejects non-string', () => {
    expect(isValidHostname(42)).toBe(false);
    expect(isValidHostname(null)).toBe(false);
  });
});

describe('validateTrustedEntry — exact matchType', () => {
  const existing = [
    { value: 'mail.example.com', matchType: 'exact' },
    { value: 'example.com', matchType: 'domain' },
  ];

  test('accepts a valid hostname not already in the list', () => {
    expect(validateTrustedEntry('smtp.example.com', 'exact', existing)).toBeNull();
  });

  test('rejects empty value', () => {
    expect(validateTrustedEntry('', 'exact', existing)).not.toBeNull();
  });

  test('rejects whitespace-only value', () => {
    expect(validateTrustedEntry('   ', 'exact', existing)).not.toBeNull();
  });

  test('rejects malformed hostname', () => {
    expect(validateTrustedEntry('-bad.example.com', 'exact', existing)).not.toBeNull();
  });

  test('rejects duplicate exact entry', () => {
    expect(validateTrustedEntry('mail.example.com', 'exact', existing)).not.toBeNull();
  });

  test('allows same value if matchType differs', () => {
    // example.com exists as domain; same value with exact matchType is not a duplicate.
    expect(validateTrustedEntry('example.com', 'exact', existing)).toBeNull();
  });

  test('duplicate check is case-insensitive', () => {
    expect(validateTrustedEntry('MAIL.EXAMPLE.COM', 'exact', existing)).not.toBeNull();
  });

  test('trims leading/trailing spaces before validating', () => {
    expect(validateTrustedEntry('  smtp.example.com  ', 'exact', [])).toBeNull();
  });
});

describe('validateTrustedEntry — domain matchType', () => {
  test('accepts a valid registrable domain', () => {
    expect(validateTrustedEntry('example.com', 'domain', [])).toBeNull();
  });

  test('accepts a multi-component registrable domain', () => {
    expect(validateTrustedEntry('example.co.jp', 'domain', [])).toBeNull();
  });

  test('rejects a public suffix alone (co.jp)', () => {
    const err = validateTrustedEntry('co.jp', 'domain', []);
    expect(err).not.toBeNull();
    expect(err).toMatch(/public suffix/i);
  });

  test('rejects a single-component public suffix (com)', () => {
    const err = validateTrustedEntry('com', 'domain', []);
    expect(err).not.toBeNull();
  });

  test('rejects duplicate domain entry', () => {
    const existing = [{ value: 'example.com', matchType: 'domain' }];
    expect(validateTrustedEntry('example.com', 'domain', existing)).not.toBeNull();
  });

  test('rejects malformed value', () => {
    expect(validateTrustedEntry('..bad', 'domain', [])).not.toBeNull();
  });

  test('rejects a subdomain host for domain match type', () => {
    const err = validateTrustedEntry('mail.example.com', 'domain', []);
    expect(err).not.toBeNull();
    expect(err).toMatch(/registrable domain/i);
  });

  test('suggests the registrable domain when a subdomain is entered', () => {
    const err = validateTrustedEntry('mail.example.co.jp', 'domain', []);
    expect(err).not.toBeNull();
    expect(err).toContain('example.co.jp');
  });
});

describe('getPromotableRegistrableDomain', () => {
  test('returns registrable domain for a subdomain exact-host entry', () => {
    expect(getPromotableRegistrableDomain('mail.example.com', [])).toBe('example.com');
  });

  test('returns registrable domain for a deep subdomain', () => {
    expect(getPromotableRegistrableDomain('mail3.2dw.jp', [])).toBe('2dw.jp');
  });

  test('returns registrable domain for a multi-label TLD', () => {
    expect(getPromotableRegistrableDomain('mail.example.co.jp', [])).toBe('example.co.jp');
  });

  test('returns registrable domain when exact host equals registrable domain', () => {
    expect(getPromotableRegistrableDomain('example.com', [])).toBe('example.com');
  });

  test('returns null when host is a public suffix', () => {
    expect(getPromotableRegistrableDomain('co.jp', [])).toBeNull();
    expect(getPromotableRegistrableDomain('com', [])).toBeNull();
  });

  test('returns null when domain trust already exists', () => {
    const existing = [{ value: 'example.com', matchType: 'domain' }];
    expect(getPromotableRegistrableDomain('mail.example.com', existing)).toBeNull();
  });

  test('returns domain when only exact trust exists (not domain trust)', () => {
    const existing = [{ value: 'mail.example.com', matchType: 'exact' }];
    expect(getPromotableRegistrableDomain('mail.example.com', existing)).toBe('example.com');
  });

  test('is case-insensitive', () => {
    expect(getPromotableRegistrableDomain('MAIL.EXAMPLE.COM', [])).toBe('example.com');
  });

  test('returns null when domain trust entry exists with different case', () => {
    const existing = [{ value: 'example.com', matchType: 'domain' }];
    expect(getPromotableRegistrableDomain('MAIL.EXAMPLE.COM', existing)).toBeNull();
  });

  test('ignores malformed existing entries', () => {
    const existing = [null, { value: 123, matchType: 'domain' }, 'bad'];
    expect(getPromotableRegistrableDomain('mail.example.com', existing)).toBe('example.com');
  });

  test('returns null for an email-like value (invalid hostname)', () => {
    expect(getPromotableRegistrableDomain('foo@example.com', [])).toBeNull();
  });

  test('returns null for a URL-like value (invalid hostname)', () => {
    expect(getPromotableRegistrableDomain('http://mail.example.com', [])).toBeNull();
  });
});
