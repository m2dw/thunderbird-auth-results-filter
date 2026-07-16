import {
  scoreLayer4,
  computeMessageIdMetrics,
  DEFAULT_COMPOSITE_SCORES,
} from '../src/core/compositeRules.js';


// ─── DEFAULT_COMPOSITE_SCORES ─────────────────────────────────────────────────

describe('DEFAULT_COMPOSITE_SCORES', () => {
  test('includes messageIdMismatchWithUnalignedAuth', () => {
    expect(typeof DEFAULT_COMPOSITE_SCORES.messageIdMismatchWithUnalignedAuth).toBe('number');
    expect(DEFAULT_COMPOSITE_SCORES.messageIdMismatchWithUnalignedAuth).toBeGreaterThan(0);
  });

  test('includes unauthenticatedFromSpoof with positive default', () => {
    expect(typeof DEFAULT_COMPOSITE_SCORES.unauthenticatedFromSpoof).toBe('number');
    expect(DEFAULT_COMPOSITE_SCORES.unauthenticatedFromSpoof).toBeGreaterThan(0);
  });

  test('includes authenticatedDisplayNameSpoof with positive default', () => {
    expect(typeof DEFAULT_COMPOSITE_SCORES.authenticatedDisplayNameSpoof).toBe('number');
    expect(DEFAULT_COMPOSITE_SCORES.authenticatedDisplayNameSpoof).toBeGreaterThan(0);
  });

  test('includes publicDomainSpoofing with positive default', () => {
    expect(typeof DEFAULT_COMPOSITE_SCORES.publicDomainSpoofing).toBe('number');
    expect(DEFAULT_COMPOSITE_SCORES.publicDomainSpoofing).toBeGreaterThan(0);
  });
});

// ─── computeMessageIdMetrics ──────────────────────────────────────────────────

describe('computeMessageIdMetrics — basic parsing', () => {
  test('returns null metrics when messageIdDomain is null', () => {
    const m = computeMessageIdMetrics({ messageIdDomain: null, fromDomain: 'example.com' });
    expect(m.messageIdDomain).toBeNull();
    expect(m.messageIdRegistrableDomain).toBeNull();
    expect(m.messageIdDomainMatchesFromDomain).toBeNull();
    expect(m.messageIdFromDomainMismatch).toBe(false);
    expect(m.messageIdMismatchWithUnalignedAuth).toBe(false);
  });

  test('returns null comparison when fromDomain is empty', () => {
    const m = computeMessageIdMetrics({ messageIdDomain: 'sender.com', fromDomain: '' });
    expect(m.messageIdDomainMatchesFromDomain).toBeNull();
    expect(m.messageIdFromDomainMismatch).toBe(false);
    expect(m.messageIdMismatchWithUnalignedAuth).toBe(false);
  });

  test('match: same registrable domain — different subdomains', () => {
    const m = computeMessageIdMetrics({
      messageIdDomain: 'smtp.example.com',
      fromDomain: 'example.com',
      anyAuthAligned: false,
    });
    expect(m.messageIdDomainMatchesFromDomain).toBe(true);
    expect(m.messageIdFromDomainMismatch).toBe(false);
    expect(m.messageIdMismatchWithUnalignedAuth).toBe(false);
  });

  test('mismatch: different registrable domains', () => {
    const m = computeMessageIdMetrics({
      messageIdDomain: 'delivery.sendgrid.net',
      fromDomain: 'brand.example.com',
      anyAuthAligned: false,
    });
    expect(m.messageIdRegistrableDomain).toBe('sendgrid.net');
    expect(m.messageIdDomainMatchesFromDomain).toBe(false);
    expect(m.messageIdFromDomainMismatch).toBe(true);
    expect(m.messageIdMismatchWithUnalignedAuth).toBe(true);
  });

  test('mismatch but auth aligned — messageIdMismatchWithUnalignedAuth is false', () => {
    const m = computeMessageIdMetrics({
      messageIdDomain: 'delivery.sendgrid.net',
      fromDomain: 'brand.example.com',
      anyAuthAligned: true,
    });
    expect(m.messageIdFromDomainMismatch).toBe(true);
    expect(m.messageIdMismatchWithUnalignedAuth).toBe(false);
  });

  test('match with jp ccTLD registrable domains', () => {
    const m = computeMessageIdMetrics({
      messageIdDomain: 'mail.example.co.jp',
      fromDomain: 'info.example.co.jp',
      anyAuthAligned: false,
    });
    expect(m.messageIdDomainMatchesFromDomain).toBe(true);
    expect(m.messageIdFromDomainMismatch).toBe(false);
  });

  test('returns all expected metric keys', () => {
    const m = computeMessageIdMetrics({});
    expect(Object.keys(m)).toEqual([
      'messageIdDomain',
      'messageIdRegistrableDomain',
      'messageIdIsIcann',
      'messageIdSubdomainDepth',
      'messageIdDomainMatchesFromDomain',
      'messageIdFromDomainMismatch',
      'messageIdMismatchWithUnalignedAuth',
    ]);
  });

  test('messageIdSubdomainDepth is null when messageIdDomain is null', () => {
    const m = computeMessageIdMetrics({ messageIdDomain: null, fromDomain: 'example.com' });
    expect(m.messageIdSubdomainDepth).toBeNull();
  });

  test('messageIdSubdomainDepth is 0 when messageIdDomain has no subdomain', () => {
    const m = computeMessageIdMetrics({ messageIdDomain: 'example.com', fromDomain: 'example.com' });
    expect(m.messageIdSubdomainDepth).toBe(0);
  });

  test('messageIdSubdomainDepth is 1 for a single-level subdomain', () => {
    const m = computeMessageIdMetrics({ messageIdDomain: 'smtp.example.com', fromDomain: 'example.com' });
    expect(m.messageIdSubdomainDepth).toBe(1);
  });

  test('messageIdSubdomainDepth is 2 for a two-level subdomain', () => {
    const m = computeMessageIdMetrics({ messageIdDomain: 'a.b.example.com', fromDomain: 'example.com' });
    expect(m.messageIdSubdomainDepth).toBe(2);
  });
});

// ─── scoreLayer4 — messageIdMismatchWithUnalignedAuth rule ───────────────────

const noAuth = {
  spfAligned: false,
  anyDkimAligned: false,
  anyAuthAligned: false,
  anyTrustedAuthPass: false,
};

describe('scoreLayer4 — composite.messageIdMismatchWithUnalignedAuth', () => {
  test('fires when Message-ID registrable domain differs and auth is unaligned', () => {
    const { score, scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'brand.example.com',
      fromLocalPart: 'info',
      messageIdDomain: 'delivery.sendgrid.net',
    });
    const reason = scoreReasons.find(r => r.key === 'composite.messageIdMismatchWithUnalignedAuth');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_COMPOSITE_SCORES.messageIdMismatchWithUnalignedAuth);
    expect(score).toBeGreaterThanOrEqual(DEFAULT_COMPOSITE_SCORES.messageIdMismatchWithUnalignedAuth);
  });

  test('does NOT fire when Message-ID registrable domain matches From', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'example.com',
      messageIdDomain: 'smtp.example.com',
    });
    expect(scoreReasons.find(r => r.key === 'composite.messageIdMismatchWithUnalignedAuth')).toBeUndefined();
  });

  test('does NOT fire when any DKIM pass aligns with From (anyDkimAligned: true)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...noAuth, anyDkimAligned: true, anyAuthAligned: true },
      fromDomain: 'brand.example.com',
      messageIdDomain: 'delivery.sendgrid.net',
    });
    expect(scoreReasons.find(r => r.key === 'composite.messageIdMismatchWithUnalignedAuth')).toBeUndefined();
  });

  test('does NOT fire when SPF aligns with From (anyAuthAligned: true)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...noAuth, spfAligned: true, anyAuthAligned: true },
      fromDomain: 'brand.example.com',
      messageIdDomain: 'delivery.sendgrid.net',
    });
    expect(scoreReasons.find(r => r.key === 'composite.messageIdMismatchWithUnalignedAuth')).toBeUndefined();
  });

  test('does NOT fire when messageIdDomain is null', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'example.com',
      messageIdDomain: null,
    });
    expect(scoreReasons.find(r => r.key === 'composite.messageIdMismatchWithUnalignedAuth')).toBeUndefined();
  });

  test('does NOT fire when fromDomain is empty', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: '',
      messageIdDomain: 'delivery.sendgrid.net',
    });
    expect(scoreReasons.find(r => r.key === 'composite.messageIdMismatchWithUnalignedAuth')).toBeUndefined();
  });

  test('score reason includes messageIdDomain and messageIdRegistrableDomain', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'brand.example.com',
      messageIdDomain: 'delivery.sendgrid.net',
    });
    const reason = scoreReasons.find(r => r.key === 'composite.messageIdMismatchWithUnalignedAuth');
    expect(reason.messageIdDomain).toBe('delivery.sendgrid.net');
    expect(reason.messageIdRegistrableDomain).toBe('sendgrid.net');
    expect(reason.fromDomain).toBe('brand.example.com');
  });

  test('uses configurable compositeScores value', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'brand.example.com',
      messageIdDomain: 'delivery.sendgrid.net',
      compositeScores: { messageIdMismatchWithUnalignedAuth: 5 },
    });
    const reason = scoreReasons.find(r => r.key === 'composite.messageIdMismatchWithUnalignedAuth');
    expect(reason.delta).toBe(5);
  });

  test('does NOT fire when called with no arguments', () => {
    expect(() => scoreLayer4()).not.toThrow();
    const { scoreReasons } = scoreLayer4();
    expect(scoreReasons.find(r => r.key === 'composite.messageIdMismatchWithUnalignedAuth')).toBeUndefined();
  });
});

// ─── scoreLayer4 — composite.fromSenderMismatchWithUnalignedAuth ──────────────

describe('scoreLayer4 — composite.fromSenderMismatchWithUnalignedAuth', () => {
  const mismatched = {
    senderRegistrableDomain: 'sender.com',
    senderDomainMatchesFromDomain: false,
    hasListHeaders: false,
  };

  test('fires when Sender differs from From and auth is unaligned', () => {
    const { score, scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'brand.example.com',
      ...mismatched,
    });
    const reason = scoreReasons.find(r => r.key === 'composite.fromSenderMismatchWithUnalignedAuth');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_COMPOSITE_SCORES.fromSenderMismatchWithUnalignedAuth);
    expect(score).toBeGreaterThanOrEqual(DEFAULT_COMPOSITE_SCORES.fromSenderMismatchWithUnalignedAuth);
  });

  test('does NOT fire when Sender registrable domain matches From (mismatch alone)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'sender.com',
      senderRegistrableDomain: 'sender.com',
      senderDomainMatchesFromDomain: true,
      hasListHeaders: false,
    });
    expect(scoreReasons.find(r => r.key === 'composite.fromSenderMismatchWithUnalignedAuth')).toBeUndefined();
  });

  test('does NOT fire when anyAuthAligned is true (aligned DKIM/SPF suppresses)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...noAuth, anyAuthAligned: true },
      fromDomain: 'brand.example.com',
      ...mismatched,
    });
    expect(scoreReasons.find(r => r.key === 'composite.fromSenderMismatchWithUnalignedAuth')).toBeUndefined();
  });

  test('does NOT fire when hasListHeaders is true', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'brand.example.com',
      senderRegistrableDomain: 'sender.com',
      senderDomainMatchesFromDomain: false,
      hasListHeaders: true,
    });
    expect(scoreReasons.find(r => r.key === 'composite.fromSenderMismatchWithUnalignedAuth')).toBeUndefined();
  });

  test('does NOT fire when senderRegistrableDomain is null (absent Sender header)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'brand.example.com',
      senderRegistrableDomain: null,
      senderDomainMatchesFromDomain: null,
      hasListHeaders: false,
    });
    expect(scoreReasons.find(r => r.key === 'composite.fromSenderMismatchWithUnalignedAuth')).toBeUndefined();
  });

  test('score reason includes senderRegistrableDomain and fromDomain', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'brand.example.com',
      ...mismatched,
    });
    const reason = scoreReasons.find(r => r.key === 'composite.fromSenderMismatchWithUnalignedAuth');
    expect(reason.senderRegistrableDomain).toBe('sender.com');
    expect(reason.fromDomain).toBe('brand.example.com');
  });

  test('uses configurable compositeScores value', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'brand.example.com',
      ...mismatched,
      compositeScores: { fromSenderMismatchWithUnalignedAuth: 5 },
    });
    const reason = scoreReasons.find(r => r.key === 'composite.fromSenderMismatchWithUnalignedAuth');
    expect(reason.delta).toBe(5);
  });

  test('does NOT fire when called with no arguments', () => {
    expect(() => scoreLayer4()).not.toThrow();
    const { scoreReasons } = scoreLayer4();
    expect(scoreReasons.find(r => r.key === 'composite.fromSenderMismatchWithUnalignedAuth')).toBeUndefined();
  });
});
// ─── scoreLayer4 — composite.deepRandomFromSubdomain ─────────────────────────

const authAligned = {
  spfAligned: false,
  anyDkimAligned: false,
  anyAuthAligned: true,
  anyTrustedAuthPass: true,
};

describe('scoreLayer4 — composite.deepRandomFromSubdomain', () => {
  test('fires for deep (depth 2) random leftmost label with auth aligned', () => {
    const { score, scoreReasons } = scoreLayer4({
      alignmentSummary: authAligned,
      fromDomain: 'ppbwwcyr.customer.233biz.com',
      fromLocalPart: 'info',
    });
    const reason = scoreReasons.find(r => r.key === 'composite.deepRandomFromSubdomain');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_COMPOSITE_SCORES.deepRandomFromSubdomain);
    expect(reason.matchedLabel).toBe('ppbwwcyr');
    expect(reason.subdomainDepth).toBe(2);
    expect(reason.fromDomain).toBe('ppbwwcyr.customer.233biz.com');
    expect(score).toBeGreaterThanOrEqual(DEFAULT_COMPOSITE_SCORES.deepRandomFromSubdomain);
  });

  test('fires for another deep random subdomain pattern', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: authAligned,
      fromDomain: 'knlpjhmf.support.ovrkj.com',
      fromLocalPart: 'info',
    });
    const reason = scoreReasons.find(r => r.key === 'composite.deepRandomFromSubdomain');
    expect(reason).toBeDefined();
    expect(reason.matchedLabel).toBe('knlpjhmf');
  });

  test('does NOT fire when subdomainDepth is 1 (shallow)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: authAligned,
      fromDomain: 'ppbwwcyr.ohnkj.com',
      fromLocalPart: 'info',
    });
    expect(scoreReasons.find(r => r.key === 'composite.deepRandomFromSubdomain')).toBeUndefined();
  });

  test('does NOT fire when subdomainDepth is 0 (no subdomain)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: authAligned,
      fromDomain: 'example.com',
      fromLocalPart: 'info',
    });
    expect(scoreReasons.find(r => r.key === 'composite.deepRandomFromSubdomain')).toBeUndefined();
  });

  test('does NOT fire when leftmost label is non-random enterprise-like (short)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: authAligned,
      fromDomain: 'mail.support.example.com',
      fromLocalPart: 'info',
    });
    expect(scoreReasons.find(r => r.key === 'composite.deepRandomFromSubdomain')).toBeUndefined();
  });

  test('does NOT fire when leftmost label is non-random enterprise-like (readable word)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: authAligned,
      fromDomain: 'helpdesk.support.example.com',
      fromLocalPart: 'info',
    });
    expect(scoreReasons.find(r => r.key === 'composite.deepRandomFromSubdomain')).toBeUndefined();
  });

  test('does NOT fire when anyAuthAligned is false (absent auth alignment)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...noAuth },
      fromDomain: 'ppbwwcyr.customer.233biz.com',
      fromLocalPart: 'info',
    });
    expect(scoreReasons.find(r => r.key === 'composite.deepRandomFromSubdomain')).toBeUndefined();
  });

  test('does NOT fire when anyAuthAligned is false even with anyTrustedAuthPass true', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...noAuth, anyTrustedAuthPass: true },
      fromDomain: 'ppbwwcyr.customer.233biz.com',
      fromLocalPart: 'info',
    });
    expect(scoreReasons.find(r => r.key === 'composite.deepRandomFromSubdomain')).toBeUndefined();
  });

  test('score reason includes registrableDomain', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: authAligned,
      fromDomain: 'ppbwwcyr.customer.233biz.com',
      fromLocalPart: 'info',
    });
    const reason = scoreReasons.find(r => r.key === 'composite.deepRandomFromSubdomain');
    expect(reason.registrableDomain).toBe('233biz.com');
  });

  test('uses configurable compositeScores value', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: authAligned,
      fromDomain: 'ppbwwcyr.customer.233biz.com',
      compositeScores: { deepRandomFromSubdomain: 10 },
    });
    const reason = scoreReasons.find(r => r.key === 'composite.deepRandomFromSubdomain');
    expect(reason.delta).toBe(10);
  });

  test('DEFAULT_COMPOSITE_SCORES includes deepRandomFromSubdomain', () => {
    expect(typeof DEFAULT_COMPOSITE_SCORES.deepRandomFromSubdomain).toBe('number');
    expect(DEFAULT_COMPOSITE_SCORES.deepRandomFromSubdomain).toBeGreaterThan(0);
  });
});

// ─── scoreLayer4 — composite.delegatedDkimAlignedRouteConsistent ─────────────

describe('scoreLayer4 — composite.delegatedDkimAlignedRouteConsistent', () => {
  const dkimAlignedNoSpf = {
    spfAligned: false,
    anyDkimAligned: true,
    anyAuthAligned: true,
    anyTrustedAuthPass: true,
  };

  const baseArgs = {
    alignmentSummary: dkimAlignedNoSpf,
    fromDomain: 'brand.example.com',
    messageIdDomain: 'delivery.sendgrid.net',
    spfMailFromRegistrableDomain: 'sendgrid.net',
    hasListHeaders: true,
  };

  test('fires when DKIM aligned, route domains match (Message-ID reg domain === SPF MAIL FROM reg domain)', () => {
    const { score, scoreReasons } = scoreLayer4(baseArgs);
    const reason = scoreReasons.find(r => r.key === 'composite.delegatedDkimAlignedRouteConsistent');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_COMPOSITE_SCORES.delegatedDkimAlignedRouteConsistent);
    expect(reason.delta).toBeLessThan(0);
    expect(score).toBeLessThanOrEqual(DEFAULT_COMPOSITE_SCORES.delegatedDkimAlignedRouteConsistent);
  });

  test('does NOT fire when anyDkimAligned is false', () => {
    const { scoreReasons } = scoreLayer4({
      ...baseArgs,
      alignmentSummary: { ...dkimAlignedNoSpf, anyDkimAligned: false, anyAuthAligned: false },
    });
    expect(scoreReasons.find(r => r.key === 'composite.delegatedDkimAlignedRouteConsistent')).toBeUndefined();
  });

  test('does NOT fire when messageIdDomain is null (missing Message-ID domain)', () => {
    const { scoreReasons } = scoreLayer4({
      ...baseArgs,
      messageIdDomain: null,
    });
    expect(scoreReasons.find(r => r.key === 'composite.delegatedDkimAlignedRouteConsistent')).toBeUndefined();
  });

  test('does NOT fire when spfMailFromRegistrableDomain is null', () => {
    const { scoreReasons } = scoreLayer4({
      ...baseArgs,
      spfMailFromRegistrableDomain: null,
    });
    expect(scoreReasons.find(r => r.key === 'composite.delegatedDkimAlignedRouteConsistent')).toBeUndefined();
  });

  test('does NOT fire when Message-ID domain and SPF MAIL FROM domain differ', () => {
    const { scoreReasons } = scoreLayer4({
      ...baseArgs,
      messageIdDomain: 'delivery.mailchimp.com',
      spfMailFromRegistrableDomain: 'sendgrid.net',
    });
    expect(scoreReasons.find(r => r.key === 'composite.delegatedDkimAlignedRouteConsistent')).toBeUndefined();
  });

  test('does NOT fire when SPF is also aligned with From (spfAligned: true)', () => {
    const { scoreReasons } = scoreLayer4({
      ...baseArgs,
      alignmentSummary: { ...dkimAlignedNoSpf, spfAligned: true },
    });
    expect(scoreReasons.find(r => r.key === 'composite.delegatedDkimAlignedRouteConsistent')).toBeUndefined();
  });

  test('score reason includes fromDomain, messageIdRegistrableDomain, spfMailFromRegistrableDomain', () => {
    const { scoreReasons } = scoreLayer4(baseArgs);
    const reason = scoreReasons.find(r => r.key === 'composite.delegatedDkimAlignedRouteConsistent');
    expect(reason.fromDomain).toBe('brand.example.com');
    expect(reason.messageIdRegistrableDomain).toBe('sendgrid.net');
    expect(reason.spfMailFromRegistrableDomain).toBe('sendgrid.net');
  });

  test('uses configurable compositeScores value', () => {
    const { scoreReasons } = scoreLayer4({
      ...baseArgs,
      compositeScores: { delegatedDkimAlignedRouteConsistent: -15 },
    });
    const reason = scoreReasons.find(r => r.key === 'composite.delegatedDkimAlignedRouteConsistent');
    expect(reason.delta).toBe(-15);
  });

  test('does NOT fire without List headers (hasListHeaders: false)', () => {
    const { scoreReasons } = scoreLayer4({
      ...baseArgs,
      hasListHeaders: false,
    });
    expect(scoreReasons.find(r => r.key === 'composite.delegatedDkimAlignedRouteConsistent')).toBeUndefined();
  });

  test('fires when all conditions including List headers are satisfied', () => {
    const { scoreReasons } = scoreLayer4({
      ...baseArgs,
      hasListHeaders: true,
    });
    expect(scoreReasons.find(r => r.key === 'composite.delegatedDkimAlignedRouteConsistent')).toBeDefined();
  });

  test('DEFAULT_COMPOSITE_SCORES includes delegatedDkimAlignedRouteConsistent as a negative value', () => {
    expect(typeof DEFAULT_COMPOSITE_SCORES.delegatedDkimAlignedRouteConsistent).toBe('number');
    expect(DEFAULT_COMPOSITE_SCORES.delegatedDkimAlignedRouteConsistent).toBeLessThan(0);
  });
});

// ─── scoreLayer4 — composite.spfPassDkimFailRandomLocal ───────────────────────

const spfPassDkimFailBase = {
  anyTrustedSpfPass: true,
  anyTrustedDkimFail: true,
  anyDkimAligned: false,
  dkimFailDomains: ['disposable.net'],
  spfAligned: false,
  anyAuthAligned: false,
  anyTrustedAuthPass: false,
};

describe('scoreLayer4 — composite.spfPassDkimFailRandomLocal', () => {
  test('fires when SPF pass + DKIM fail + no DKIM aligned + random local part', () => {
    const { score, scoreReasons } = scoreLayer4({
      alignmentSummary: spfPassDkimFailBase,
      fromDomain: 'spammer.net',
      fromLocalPart: 'xkqvbtzm',
    });
    const reason = scoreReasons.find(r => r.key === 'composite.spfPassDkimFailRandomLocal');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_COMPOSITE_SCORES.spfPassDkimFailRandomLocal);
    expect(score).toBeGreaterThanOrEqual(DEFAULT_COMPOSITE_SCORES.spfPassDkimFailRandomLocal);
  });

  test('score reason includes localPart and dkimFailDomains', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...spfPassDkimFailBase, dkimFailDomains: ['badmailer.io'] },
      fromDomain: 'spammer.net',
      fromLocalPart: 'xkqvbtzm',
    });
    const reason = scoreReasons.find(r => r.key === 'composite.spfPassDkimFailRandomLocal');
    expect(reason.localPart).toBe('xkqvbtzm');
    expect(reason.dkimFailDomains).toEqual(['badmailer.io']);
  });

  test('does NOT fire when a DKIM pass aligns with From (anyDkimAligned: true)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...spfPassDkimFailBase, anyDkimAligned: true },
      fromDomain: 'spammer.net',
      fromLocalPart: 'xkqvbtzm',
    });
    expect(scoreReasons.find(r => r.key === 'composite.spfPassDkimFailRandomLocal')).toBeUndefined();
  });

  test('does NOT fire when local part is not random-looking', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: spfPassDkimFailBase,
      fromDomain: 'spammer.net',
      fromLocalPart: 'newsletter',
    });
    expect(scoreReasons.find(r => r.key === 'composite.spfPassDkimFailRandomLocal')).toBeUndefined();
  });

  test('does NOT fire when there is no trusted DKIM fail (anyTrustedDkimFail: false)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...spfPassDkimFailBase, anyTrustedDkimFail: false },
      fromDomain: 'spammer.net',
      fromLocalPart: 'xkqvbtzm',
    });
    expect(scoreReasons.find(r => r.key === 'composite.spfPassDkimFailRandomLocal')).toBeUndefined();
  });

  test('does NOT fire when there is no trusted SPF pass (anyTrustedSpfPass: false)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...spfPassDkimFailBase, anyTrustedSpfPass: false },
      fromDomain: 'spammer.net',
      fromLocalPart: 'xkqvbtzm',
    });
    expect(scoreReasons.find(r => r.key === 'composite.spfPassDkimFailRandomLocal')).toBeUndefined();
  });

  test('does NOT fire when local part is too short (length < 7)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: spfPassDkimFailBase,
      fromDomain: 'spammer.net',
      fromLocalPart: 'xkqvbt',
    });
    expect(scoreReasons.find(r => r.key === 'composite.spfPassDkimFailRandomLocal')).toBeUndefined();
  });

  test('uses configurable compositeScores value', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: spfPassDkimFailBase,
      fromDomain: 'spammer.net',
      fromLocalPart: 'xkqvbtzm',
      compositeScores: { spfPassDkimFailRandomLocal: 5 },
    });
    const reason = scoreReasons.find(r => r.key === 'composite.spfPassDkimFailRandomLocal');
    expect(reason.delta).toBe(5);
  });

  test('does NOT fire when called with no arguments', () => {
    expect(() => scoreLayer4()).not.toThrow();
    const { scoreReasons } = scoreLayer4();
    expect(scoreReasons.find(r => r.key === 'composite.spfPassDkimFailRandomLocal')).toBeUndefined();
  });
});

// ─── scoreLayer4 — composite.dkimAlignedLexicalMitigation ────────────────────

describe('scoreLayer4 — composite.dkimAlignedLexicalMitigation', () => {
  // Aligned DKIM, SPF not aligned (typical delegated newsletter route).
  const dkimAlignedDelegatedRoute = {
    spfAligned: false,
    anyDkimAligned: true,
    anyAuthAligned: true,
    anyTrustedAuthPass: true,
    anyTrustedSpfPass: true,
    anyTrustedDkimFail: false,
    dkimFailDomains: [],
  };

  // Consistent delegated route with list headers: Message-ID and SPF MAIL FROM
  // share a registrable domain, and List headers confirm newsletter/list context.
  const routeConsistentOpts = {
    messageIdDomain: 'smtp.esp.com',
    spfMailFromRegistrableDomain: 'esp.com',
    hasListHeaders: true,
  };

  test('fires for legitimate delegated route + DKIM aligned + lexical penalty + list headers', () => {
    const { score, scoreReasons } = scoreLayer4({
      alignmentSummary: dkimAlignedDelegatedRoute,
      fromDomain: 'newsletter.brand.com',
      fromLocalPart: 'info',
      hasLexicalPenalty: true,
      ...routeConsistentOpts,
    });
    const reason = scoreReasons.find(r => r.key === 'composite.dkimAlignedLexicalMitigation');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_COMPOSITE_SCORES.dkimAlignedLexicalMitigation);
    expect(reason.delta).toBeLessThan(0);
    expect(score).toBeLessThanOrEqual(0);
  });

  test('does NOT fire without List headers (hasListHeaders: false)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dkimAlignedDelegatedRoute,
      fromDomain: 'newsletter.brand.com',
      fromLocalPart: 'info',
      hasLexicalPenalty: true,
      messageIdDomain: 'smtp.esp.com',
      spfMailFromRegistrableDomain: 'esp.com',
      hasListHeaders: false,
    });
    expect(scoreReasons.find(r => r.key === 'composite.dkimAlignedLexicalMitigation')).toBeUndefined();
  });

  test('does NOT fire when registrable domain main label is random-looking', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dkimAlignedDelegatedRoute,
      fromDomain: 'ppbwwcyr.com',
      fromLocalPart: 'info',
      hasLexicalPenalty: true,
      ...routeConsistentOpts,
    });
    expect(scoreReasons.find(r => r.key === 'composite.dkimAlignedLexicalMitigation')).toBeUndefined();
  });

  test('does NOT fire when lexical penalty is absent', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dkimAlignedDelegatedRoute,
      fromDomain: 'newsletter.brand.com',
      fromLocalPart: 'info',
      hasLexicalPenalty: false,
      ...routeConsistentOpts,
    });
    expect(scoreReasons.find(r => r.key === 'composite.dkimAlignedLexicalMitigation')).toBeUndefined();
  });

  test('does NOT fire when route is inconsistent (Message-ID != SPF MAIL FROM domain)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dkimAlignedDelegatedRoute,
      fromDomain: 'newsletter.brand.com',
      fromLocalPart: 'info',
      hasLexicalPenalty: true,
      messageIdDomain: 'smtp.otheresp.com',
      spfMailFromRegistrableDomain: 'esp.com',
    });
    expect(scoreReasons.find(r => r.key === 'composite.dkimAlignedLexicalMitigation')).toBeUndefined();
  });

  test('does NOT fire when DKIM is not aligned', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...dkimAlignedDelegatedRoute, anyDkimAligned: false, anyAuthAligned: false },
      fromDomain: 'newsletter.brand.com',
      fromLocalPart: 'info',
      hasLexicalPenalty: true,
      ...routeConsistentOpts,
    });
    expect(scoreReasons.find(r => r.key === 'composite.dkimAlignedLexicalMitigation')).toBeUndefined();
  });

  test('does NOT fire when Message-ID is unregistrable (messageIdUnregistrableMismatch suppressed by DKIM alignment; route consistency also fails)', () => {
    // When anyDkimAligned is true, messageIdUnregistrableMismatch is suppressed by the
    // DKIM-aligned bypass. dkimAlignedLexicalMitigation also does not fire because the
    // route consistency check requires messageIdRegistrableDomain !== null, which is null
    // for an unregistrable Message-ID host.
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...dkimAlignedDelegatedRoute, anyTrustedSpfPass: true },
      fromDomain: 'newsletter.brand.com',
      fromLocalPart: 'info',
      hasLexicalPenalty: true,
      messageIdDomain: 'internalhost',
      spfMailFromRegistrableDomain: 'esp.com',
    });
    expect(scoreReasons.find(r => r.key === 'composite.messageIdUnregistrableMismatch')).toBeUndefined();
    expect(scoreReasons.find(r => r.key === 'composite.dkimAlignedLexicalMitigation')).toBeUndefined();
  });

  test('score reason includes expected context fields', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dkimAlignedDelegatedRoute,
      fromDomain: 'newsletter.brand.com',
      fromLocalPart: 'info',
      hasLexicalPenalty: true,
      ...routeConsistentOpts,
    });
    const reason = scoreReasons.find(r => r.key === 'composite.dkimAlignedLexicalMitigation');
    expect(reason.fromDomain).toBe('newsletter.brand.com');
    expect(reason.fromRegistrableDomain).toBe('brand.com');
    expect(reason.messageIdRegistrableDomain).toBe('esp.com');
    expect(reason.spfMailFromRegistrableDomain).toBe('esp.com');
  });

  test('uses configurable compositeScores value', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dkimAlignedDelegatedRoute,
      fromDomain: 'newsletter.brand.com',
      fromLocalPart: 'info',
      hasLexicalPenalty: true,
      ...routeConsistentOpts,
      compositeScores: { dkimAlignedLexicalMitigation: -15 },
    });
    const reason = scoreReasons.find(r => r.key === 'composite.dkimAlignedLexicalMitigation');
    expect(reason.delta).toBe(-15);
  });

  test('DEFAULT_COMPOSITE_SCORES includes dkimAlignedLexicalMitigation as a negative value', () => {
    expect(typeof DEFAULT_COMPOSITE_SCORES.dkimAlignedLexicalMitigation).toBe('number');
    expect(DEFAULT_COMPOSITE_SCORES.dkimAlignedLexicalMitigation).toBeLessThan(0);
  });
});

// ─── scoreLayer4 — composite.ownDomainAuthFail ────────────────────────────────

const dmarcFail = {
  spfAligned: false,
  anyDkimAligned: false,
  anyAuthAligned: false,
  anyTrustedAuthPass: false,
  anyTrustedDmarcFail: true,
  anyTrustedSpfFail: false,
};

const spfFail = {
  spfAligned: false,
  anyDkimAligned: false,
  anyAuthAligned: false,
  anyTrustedAuthPass: false,
  anyTrustedDmarcFail: false,
  anyTrustedSpfFail: true,
  spfFailMailFromRegistrableDomain: 'example.com',
};

const bothFail = {
  spfAligned: false,
  anyDkimAligned: false,
  anyAuthAligned: false,
  anyTrustedAuthPass: false,
  anyTrustedDmarcFail: true,
  anyTrustedSpfFail: true,
  spfFailMailFromRegistrableDomain: 'example.com',
};

describe('scoreLayer4 — composite.ownDomainAuthFail', () => {
  test('fires when From registrable domain matches account domain and DMARC fails', () => {
    const { score, scoreReasons } = scoreLayer4({
      alignmentSummary: dmarcFail,
      fromDomain: 'mail.example.com',
      accountDomains: ['example.com'],
    });
    const reason = scoreReasons.find(r => r.key === 'composite.ownDomainAuthFail');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_COMPOSITE_SCORES.ownDomainAuthFail);
    expect(reason.delta).toBeGreaterThan(0);
    expect(score).toBeGreaterThanOrEqual(DEFAULT_COMPOSITE_SCORES.ownDomainAuthFail);
  });

  test('fires when From registrable domain matches account domain and SPF fails', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: spfFail,
      fromDomain: 'example.com',
      accountDomains: ['example.com'],
    });
    const reason = scoreReasons.find(r => r.key === 'composite.ownDomainAuthFail');
    expect(reason).toBeDefined();
  });

  test('fires when both DMARC and SPF fail', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: bothFail,
      fromDomain: 'example.com',
      accountDomains: ['example.com'],
    });
    const reason = scoreReasons.find(r => r.key === 'composite.ownDomainAuthFail');
    expect(reason).toBeDefined();
    expect(reason.dmarcResult).toBe('fail');
    expect(reason.spfResult).toBe('fail');
  });

  test('score reason includes fromDomain and accountDomain', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dmarcFail,
      fromDomain: 'mail.example.com',
      accountDomains: ['example.com'],
    });
    const reason = scoreReasons.find(r => r.key === 'composite.ownDomainAuthFail');
    expect(reason.fromDomain).toBe('mail.example.com');
    expect(reason.accountDomain).toBe('example.com');
    expect(reason.dmarcResult).toBe('fail');
    expect(reason.spfResult).toBeUndefined();
  });

  test('does NOT fire when From registrable domain differs from account domain', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dmarcFail,
      fromDomain: 'attacker.com',
      accountDomains: ['example.com'],
    });
    expect(scoreReasons.find(r => r.key === 'composite.ownDomainAuthFail')).toBeUndefined();
  });

  test('does NOT fire when accountDomains is empty (unavailable)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dmarcFail,
      fromDomain: 'example.com',
      accountDomains: [],
    });
    expect(scoreReasons.find(r => r.key === 'composite.ownDomainAuthFail')).toBeUndefined();
  });

  test('does NOT fire when neither DMARC nor SPF fails (only DKIM fail)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: {
        ...noAuth,
        anyTrustedDmarcFail: false,
        anyTrustedSpfFail: false,
        anyTrustedDkimFail: true,
      },
      fromDomain: 'example.com',
      accountDomains: ['example.com'],
    });
    expect(scoreReasons.find(r => r.key === 'composite.ownDomainAuthFail')).toBeUndefined();
  });

  test('does NOT fire when fromDomain is empty', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dmarcFail,
      fromDomain: '',
      accountDomains: ['example.com'],
    });
    expect(scoreReasons.find(r => r.key === 'composite.ownDomainAuthFail')).toBeUndefined();
  });

  test('uses configurable compositeScores value', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dmarcFail,
      fromDomain: 'example.com',
      accountDomains: ['example.com'],
      compositeScores: { ownDomainAuthFail: 50 },
    });
    const reason = scoreReasons.find(r => r.key === 'composite.ownDomainAuthFail');
    expect(reason.delta).toBe(50);
  });

  test('matches subdomain of account domain (registrable-domain comparison)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: {
        ...spfFail,
        spfFailMailFromRegistrableDomain: 'example.co.jp',
      },
      fromDomain: 'subdomain.example.co.jp',
      accountDomains: ['example.co.jp'],
    });
    const reason = scoreReasons.find(r => r.key === 'composite.ownDomainAuthFail');
    expect(reason).toBeDefined();
  });

  test('fires when SPF fails for an unrelated bounce domain (attacker spoofs From while using different MAIL FROM)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: {
        ...spfFail,
        spfFailMailFromRegistrableDomain: 'forwarder.net',
      },
      fromDomain: 'example.com',
      accountDomains: ['example.com'],
    });
    const reason = scoreReasons.find(r => r.key === 'composite.ownDomainAuthFail');
    expect(reason).toBeDefined();
    expect(reason.spfResult).toBe('fail');
  });

  test('fires when SPF fails and spfFailMailFromRegistrableDomain is null', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: {
        ...spfFail,
        spfFailMailFromRegistrableDomain: null,
      },
      fromDomain: 'example.com',
      accountDomains: ['example.com'],
    });
    const reason = scoreReasons.find(r => r.key === 'composite.ownDomainAuthFail');
    expect(reason).toBeDefined();
    expect(reason.spfResult).toBe('fail');
  });

  test('does NOT fire when called with no arguments', () => {
    expect(() => scoreLayer4()).not.toThrow();
    const { scoreReasons } = scoreLayer4();
    expect(scoreReasons.find(r => r.key === 'composite.ownDomainAuthFail')).toBeUndefined();
  });

  test('fires when From matches a secondary identity domain (not the first in the array)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dmarcFail,
      fromDomain: 'work.example',
      accountDomains: ['personal.example', 'work.example'],
    });
    const reason = scoreReasons.find(r => r.key === 'composite.ownDomainAuthFail');
    expect(reason).toBeDefined();
    expect(reason.accountDomain).toBe('work.example');
    expect(reason.fromDomain).toBe('work.example');
  });

  test('does NOT fire when From matches none of the account identity domains', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dmarcFail,
      fromDomain: 'attacker.com',
      accountDomains: ['personal.example', 'work.example'],
    });
    expect(scoreReasons.find(r => r.key === 'composite.ownDomainAuthFail')).toBeUndefined();
  });

  test('DEFAULT_COMPOSITE_SCORES includes ownDomainAuthFail as a positive value', () => {
    expect(typeof DEFAULT_COMPOSITE_SCORES.ownDomainAuthFail).toBe('number');
    expect(DEFAULT_COMPOSITE_SCORES.ownDomainAuthFail).toBeGreaterThan(0);
  });
});

// ─── scoreLayer4 — composite.messageIdUnregistrableMismatch ──────────────────

const spfPassAuth = {
  spfAligned: false,
  anyDkimAligned: false,
  anyAuthAligned: false,
  anyTrustedAuthPass: true,
  anyTrustedSpfPass: true,
  anyTrustedDkimFail: false,
  dkimFailDomains: [],
};

describe('scoreLayer4 — composite.messageIdUnregistrableMismatch', () => {
  test('fires when Message-ID domain is present but unregistrable and trusted SPF pass exists', () => {
    const { score, scoreReasons } = scoreLayer4({
      alignmentSummary: spfPassAuth,
      fromDomain: 'disposable-spam.xyz',
      messageIdDomain: 'internalserver',
    });
    const reason = scoreReasons.find(r => r.key === 'composite.messageIdUnregistrableMismatch');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_COMPOSITE_SCORES.messageIdUnregistrableMismatch);
    expect(score).toBeGreaterThanOrEqual(DEFAULT_COMPOSITE_SCORES.messageIdUnregistrableMismatch);
  });

  test('score reason includes fromDomain, messageIdDomain, and messageIdRegistrableDomain null', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: spfPassAuth,
      fromDomain: 'disposable-spam.xyz',
      messageIdDomain: 'internalserver',
    });
    const reason = scoreReasons.find(r => r.key === 'composite.messageIdUnregistrableMismatch');
    expect(reason.fromDomain).toBe('disposable-spam.xyz');
    expect(reason.messageIdDomain).toBe('internalserver');
    expect(reason.messageIdRegistrableDomain).toBeNull();
  });

  test('does NOT fire when Message-ID domain has a non-null registrable domain but isIcann: false (private PSL suffix)', () => {
    // host.fakecorp: tldts returns a non-null registrableDomain (isIcann: false).
    // The SPEC condition is messageIdRegistrableDomain === null, so domains that are
    // parseable — even non-ICANN ones — must not be flagged by this rule.
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: spfPassAuth,
      fromDomain: 'disposable-spam.xyz',
      messageIdDomain: 'host.fakecorp',
    });
    expect(scoreReasons.find(r => r.key === 'composite.messageIdUnregistrableMismatch')).toBeUndefined();
  });

  test('does NOT fire when Message-ID domain is null (missing Message-ID)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: spfPassAuth,
      fromDomain: 'disposable-spam.xyz',
      messageIdDomain: null,
    });
    expect(scoreReasons.find(r => r.key === 'composite.messageIdUnregistrableMismatch')).toBeUndefined();
  });

  test('does NOT fire when Message-ID domain has a registrable domain (normal route-consistent newsletter)', () => {
    // Legitimate newsletter via sendgrid.net — Message-ID domain is parseable
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: spfPassAuth,
      fromDomain: 'brand.example.com',
      messageIdDomain: 'delivery.sendgrid.net',
      spfMailFromRegistrableDomain: 'sendgrid.net',
    });
    expect(scoreReasons.find(r => r.key === 'composite.messageIdUnregistrableMismatch')).toBeUndefined();
  });

  test('does NOT fire when no trusted SPF pass exists', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...spfPassAuth, anyTrustedSpfPass: false, anyTrustedAuthPass: false },
      fromDomain: 'disposable-spam.xyz',
      messageIdDomain: 'internalserver',
    });
    expect(scoreReasons.find(r => r.key === 'composite.messageIdUnregistrableMismatch')).toBeUndefined();
  });

  test('does NOT fire when Message-ID host domain matches From domain', () => {
    // Edge case: From domain itself is unregistrable — host-level match suppresses
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: spfPassAuth,
      fromDomain: 'internalserver',
      messageIdDomain: 'internalserver',
    });
    expect(scoreReasons.find(r => r.key === 'composite.messageIdUnregistrableMismatch')).toBeUndefined();
  });

  test('does NOT fire when From domain has no registrable domain', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: spfPassAuth,
      fromDomain: 'invalid',
      messageIdDomain: 'other.invalid',
    });
    expect(scoreReasons.find(r => r.key === 'composite.messageIdUnregistrableMismatch')).toBeUndefined();
  });

  test('uses configurable compositeScores value', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: spfPassAuth,
      fromDomain: 'disposable-spam.xyz',
      messageIdDomain: 'internalserver',
      compositeScores: { messageIdUnregistrableMismatch: 30 },
    });
    const reason = scoreReasons.find(r => r.key === 'composite.messageIdUnregistrableMismatch');
    expect(reason.delta).toBe(30);
  });

  test('DEFAULT_COMPOSITE_SCORES includes messageIdUnregistrableMismatch as a positive value', () => {
    expect(typeof DEFAULT_COMPOSITE_SCORES.messageIdUnregistrableMismatch).toBe('number');
    expect(DEFAULT_COMPOSITE_SCORES.messageIdUnregistrableMismatch).toBeGreaterThan(0);
  });

  test('does NOT fire when called with no arguments', () => {
    expect(() => scoreLayer4()).not.toThrow();
    const { scoreReasons } = scoreLayer4();
    expect(scoreReasons.find(r => r.key === 'composite.messageIdUnregistrableMismatch')).toBeUndefined();
  });

  test('does NOT fire when anyDkimAligned is true (DKIM aligned with From suppresses rule)', () => {
    // Legitimate delegated sender: DKIM signed by brand domain, Message-ID from internal host.
    // anyDkimAligned is the strong mitigation signal — rule must not fire.
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...spfPassAuth, anyDkimAligned: true, anyAuthAligned: true },
      fromDomain: 'techdirect.jp',
      messageIdDomain: 'geopod-ismtpd-15',
    });
    expect(scoreReasons.find(r => r.key === 'composite.messageIdUnregistrableMismatch')).toBeUndefined();
  });

  test('does NOT fire for delegated newsletter with aligned DKIM and list headers', () => {
    // TechDirect-style case: noreply@techdirect.jp, DKIM aligned, List-Unsubscribe present,
    // Message-ID domain is an internal delivery host with no registrable domain.
    const { score, scoreReasons } = scoreLayer4({
      alignmentSummary: { ...spfPassAuth, anyDkimAligned: true, anyAuthAligned: true },
      fromDomain: 'techdirect.jp',
      messageIdDomain: 'geopod-ismtpd-15',
      hasListHeaders: true,
    });
    expect(scoreReasons.find(r => r.key === 'composite.messageIdUnregistrableMismatch')).toBeUndefined();
    // Score must not reach the Review threshold (50) via this rule alone.
    expect(score).toBeLessThan(50);
  });

  test('still fires for suspicious mail without aligned DKIM (unregistrable Message-ID + SPF only)', () => {
    // No DKIM alignment: the rule must still fire to catch spam patterns.
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...spfPassAuth, anyDkimAligned: false },
      fromDomain: 'disposable-spam.xyz',
      messageIdDomain: 'internalserver',
    });
    expect(scoreReasons.find(r => r.key === 'composite.messageIdUnregistrableMismatch')).toBeDefined();
  });
});

// ─── scoreLayer4 — composite.dkimAlignedLexicalMitigation ────────────────────

describe('scoreLayer4 — composite.dkimAlignedLexicalMitigation', () => {
  // Aligned DKIM, SPF not aligned (typical delegated newsletter route).
  const dkimAlignedDelegatedRoute = {
    spfAligned: false,
    anyDkimAligned: true,
    anyAuthAligned: true,
    anyTrustedAuthPass: true,
    anyTrustedSpfPass: true,
    anyTrustedDkimFail: false,
    dkimFailDomains: [],
  };

  // Consistent delegated route with list headers: Message-ID and SPF MAIL FROM
  // share a registrable domain, and List headers confirm newsletter/list context.
  const routeConsistentOpts = {
    messageIdDomain: 'smtp.esp.com',
    spfMailFromRegistrableDomain: 'esp.com',
    hasListHeaders: true,
  };

  test('fires for legitimate delegated route + DKIM aligned + lexical penalty + list headers', () => {
    const { score, scoreReasons } = scoreLayer4({
      alignmentSummary: dkimAlignedDelegatedRoute,
      fromDomain: 'newsletter.brand.com',
      fromLocalPart: 'info',
      hasLexicalPenalty: true,
      ...routeConsistentOpts,
    });
    const reason = scoreReasons.find(r => r.key === 'composite.dkimAlignedLexicalMitigation');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_COMPOSITE_SCORES.dkimAlignedLexicalMitigation);
    expect(reason.delta).toBeLessThan(0);
    expect(score).toBeLessThanOrEqual(0);
  });

  test('does NOT fire without List headers (hasListHeaders: false)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dkimAlignedDelegatedRoute,
      fromDomain: 'newsletter.brand.com',
      fromLocalPart: 'info',
      hasLexicalPenalty: true,
      messageIdDomain: 'smtp.esp.com',
      spfMailFromRegistrableDomain: 'esp.com',
      hasListHeaders: false,
    });
    expect(scoreReasons.find(r => r.key === 'composite.dkimAlignedLexicalMitigation')).toBeUndefined();
  });

  test('does NOT fire when registrable domain main label is random-looking', () => {
    // 'ppbwwcyr.com' — 'ppbwwcyr' passes isRandomLookingLabel
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dkimAlignedDelegatedRoute,
      fromDomain: 'ppbwwcyr.com',
      fromLocalPart: 'info',
      hasLexicalPenalty: true,
      ...routeConsistentOpts,
    });
    expect(scoreReasons.find(r => r.key === 'composite.dkimAlignedLexicalMitigation')).toBeUndefined();
  });

  test('does NOT fire when lexical penalty is absent', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dkimAlignedDelegatedRoute,
      fromDomain: 'newsletter.brand.com',
      fromLocalPart: 'info',
      hasLexicalPenalty: false,
      ...routeConsistentOpts,
    });
    expect(scoreReasons.find(r => r.key === 'composite.dkimAlignedLexicalMitigation')).toBeUndefined();
  });

  test('does NOT fire when route is inconsistent (Message-ID != SPF MAIL FROM domain)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dkimAlignedDelegatedRoute,
      fromDomain: 'newsletter.brand.com',
      fromLocalPart: 'info',
      hasLexicalPenalty: true,
      messageIdDomain: 'smtp.otheresp.com',       // otheresp.com
      spfMailFromRegistrableDomain: 'esp.com',     // esp.com — mismatch
    });
    expect(scoreReasons.find(r => r.key === 'composite.dkimAlignedLexicalMitigation')).toBeUndefined();
  });

  test('does NOT fire when DKIM is not aligned', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...dkimAlignedDelegatedRoute, anyDkimAligned: false, anyAuthAligned: false },
      fromDomain: 'newsletter.brand.com',
      fromLocalPart: 'info',
      hasLexicalPenalty: true,
      ...routeConsistentOpts,
    });
    expect(scoreReasons.find(r => r.key === 'composite.dkimAlignedLexicalMitigation')).toBeUndefined();
  });

  test('does NOT fire when Message-ID is unregistrable (DKIM-aligned bypass suppresses messageIdUnregistrableMismatch; route consistency also fails)', () => {
    // With anyDkimAligned true, messageIdUnregistrableMismatch is now suppressed by the
    // DKIM-aligned bypass introduced in issue #190. dkimAlignedLexicalMitigation also
    // does not fire because messageIdRegistrableDomain is null (unregistrable host),
    // so the route consistency check (messageIdRegistrableDomain === spfMailFromRegistrableDomain)
    // cannot be satisfied.
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...dkimAlignedDelegatedRoute, anyTrustedSpfPass: true },
      fromDomain: 'newsletter.brand.com',
      fromLocalPart: 'info',
      hasLexicalPenalty: true,
      messageIdDomain: 'internalhost',           // unregistrable
      spfMailFromRegistrableDomain: 'esp.com',
    });
    expect(scoreReasons.find(r => r.key === 'composite.messageIdUnregistrableMismatch')).toBeUndefined();
    expect(scoreReasons.find(r => r.key === 'composite.dkimAlignedLexicalMitigation')).toBeUndefined();
  });

  test('score reason includes expected context fields', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dkimAlignedDelegatedRoute,
      fromDomain: 'newsletter.brand.com',
      fromLocalPart: 'info',
      hasLexicalPenalty: true,
      ...routeConsistentOpts,
    });
    const reason = scoreReasons.find(r => r.key === 'composite.dkimAlignedLexicalMitigation');
    expect(reason.fromDomain).toBe('newsletter.brand.com');
    expect(reason.fromRegistrableDomain).toBe('brand.com');
    expect(reason.messageIdRegistrableDomain).toBe('esp.com');
    expect(reason.spfMailFromRegistrableDomain).toBe('esp.com');
  });

  test('uses configurable compositeScores value', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dkimAlignedDelegatedRoute,
      fromDomain: 'newsletter.brand.com',
      fromLocalPart: 'info',
      hasLexicalPenalty: true,
      ...routeConsistentOpts,
      compositeScores: { dkimAlignedLexicalMitigation: -15 },
    });
    const reason = scoreReasons.find(r => r.key === 'composite.dkimAlignedLexicalMitigation');
    expect(reason.delta).toBe(-15);
  });

  test('DEFAULT_COMPOSITE_SCORES includes dkimAlignedLexicalMitigation as a negative value', () => {
    expect(typeof DEFAULT_COMPOSITE_SCORES.dkimAlignedLexicalMitigation).toBe('number');
    expect(DEFAULT_COMPOSITE_SCORES.dkimAlignedLexicalMitigation).toBeLessThan(0);
  });
});

// ─── scoreLayer4 — composite.unparseableFromWithInfrastructureMismatch ────────

describe('scoreLayer4 — composite.unparseableFromWithInfrastructureMismatch', () => {
  const noAuthNoFrom = {
    spfAligned: false,
    anyDkimAligned: false,
    anyAuthAligned: false,
    anyTrustedAuthPass: false,
    anyTrustedSpfPass: false,
    anyTrustedDkimFail: false,
    anyTrustedDmarcFail: false,
    anyTrustedSpfFail: false,
    dkimFailDomains: [],
    spfFailMailFromRegistrableDomain: null,
  };

  test('fires when fromDomain is empty, no auth pass, and Sender is present', () => {
    const result = scoreLayer4({
      alignmentSummary: noAuthNoFrom,
      fromDomain: '',
      senderRegistrableDomain: 'sender.com',
    });
    const reason = result.scoreReasons.find(r => r.key === 'composite.unparseableFromWithInfrastructureMismatch');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_COMPOSITE_SCORES.unparseableFromWithInfrastructureMismatch);
    expect(result.score).toBeGreaterThanOrEqual(DEFAULT_COMPOSITE_SCORES.unparseableFromWithInfrastructureMismatch);
  });

  test('fires when fromDomain is empty, no auth pass, and Return-Path is present', () => {
    const result = scoreLayer4({
      alignmentSummary: noAuthNoFrom,
      fromDomain: '',
      returnPathRegistrableDomain: 'returnpath.example.com',
    });
    const reason = result.scoreReasons.find(r => r.key === 'composite.unparseableFromWithInfrastructureMismatch');
    expect(reason).toBeDefined();
    expect(reason.returnPathRegistrableDomain).toBe('returnpath.example.com');
  });

  test('fires when fromDomain is empty, no auth pass, and Message-ID is present', () => {
    const result = scoreLayer4({
      alignmentSummary: noAuthNoFrom,
      fromDomain: '',
      messageIdDomain: 'mail.somewhere.net',
    });
    const reason = result.scoreReasons.find(r => r.key === 'composite.unparseableFromWithInfrastructureMismatch');
    expect(reason).toBeDefined();
    expect(reason.messageIdDomain).toBe('mail.somewhere.net');
  });

  test('does NOT fire when fromDomain is non-empty (normal parseable From)', () => {
    const result = scoreLayer4({
      alignmentSummary: noAuthNoFrom,
      fromDomain: 'example.com',
      senderRegistrableDomain: 'sender.com',
      messageIdDomain: 'mail.somewhere.net',
    });
    const reason = result.scoreReasons.find(r => r.key === 'composite.unparseableFromWithInfrastructureMismatch');
    expect(reason).toBeUndefined();
  });

  test('does NOT fire when fromDomain is empty but no infrastructure headers are present', () => {
    const result = scoreLayer4({
      alignmentSummary: noAuthNoFrom,
      fromDomain: '',
      senderRegistrableDomain: null,
      returnPathRegistrableDomain: null,
      messageIdDomain: null,
    });
    const reason = result.scoreReasons.find(r => r.key === 'composite.unparseableFromWithInfrastructureMismatch');
    expect(reason).toBeUndefined();
  });

  test('does NOT fire when fromDomain is empty but a trusted auth pass exists', () => {
    const result = scoreLayer4({
      alignmentSummary: Object.assign({}, noAuthNoFrom, { anyTrustedAuthPass: true }),
      fromDomain: '',
      senderRegistrableDomain: 'sender.com',
    });
    const reason = result.scoreReasons.find(r => r.key === 'composite.unparseableFromWithInfrastructureMismatch');
    expect(reason).toBeUndefined();
  });

  test('score is Review-oriented (>= 50, < 100) by default', () => {
    expect(DEFAULT_COMPOSITE_SCORES.unparseableFromWithInfrastructureMismatch).toBeGreaterThanOrEqual(50);
    expect(DEFAULT_COMPOSITE_SCORES.unparseableFromWithInfrastructureMismatch).toBeLessThan(100);
  });

  test('malformed From with no infrastructure signals does not fire the rule', () => {
    const result = scoreLayer4({
      alignmentSummary: noAuthNoFrom,
      fromDomain: '',
      senderRegistrableDomain: null,
      returnPathRegistrableDomain: null,
      messageIdDomain: null,
    });
    expect(result.scoreReasons.find(r => r.key === 'composite.unparseableFromWithInfrastructureMismatch')).toBeUndefined();
    expect(result.score).toBe(0);
  });

  test('reason includes all present infrastructure fields', () => {
    const result = scoreLayer4({
      alignmentSummary: noAuthNoFrom,
      fromDomain: '',
      senderRegistrableDomain: 'sender.com',
      returnPathRegistrableDomain: 'returnpath.com',
      messageIdDomain: 'msgid.com',
    });
    const reason = result.scoreReasons.find(r => r.key === 'composite.unparseableFromWithInfrastructureMismatch');
    expect(reason.senderRegistrableDomain).toBe('sender.com');
    expect(reason.returnPathRegistrableDomain).toBe('returnpath.com');
    expect(reason.messageIdDomain).toBe('msgid.com');
  });

  test('respects custom compositeScores override', () => {
    const result = scoreLayer4({
      alignmentSummary: noAuthNoFrom,
      fromDomain: '',
      senderRegistrableDomain: 'sender.com',
      compositeScores: { unparseableFromWithInfrastructureMismatch: 30 },
    });
    expect(result.score).toBe(30);
  });

  test('DEFAULT_COMPOSITE_SCORES includes unparseableFromWithInfrastructureMismatch as a positive value', () => {
    expect(typeof DEFAULT_COMPOSITE_SCORES.unparseableFromWithInfrastructureMismatch).toBe('number');
    expect(DEFAULT_COMPOSITE_SCORES.unparseableFromWithInfrastructureMismatch).toBeGreaterThan(0);
  });
});

// ─── scoreLayer4 — composite.dmarcFailDkimAlignedListMitigation ───────────────

describe('scoreLayer4 — composite.dmarcFailDkimAlignedListMitigation', () => {
  const dkimAlignedDmarcFail = {
    spfAligned: false,
    anyDkimAligned: true,
    anyAuthAligned: true,
    anyTrustedAuthPass: true,
    anyTrustedDmarcFail: true,
    anyTrustedSpfFail: false,
    anyTrustedSpfPass: true,
    anyTrustedDkimFail: false,
    dkimFailDomains: [],
    spfMailFromRegistrableDomain: 'esp.net',
    spfFailMailFromRegistrableDomain: null,
  };

  test('fires when DMARC fail + DKIM aligned + list headers present', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dkimAlignedDmarcFail,
      fromDomain: 'brand.example.com',
      hasListHeaders: true,
    });
    const reason = scoreReasons.find(r => r.key === 'composite.dmarcFailDkimAlignedListMitigation');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_COMPOSITE_SCORES.dmarcFailDkimAlignedListMitigation);
    expect(reason.delta).toBeLessThan(0);
  });

  test('does NOT fire when DKIM is not aligned', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...dkimAlignedDmarcFail, anyDkimAligned: false, anyAuthAligned: false },
      fromDomain: 'brand.example.com',
      hasListHeaders: true,
    });
    expect(scoreReasons.find(r => r.key === 'composite.dmarcFailDkimAlignedListMitigation')).toBeUndefined();
  });

  test('does NOT fire when list headers are absent', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dkimAlignedDmarcFail,
      fromDomain: 'brand.example.com',
      hasListHeaders: false,
    });
    expect(scoreReasons.find(r => r.key === 'composite.dmarcFailDkimAlignedListMitigation')).toBeUndefined();
  });

  test('does NOT fire when DMARC did not fail', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...dkimAlignedDmarcFail, anyTrustedDmarcFail: false },
      fromDomain: 'brand.example.com',
      hasListHeaders: true,
    });
    expect(scoreReasons.find(r => r.key === 'composite.dmarcFailDkimAlignedListMitigation')).toBeUndefined();
  });

  test('default mitigation score cancels the default auth.dmarc.fail score', () => {
    expect(DEFAULT_COMPOSITE_SCORES.dmarcFailDkimAlignedListMitigation).toBe(-15);
  });

  test('respects custom compositeScores override', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dkimAlignedDmarcFail,
      fromDomain: 'brand.example.com',
      hasListHeaders: true,
      compositeScores: { dmarcFailDkimAlignedListMitigation: -10 },
    });
    const reason = scoreReasons.find(r => r.key === 'composite.dmarcFailDkimAlignedListMitigation');
    expect(reason.delta).toBe(-10);
  });
});

// ─── scoreLayer4 — composite.geoTokenCompoundDomain ──────────────────────────

const authPassNoAlignment = {
  spfAligned: false,
  anyDkimAligned: false,
  anyAuthAligned: false,
  anyTrustedAuthPass: true,
  anyTrustedSpfPass: true,
  anyTrustedDkimFail: false,
  anyTrustedDmarcFail: false,
  anyTrustedSpfFail: false,
};

describe('scoreLayer4 — composite.geoTokenCompoundDomain', () => {
  test('fires for hyphen-compound domain with cn token and trusted auth pass', () => {
    const { score, scoreReasons } = scoreLayer4({
      alignmentSummary: authPassNoAlignment,
      fromDomain: 'official-cn-ayx.com',
    });
    const reason = scoreReasons.find(r => r.key === 'composite.geoTokenCompoundDomain');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_COMPOSITE_SCORES.geoTokenCompoundDomain);
    expect(['cn', 'zh', 'china', 'official', 'svip', 'apps']).toContain(reason.matchedToken);
    expect(reason.registrableDomainCore).toBe('official-cn-ayx');
    expect(reason.fromDomain).toBe('official-cn-ayx.com');
    expect(score).toBeGreaterThanOrEqual(DEFAULT_COMPOSITE_SCORES.geoTokenCompoundDomain);
  });

  test('fires for domain with svip token', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: authPassNoAlignment,
      fromDomain: 'svip-service-xyz.com',
    });
    const reason = scoreReasons.find(r => r.key === 'composite.geoTokenCompoundDomain');
    expect(reason).toBeDefined();
    expect(reason.matchedToken).toBe('svip');
  });

  test('fires for domain with official token', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: authPassNoAlignment,
      fromDomain: 'official-zh-abc.net',
    });
    const reason = scoreReasons.find(r => r.key === 'composite.geoTokenCompoundDomain');
    expect(reason).toBeDefined();
    expect(reason.matchedToken).toBe('official');
  });

  test('fires for domain with china token in compound', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: authPassNoAlignment,
      fromDomain: 'china-apps-qrs.com',
    });
    const reason = scoreReasons.find(r => r.key === 'composite.geoTokenCompoundDomain');
    expect(reason).toBeDefined();
    expect(reason.matchedToken).toBe('china');
  });

  test('does NOT fire when DKIM is aligned with From', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...authPassNoAlignment, anyDkimAligned: true, anyAuthAligned: true },
      fromDomain: 'official-cn-ayx.com',
    });
    expect(scoreReasons.find(r => r.key === 'composite.geoTokenCompoundDomain')).toBeUndefined();
  });

  test('does NOT fire when no trusted auth pass exists', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...noAuth },
      fromDomain: 'official-cn-ayx.com',
    });
    expect(scoreReasons.find(r => r.key === 'composite.geoTokenCompoundDomain')).toBeUndefined();
  });

  test('does NOT fire for domain without hyphens in core', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: authPassNoAlignment,
      fromDomain: 'cn.com',
    });
    expect(scoreReasons.find(r => r.key === 'composite.geoTokenCompoundDomain')).toBeUndefined();
  });

  test('does NOT fire for hyphenated domain without risk token', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: authPassNoAlignment,
      fromDomain: 'fast-delivery-service.com',
    });
    expect(scoreReasons.find(r => r.key === 'composite.geoTokenCompoundDomain')).toBeUndefined();
  });

  test('does NOT fire for legitimate domain like my-company.com without risk tokens', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: authPassNoAlignment,
      fromDomain: 'my-company.com',
    });
    expect(scoreReasons.find(r => r.key === 'composite.geoTokenCompoundDomain')).toBeUndefined();
  });

  test('respects custom compositeScores override', () => {
    const { score } = scoreLayer4({
      alignmentSummary: authPassNoAlignment,
      fromDomain: 'official-cn-ayx.com',
      compositeScores: { geoTokenCompoundDomain: 50 },
    });
    expect(score).toBeGreaterThanOrEqual(50);
    const reason = scoreLayer4({
      alignmentSummary: authPassNoAlignment,
      fromDomain: 'official-cn-ayx.com',
      compositeScores: { geoTokenCompoundDomain: 50 },
    }).scoreReasons.find(r => r.key === 'composite.geoTokenCompoundDomain');
    expect(reason.delta).toBe(50);
  });

  test('DEFAULT_COMPOSITE_SCORES includes geoTokenCompoundDomain as a positive value', () => {
    expect(typeof DEFAULT_COMPOSITE_SCORES.geoTokenCompoundDomain).toBe('number');
    expect(DEFAULT_COMPOSITE_SCORES.geoTokenCompoundDomain).toBeGreaterThan(0);
  });
});

// ─── scoreLayer4 — composite.deepServiceWordSubdomain ────────────────────────

describe('scoreLayer4 — composite.deepServiceWordSubdomain', () => {
  test('fires for depth-2 subdomain with payment intermediate label', () => {
    const { score, scoreReasons } = scoreLayer4({
      alignmentSummary: authPassNoAlignment,
      fromDomain: 'fuxlugxe.payment.eamkj.com',
    });
    const reason = scoreReasons.find(r => r.key === 'composite.deepServiceWordSubdomain');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_COMPOSITE_SCORES.deepServiceWordSubdomain);
    expect(reason.matchedLabel).toBe('payment');
    expect(reason.subdomainDepth).toBe(2);
    expect(reason.leftmostLabel).toBe('fuxlugxe');
    expect(score).toBeGreaterThanOrEqual(DEFAULT_COMPOSITE_SCORES.deepServiceWordSubdomain);
  });

  test('fires for domain with notice intermediate label', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: authPassNoAlignment,
      fromDomain: 'abc.notice.xyzco.com',
    });
    const reason = scoreReasons.find(r => r.key === 'composite.deepServiceWordSubdomain');
    expect(reason).toBeDefined();
    expect(reason.matchedLabel).toBe('notice');
  });

  test('fires for domain with portal intermediate label', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: authPassNoAlignment,
      fromDomain: 'rnd.portal.spamco.net',
    });
    expect(scoreReasons.find(r => r.key === 'composite.deepServiceWordSubdomain')).toBeDefined();
  });

  test('fires for domain with mail-NN pattern', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: authPassNoAlignment,
      fromDomain: 'rndxyz.mail-14.spamco.com',
    });
    const reason = scoreReasons.find(r => r.key === 'composite.deepServiceWordSubdomain');
    expect(reason).toBeDefined();
    expect(reason.matchedLabel).toBe('mail-14');
  });

  test('does NOT fire when DKIM is aligned with From', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...authPassNoAlignment, anyDkimAligned: true, anyAuthAligned: true },
      fromDomain: 'abc.payment.spamco.com',
    });
    expect(scoreReasons.find(r => r.key === 'composite.deepServiceWordSubdomain')).toBeUndefined();
  });

  test('does NOT fire when no trusted auth pass exists', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...noAuth },
      fromDomain: 'abc.payment.spamco.com',
    });
    expect(scoreReasons.find(r => r.key === 'composite.deepServiceWordSubdomain')).toBeUndefined();
  });

  test('does NOT fire for subdomainDepth 1 (plain mail.example.com)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: authPassNoAlignment,
      fromDomain: 'mail.example.com',
    });
    expect(scoreReasons.find(r => r.key === 'composite.deepServiceWordSubdomain')).toBeUndefined();
  });

  test('does NOT fire for shallow service subdomain (depth 1)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: authPassNoAlignment,
      fromDomain: 'payment.example.com',
    });
    expect(scoreReasons.find(r => r.key === 'composite.deepServiceWordSubdomain')).toBeUndefined();
  });

  test('does NOT fire for ordinary mail.example.com (depth 1)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: authPassNoAlignment,
      fromDomain: 'mail.example.com',
    });
    expect(scoreReasons.find(r => r.key === 'composite.deepServiceWordSubdomain')).toBeUndefined();
  });

  test('does NOT fire when plain mail is the intermediate label (not mail-NN)', () => {
    // user.mail.example.com — 'mail' alone is not a service word; only mail-NN fires
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: authPassNoAlignment,
      fromDomain: 'user.mail.example.com',
    });
    expect(scoreReasons.find(r => r.key === 'composite.deepServiceWordSubdomain')).toBeUndefined();
  });

  test('does NOT fire when service word is in leftmost label (not intermediate)', () => {
    // payment.abc.example.com — payment is leftmost, abc is intermediate — no match
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: authPassNoAlignment,
      fromDomain: 'payment.abc.example.com',
    });
    expect(scoreReasons.find(r => r.key === 'composite.deepServiceWordSubdomain')).toBeUndefined();
  });

  test('respects custom compositeScores override', () => {
    const reason = scoreLayer4({
      alignmentSummary: authPassNoAlignment,
      fromDomain: 'fuxlugxe.payment.eamkj.com',
      compositeScores: { deepServiceWordSubdomain: 45 },
    }).scoreReasons.find(r => r.key === 'composite.deepServiceWordSubdomain');
    expect(reason.delta).toBe(45);
  });

  test('DEFAULT_COMPOSITE_SCORES includes deepServiceWordSubdomain as a positive value', () => {
    expect(typeof DEFAULT_COMPOSITE_SCORES.deepServiceWordSubdomain).toBe('number');
    expect(DEFAULT_COMPOSITE_SCORES.deepServiceWordSubdomain).toBeGreaterThan(0);
  });
});

// ─── scoreLayer4 — composite.dkimFailWithAlignedPass ─────────────────────────

describe('scoreLayer4 — composite.dkimFailWithAlignedPass', () => {
  const dkimFailWithAligned = {
    spfAligned: false,
    anyDkimAligned: true,
    anyAuthAligned: true,
    anyTrustedAuthPass: true,
    anyTrustedSpfPass: false,
    anyTrustedDkimFail: true,
    anyTrustedDmarcFail: false,
    anyTrustedSpfFail: false,
    dkimFailDomains: ['broken-sig.example.com'],
  };

  test('fires when trusted DKIM fail and aligned DKIM pass both present', () => {
    const { score, scoreReasons } = scoreLayer4({
      alignmentSummary: dkimFailWithAligned,
      fromDomain: 'brand.example.com',
    });
    const reason = scoreReasons.find(r => r.key === 'composite.dkimFailWithAlignedPass');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_COMPOSITE_SCORES.dkimFailWithAlignedPass);
    expect(score).toBeGreaterThanOrEqual(DEFAULT_COMPOSITE_SCORES.dkimFailWithAlignedPass);
  });

  test('includes dkimFailDomains in scoreReasons context', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dkimFailWithAligned,
      fromDomain: 'brand.example.com',
    });
    const reason = scoreReasons.find(r => r.key === 'composite.dkimFailWithAlignedPass');
    expect(reason.dkimFailDomains).toEqual(['broken-sig.example.com']);
  });

  test('does NOT fire when only DKIM fail exists (no aligned pass)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...dkimFailWithAligned, anyDkimAligned: false, anyAuthAligned: false },
      fromDomain: 'brand.example.com',
    });
    expect(scoreReasons.find(r => r.key === 'composite.dkimFailWithAlignedPass')).toBeUndefined();
  });

  test('does NOT fire when only aligned pass exists (no DKIM fail)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...dkimFailWithAligned, anyTrustedDkimFail: false, dkimFailDomains: [] },
      fromDomain: 'brand.example.com',
    });
    expect(scoreReasons.find(r => r.key === 'composite.dkimFailWithAlignedPass')).toBeUndefined();
  });

  test('does NOT fire for untrusted DKIM fail (anyTrustedDkimFail remains false)', () => {
    // Untrusted AR headers are ignored for scoring; anyTrustedDkimFail is only set
    // from trusted headers. With no trusted DKIM fail the rule must not fire.
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...dkimFailWithAligned, anyTrustedDkimFail: false, dkimFailDomains: [] },
      fromDomain: 'brand.example.com',
    });
    expect(scoreReasons.find(r => r.key === 'composite.dkimFailWithAlignedPass')).toBeUndefined();
  });

  test('respects custom compositeScores value', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dkimFailWithAligned,
      fromDomain: 'brand.example.com',
      compositeScores: { dkimFailWithAlignedPass: 20 },
    });
    const reason = scoreReasons.find(r => r.key === 'composite.dkimFailWithAlignedPass');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(20);
  });

  test('DEFAULT_COMPOSITE_SCORES includes dkimFailWithAlignedPass as a positive value', () => {
    expect(typeof DEFAULT_COMPOSITE_SCORES.dkimFailWithAlignedPass).toBe('number');
    expect(DEFAULT_COMPOSITE_SCORES.dkimFailWithAlignedPass).toBeGreaterThan(0);
  });
});

// ─── scoreLayer4 — composite.brandDivergencePhishing ─────────────────────────

const brandDisplayNameMetrics = {
  displayNameBrandLikeShape: true,
  brandDomainMismatch: true,
  inferredBrandDomain: 'apple.com',
  inferredBrandScore: 0.95,
  brandInferenceCandidateRank: 1,
};

describe('scoreLayer4 — composite.brandDivergencePhishing', () => {
  test('fires when display name matches a known brand and From domain is unrelated', () => {
    const { score, scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'attacker-domain.com',
      displayNameMetrics: brandDisplayNameMetrics,
    });
    const reason = scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_COMPOSITE_SCORES.brandDivergencePhishing);
    expect(reason.inferredBrandDomain).toBe('apple.com');
    expect(reason.inferredBrandScore).toBe(0.95);
    expect(score).toBeGreaterThanOrEqual(DEFAULT_COMPOSITE_SCORES.brandDivergencePhishing);
  });

  test('does NOT fire when From domain matches the inferred brand domain (brandDomainMismatch: false)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'apple.com',
      displayNameMetrics: {
        ...brandDisplayNameMetrics,
        brandDomainMismatch: false,
      },
    });
    expect(scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing')).toBeUndefined();
  });

  test('does NOT fire when From is a subdomain of the inferred brand domain (brandDomainMismatch: false)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'noreply.apple.com',
      displayNameMetrics: {
        ...brandDisplayNameMetrics,
        brandDomainMismatch: false,
      },
    });
    expect(scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing')).toBeUndefined();
  });

  test('does NOT fire when brandDomainMismatch is null (inference not applicable)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'attacker-domain.com',
      displayNameMetrics: {
        brandDomainMismatch: null,
        inferredBrandDomain: null,
        inferredBrandScore: null,
        brandInferenceCandidateRank: null,
      },
    });
    expect(scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing')).toBeUndefined();
  });

  test('does NOT fire when inferredBrandScore is below the acceptance threshold', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'attacker-domain.com',
      displayNameMetrics: {
        ...brandDisplayNameMetrics,
        inferredBrandScore: 0.80,
      },
    });
    expect(scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing')).toBeUndefined();
  });

  test('fires for brands with candidateRank > 1 (e.g. PayPal rank 2, Apple rank 5)', () => {
    // brandInferenceCandidateRank is the static position in the TOP_DOMAINS list,
    // not an inference-confidence indicator — the rule must fire for all brands that
    // pass the score/mismatch gates, not only the single rank-1 entry.
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'attacker-domain.com',
      displayNameMetrics: {
        ...brandDisplayNameMetrics,
        inferredBrandDomain: 'paypal.com',
        brandInferenceCandidateRank: 2,
      },
    });
    expect(scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing')).toBeDefined();
  });

  test('does NOT fire for regional brand domain sharing the same PSL core label (e.g. amazon.co.jp vs amazon.com)', () => {
    // amazon.co.jp shares core label "amazon" with amazon.com — this is a
    // legitimate regional brand domain, not an impersonator. The rule must
    // not fire even though brandDomainMismatch is true (registrable domains differ).
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'amazon.co.jp',
      displayNameMetrics: {
        ...brandDisplayNameMetrics,
        inferredBrandDomain: 'amazon.com',
        brandDomainMismatch: true,
      },
    });
    expect(scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing')).toBeUndefined();
  });

  test('fires for brand domain on a commonly-used-as-generic ccTLD (e.g. paypal.co vs paypal.com)', () => {
    // paypal.co shares the core label "paypal" with paypal.com, but .co is a
    // ccTLD commonly registered for generic use (not a traditional regional
    // brand variant). The rule must fire to catch phishing on such TLDs.
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'paypal.co',
      displayNameMetrics: {
        ...brandDisplayNameMetrics,
        inferredBrandDomain: 'paypal.com',
        brandDomainMismatch: true,
      },
    });
    expect(scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing')).toBeDefined();
  });

  test('fires for brand domain on a multi-letter generic TLD (e.g. apple.xyz)', () => {
    // .xyz is a generic TLD; apple.xyz is not a legitimate regional brand domain.
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'apple.xyz',
      displayNameMetrics: {
        ...brandDisplayNameMetrics,
        inferredBrandDomain: 'apple.com',
        brandDomainMismatch: true,
      },
    });
    expect(scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing')).toBeDefined();
  });

  test('does NOT fire for brand domain on a classic 2-letter ccTLD (e.g. paypal.de)', () => {
    // paypal.de is a legitimate regional PayPal domain on the German ccTLD.
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'paypal.de',
      displayNameMetrics: {
        ...brandDisplayNameMetrics,
        inferredBrandDomain: 'paypal.com',
        brandDomainMismatch: true,
      },
    });
    expect(scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing')).toBeUndefined();
  });

  test('fires when From domain is a brand-named subdomain under a PSL private suffix (e.g. apple.blogspot.com)', () => {
    // apple.blogspot.com — blogspot.com is a PSL private suffix (multi-tenant).
    // extractDomainCoreLabel() returns "apple" for this domain, which matches
    // the core label for apple.com, but this is NOT a legitimate regional brand
    // domain — it is an attacker-controlled subdomain on a hosting platform.
    // The rule must fire even though core labels match.
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'apple.blogspot.com',
      displayNameMetrics: {
        ...brandDisplayNameMetrics,
        inferredBrandDomain: 'apple.com',
        brandDomainMismatch: true,
      },
    });
    expect(scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing')).toBeDefined();
  });

  test('fires when From domain is a brand-named subdomain under a PSL private suffix (e.g. paypal.github.io)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'paypal.github.io',
      displayNameMetrics: {
        ...brandDisplayNameMetrics,
        inferredBrandDomain: 'paypal.com',
        brandDomainMismatch: true,
      },
    });
    expect(scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing')).toBeDefined();
  });

  test('fires when From domain is unrelated to inferred brand domain (e.g. attacker-amazon.com)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'attacker-amazon.com',
      displayNameMetrics: {
        ...brandDisplayNameMetrics,
        inferredBrandDomain: 'amazon.com',
        brandDomainMismatch: true,
      },
    });
    expect(scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing')).toBeDefined();
  });

  test('fires for two-word title-case brand names even when displayNameBrandLikeShape is false', () => {
    // "American Express" looks like a personal name to isBrandLikeShape (two title-case
    // words), so displayNameBrandLikeShape is false. The personal-name guard uses the
    // ratio of brand-core length to normalized-display-name length: "americanexpress"
    // equals the brand core "americanexpress" (ratio 1.0 >= 0.8), so the rule fires.
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'attacker-domain.com',
      displayNameMetrics: {
        ...brandDisplayNameMetrics,
        displayNameBrandLikeShape: false,
        displayNameNormalized: 'americanexpress',
        inferredBrandDomain: 'americanexpress.com',
        brandDomainMismatch: true,
      },
    });
    expect(scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing')).toBeDefined();
  });

  test('does NOT fire for personal name whose first word is a brand (e.g. "Apple Martin")', () => {
    // "Apple Martin" has displayNameBrandLikeShape: false and normalizes to
    // "applemartin". The brand core is "apple" (5 chars). The ratio 5/11 < 0.8,
    // so the personal-name guard suppresses the rule.
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'family.example',
      displayNameMetrics: {
        ...brandDisplayNameMetrics,
        displayNameBrandLikeShape: false,
        displayNameNormalized: 'applemartin',
        inferredBrandDomain: 'apple.com',
        brandDomainMismatch: true,
      },
    });
    expect(scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing')).toBeUndefined();
  });

  test('fires for brand+service display name "Apple Support" (two Title-Case words, service noun)', () => {
    // "Apple Support" has displayNameBrandLikeShape: false (two Title-Case words),
    // but the second word is a service noun so the brand-service escape hatch applies.
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'attacker-domain.com',
      displayNameMetrics: {
        ...brandDisplayNameMetrics,
        displayNameBrandLikeShape: false,
        displayNameRaw: 'Apple Support',
        displayNameNormalized: 'applesupport',
        inferredBrandDomain: 'apple.com',
        brandDomainMismatch: true,
      },
    });
    expect(scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing')).toBeDefined();
  });

  test('fires for brand+service display name "Amazon Security" (two Title-Case words, service noun)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'attacker-domain.com',
      displayNameMetrics: {
        ...brandDisplayNameMetrics,
        displayNameBrandLikeShape: false,
        displayNameRaw: 'Amazon Security',
        displayNameNormalized: 'amazonsecurity',
        inferredBrandDomain: 'amazon.com',
        brandDomainMismatch: true,
      },
    });
    expect(scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing')).toBeDefined();
  });

  test('does NOT fire for personal name whose first word is a brand (e.g. "Chase Smith")', () => {
    // "Chase Smith" normalizes to "chasesmith". The brand core "chase" (5 chars)
    // covers 5/10 = 0.5 of the name — below the 0.8 threshold → suppressed.
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'family.example',
      displayNameMetrics: {
        ...brandDisplayNameMetrics,
        displayNameBrandLikeShape: false,
        displayNameNormalized: 'chasesmith',
        inferredBrandDomain: 'chase.com',
        brandDomainMismatch: true,
      },
    });
    expect(scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing')).toBeUndefined();
  });

  test('does NOT fire when displayNameMetrics is null', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'attacker-domain.com',
      displayNameMetrics: null,
    });
    expect(scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing')).toBeUndefined();
  });

  test('does NOT fire when displayNameMetrics is not provided', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'attacker-domain.com',
    });
    expect(scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing')).toBeUndefined();
  });

  test('respects custom compositeScores value', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'attacker-domain.com',
      displayNameMetrics: brandDisplayNameMetrics,
      compositeScores: { brandDivergencePhishing: 75 },
    });
    const reason = scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(75);
  });

  test('DEFAULT_COMPOSITE_SCORES includes brandDivergencePhishing as a positive value', () => {
    expect(typeof DEFAULT_COMPOSITE_SCORES.brandDivergencePhishing).toBe('number');
    expect(DEFAULT_COMPOSITE_SCORES.brandDivergencePhishing).toBeGreaterThan(0);
  });

  test('fires for spaced Dai-ichi Life style display name and includes displayNameSpacedCamouflage in reason', () => {
    // "D a i i c h i L i f e I n s u r a n c e" is the spaced-camouflage form of
    // "Daiichi Life Insurance". The metric layer detects this pattern and sets
    // displayNameSpacedCamouflage: true; the score reason must record it.
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'attacker.com',
      displayNameMetrics: {
        displayNameBrandLikeShape: true,
        displayNameSpacedCamouflage: true,
        displayNameRaw: 'D a i i c h i L i f e I n s u r a n c e',
        displayNameCompacted: 'DaiichiLifeInsurance',
        brandDomainMismatch: true,
        inferredBrandDomain: 'dai-ichi-life.co.jp',
        inferredBrandScore: 0.91,
        brandInferenceCandidateRank: 31,
      },
    });
    const reason = scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_COMPOSITE_SCORES.brandDivergencePhishing);
    expect(reason.inferredBrandDomain).toBe('dai-ichi-life.co.jp');
    expect(reason.displayNameSpacedCamouflage).toBe(true);
    expect(reason.displayNameRaw).toBe('D a i i c h i L i f e I n s u r a n c e');
  });

  test('reason does NOT include displayNameSpacedCamouflage when camouflage is absent', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: noAuth,
      fromDomain: 'attacker.com',
      displayNameMetrics: {
        ...brandDisplayNameMetrics,
        displayNameSpacedCamouflage: false,
        displayNameRaw: 'Apple',
      },
    });
    const reason = scoreReasons.find(r => r.key === 'composite.brandDivergencePhishing');
    expect(reason).toBeDefined();
    expect(reason.displayNameSpacedCamouflage).toBeUndefined();
  });
});

// ─── scoreLayer4 — composite.unsecuredDeepSubdomain ──────────────────────────

const dmarcNoneNoAuth = {
  spfAligned: false,
  anyDkimAligned: false,
  anyAuthAligned: false,
  anyTrustedAuthPass: false,
  anyTrustedDmarcFail: false,
  anyTrustedDmarcNone: true,
  anyTrustedSpfFail: false,
};

describe('scoreLayer4 — composite.unsecuredDeepSubdomain', () => {
  test('fires for sivakeso.support.sn5799.com style deep subdomain with DMARC none', () => {
    const { score, scoreReasons } = scoreLayer4({
      alignmentSummary: dmarcNoneNoAuth,
      fromDomain: 'sivakeso.support.sn5799.com',
      fromLocalPart: 'info',
    });
    const reason = scoreReasons.find(r => r.key === 'composite.unsecuredDeepSubdomain');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_COMPOSITE_SCORES.unsecuredDeepSubdomain);
    expect(reason.subdomainDepth).toBe(2);
    expect(reason.fromDomain).toBe('sivakeso.support.sn5799.com');
    expect(reason.registrableDomain).toBe('sn5799.com');
    expect(score).toBeGreaterThanOrEqual(DEFAULT_COMPOSITE_SCORES.unsecuredDeepSubdomain);
  });

  test('fires for depth-3 deep subdomain with DMARC none', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dmarcNoneNoAuth,
      fromDomain: 'a.b.c.disposable.com',
      fromLocalPart: 'info',
    });
    const reason = scoreReasons.find(r => r.key === 'composite.unsecuredDeepSubdomain');
    expect(reason).toBeDefined();
    expect(reason.subdomainDepth).toBe(3);
  });

  test('fires even when leftmost label is pronounceable (not random-looking)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dmarcNoneNoAuth,
      fromDomain: 'helpdesk.support.nodmarc.com',
      fromLocalPart: 'info',
    });
    expect(scoreReasons.find(r => r.key === 'composite.unsecuredDeepSubdomain')).toBeDefined();
  });

  test('fires with anyTrustedAuthPass true but no alignment (third-party auth + DMARC none)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...dmarcNoneNoAuth, anyTrustedAuthPass: true },
      fromDomain: 'sivakeso.support.sn5799.com',
      fromLocalPart: 'info',
    });
    expect(scoreReasons.find(r => r.key === 'composite.unsecuredDeepSubdomain')).toBeDefined();
  });

  test('does NOT fire when subdomainDepth is 1 (shallow subdomain)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dmarcNoneNoAuth,
      fromDomain: 'mail.nodmarc.com',
      fromLocalPart: 'info',
    });
    expect(scoreReasons.find(r => r.key === 'composite.unsecuredDeepSubdomain')).toBeUndefined();
  });

  test('does NOT fire when subdomainDepth is 0 (no subdomain)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dmarcNoneNoAuth,
      fromDomain: 'nodmarc.com',
      fromLocalPart: 'info',
    });
    expect(scoreReasons.find(r => r.key === 'composite.unsecuredDeepSubdomain')).toBeUndefined();
  });

  test('does NOT fire when auth is aligned (e.g. legitimate deep subdomain with DKIM)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: {
        ...dmarcNoneNoAuth,
        anyDkimAligned: true,
        anyAuthAligned: true,
        anyTrustedAuthPass: true,
      },
      fromDomain: 'news.alerts.example.com',
      fromLocalPart: 'info',
    });
    expect(scoreReasons.find(r => r.key === 'composite.unsecuredDeepSubdomain')).toBeUndefined();
  });

  test('does NOT fire when DMARC explicitly fails (scored separately)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...dmarcNoneNoAuth, anyTrustedDmarcFail: true, anyTrustedDmarcNonNone: true, anyTrustedDmarcNone: false },
      fromDomain: 'sivakeso.support.sn5799.com',
      fromLocalPart: 'info',
    });
    expect(scoreReasons.find(r => r.key === 'composite.unsecuredDeepSubdomain')).toBeUndefined();
  });

  test('does NOT fire when DMARC explicitly passes (trusted dmarc=pass without parseable aligned SPF/DKIM)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...dmarcNoneNoAuth, anyTrustedDmarcPass: true, anyTrustedDmarcNonNone: true, anyTrustedDmarcNone: false },
      fromDomain: 'news.updates.example.com',
      fromLocalPart: 'info',
    });
    expect(scoreReasons.find(r => r.key === 'composite.unsecuredDeepSubdomain')).toBeUndefined();
  });

  test('does NOT fire when trusted DMARC result is temperror (domain published DMARC, evaluation error)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...dmarcNoneNoAuth, anyTrustedDmarcNonNone: true, anyTrustedDmarcNone: false },
      fromDomain: 'sivakeso.support.sn5799.com',
      fromLocalPart: 'info',
    });
    expect(scoreReasons.find(r => r.key === 'composite.unsecuredDeepSubdomain')).toBeUndefined();
  });

  test('does NOT fire when trusted DMARC result is permerror (domain published DMARC, permanent error)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...dmarcNoneNoAuth, anyTrustedDmarcNonNone: true, anyTrustedDmarcNone: false },
      fromDomain: 'a.b.permerror-domain.com',
      fromLocalPart: 'info',
    });
    expect(scoreReasons.find(r => r.key === 'composite.unsecuredDeepSubdomain')).toBeUndefined();
  });

  test('does NOT fire when mixed trusted DMARC: one header reports dmarc=none, another reports dmarc=pass', () => {
    // Both anyTrustedDmarcNone and anyTrustedDmarcNonNone are true — mixed result from
    // multiple Authentication-Results headers. A trusted server already evaluated DMARC
    // enforcement, so the none-only penalty must not apply.
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: {
        ...dmarcNoneNoAuth,
        anyTrustedDmarcNone: true,
        anyTrustedDmarcPass: true,
        anyTrustedDmarcNonNone: true,
      },
      fromDomain: 'sivakeso.support.sn5799.com',
      fromLocalPart: 'info',
    });
    expect(scoreReasons.find(r => r.key === 'composite.unsecuredDeepSubdomain')).toBeUndefined();
  });

  test('does NOT fire when mixed trusted DMARC: one header reports dmarc=none, another reports dmarc=fail', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: {
        ...dmarcNoneNoAuth,
        anyTrustedDmarcNone: true,
        anyTrustedDmarcFail: true,
        anyTrustedDmarcNonNone: true,
      },
      fromDomain: 'a.b.mixed-dmarc.com',
      fromLocalPart: 'info',
    });
    expect(scoreReasons.find(r => r.key === 'composite.unsecuredDeepSubdomain')).toBeUndefined();
  });

  test('does NOT fire when no trusted DMARC evidence (no trusted AR headers or server omitted DMARC)', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: { ...dmarcNoneNoAuth, anyTrustedDmarcNone: false },
      fromDomain: 'sivakeso.support.sn5799.com',
      fromLocalPart: 'info',
    });
    expect(scoreReasons.find(r => r.key === 'composite.unsecuredDeepSubdomain')).toBeUndefined();
  });

  test('does NOT fire for legitimate deep subdomain sender with aligned SPF', () => {
    // e.g. news.updates.bigco.com where SPF aligns — anyAuthAligned is true
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: {
        spfAligned: true,
        anyDkimAligned: false,
        anyAuthAligned: true,
        anyTrustedAuthPass: true,
        anyTrustedDmarcFail: false,
        anyTrustedSpfFail: false,
      },
      fromDomain: 'news.updates.bigco.com',
      fromLocalPart: 'newsletter',
    });
    expect(scoreReasons.find(r => r.key === 'composite.unsecuredDeepSubdomain')).toBeUndefined();
  });

  test('uses configurable compositeScores override', () => {
    const { scoreReasons } = scoreLayer4({
      alignmentSummary: dmarcNoneNoAuth,
      fromDomain: 'sivakeso.support.sn5799.com',
      compositeScores: { unsecuredDeepSubdomain: 10 },
    });
    const reason = scoreReasons.find(r => r.key === 'composite.unsecuredDeepSubdomain');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(10);
  });

  test('DEFAULT_COMPOSITE_SCORES includes unsecuredDeepSubdomain as a positive value', () => {
    expect(typeof DEFAULT_COMPOSITE_SCORES.unsecuredDeepSubdomain).toBe('number');
    expect(DEFAULT_COMPOSITE_SCORES.unsecuredDeepSubdomain).toBeGreaterThan(0);
  });
});
