import {
  analyzeMailAuthSignals,
  adaptAuthResults,
  adaptCompositeSignals,
} from '../src/modules/mailAuthSignalAdapter.js';
import { computeMessageIdMetrics, DEFAULT_COMPOSITE_SCORES } from '../src/core/compositeRules.js';
import { extractRegistrableDomain } from '../src/core/psl.js';

describe('analyzeMailAuthSignals', () => {
  test('returns metrics and signals for a trusted dmarc=pass message', () => {
    const result = analyzeMailAuthSignals({
      headers: {
        from: 'Alice <alice@example.com>',
        'authentication-results': 'mx.example.com; dmarc=pass header.from=example.com',
      },
      trustedAuthservIds: ['mx.example.com'],
    });
    expect(result).toHaveProperty('metrics');
    expect(result).toHaveProperty('signals');
    expect(Array.isArray(result.signals)).toBe(true);
  });

  test('exposes fromDomain in metrics', () => {
    const result = analyzeMailAuthSignals({
      headers: { from: 'Alice <alice@example.com>' },
    });
    expect(result.metrics.fromDomain).toBe('example.com');
  });

  test('emits auth.method.failure signal for dmarc=fail from trusted source', () => {
    const result = analyzeMailAuthSignals({
      headers: {
        from: 'Alice <alice@example.com>',
        'authentication-results': 'mx.example.com; dmarc=fail header.from=example.com',
      },
      trustedAuthservIds: ['mx.example.com'],
    });
    const signal = result.signals.find(s => s.key === 'auth.method.failure');
    expect(signal).toBeDefined();
    expect(signal.data.method).toBe('dmarc');
    expect(signal.data.result).toBe('fail');
  });

  test('emits auth.results.untrusted signal for unknown authserv-id', () => {
    const result = analyzeMailAuthSignals({
      headers: {
        from: 'Alice <alice@example.com>',
        'authentication-results': 'unknown.host.example; dmarc=pass',
      },
      trustedAuthservIds: ['mx.example.com'],
    });
    const signal = result.signals.find(s => s.key === 'auth.results.untrusted');
    expect(signal).toBeDefined();
  });

  test('defaults to all-untrusted when trustedAuthservIds is omitted', () => {
    const result = analyzeMailAuthSignals({
      headers: {
        from: 'Alice <alice@example.com>',
        'authentication-results': 'mx.example.com; dmarc=fail',
      },
    });
    expect(result).toHaveProperty('metrics');
    expect(result).toHaveProperty('signals');
    // Without any trusted ids, failure from a non-trusted source is low severity
    const failure = result.signals.find(s => s.key === 'auth.method.failure');
    if (failure) {
      expect(failure.data.trusted).toBe(false);
    }
  });

  test('accepts headers as an array of {name, value} pairs', () => {
    const result = analyzeMailAuthSignals({
      headers: [
        { name: 'from', value: 'Bob <bob@example.org>' },
        { name: 'authentication-results', value: 'mx.example.org; spf=pass smtp.mailfrom=bob@example.org' },
      ],
      trustedAuthservIds: ['mx.example.org'],
    });
    expect(result.metrics.fromDomain).toBe('example.org');
    expect(Array.isArray(result.signals)).toBe(true);
  });
});

// ── adaptAuthResults ──────────────────────────────────────────────────────────

describe('adaptAuthResults', () => {
  test('converts methods to results — spam fixture (dmarc=fail from trusted source)', () => {
    const { metrics } = analyzeMailAuthSignals({
      headers: {
        from: 'Support <noreply@random-xyz123.com>',
        'authentication-results': 'mx.trusted.com; dmarc=fail header.from=random-xyz123.com',
      },
      trustedAuthservIds: ['mx.trusted.com'],
    });
    const adapted = adaptAuthResults(metrics.authenticationResults);
    expect(adapted).toHaveLength(1);
    expect(adapted[0].authservId).toBe('mx.trusted.com');
    expect(adapted[0].results).toBeDefined();
    expect(adapted[0].results[0]).toMatchObject({ method: 'dmarc', result: 'fail' });
    expect(adapted[0]).not.toHaveProperty('methods');
  });

  test('converts methods to results — ham fixture (dmarc=pass, spf=pass, dkim=pass)', () => {
    const { metrics } = analyzeMailAuthSignals({
      headers: {
        from: 'Alice <alice@example.com>',
        'authentication-results': 'mx.example.com; dmarc=pass header.from=example.com; spf=pass smtp.mailfrom=alice@example.com; dkim=pass header.d=example.com',
      },
      trustedAuthservIds: ['mx.example.com'],
    });
    const adapted = adaptAuthResults(metrics.authenticationResults);
    expect(adapted).toHaveLength(1);
    const methods = adapted[0].results;
    expect(methods.find(r => r.method === 'dmarc')).toMatchObject({ method: 'dmarc', result: 'pass' });
    expect(methods.find(r => r.method === 'spf')).toMatchObject({ method: 'spf', result: 'pass' });
    expect(methods.find(r => r.method === 'dkim')).toMatchObject({ method: 'dkim', result: 'pass' });
  });

  test('preserves properties on each result', () => {
    const { metrics } = analyzeMailAuthSignals({
      headers: {
        from: 'Bob <bob@example.com>',
        'authentication-results': 'mx.example.com; spf=pass smtp.mailfrom=bob@example.com',
      },
      trustedAuthservIds: ['mx.example.com'],
    });
    const adapted = adaptAuthResults(metrics.authenticationResults);
    const spf = adapted[0].results.find(r => r.method === 'spf');
    expect(spf.properties?.['smtp.mailfrom']).toBe('bob@example.com');
  });

  test('includes untrusted AR headers in output (scoring applies its own trust check)', () => {
    const { metrics } = analyzeMailAuthSignals({
      headers: {
        from: 'Alice <alice@example.com>',
        'authentication-results': 'unknown.host.example; dmarc=pass',
      },
      trustedAuthservIds: ['mx.example.com'],
    });
    const adapted = adaptAuthResults(metrics.authenticationResults);
    expect(adapted).toHaveLength(1);
    expect(adapted[0].authservId).toBe('unknown.host.example');
    expect(Array.isArray(adapted[0].results)).toBe(true);
  });

  test('returns empty array when no AR headers are present', () => {
    const { metrics } = analyzeMailAuthSignals({
      headers: { from: 'alice@example.com' },
    });
    expect(adaptAuthResults(metrics.authenticationResults)).toEqual([]);
  });

  test('strips version token from authservId when pre-normalizer missed it (leading whitespace path)', () => {
    // The pre-normalizer regex anchors at ^ so a value like ' mx.example.com 1; dmarc=fail'
    // (with leading whitespace) slips through; adaptAuthResults must strip the trailing token.
    const adapted = adaptAuthResults([
      { authservId: 'mx.example.com 1', trusted: false, methods: [{ method: 'dmarc', result: 'fail', properties: {} }] },
    ]);
    expect(adapted[0].authservId).toBe('mx.example.com');
    expect(adapted[0].results[0]).toMatchObject({ method: 'dmarc', result: 'fail' });
  });

  test('handles multiple AR headers — one trusted, one not', () => {
    const { metrics } = analyzeMailAuthSignals({
      headers: {
        from: 'Alice <alice@example.com>',
        'authentication-results': [
          'mx.example.com; dmarc=pass',
          'relay.third-party.example; spf=pass smtp.mailfrom=bounce@mail.example.com',
        ],
      },
      trustedAuthservIds: ['mx.example.com'],
    });
    const adapted = adaptAuthResults(metrics.authenticationResults);
    expect(adapted).toHaveLength(2);
    expect(adapted.every(a => Array.isArray(a.results))).toBe(true);
    expect(adapted.every(a => !Object.prototype.hasOwnProperty.call(a, 'methods'))).toBe(true);
  });

  test('full pipeline: adapted results feed into scoreMessage without errors', async () => {
    const { scoreMessage, DEFAULT_AUTH_SCORES } = await import('../src/core/scoring.js');
    const { metrics } = analyzeMailAuthSignals({
      headers: {
        from: 'Phish <phish@random-abc987.com>',
        'authentication-results': 'mx.isp.example; dmarc=fail header.from=random-abc987.com; spf=fail smtp.mailfrom=bounce@random-abc987.com',
      },
      trustedAuthservIds: ['mx.isp.example'],
    });
    const parsedAuthResults = adaptAuthResults(metrics.authenticationResults);
    const result = scoreMessage({
      parsedAuthResults,
      trustedDomains: [{ value: 'mx.isp.example', matchType: 'exact' }],
      senderDomain: metrics.fromDomain ?? '',
      senderDomainRules: [],
      authScores: DEFAULT_AUTH_SCORES,
    });
    expect(typeof result.score).toBe('number');
    expect(result.score).toBeGreaterThan(0);
    const dmarcReason = result.scoreReasons.find(r => r.key === 'auth.dmarc.fail');
    expect(dmarcReason).toBeDefined();
    expect(dmarcReason.delta).toBe(DEFAULT_AUTH_SCORES.dmarc.fail);
  });
});

// ── senderIdentity PSL injection ──────────────────────────────────────────────
//
// Parity tests: verify that injecting the add-on's extractRegistrableDomain
// resolver activates the senderIdentity PSL fields and that they agree with
// the add-on's own computeMessageIdMetrics() for representative fixtures.
//
// Non-migrated local behaviors (documented here for follow-up):
//   - computeDisplayNameMetrics(): brand inference (JW, trigram Jaccard) and the
//     strict "entire display name is email-shaped" check have no equivalent in
//     senderIdentity; local helpers remain authoritative.
//   - getDomainParts(): returns publicSuffix, subdomain, isIcann, isPrivate which
//     senderIdentity.fromDomainParts omits; local PSL wrapper remains in use.
//   - computeLexicalMetrics(): entropy, vowel ratio, consonant run, etc. are not
//     in senderIdentity.localPartLexical / fromDomainLexical; local helper stays.
//   - computeMessageIdMetrics(): messageIdIsIcann and messageIdMismatchWithUnalignedAuth
//     are not in senderIdentity; local helper stays for scoring.

describe('analyzeMailAuthSignals — senderIdentity with getRegistrableDomain injection', () => {
  test('senderIdentity PSL fields are unpopulated without getRegistrableDomain', () => {
    // The package always produces a fromDomainParts object, but registrableDomain
    // stays null when no PSL resolver is injected.
    const { metrics } = analyzeMailAuthSignals({
      headers: {
        from: 'Alice <alice@example.com>',
        'message-id': '<msg-1@mail.example.com>',
      },
    });
    expect(metrics.senderIdentity.fromDomainParts.registrableDomain).toBeNull();
    expect(metrics.senderIdentity.messageIdDomainParts.registrableDomain).toBeNull();
    expect(metrics.senderIdentity.messageIdRegistrableDomainMatchesFromDomain).toBeNull();
  });

  test('fromDomainParts is populated when getRegistrableDomain is injected', () => {
    const { metrics } = analyzeMailAuthSignals({
      headers: { from: 'Alice <alice@mail.example.com>' },
      getRegistrableDomain: extractRegistrableDomain,
    });
    expect(metrics.senderIdentity.fromDomainParts).not.toBeNull();
    expect(metrics.senderIdentity.fromDomainParts.registrableDomain).toBe('example.com');
    expect(metrics.senderIdentity.fromDomainParts.subdomainDepth).toBe(1);
  });

  test('messageIdDomainParts is populated when getRegistrableDomain is injected', () => {
    const { metrics } = analyzeMailAuthSignals({
      headers: {
        from: 'Alice <alice@example.com>',
        'message-id': '<msg-1@mail.sendgrid.net>',
      },
      getRegistrableDomain: extractRegistrableDomain,
    });
    expect(metrics.senderIdentity.messageIdDomainParts).not.toBeNull();
    expect(metrics.senderIdentity.messageIdDomainParts.registrableDomain).toBe('sendgrid.net');
  });

  // Parity: senderIdentity.messageIdRegistrableDomainMatchesFromDomain vs
  // computeMessageIdMetrics().messageIdDomainMatchesFromDomain

  test('messageIdRegistrableDomainMatchesFromDomain — same registrable domain (true)', () => {
    const fromDomain = 'example.com';
    const messageIdHeader = '<msg-1@mail.example.com>';
    const { metrics } = analyzeMailAuthSignals({
      headers: { from: `Alice <alice@${fromDomain}>`, 'message-id': messageIdHeader },
      getRegistrableDomain: extractRegistrableDomain,
    });
    const localResult = computeMessageIdMetrics({
      messageIdDomain: 'mail.example.com',
      fromDomain,
    });
    expect(metrics.senderIdentity.messageIdRegistrableDomainMatchesFromDomain).toBe(true);
    expect(localResult.messageIdDomainMatchesFromDomain).toBe(true);
    expect(metrics.senderIdentity.messageIdRegistrableDomainMatchesFromDomain)
      .toBe(localResult.messageIdDomainMatchesFromDomain);
  });

  test('messageIdRegistrableDomainMatchesFromDomain — different registrable domains (false)', () => {
    const fromDomain = 'example.com';
    const { metrics } = analyzeMailAuthSignals({
      headers: {
        from: `Alice <alice@${fromDomain}>`,
        'message-id': '<msg-1@mail.sendgrid.net>',
      },
      getRegistrableDomain: extractRegistrableDomain,
    });
    const localResult = computeMessageIdMetrics({
      messageIdDomain: 'mail.sendgrid.net',
      fromDomain,
    });
    expect(metrics.senderIdentity.messageIdRegistrableDomainMatchesFromDomain).toBe(false);
    expect(localResult.messageIdDomainMatchesFromDomain).toBe(false);
    expect(metrics.senderIdentity.messageIdRegistrableDomainMatchesFromDomain)
      .toBe(localResult.messageIdDomainMatchesFromDomain);
  });

  test('messageIdRegistrableDomainMatchesFromDomain — missing message-id (null)', () => {
    const { metrics } = analyzeMailAuthSignals({
      headers: { from: 'Alice <alice@example.com>' },
      getRegistrableDomain: extractRegistrableDomain,
    });
    const localResult = computeMessageIdMetrics({ messageIdDomain: null, fromDomain: 'example.com' });
    expect(metrics.senderIdentity.messageIdRegistrableDomainMatchesFromDomain).toBeNull();
    expect(localResult.messageIdDomainMatchesFromDomain).toBeNull();
  });

  // Parity: senderIdentity.localPart vs extractFromLocalPart (internal background helper)

  test('senderIdentity.localPart matches the local part of the From address', () => {
    const { metrics } = analyzeMailAuthSignals({
      headers: { from: 'Alice <alice@example.com>' },
      getRegistrableDomain: extractRegistrableDomain,
    });
    expect(metrics.senderIdentity.localPart).toBe('alice');
  });

  test('senderIdentity.localPart preserves original case (unlike the add-on parseMailboxAddress fallback)', () => {
    // The package does not lowercase the local part; background.js applies
    // .toLowerCase() when consuming senderIdentity.localPart to maintain parity
    // with the parseMailboxAddress-based fallback.
    const { metrics } = analyzeMailAuthSignals({
      headers: { from: 'Alice <ALICE@Example.COM>' },
      getRegistrableDomain: extractRegistrableDomain,
    });
    expect(metrics.senderIdentity.localPart).toBe('ALICE');
  });

  test('senderIdentity.localPart is null when fromDomain cannot be extracted', () => {
    const { metrics } = analyzeMailAuthSignals({
      headers: { from: 'not a valid email' },
      getRegistrableDomain: extractRegistrableDomain,
    });
    expect(metrics.senderIdentity.localPart).toBeNull();
  });

  test('senderIdentity.displayName.containsEmail detects embedded email in display name', () => {
    const { metrics } = analyzeMailAuthSignals({
      headers: { from: '"trusted@example.com" <attacker@evil.test>' },
    });
    expect(metrics.senderIdentity.displayName.containsEmail).toBe(true);
    expect(metrics.senderIdentity.displayName.embeddedDomains).toContain('example.com');
  });

  test('senderIdentity.displayName.embeddedDomainMatchesFromDomain is false when embedded domain differs from From', () => {
    const { metrics } = analyzeMailAuthSignals({
      headers: { from: '"trusted@example.com" <attacker@evil.test>' },
    });
    expect(metrics.senderIdentity.displayName.embeddedDomainMatchesFromDomain).toBe(false);
  });
});

// ── analyzeMailAuthSignals — composite rules ──────────────────────────────────

describe('analyzeMailAuthSignals — composite rules', () => {
  test('runs composite rules by default and includes composite category signals', () => {
    // Unaligned auth + Message-ID mismatch → unauthenticatedFromSpoof fires
    const { signals } = analyzeMailAuthSignals({
      headers: {
        from: 'Attacker <victim@example.com>',
        'message-id': '<abc@sendgrid.net>',
        'authentication-results': 'mx.example.com; spf=pass smtp.mailfrom=sender@sendgrid.net; dkim=pass header.d=sendgrid.net',
      },
      trustedAuthservIds: ['mx.example.com'],
    });
    const compositeSignals = signals.filter(s => s.category === 'composite');
    expect(compositeSignals.length).toBeGreaterThan(0);
    expect(compositeSignals.some(s => s.key === 'composite.unauthenticatedFromSpoof')).toBe(true);
  });

  test('emits composite.alignedAuthenticationConfirmed for fully-aligned auth with no risk signals', () => {
    const { signals } = analyzeMailAuthSignals({
      headers: {
        from: 'Alice <alice@example.com>',
        'authentication-results': 'mx.example.com; dkim=pass header.d=example.com',
      },
      trustedAuthservIds: ['mx.example.com'],
    });
    const confirmed = signals.find(s => s.key === 'composite.alignedAuthenticationConfirmed');
    expect(confirmed).toBeDefined();
    expect(confirmed.category).toBe('composite');
    expect(confirmed.data.fromDomain).toBe('example.com');
  });

  test('emits composite.unauthenticatedFromSpoof when From has no aligned auth and Message-ID mismatches', () => {
    const { signals } = analyzeMailAuthSignals({
      headers: {
        from: 'Attacker <victim@example.com>',
        'message-id': '<abc@sendgrid.net>',
        'authentication-results': 'mx.example.com; spf=pass smtp.mailfrom=sender@sendgrid.net; dkim=pass header.d=sendgrid.net',
      },
      trustedAuthservIds: ['mx.example.com'],
    });
    const spoof = signals.find(s => s.key === 'composite.unauthenticatedFromSpoof');
    expect(spoof).toBeDefined();
    expect(spoof.category).toBe('composite');
    expect(spoof.data.fromDomain).toBe('example.com');
    expect(spoof.data.anyAuthAligned).toBe(false);
  });

  test('emits composite.authenticatedDisplayNameSpoof when display name embeds a different domain', () => {
    const { signals } = analyzeMailAuthSignals({
      headers: {
        from: '"user@evil.com" <legit@example.com>',
        'authentication-results': 'mx.example.com; dkim=pass header.d=example.com',
      },
      trustedAuthservIds: ['mx.example.com'],
    });
    const spoof = signals.find(s => s.key === 'composite.authenticatedDisplayNameSpoof');
    expect(spoof).toBeDefined();
    expect(spoof.category).toBe('composite');
    expect(spoof.data.fromDomain).toBe('example.com');
    expect(spoof.data.embeddedDomains).toContain('evil.com');
  });

  test('emits composite.publicMailboxSpoofingCandidate when From and Return-Path are both public mailbox providers', () => {
    // Observed spam: From outlook.com (Microsoft), Return-Path icloud.com (Apple), DMARC/SPF failed.
    const { signals } = analyzeMailAuthSignals({
      headers: {
        from: 'Sender <user@outlook.com>',
        'return-path': '<bounce@icloud.com>',
        'authentication-results': 'mx.example.com; dmarc=fail; spf=fail smtp.mailfrom=bounce@icloud.com',
      },
      trustedAuthservIds: ['mx.example.com'],
    });
    const spoof = signals.find(s => s.key === 'composite.publicMailboxSpoofingCandidate');
    expect(spoof).toBeDefined();
    expect(spoof.data.fromDomain).toBe('outlook.com');
  });

  test('does not emit composite.publicMailboxSpoofingCandidate when Return-Path is a non-public domain', () => {
    // Forwarding/relay case: From gmail.com but Return-Path is a private/enterprise domain.
    // The mismatch is not a provider-split pattern — should not score as public mailbox spoofing.
    const { signals } = analyzeMailAuthSignals({
      headers: {
        from: 'Sender <user@gmail.com>',
        'return-path': '<bounce@example.org>',
        'authentication-results': 'mx.example.com; dmarc=fail; spf=fail smtp.mailfrom=bounce@example.org',
      },
      trustedAuthservIds: ['mx.example.com'],
    });
    const spoof = signals.find(s => s.key === 'composite.publicMailboxSpoofingCandidate');
    expect(spoof).toBeUndefined();
  });

  test('emits composite.publicMailboxSpoofingCandidate when Return-Path uses a provider subdomain', () => {
    // Provider-split pattern with routing subdomain: Return-Path bounce.mail.icloud.com belongs
    // to the icloud.com family — exact-domain check misses it, subdomain-aware check must fire.
    const { signals } = analyzeMailAuthSignals({
      headers: {
        from: 'Sender <user@outlook.com>',
        'return-path': '<bounce@bounce.mail.icloud.com>',
        'authentication-results': 'mx.example.com; dmarc=fail; spf=fail smtp.mailfrom=bounce@bounce.mail.icloud.com',
      },
      trustedAuthservIds: ['mx.example.com'],
    });
    const spoof = signals.find(s => s.key === 'composite.publicMailboxSpoofingCandidate');
    expect(spoof).toBeDefined();
    expect(spoof.data.fromDomain).toBe('outlook.com');
  });

  test('emits composite.publicMailboxSpoofingCandidate when Message-ID uses a provider subdomain', () => {
    // Message-ID mx.yahoo.co.jp belongs to the yahoo.co.jp family; exact-domain check misses it.
    const { signals } = analyzeMailAuthSignals({
      headers: {
        from: 'Sender <user@outlook.com>',
        'message-id': '<12345@mx.yahoo.co.jp>',
        'authentication-results': 'mx.example.com; dmarc=fail; spf=fail',
      },
      trustedAuthservIds: ['mx.example.com'],
    });
    const spoof = signals.find(s => s.key === 'composite.publicMailboxSpoofingCandidate');
    expect(spoof).toBeDefined();
    expect(spoof.data.fromDomain).toBe('outlook.com');
  });

  test('does not emit composite.publicMailboxSpoofingCandidate when Return-Path subdomain belongs to a non-public domain', () => {
    // Forwarding/relay: From gmail.com but Return-Path is a subdomain of a private/enterprise domain.
    const { signals } = analyzeMailAuthSignals({
      headers: {
        from: 'Sender <user@gmail.com>',
        'return-path': '<bounce@mail.example.org>',
        'authentication-results': 'mx.example.com; dmarc=fail; spf=fail smtp.mailfrom=bounce@mail.example.org',
      },
      trustedAuthservIds: ['mx.example.com'],
    });
    const spoof = signals.find(s => s.key === 'composite.publicMailboxSpoofingCandidate');
    expect(spoof).toBeUndefined();
  });

  test('does not emit composite.publicMailboxSpoofingCandidate when Return-Path is a subdomain of the same provider', () => {
    // False-positive guard: From outlook.com, Return-Path bounce.mail.outlook.com — same Microsoft
    // provider family. Even though exact domains differ, this is legitimate routing infrastructure
    // and must not score as spoofing.
    const { signals } = analyzeMailAuthSignals({
      headers: {
        from: 'Sender <user@outlook.com>',
        'return-path': '<bounce@bounce.mail.outlook.com>',
        'authentication-results': 'mx.example.com; dmarc=fail; spf=fail smtp.mailfrom=bounce@bounce.mail.outlook.com',
      },
      trustedAuthservIds: ['mx.example.com'],
    });
    const spoof = signals.find(s => s.key === 'composite.publicMailboxSpoofingCandidate');
    expect(spoof).toBeUndefined();
  });

  test('does not emit composite.publicMailboxSpoofingCandidate when Message-ID is a subdomain of the same provider', () => {
    // False-positive guard: From hotmail.com, Message-ID mx.outlook.com — both Microsoft family.
    const { signals } = analyzeMailAuthSignals({
      headers: {
        from: 'Sender <user@hotmail.com>',
        'message-id': '<12345@mx.outlook.com>',
        'authentication-results': 'mx.example.com; dmarc=fail; spf=fail',
      },
      trustedAuthservIds: ['mx.example.com'],
    });
    const spoof = signals.find(s => s.key === 'composite.publicMailboxSpoofingCandidate');
    expect(spoof).toBeUndefined();
  });

  test('disabling composite rules via compositeRules: [] emits no composite signals', () => {
    const { signals } = analyzeMailAuthSignals({
      headers: {
        from: 'Alice <alice@example.com>',
        'authentication-results': 'mx.example.com; dkim=pass d=example.com',
      },
      trustedAuthservIds: ['mx.example.com'],
      compositeRules: [],
    });
    const compositeSignals = signals.filter(s => s.category === 'composite');
    expect(compositeSignals).toHaveLength(0);
  });
});

// ── adaptCompositeSignals ─────────────────────────────────────────────────────

describe('adaptCompositeSignals', () => {
  test('returns zero score and empty reasons when signals array is empty', () => {
    const result = adaptCompositeSignals([]);
    expect(result.score).toBe(0);
    expect(result.scoreReasons).toHaveLength(0);
  });

  test('ignores non-composite signals', () => {
    const signals = [
      { key: 'auth.method.failure', category: 'auth-failure', data: {} },
      { key: 'messageId.domainMismatch', category: 'consistency', data: {} },
    ];
    const result = adaptCompositeSignals(signals);
    expect(result.score).toBe(0);
    expect(result.scoreReasons).toHaveLength(0);
  });

  test('maps composite.unauthenticatedFromSpoof to score reason with default delta 35', () => {
    const signals = [{
      key: 'composite.unauthenticatedFromSpoof',
      category: 'composite',
      severity: 'high',
      data: { fromDomain: 'example.com', anyAuthAligned: false, contributingSignals: ['replyTo.domainMismatch'] },
    }];
    const result = adaptCompositeSignals(signals);
    expect(result.score).toBe(35);
    expect(result.scoreReasons).toHaveLength(1);
    const reason = result.scoreReasons[0];
    expect(reason.key).toBe('composite.unauthenticatedFromSpoof');
    expect(reason.delta).toBe(35);
    expect(reason.fromDomain).toBe('example.com');
    expect(reason.contributingSignals).toEqual(['replyTo.domainMismatch']);
  });

  test('suppresses composite.unauthenticatedFromSpoof when Message-ID mismatch is the sole contributor', () => {
    // scoreMessage() already applies composite.messageIdMismatchWithUnalignedAuth (+30)
    // for the same evidence; emitting the composite signal would double-count it.
    const signals = [{
      key: 'composite.unauthenticatedFromSpoof',
      category: 'composite',
      severity: 'high',
      data: { fromDomain: 'example.com', anyAuthAligned: false, contributingSignals: ['messageId.domainMismatch'] },
    }];
    const result = adaptCompositeSignals(signals);
    expect(result.score).toBe(0);
    expect(result.scoreReasons).toHaveLength(0);
  });

  test('emits composite.unauthenticatedFromSpoof when Message-ID mismatch is one of multiple contributors', () => {
    const signals = [{
      key: 'composite.unauthenticatedFromSpoof',
      category: 'composite',
      severity: 'high',
      data: { fromDomain: 'example.com', anyAuthAligned: false, contributingSignals: ['messageId.domainMismatch', 'replyTo.domainMismatch'] },
    }];
    const result = adaptCompositeSignals(signals);
    expect(result.score).toBe(35);
    expect(result.scoreReasons).toHaveLength(1);
    expect(result.scoreReasons[0].contributingSignals).toEqual(['messageId.domainMismatch', 'replyTo.domainMismatch']);
  });

  test('suppresses composite.unauthenticatedFromSpoof when addonAnyAuthAligned is true', () => {
    const signals = [{
      key: 'composite.unauthenticatedFromSpoof',
      category: 'composite',
      severity: 'high',
      data: { fromDomain: 'news.example.com', anyAuthAligned: false, contributingSignals: ['smtpMailfrom.domainMismatch'] },
    }];
    // The add-on's PSL-aware check sees SPF-pass for example.com as aligned with news.example.com
    const result = adaptCompositeSignals(signals, {}, { addonAnyAuthAligned: true });
    expect(result.score).toBe(0);
    expect(result.scoreReasons).toHaveLength(0);
  });

  test('emits composite.unauthenticatedFromSpoof when addonAnyAuthAligned is false', () => {
    const signals = [{
      key: 'composite.unauthenticatedFromSpoof',
      category: 'composite',
      severity: 'high',
      data: { fromDomain: 'example.com', anyAuthAligned: false, contributingSignals: ['replyTo.domainMismatch'] },
    }];
    const result = adaptCompositeSignals(signals, {}, { addonAnyAuthAligned: false });
    expect(result.score).toBe(35);
    expect(result.scoreReasons[0].contributingSignals).toEqual(['replyTo.domainMismatch']);
  });

  test('emits composite.unauthenticatedFromSpoof when addonAnyAuthAligned is null (no auth info)', () => {
    const signals = [{
      key: 'composite.unauthenticatedFromSpoof',
      category: 'composite',
      severity: 'high',
      data: { fromDomain: 'example.com', anyAuthAligned: false, contributingSignals: ['returnPath.domainMismatch'] },
    }];
    const result = adaptCompositeSignals(signals, {}, { addonAnyAuthAligned: null });
    expect(result.score).toBe(35);
  });

  test('maps composite.authenticatedDisplayNameSpoof to score reason with default delta 40', () => {
    const signals = [{
      key: 'composite.authenticatedDisplayNameSpoof',
      category: 'composite',
      severity: 'medium',
      data: {
        fromDomain: 'example.com',
        embeddedDomains: ['evil.com'],
        mismatchedDomains: ['evil.com'],
        contributingSignals: [],
      },
    }];
    const result = adaptCompositeSignals(signals);
    expect(result.score).toBe(40);
    expect(result.scoreReasons).toHaveLength(1);
    const reason = result.scoreReasons[0];
    expect(reason.key).toBe('composite.authenticatedDisplayNameSpoof');
    expect(reason.delta).toBe(40);
    expect(reason.embeddedDomains).toEqual(['evil.com']);
    expect(reason.mismatchedDomains).toEqual(['evil.com']);
  });

  test('maps composite.alignedAuthenticationConfirmed with delta 0', () => {
    const signals = [{
      key: 'composite.alignedAuthenticationConfirmed',
      category: 'composite',
      severity: 'info',
      data: { fromDomain: 'example.com', anyAlignedSpfPass: true, anyAlignedDkimPass: true, dmarcPass: true, contributingSignals: [] },
    }];
    const result = adaptCompositeSignals(signals);
    expect(result.score).toBe(0);
    expect(result.scoreReasons).toHaveLength(1);
    const reason = result.scoreReasons[0];
    expect(reason.key).toBe('composite.alignedAuthenticationConfirmed');
    expect(reason.delta).toBe(0);
    expect(reason.fromDomain).toBe('example.com');
  });

  test('applies compositeScores overrides for unauthenticatedFromSpoof', () => {
    const signals = [{
      key: 'composite.unauthenticatedFromSpoof',
      category: 'composite',
      severity: 'high',
      data: { fromDomain: 'example.com', anyAuthAligned: false, contributingSignals: [] },
    }];
    const result = adaptCompositeSignals(signals, { unauthenticatedFromSpoof: 50 });
    expect(result.score).toBe(50);
    expect(result.scoreReasons[0].delta).toBe(50);
  });

  test('applies compositeScores overrides for authenticatedDisplayNameSpoof', () => {
    const signals = [{
      key: 'composite.authenticatedDisplayNameSpoof',
      category: 'composite',
      severity: 'medium',
      data: { fromDomain: 'example.com', embeddedDomains: ['evil.com'], mismatchedDomains: ['evil.com'], contributingSignals: [] },
    }];
    const result = adaptCompositeSignals(signals, { authenticatedDisplayNameSpoof: 60 });
    expect(result.score).toBe(60);
    expect(result.scoreReasons[0].delta).toBe(60);
  });

  test('accumulates scores from multiple composite signals', () => {
    const signals = [
      {
        key: 'composite.unauthenticatedFromSpoof',
        category: 'composite',
        severity: 'high',
        data: { fromDomain: 'example.com', anyAuthAligned: false, contributingSignals: ['returnPath.domainMismatch'] },
      },
      {
        key: 'composite.alignedAuthenticationConfirmed',
        category: 'composite',
        severity: 'info',
        data: { fromDomain: 'other.com', anyAlignedSpfPass: false, anyAlignedDkimPass: true, dmarcPass: null, contributingSignals: [] },
      },
    ];
    const result = adaptCompositeSignals(signals, {}, { addonAnyAuthAligned: false });
    expect(result.score).toBe(35);
    expect(result.scoreReasons).toHaveLength(2);
  });

  test('end-to-end: analyzeMailAuthSignals + adaptCompositeSignals scores unauthenticatedFromSpoof', () => {
    const { signals } = analyzeMailAuthSignals({
      headers: {
        from: 'Attacker <victim@example.com>',
        'message-id': '<abc@sendgrid.net>',
        'authentication-results': 'mx.example.com; spf=pass smtp.mailfrom=sender@sendgrid.net; dkim=pass header.d=sendgrid.net',
      },
      trustedAuthservIds: ['mx.example.com'],
    });
    const result = adaptCompositeSignals(signals, {}, { addonAnyAuthAligned: false });
    expect(result.score).toBe(35);
    const reason = result.scoreReasons.find(r => r.key === 'composite.unauthenticatedFromSpoof');
    expect(reason).toBeDefined();
    expect(reason.fromDomain).toBe('example.com');
  });

  test('end-to-end: analyzeMailAuthSignals + adaptCompositeSignals scores authenticatedDisplayNameSpoof', () => {
    const { signals } = analyzeMailAuthSignals({
      headers: {
        from: '"user@evil.com" <legit@example.com>',
        'authentication-results': 'mx.example.com; dkim=pass header.d=example.com',
      },
      trustedAuthservIds: ['mx.example.com'],
    });
    const result = adaptCompositeSignals(signals);
    expect(result.score).toBe(40);
    const reason = result.scoreReasons.find(r => r.key === 'composite.authenticatedDisplayNameSpoof');
    expect(reason).toBeDefined();
    expect(reason.embeddedDomains).toContain('evil.com');
  });

  test('end-to-end: suppressed unauthenticatedFromSpoof when add-on considers PSL-aligned', () => {
    // From: news.example.com, SPF-pass for example.com
    // Package: exact mismatch → unauthenticatedFromSpoof fires
    // Add-on PSL: example.com == example.com → anyAuthAligned=true → suppressed
    const { signals } = analyzeMailAuthSignals({
      headers: {
        from: 'News <news@news.example.com>',
        'message-id': '<abc@lists.example.com>',
        'authentication-results': 'mx.example.com; spf=pass smtp.mailfrom=mailer@example.com',
      },
      trustedAuthservIds: ['mx.example.com'],
    });
    // Package fires unauthenticatedFromSpoof (exact mismatch: example.com ≠ news.example.com)
    const packageSpoof = signals.find(s => s.key === 'composite.unauthenticatedFromSpoof');
    // Suppressed by the gate because addonAnyAuthAligned=true (PSL: both are example.com)
    const result = adaptCompositeSignals(signals, {}, { addonAnyAuthAligned: true });
    if (packageSpoof) {
      // Gate works: no score reason emitted even though the signal fired
      expect(result.scoreReasons.find(r => r.key === 'composite.unauthenticatedFromSpoof')).toBeUndefined();
    }
    // Either way, no score from suppressed signal
    expect(result.scoreReasons.filter(r => r.key === 'composite.unauthenticatedFromSpoof')).toHaveLength(0);
  });

  // ── composite.publicMailboxSpoofingCandidate → composite.publicDomainSpoofing ──

  test('maps composite.publicMailboxSpoofingCandidate to composite.publicDomainSpoofing with default delta 45', () => {
    const signals = [{
      key: 'composite.publicMailboxSpoofingCandidate',
      category: 'composite',
      severity: 'high',
      data: { fromDomain: 'outlook.com', provider: 'Microsoft' },
    }];
    const result = adaptCompositeSignals(signals);
    expect(result.score).toBe(45);
    expect(result.scoreReasons).toHaveLength(1);
    const reason = result.scoreReasons[0];
    expect(reason.key).toBe('composite.publicDomainSpoofing');
    expect(reason.delta).toBe(45);
    expect(reason.fromDomain).toBe('outlook.com');
    expect(reason.provider).toBe('Microsoft');
  });

  test('Outlook/iCloud/Yahoo split pattern: signal fires for public mailbox domain with mismatched infrastructure', () => {
    // Observed spam: From outlook.com, Return-Path icloud.com, Message-ID yahoo.co.jp, DMARC/SPF failed.
    // mail-auth-signal detects the public mailbox spoofing candidate; adaptCompositeSignals scores it.
    const signals = [
      {
        key: 'composite.publicMailboxSpoofingCandidate',
        category: 'composite',
        severity: 'high',
        data: {
          fromDomain: 'outlook.com',
          provider: 'Microsoft',
          returnPathProvider: 'Apple',
          messageIdProvider: 'Yahoo',
        },
      },
    ];
    const result = adaptCompositeSignals(signals);
    expect(result.score).toBe(45);
    const reason = result.scoreReasons.find(r => r.key === 'composite.publicDomainSpoofing');
    expect(reason).toBeDefined();
    expect(reason.fromDomain).toBe('outlook.com');
    expect(reason.label).toMatch(/[Pp]ublic mailbox/);
  });

  test('forwarding-like non-hit: no publicDomainSpoofing score when signal is absent', () => {
    // A message forwarded through an intermediate relay with no public mailbox spoofing candidate signal.
    const signals = [
      {
        key: 'composite.alignedAuthenticationConfirmed',
        category: 'composite',
        severity: 'info',
        data: { fromDomain: 'example.com', anyAlignedDkimPass: true, contributingSignals: [] },
      },
    ];
    const result = adaptCompositeSignals(signals);
    expect(result.scoreReasons.find(r => r.key === 'composite.publicDomainSpoofing')).toBeUndefined();
    expect(result.score).toBe(0);
  });

  test('applies compositeScores override for publicDomainSpoofing', () => {
    const signals = [{
      key: 'composite.publicMailboxSpoofingCandidate',
      category: 'composite',
      severity: 'high',
      data: { fromDomain: 'yahoo.co.jp', provider: 'Yahoo' },
    }];
    const result = adaptCompositeSignals(signals, { publicDomainSpoofing: 50 });
    expect(result.score).toBe(50);
    expect(result.scoreReasons[0].delta).toBe(50);
  });

  test('iCloud spoofing candidate: maps fromDomain and provider correctly', () => {
    const signals = [{
      key: 'composite.publicMailboxSpoofingCandidate',
      category: 'composite',
      severity: 'high',
      data: { fromDomain: 'icloud.com', provider: 'Apple' },
    }];
    const result = adaptCompositeSignals(signals);
    expect(result.score).toBe(45);
    const reason = result.scoreReasons[0];
    expect(reason.key).toBe('composite.publicDomainSpoofing');
    expect(reason.fromDomain).toBe('icloud.com');
    expect(reason.provider).toBe('Apple');
  });

  test('adaptCompositeSignals uses DEFAULT_COMPOSITE_SCORES.publicDomainSpoofing as the default delta', () => {
    const signals = [{
      key: 'composite.publicMailboxSpoofingCandidate',
      category: 'composite',
      severity: 'high',
      data: { fromDomain: 'outlook.com', provider: 'Microsoft' },
    }];
    const result = adaptCompositeSignals(signals);
    expect(result.score).toBe(DEFAULT_COMPOSITE_SCORES.publicDomainSpoofing);
    expect(result.scoreReasons[0].delta).toBe(DEFAULT_COMPOSITE_SCORES.publicDomainSpoofing);
  });

  test('suppresses composite.publicMailboxSpoofingCandidate when addonAnyAuthAligned is true (PSL-aligned subdomain)', () => {
    // From: outlook.com, SPF pass for bounce.mail.outlook.com — PSL-aware alignment treats this
    // as authenticated, so the public-domain score must not fire.
    const signals = [{
      key: 'composite.publicMailboxSpoofingCandidate',
      category: 'composite',
      severity: 'high',
      data: { fromDomain: 'outlook.com', provider: 'Microsoft' },
    }];
    const result = adaptCompositeSignals(signals, {}, { addonAnyAuthAligned: true });
    expect(result.score).toBe(0);
    expect(result.scoreReasons.find(r => r.key === 'composite.publicDomainSpoofing')).toBeUndefined();
  });

  test('emits composite.publicMailboxSpoofingCandidate when addonAnyAuthAligned is false', () => {
    const signals = [{
      key: 'composite.publicMailboxSpoofingCandidate',
      category: 'composite',
      severity: 'high',
      data: { fromDomain: 'outlook.com', provider: 'Microsoft' },
    }];
    const result = adaptCompositeSignals(signals, {}, { addonAnyAuthAligned: false });
    expect(result.score).toBe(45);
    expect(result.scoreReasons[0].key).toBe('composite.publicDomainSpoofing');
  });
});
