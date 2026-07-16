import { computeAlignmentMetrics, computePassAlignmentSummary, resolveDkimDomain } from '../src/core/alignment.js';

// Convenience helpers to build parsed AR entries with the extended shape.
const trusted = (authservId, results) => ({ authservId, results });
const result = (method, result, properties = {}) => ({ method, result, properties });

// A single exact-match trusted domain entry.
const exactTrust = value => ({ value, matchType: 'exact' });

// ─── computeAlignmentMetrics ──────────────────────────────────────────────────

describe('computeAlignmentMetrics', () => {
  // ── Basic structure ──

  test('returns expected top-level keys', () => {
    const m = computeAlignmentMetrics({});
    expect(m).toHaveProperty('from');
    expect(m).toHaveProperty('dmarc');
    expect(m).toHaveProperty('spf');
    expect(m).toHaveProperty('dkim');
    expect(m).toHaveProperty('summary');
  });

  test('empty input: from is null, dmarc/spf null, dkim [], summary all false', () => {
    const m = computeAlignmentMetrics({});
    expect(m.from.domain).toBeNull();
    expect(m.dmarc).toBeNull();
    expect(m.spf).toBeNull();
    expect(m.dkim).toEqual([]);
    expect(m.summary).toEqual({ spfAligned: false, anyDkimAligned: false, anyAuthAligned: false });
  });

  test('no trusted headers: dmarc/spf remain null, summary all false', () => {
    const parsedAuthResults = [
      trusted('untrusted.example.com', [
        result('spf', 'pass', { 'smtp.mailfrom': 'user@example.com' }),
      ]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.spf).toBeNull();
    expect(m.summary.spfAligned).toBe(false);
    expect(m.summary.anyAuthAligned).toBe(false);
  });

  // ── from field ──

  test('from.domain is set from fromDomain', () => {
    const m = computeAlignmentMetrics({ fromDomain: 'example.com', parsedAuthResults: [], trustedDomains: [] });
    expect(m.from.domain).toBe('example.com');
    expect(m.from.registrableDomain).toBe('example.com');
  });

  test('from.registrableDomain uses PSL for multi-part TLD', () => {
    const m = computeAlignmentMetrics({ fromDomain: 'mail.example.co.jp', parsedAuthResults: [], trustedDomains: [] });
    expect(m.from.registrableDomain).toBe('example.co.jp');
  });

  // ── SPF alignment ──

  test('SPF: From and smtp.mailfrom same registrable domain → alignedWithFrom true', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('spf', 'pass', { 'smtp.mailfrom': 'bounce@mail.example.com' }),
      ]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.spf.result).toBe('pass');
    expect(m.spf.smtpMailFrom).toBe('bounce@mail.example.com');
    expect(m.spf.smtpMailFromDomain).toBe('mail.example.com');
    expect(m.spf.smtpMailFromRegistrableDomain).toBe('example.com');
    expect(m.spf.alignedWithFrom).toBe(true);
    expect(m.summary.spfAligned).toBe(true);
  });

  test('SPF: From and smtp.mailfrom different registrable domain → alignedWithFrom false', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('spf', 'pass', { 'smtp.mailfrom': 'bounce@mailer.example.net' }),
      ]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.spf.smtpMailFromRegistrableDomain).toBe('example.net');
    expect(m.spf.alignedWithFrom).toBe(false);
    expect(m.summary.spfAligned).toBe(false);
  });

  test('SPF: smtp.mailfrom is a bare domain (no @ sign)', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('spf', 'pass', { 'smtp.mailfrom': 'example.com' }),
      ]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.spf.smtpMailFromDomain).toBe('example.com');
    expect(m.spf.alignedWithFrom).toBe(true);
  });

  test('SPF: missing smtp.mailfrom → smtpMailFrom null, alignedWithFrom false', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [result('spf', 'pass')]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.spf.smtpMailFrom).toBeNull();
    expect(m.spf.alignedWithFrom).toBe(false);
  });

  test('SPF: smtpMailFromSubdomainDepth is 0 when smtp.mailfrom has no subdomain', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('spf', 'pass', { 'smtp.mailfrom': 'bounce@example.com' }),
      ]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.spf.smtpMailFromSubdomainDepth).toBe(0);
  });

  test('SPF: smtpMailFromSubdomainDepth is 1 for single-level subdomain', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('spf', 'pass', { 'smtp.mailfrom': 'bounce@mail.example.com' }),
      ]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.spf.smtpMailFromSubdomainDepth).toBe(1);
  });

  test('SPF: smtpMailFromSubdomainDepth is null when smtp.mailfrom is absent', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [result('spf', 'pass')]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.spf.smtpMailFromSubdomainDepth).toBeNull();
  });

  // ── DKIM alignment ──

  test('DKIM: From and header.d same registrable domain → alignedWithFrom true', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('dkim', 'pass', { 'header.d': 'example.com' }),
      ]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.dkim).toHaveLength(1);
    expect(m.dkim[0].domain).toBe('example.com');
    expect(m.dkim[0].registrableDomain).toBe('example.com');
    expect(m.dkim[0].alignedWithFrom).toBe(true);
    expect(m.summary.anyDkimAligned).toBe(true);
  });

  test('DKIM: From and header.d different registrable domain → alignedWithFrom false', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('dkim', 'pass', { 'header.d': 'example.net' }),
      ]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.dkim[0].registrableDomain).toBe('example.net');
    expect(m.dkim[0].alignedWithFrom).toBe(false);
    expect(m.summary.anyDkimAligned).toBe(false);
  });

  test('DKIM: uses bare d= property when header.d is absent', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('dkim', 'pass', { 'd': 'example.com' }),
      ]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.dkim[0].domain).toBe('example.com');
    expect(m.dkim[0].alignedWithFrom).toBe(true);
  });

  test('DKIM: multiple signatures collected — anyDkimAligned true if at least one aligns', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('dkim', 'pass', { 'header.d': 'example.net' }),  // not aligned
        result('dkim', 'pass', { 'header.d': 'example.com' }),  // aligned
      ]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.dkim).toHaveLength(2);
    expect(m.dkim.some(d => d.alignedWithFrom)).toBe(true);
    expect(m.summary.anyDkimAligned).toBe(true);
    expect(m.summary.anyAuthAligned).toBe(true);
  });

  test('DKIM: no domain property → domain null, alignedWithFrom false', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [result('dkim', 'pass')]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.dkim[0].domain).toBeNull();
    expect(m.dkim[0].alignedWithFrom).toBe(false);
  });

  test('DKIM: subdomainDepth is 0 when signing domain has no subdomain', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('dkim', 'pass', { 'header.d': 'example.com' }),
      ]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.dkim[0].subdomainDepth).toBe(0);
  });

  test('DKIM: subdomainDepth is 1 for single-level subdomain signing domain', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('dkim', 'pass', { 'header.d': 'mail.example.com' }),
      ]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.dkim[0].subdomainDepth).toBe(1);
  });

  test('DKIM: subdomainDepth is null when domain is null', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [result('dkim', 'pass')]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.dkim[0].subdomainDepth).toBeNull();
  });

  test('DKIM: header.i fallback used when header.d and d are absent', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('dkim', 'pass', { 'header.i': '@repica.jp' }),
      ]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'matsuo1956.jp',
    });
    expect(m.dkim[0].domain).toBe('repica.jp');
    expect(m.dkim[0].registrableDomain).toBe('repica.jp');
    expect(m.dkim[0].alignedWithFrom).toBe(false);
  });

  test('DKIM: header.i with user@sub.example.com extracts sub.example.com', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('dkim', 'pass', { 'header.i': 'user@sub.example.com' }),
      ]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.dkim[0].domain).toBe('sub.example.com');
    expect(m.dkim[0].registrableDomain).toBe('example.com');
    expect(m.dkim[0].alignedWithFrom).toBe(true);
  });

  test('DKIM: header.d preferred over header.i when both present', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('dkim', 'pass', { 'header.d': 'example.net', 'header.i': '@example.com' }),
      ]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.dkim[0].domain).toBe('example.net');
    expect(m.dkim[0].alignedWithFrom).toBe(false);
  });

  test('DKIM: malformed header.i without @ → domain null, no crash', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('dkim', 'pass', { 'header.i': 'not-an-email' }),
      ]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.dkim[0].domain).toBeNull();
    expect(m.dkim[0].alignedWithFrom).toBe(false);
  });

  // ── DMARC ──

  test('DMARC: result and header.from extracted correctly', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('dmarc', 'pass', { 'header.from': 'example.com' }),
      ]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.dmarc.result).toBe('pass');
    expect(m.dmarc.headerFrom).toBe('example.com');
    expect(m.dmarc.headerFromRegistrableDomain).toBe('example.com');
  });

  test('DMARC: header.from with email address format → domain extracted', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('dmarc', 'fail', { 'header.from': 'user@example.com' }),
      ]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.dmarc.headerFrom).toBe('example.com');
  });

  test('DMARC: missing header.from → headerFrom null', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [result('dmarc', 'none')]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.dmarc.result).toBe('none');
    expect(m.dmarc.headerFrom).toBeNull();
  });

  test('DMARC: only first occurrence is recorded', () => {
    const parsedAuthResults = [
      trusted('mx1.example.com', [result('dmarc', 'pass', { 'header.from': 'example.com' })]),
      trusted('mx2.example.com', [result('dmarc', 'fail', { 'header.from': 'example.com' })]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx1.example.com'), exactTrust('mx2.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.dmarc.result).toBe('pass');
  });

  // ── Trust filtering ──

  test('untrusted authserv-id results do not contribute to alignment', () => {
    const parsedAuthResults = [
      trusted('untrusted.evil.com', [
        result('spf', 'pass', { 'smtp.mailfrom': 'user@example.com' }),
        result('dkim', 'pass', { 'header.d': 'example.com' }),
        result('dmarc', 'pass', { 'header.from': 'example.com' }),
      ]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.spf).toBeNull();
    expect(m.dkim).toEqual([]);
    expect(m.dmarc).toBeNull();
    expect(m.summary).toEqual({ spfAligned: false, anyDkimAligned: false, anyAuthAligned: false });
  });

  // ── Summary ──

  test('summary.anyAuthAligned true when SPF aligns but DKIM does not', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('spf', 'pass', { 'smtp.mailfrom': 'bounce@example.com' }),
        result('dkim', 'pass', { 'header.d': 'example.net' }),
      ]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.summary.spfAligned).toBe(true);
    expect(m.summary.anyDkimAligned).toBe(false);
    expect(m.summary.anyAuthAligned).toBe(true);
  });

  test('summary.anyAuthAligned false when neither SPF nor DKIM aligns', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('spf', 'pass', { 'smtp.mailfrom': 'bounce@example.net' }),
        result('dkim', 'pass', { 'header.d': 'example.org' }),
      ]),
    ];
    const m = computeAlignmentMetrics({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(m.summary.anyAuthAligned).toBe(false);
  });

  // ── Missing properties do not throw ──

  test('does not throw when parsedAuthResults is undefined', () => {
    expect(() => computeAlignmentMetrics({ fromDomain: 'example.com' })).not.toThrow();
  });

  test('does not throw when trustedDomains is undefined', () => {
    expect(() => computeAlignmentMetrics({ parsedAuthResults: [], fromDomain: 'example.com' })).not.toThrow();
  });

  test('does not throw when fromDomain is undefined', () => {
    expect(() => computeAlignmentMetrics({ parsedAuthResults: [], trustedDomains: [] })).not.toThrow();
  });
});

// ─── computePassAlignmentSummary ──────────────────────────────────────────────

describe('computePassAlignmentSummary', () => {
  test('empty input returns all false', () => {
    expect(computePassAlignmentSummary({}))
      .toEqual({
        spfAligned: false,
        anyDkimAligned: false,
        anyAuthAligned: false,
        anyTrustedAuthPass: false,
        spfMailFromRegistrableDomain: null,
        anyTrustedSpfPass: false,
        anyTrustedDkimFail: false,
        dkimFailDomains: [],
        anyTrustedDmarcFail: false,
        anyTrustedDmarcPass: false,
        anyTrustedDmarcNonNone: false,
        anyTrustedDmarcNone: false,
        anyTrustedSpfFail: false,
        spfFailMailFromRegistrableDomain: null,
      });
  });

  test('spf=pass aligned → spfAligned true', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('spf', 'pass', { 'smtp.mailfrom': 'sender@example.com' }),
      ]),
    ];
    const s = computePassAlignmentSummary({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(s.spfAligned).toBe(true);
    expect(s.anyAuthAligned).toBe(true);
  });

  test('spf=fail with aligned smtp.mailfrom → spfAligned false', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('spf', 'fail', { 'smtp.mailfrom': 'sender@example.com' }),
      ]),
    ];
    const s = computePassAlignmentSummary({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(s.spfAligned).toBe(false);
    expect(s.anyAuthAligned).toBe(false);
  });

  test('spf=fail → spfFailMailFromRegistrableDomain set to smtp.mailfrom registrable domain', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('spf', 'fail', { 'smtp.mailfrom': 'sender@example.com' }),
      ]),
    ];
    const s = computePassAlignmentSummary({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(s.anyTrustedSpfFail).toBe(true);
    expect(s.spfFailMailFromRegistrableDomain).toBe('example.com');
  });

  test('spf=fail for unrelated domain → spfFailMailFromRegistrableDomain set to that domain', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('spf', 'fail', { 'smtp.mailfrom': 'bounce@forwarder.net' }),
      ]),
    ];
    const s = computePassAlignmentSummary({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(s.anyTrustedSpfFail).toBe(true);
    expect(s.spfFailMailFromRegistrableDomain).toBe('forwarder.net');
  });

  test('spf=fail without smtp.mailfrom property → spfFailMailFromRegistrableDomain null', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('spf', 'fail', {}),
      ]),
    ];
    const s = computePassAlignmentSummary({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(s.anyTrustedSpfFail).toBe(true);
    expect(s.spfFailMailFromRegistrableDomain).toBeNull();
  });

  test('spf=softfail with aligned smtp.mailfrom → spfAligned false', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('spf', 'softfail', { 'smtp.mailfrom': 'sender@example.com' }),
      ]),
    ];
    const s = computePassAlignmentSummary({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(s.spfAligned).toBe(false);
  });

  test('second trusted SPF pass aligned → spfAligned true even when first SPF was non-pass', () => {
    const parsedAuthResults = [
      trusted('mx1.example.com', [
        result('spf', 'fail', { 'smtp.mailfrom': 'sender@example.com' }),
      ]),
      trusted('mx2.example.com', [
        result('spf', 'pass', { 'smtp.mailfrom': 'sender@example.com' }),
      ]),
    ];
    const s = computePassAlignmentSummary({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx1.example.com'), exactTrust('mx2.example.com')],
      fromDomain: 'example.com',
    });
    expect(s.spfAligned).toBe(true);
  });

  test('dkim=pass aligned → anyDkimAligned true', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('dkim', 'pass', { 'header.d': 'example.com' }),
      ]),
    ];
    const s = computePassAlignmentSummary({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(s.anyDkimAligned).toBe(true);
    expect(s.anyAuthAligned).toBe(true);
  });

  test('dkim=fail with aligned domain → anyDkimAligned false', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('dkim', 'fail', { 'header.d': 'example.com' }),
      ]),
    ];
    const s = computePassAlignmentSummary({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(s.anyDkimAligned).toBe(false);
    expect(s.anyAuthAligned).toBe(false);
  });

  test('untrusted AR with passing aligned results → all false', () => {
    const parsedAuthResults = [
      trusted('untrusted.example.net', [
        result('spf', 'pass', { 'smtp.mailfrom': 'sender@example.com' }),
        result('dkim', 'pass', { 'header.d': 'example.com' }),
      ]),
    ];
    const s = computePassAlignmentSummary({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(s).toEqual({
      spfAligned: false,
      anyDkimAligned: false,
      anyAuthAligned: false,
      anyTrustedAuthPass: false,
      spfMailFromRegistrableDomain: null,
      anyTrustedSpfPass: false,
      anyTrustedDkimFail: false,
      dkimFailDomains: [],
      anyTrustedDmarcFail: false,
      anyTrustedDmarcPass: false,
      anyTrustedDmarcNonNone: false,
      anyTrustedDmarcNone: false,
      anyTrustedSpfFail: false,
      spfFailMailFromRegistrableDomain: null,
    });
  });

  test('fromDomain with no registrable domain → all false (smtp.mailfrom also unregistrable)', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('spf', 'pass', { 'smtp.mailfrom': 'sender@localhost' }),
      ]),
    ];
    const s = computePassAlignmentSummary({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'localhost',
    });
    expect(s).toEqual({
      spfAligned: false,
      anyDkimAligned: false,
      anyAuthAligned: false,
      anyTrustedAuthPass: false,
      spfMailFromRegistrableDomain: null,
      anyTrustedSpfPass: false,
      anyTrustedDkimFail: false,
      dkimFailDomains: [],
      anyTrustedDmarcFail: false,
      anyTrustedDmarcPass: false,
      anyTrustedDmarcNonNone: false,
      anyTrustedDmarcNone: false,
      anyTrustedSpfFail: false,
      spfFailMailFromRegistrableDomain: null,
    });
  });

  test('fromDomain with no registrable domain but trusted SPF pass with valid smtp.mailfrom → anyTrustedAuthPass true', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('spf', 'pass', { 'smtp.mailfrom': 'sender@legit.example.com' }),
      ]),
    ];
    const s = computePassAlignmentSummary({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: '',
    });
    expect(s.anyTrustedAuthPass).toBe(true);
    expect(s.spfAligned).toBe(false);
    expect(s.anyDkimAligned).toBe(false);
    expect(s.anyAuthAligned).toBe(false);
  });

  test('fromDomain with no registrable domain but trusted SPF pass with smtp.helo only → anyTrustedAuthPass true', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('spf', 'pass', { 'smtp.helo': 'bounce-relay.legit.example.com' }),
      ]),
    ];
    const s = computePassAlignmentSummary({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: '',
    });
    expect(s.anyTrustedAuthPass).toBe(true);
    expect(s.spfAligned).toBe(false);
    expect(s.anyDkimAligned).toBe(false);
    expect(s.anyAuthAligned).toBe(false);
  });

  test('fromDomain with no registrable domain but trusted DKIM pass with valid domain → anyTrustedAuthPass true', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('dkim', 'pass', { 'header.d': 'legit.example.com' }),
      ]),
    ];
    const s = computePassAlignmentSummary({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: '',
    });
    expect(s.anyTrustedAuthPass).toBe(true);
    expect(s.spfAligned).toBe(false);
    expect(s.anyDkimAligned).toBe(false);
    expect(s.anyAuthAligned).toBe(false);
  });

  test('dkim=fail → anyTrustedDkimFail true, anyDkimAligned false', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('spf', 'pass', { 'smtp.mailfrom': 'sender@example.com' }),
        result('dkim', 'fail', { 'header.d': 'example.com' }),
      ]),
    ];
    const s = computePassAlignmentSummary({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(s.anyTrustedDkimFail).toBe(true);
    expect(s.anyDkimAligned).toBe(false);
    expect(s.dkimFailDomains).toEqual(['example.com']);
  });

  test('spf=pass sets anyTrustedSpfPass regardless of smtp.mailfrom', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('spf', 'pass', {}),
      ]),
    ];
    const s = computePassAlignmentSummary({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(s.anyTrustedSpfPass).toBe(true);
    expect(s.spfAligned).toBe(false);
  });

  test('untrusted AR dkim=fail → anyTrustedDkimFail false', () => {
    const parsedAuthResults = [
      trusted('untrusted.example.net', [
        result('dkim', 'fail', { 'header.d': 'example.com' }),
      ]),
    ];
    const s = computePassAlignmentSummary({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(s.anyTrustedDkimFail).toBe(false);
    expect(s.dkimFailDomains).toEqual([]);
  });

  test('trusted dmarc=none → anyTrustedDmarcNone true, anyTrustedDmarcNonNone false', () => {
    const parsedAuthResults = [
      trusted('mx.example.com', [
        result('dmarc', 'none'),
      ]),
    ];
    const s = computePassAlignmentSummary({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'nodmarc.example.com',
    });
    expect(s.anyTrustedDmarcNone).toBe(true);
    expect(s.anyTrustedDmarcNonNone).toBe(false);
    expect(s.anyTrustedDmarcFail).toBe(false);
    expect(s.anyTrustedDmarcPass).toBe(false);
  });

  test('no trusted AR headers → anyTrustedDmarcNone false', () => {
    const parsedAuthResults = [
      trusted('untrusted.example.net', [
        result('dmarc', 'none'),
      ]),
    ];
    const s = computePassAlignmentSummary({
      parsedAuthResults,
      trustedDomains: [exactTrust('mx.example.com')],
      fromDomain: 'example.com',
    });
    expect(s.anyTrustedDmarcNone).toBe(false);
  });
});

// ─── resolveDkimDomain ────────────────────────────────────────────────────────

describe('resolveDkimDomain', () => {
  test('returns header.d when present', () => {
    expect(resolveDkimDomain({ 'header.d': 'example.com' })).toBe('example.com');
  });

  test('returns bare d when header.d absent', () => {
    expect(resolveDkimDomain({ 'd': 'example.net' })).toBe('example.net');
  });

  test('header.d preferred over d and header.i', () => {
    expect(resolveDkimDomain({ 'header.d': 'first.com', 'd': 'second.com', 'header.i': '@third.com' })).toBe('first.com');
  });

  test('extracts domain from header.i=@repica.jp', () => {
    expect(resolveDkimDomain({ 'header.i': '@repica.jp' })).toBe('repica.jp');
  });

  test('extracts domain from header.i=user@sub.example.com', () => {
    expect(resolveDkimDomain({ 'header.i': 'user@sub.example.com' })).toBe('sub.example.com');
  });

  test('falls back to bare i when header.i absent', () => {
    expect(resolveDkimDomain({ 'i': 'user@example.org' })).toBe('example.org');
  });

  test('malformed header.i without @ returns null', () => {
    expect(resolveDkimDomain({ 'header.i': 'not-an-email' })).toBeNull();
  });

  test('empty header.i returns null', () => {
    expect(resolveDkimDomain({ 'header.i': '' })).toBeNull();
  });

  test('null properties returns null', () => {
    expect(resolveDkimDomain(null)).toBeNull();
  });

  test('undefined properties returns null', () => {
    expect(resolveDkimDomain(undefined)).toBeNull();
  });

  test('empty properties object returns null', () => {
    expect(resolveDkimDomain({})).toBeNull();
  });
});
