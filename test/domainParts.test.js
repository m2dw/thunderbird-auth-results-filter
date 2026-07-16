import { getDomainParts } from '../src/core/domainParts.js';

// ─── getDomainParts ───────────────────────────────────────────────────────────

describe('getDomainParts', () => {
  // ── Required spec examples (from Issue #12) ──

  test('example.com', () => {
    const p = getDomainParts('example.com');
    expect(p.hostname).toBe('example.com');
    expect(p.registrableDomain).toBe('example.com');
    expect(p.publicSuffix).toBe('com');
    expect(p.subdomain).toBeNull();
    expect(p.subdomainDepth).toBe(0);
    expect(p.isIcann).toBe(true);
    expect(p.isPrivate).toBe(false);
  });

  test('mail1.foo.example.co.jp', () => {
    const p = getDomainParts('mail1.foo.example.co.jp');
    expect(p.hostname).toBe('mail1.foo.example.co.jp');
    expect(p.registrableDomain).toBe('example.co.jp');
    expect(p.publicSuffix).toBe('co.jp');
    expect(p.subdomain).toBe('mail1.foo');
    expect(p.subdomainDepth).toBe(2);
    expect(p.isIcann).toBe(true);
  });

  test('mail1.foo.bar.example.jp', () => {
    const p = getDomainParts('mail1.foo.bar.example.jp');
    expect(p.hostname).toBe('mail1.foo.bar.example.jp');
    expect(p.registrableDomain).toBe('example.jp');
    expect(p.publicSuffix).toBe('jp');
    expect(p.subdomain).toBe('mail1.foo.bar');
    expect(p.subdomainDepth).toBe(3);
    expect(p.isIcann).toBe(true);
  });

  test('empty input returns all-null result', () => {
    const p = getDomainParts('');
    expect(p.hostname).toBeNull();
    expect(p.registrableDomain).toBeNull();
    expect(p.publicSuffix).toBeNull();
    expect(p.subdomain).toBeNull();
    expect(p.subdomainDepth).toBe(0);
    expect(p.isIcann).toBeNull();
    expect(p.isPrivate).toBeNull();
  });

  test('undefined / no argument returns all-null result', () => {
    const p = getDomainParts();
    expect(p.registrableDomain).toBeNull();
    expect(p.subdomainDepth).toBe(0);
  });

  // ── Normalisation ──

  test('hostname is normalised to lowercase', () => {
    const p = getDomainParts('EXAMPLE.COM');
    expect(p.hostname).toBe('example.com');
    expect(p.registrableDomain).toBe('example.com');
  });

  // ── Malformed / unusual input ──

  test('bare TLD returns null registrableDomain', () => {
    const p = getDomainParts('com');
    expect(p.registrableDomain).toBeNull();
  });

  test('public suffix alone (co.jp) returns null registrableDomain', () => {
    const p = getDomainParts('co.jp');
    expect(p.registrableDomain).toBeNull();
    expect(p.publicSuffix).toBe('co.jp');
  });

  test('malformed host without recognised TLD returns null registrableDomain', () => {
    // 'not-a-domain' has no dot → no valid TLD
    const p = getDomainParts('not-a-domain');
    expect(p.registrableDomain).toBeNull();
  });

  // ── Private suffix ──

  test('private suffix (foo.blogspot.com): isPrivate true, registrableDomain recognised', () => {
    const p = getDomainParts('foo.blogspot.com');
    expect(p.registrableDomain).toBe('foo.blogspot.com');
    expect(p.publicSuffix).toBe('blogspot.com');
    expect(p.isIcann).toBe(false);
    expect(p.isPrivate).toBe(true);
  });

  // ── Subdomain depth ──

  test('subdomainDepth is 0 when no subdomain', () => {
    expect(getDomainParts('example.co.jp').subdomainDepth).toBe(0);
  });

  test('subdomainDepth is 1 for single-label subdomain', () => {
    expect(getDomainParts('mail.example.com').subdomainDepth).toBe(1);
  });

  test('subdomainDepth counts dot-separated labels in subdomain', () => {
    // mail1.foo.example.co.jp → subdomain = 'mail1.foo' → depth 2
    expect(getDomainParts('mail1.foo.example.co.jp').subdomainDepth).toBe(2);
    // a.b.c.example.jp → subdomain = 'a.b.c' → depth 3
    expect(getDomainParts('a.b.c.example.jp').subdomainDepth).toBe(3);
  });

  // ── Return shape completeness ──

  test('returns all expected keys', () => {
    const keys = Object.keys(getDomainParts('example.com'));
    expect(keys).toEqual(expect.arrayContaining([
      'hostname', 'registrableDomain', 'publicSuffix',
      'subdomain', 'subdomainDepth', 'isIcann', 'isPrivate',
    ]));
  });
});
