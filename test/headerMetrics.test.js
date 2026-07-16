import { computeHeaderMetrics } from '../src/core/headerMetrics.js';

// ─── Return shape ─────────────────────────────────────────────────────────────

describe('computeHeaderMetrics — return shape', () => {
  test('returns all expected keys when called with no arguments', () => {
    const m = computeHeaderMetrics();
    const keys = Object.keys(m);
    expect(keys).toEqual([
      'senderHeader',
      'senderDomain',
      'senderRegistrableDomain',
      'senderSubdomainDepth',
      'replyToHeader',
      'replyToDomain',
      'replyToRegistrableDomain',
      'replyToSubdomainDepth',
      'returnPathHeader',
      'returnPathDomain',
      'returnPathRegistrableDomain',
      'returnPathSubdomainDepth',
      'listId',
      'listUnsubscribe',
      'senderDomainMatchesFromDomain',
      'replyToDomainMatchesFromDomain',
      'returnPathDomainMatchesFromDomain',
      'hasListHeaders',
    ]);
  });

  test('all address fields are null and hasListHeaders false when headers are empty', () => {
    const m = computeHeaderMetrics({ headers: {}, fromDomain: 'example.com' });
    expect(m.senderHeader).toBeNull();
    expect(m.senderDomain).toBeNull();
    expect(m.senderRegistrableDomain).toBeNull();
    expect(m.senderSubdomainDepth).toBeNull();
    expect(m.replyToHeader).toBeNull();
    expect(m.replyToDomain).toBeNull();
    expect(m.replyToRegistrableDomain).toBeNull();
    expect(m.replyToSubdomainDepth).toBeNull();
    expect(m.returnPathHeader).toBeNull();
    expect(m.returnPathDomain).toBeNull();
    expect(m.returnPathRegistrableDomain).toBeNull();
    expect(m.returnPathSubdomainDepth).toBeNull();
    expect(m.listId).toBeNull();
    expect(m.listUnsubscribe).toBeNull();
    expect(m.senderDomainMatchesFromDomain).toBeNull();
    expect(m.replyToDomainMatchesFromDomain).toBeNull();
    expect(m.returnPathDomainMatchesFromDomain).toBeNull();
    expect(m.hasListHeaders).toBe(false);
  });
});

// ─── Sender ───────────────────────────────────────────────────────────────────

describe('computeHeaderMetrics — Sender header', () => {
  test('extracts sender address from bare addr-spec', () => {
    const m = computeHeaderMetrics({
      headers: { sender: ['sender@example.com'] },
      fromDomain: 'example.com',
    });
    expect(m.senderHeader).toBe('sender@example.com');
    expect(m.senderDomain).toBe('example.com');
    expect(m.senderRegistrableDomain).toBe('example.com');
  });

  test('extracts sender address from angle-bracket name-addr', () => {
    const m = computeHeaderMetrics({
      headers: { sender: ['SMTP Server <bounce@mail.example.com>'] },
      fromDomain: 'example.com',
    });
    expect(m.senderHeader).toBe('bounce@mail.example.com');
    expect(m.senderDomain).toBe('mail.example.com');
    expect(m.senderRegistrableDomain).toBe('example.com');
  });

  test('senderSubdomainDepth is 1 for a single-level subdomain', () => {
    const m = computeHeaderMetrics({
      headers: { sender: ['sender@mail.example.com'] },
      fromDomain: 'example.com',
    });
    expect(m.senderSubdomainDepth).toBe(1);
  });

  test('senderSubdomainDepth is 0 when sender domain has no subdomain', () => {
    const m = computeHeaderMetrics({
      headers: { sender: ['sender@example.com'] },
      fromDomain: 'example.com',
    });
    expect(m.senderSubdomainDepth).toBe(0);
  });

  test('senderSubdomainDepth is null when Sender header is absent', () => {
    const m = computeHeaderMetrics({ headers: {}, fromDomain: 'example.com' });
    expect(m.senderSubdomainDepth).toBeNull();
  });

  test('senderDomainMatchesFromDomain is true when registrable domains match', () => {
    const m = computeHeaderMetrics({
      headers: { sender: ['sender@smtp.example.co.jp'] },
      fromDomain: 'example.co.jp',
    });
    expect(m.senderRegistrableDomain).toBe('example.co.jp');
    expect(m.senderDomainMatchesFromDomain).toBe(true);
  });

  test('senderDomainMatchesFromDomain is false when registrable domains differ', () => {
    const m = computeHeaderMetrics({
      headers: { sender: ['sender@other.org'] },
      fromDomain: 'example.com',
    });
    expect(m.senderDomainMatchesFromDomain).toBe(false);
  });

  test('senderDomainMatchesFromDomain is null when fromDomain is empty', () => {
    const m = computeHeaderMetrics({
      headers: { sender: ['sender@example.com'] },
      fromDomain: '',
    });
    expect(m.senderDomainMatchesFromDomain).toBeNull();
  });

  test('senderDomainMatchesFromDomain is null when Sender header is absent', () => {
    const m = computeHeaderMetrics({
      headers: {},
      fromDomain: 'example.com',
    });
    expect(m.senderDomainMatchesFromDomain).toBeNull();
  });

  test('returns null for missing Sender header', () => {
    const m = computeHeaderMetrics({ headers: {}, fromDomain: 'example.com' });
    expect(m.senderHeader).toBeNull();
    expect(m.senderDomain).toBeNull();
    expect(m.senderRegistrableDomain).toBeNull();
  });
});

// ─── Reply-To ─────────────────────────────────────────────────────────────────

describe('computeHeaderMetrics — Reply-To header', () => {
  test('extracts reply-to address from bare addr-spec', () => {
    const m = computeHeaderMetrics({
      headers: { 'reply-to': ['replies@example.com'] },
      fromDomain: 'example.com',
    });
    expect(m.replyToHeader).toBe('replies@example.com');
    expect(m.replyToDomain).toBe('example.com');
    expect(m.replyToRegistrableDomain).toBe('example.com');
  });

  test('extracts reply-to address from angle-bracket form', () => {
    const m = computeHeaderMetrics({
      headers: { 'reply-to': ['Support Team <support@helpdesk.other.com>'] },
      fromDomain: 'brand.com',
    });
    expect(m.replyToHeader).toBe('support@helpdesk.other.com');
    expect(m.replyToDomain).toBe('helpdesk.other.com');
    expect(m.replyToRegistrableDomain).toBe('other.com');
    expect(m.replyToDomainMatchesFromDomain).toBe(false);
  });

  test('replyToDomainMatchesFromDomain is true when registrable domains match', () => {
    const m = computeHeaderMetrics({
      headers: { 'reply-to': ['noreply@sub.example.com'] },
      fromDomain: 'example.com',
    });
    expect(m.replyToDomainMatchesFromDomain).toBe(true);
  });

  test('replyToSubdomainDepth is 2 for a two-level subdomain', () => {
    const m = computeHeaderMetrics({
      headers: { 'reply-to': ['replies@a.b.example.com'] },
      fromDomain: 'example.com',
    });
    expect(m.replyToSubdomainDepth).toBe(2);
  });

  test('replyToSubdomainDepth is null when Reply-To is absent', () => {
    const m = computeHeaderMetrics({ headers: {}, fromDomain: 'example.com' });
    expect(m.replyToSubdomainDepth).toBeNull();
  });

  test('replyToDomainMatchesFromDomain is null when Reply-To is absent', () => {
    const m = computeHeaderMetrics({ headers: {}, fromDomain: 'example.com' });
    expect(m.replyToDomainMatchesFromDomain).toBeNull();
  });

  test('replyToDomainMatchesFromDomain is null when fromDomain is empty', () => {
    const m = computeHeaderMetrics({
      headers: { 'reply-to': ['replies@example.com'] },
      fromDomain: '',
    });
    expect(m.replyToDomainMatchesFromDomain).toBeNull();
  });
});

// ─── Return-Path ──────────────────────────────────────────────────────────────

describe('computeHeaderMetrics — Return-Path header', () => {
  test('extracts return-path address from angle-bracket form', () => {
    const m = computeHeaderMetrics({
      headers: { 'return-path': ['<bounce@mail.example.com>'] },
      fromDomain: 'example.com',
    });
    expect(m.returnPathHeader).toBe('bounce@mail.example.com');
    expect(m.returnPathDomain).toBe('mail.example.com');
    expect(m.returnPathRegistrableDomain).toBe('example.com');
    expect(m.returnPathDomainMatchesFromDomain).toBe(true);
  });

  test('extracts return-path from bare address', () => {
    const m = computeHeaderMetrics({
      headers: { 'return-path': ['bounce@sender.net'] },
      fromDomain: 'brand.com',
    });
    expect(m.returnPathHeader).toBe('bounce@sender.net');
    expect(m.returnPathDomain).toBe('sender.net');
    expect(m.returnPathDomainMatchesFromDomain).toBe(false);
  });

  test('empty bounce path <> produces null returnPathHeader', () => {
    const m = computeHeaderMetrics({
      headers: { 'return-path': ['<>'] },
      fromDomain: 'example.com',
    });
    expect(m.returnPathHeader).toBeNull();
    expect(m.returnPathDomain).toBeNull();
    expect(m.returnPathRegistrableDomain).toBeNull();
    expect(m.returnPathDomainMatchesFromDomain).toBeNull();
  });

  test('returnPathSubdomainDepth is 1 for a single-level subdomain', () => {
    const m = computeHeaderMetrics({
      headers: { 'return-path': ['<bounce@smtp.example.com>'] },
      fromDomain: 'example.com',
    });
    expect(m.returnPathSubdomainDepth).toBe(1);
  });

  test('returnPathSubdomainDepth is null when Return-Path is absent', () => {
    const m = computeHeaderMetrics({ headers: {}, fromDomain: 'example.com' });
    expect(m.returnPathSubdomainDepth).toBeNull();
  });

  test('returnPathDomainMatchesFromDomain is null when Return-Path is absent', () => {
    const m = computeHeaderMetrics({ headers: {}, fromDomain: 'example.com' });
    expect(m.returnPathDomainMatchesFromDomain).toBeNull();
  });

  test('returnPathDomainMatchesFromDomain is null when fromDomain is empty', () => {
    const m = computeHeaderMetrics({
      headers: { 'return-path': ['<bounce@example.com>'] },
      fromDomain: '',
    });
    expect(m.returnPathDomainMatchesFromDomain).toBeNull();
  });

  test('registrable-domain comparison works across subdomains', () => {
    const m = computeHeaderMetrics({
      headers: { 'return-path': ['<bounce@smtp1.example.co.jp>'] },
      fromDomain: 'mail.example.co.jp',
    });
    expect(m.returnPathRegistrableDomain).toBe('example.co.jp');
    expect(m.returnPathDomainMatchesFromDomain).toBe(true);
  });
});

// ─── List headers ─────────────────────────────────────────────────────────────

describe('computeHeaderMetrics — list headers', () => {
  test('captures List-Id value', () => {
    const m = computeHeaderMetrics({
      headers: { 'list-id': ['<mylist.example.com>'] },
      fromDomain: 'example.com',
    });
    expect(m.listId).toBe('<mylist.example.com>');
    expect(m.hasListHeaders).toBe(true);
  });

  test('captures List-Unsubscribe value', () => {
    const m = computeHeaderMetrics({
      headers: { 'list-unsubscribe': ['<https://example.com/unsub?id=123>'] },
      fromDomain: 'example.com',
    });
    expect(m.listUnsubscribe).toBe('<https://example.com/unsub?id=123>');
    expect(m.hasListHeaders).toBe(true);
  });

  test('hasListHeaders is true when both list headers are present', () => {
    const m = computeHeaderMetrics({
      headers: {
        'list-id': ['<mylist.example.com>'],
        'list-unsubscribe': ['<mailto:unsub@example.com>'],
      },
      fromDomain: 'example.com',
    });
    expect(m.hasListHeaders).toBe(true);
    expect(m.listId).toBe('<mylist.example.com>');
    expect(m.listUnsubscribe).toBe('<mailto:unsub@example.com>');
  });

  test('hasListHeaders is false when no list headers present', () => {
    const m = computeHeaderMetrics({ headers: {}, fromDomain: 'example.com' });
    expect(m.hasListHeaders).toBe(false);
    expect(m.listId).toBeNull();
    expect(m.listUnsubscribe).toBeNull();
  });

  test('hasListHeaders is true when only List-Id is present', () => {
    const m = computeHeaderMetrics({
      headers: { 'list-id': ['<announce.example.org>'] },
      fromDomain: 'example.org',
    });
    expect(m.hasListHeaders).toBe(true);
    expect(m.listUnsubscribe).toBeNull();
  });

  test('hasListHeaders is true when only List-Unsubscribe is present', () => {
    const m = computeHeaderMetrics({
      headers: { 'list-unsubscribe': ['<https://example.org/unsub>'] },
      fromDomain: 'example.org',
    });
    expect(m.hasListHeaders).toBe(true);
    expect(m.listId).toBeNull();
  });

  test('list header values are trimmed', () => {
    const m = computeHeaderMetrics({
      headers: { 'list-id': ['  <mylist.example.com>  '] },
      fromDomain: 'example.com',
    });
    expect(m.listId).toBe('<mylist.example.com>');
  });
});

// ─── List header truncation ───────────────────────────────────────────────────

describe('computeHeaderMetrics — list header truncation', () => {
  const LONG = 'x'.repeat(300);

  test('List-Id longer than 200 chars is truncated to 200', () => {
    const m = computeHeaderMetrics({
      headers: { 'list-id': [LONG] },
      fromDomain: 'example.com',
    });
    expect(m.listId).toHaveLength(200);
    expect(m.listId).toBe(LONG.slice(0, 200));
    expect(m.hasListHeaders).toBe(true);
  });

  test('List-Unsubscribe longer than 200 chars is truncated to 200', () => {
    const m = computeHeaderMetrics({
      headers: { 'list-unsubscribe': [LONG] },
      fromDomain: 'example.com',
    });
    expect(m.listUnsubscribe).toHaveLength(200);
    expect(m.listUnsubscribe).toBe(LONG.slice(0, 200));
    expect(m.hasListHeaders).toBe(true);
  });

  test('List-Id within 200 chars is stored as-is', () => {
    const short = '<mylist.example.com>';
    const m = computeHeaderMetrics({
      headers: { 'list-id': [short] },
      fromDomain: 'example.com',
    });
    expect(m.listId).toBe(short);
  });
});

// ─── Address field truncation ────────────────────────────────────────────────

describe('computeHeaderMetrics — address field truncation', () => {
  // Build an address whose local part pushes the total past 200 chars.
  // domain must be valid so parseMailboxAddress returns it.
  const longLocal = 'a'.repeat(210);
  const longAddress = `${longLocal}@example.com`;

  test('senderHeader longer than 200 chars is truncated to 200', () => {
    const m = computeHeaderMetrics({
      headers: { sender: [longAddress] },
      fromDomain: 'example.com',
    });
    expect(m.senderHeader).toHaveLength(200);
    expect(m.senderHeader).toBe(longAddress.slice(0, 200));
  });

  test('senderDomain is still extracted correctly when senderHeader is truncated', () => {
    const m = computeHeaderMetrics({
      headers: { sender: [longAddress] },
      fromDomain: 'example.com',
    });
    expect(m.senderDomain).toBe('example.com');
    expect(m.senderRegistrableDomain).toBe('example.com');
    expect(m.senderDomainMatchesFromDomain).toBe(true);
  });

  test('replyToHeader longer than 200 chars is truncated to 200', () => {
    const m = computeHeaderMetrics({
      headers: { 'reply-to': [longAddress] },
      fromDomain: 'example.com',
    });
    expect(m.replyToHeader).toHaveLength(200);
    expect(m.replyToHeader).toBe(longAddress.slice(0, 200));
  });

  test('returnPathHeader longer than 200 chars is truncated to 200', () => {
    const m = computeHeaderMetrics({
      headers: { 'return-path': [longAddress] },
      fromDomain: 'example.com',
    });
    expect(m.returnPathHeader).toHaveLength(200);
    expect(m.returnPathHeader).toBe(longAddress.slice(0, 200));
  });

  test('short address is stored as-is without truncation', () => {
    const addr = 'short@example.com';
    const m = computeHeaderMetrics({
      headers: { sender: [addr] },
      fromDomain: 'example.com',
    });
    expect(m.senderHeader).toBe(addr);
  });

  test('senderDomain is capped at 200 chars when the domain part itself is very long', () => {
    const longDomain = 'x'.repeat(300);
    const m = computeHeaderMetrics({
      headers: { sender: [`a@${longDomain}`] },
      fromDomain: 'example.com',
    });
    expect(m.senderDomain).toHaveLength(200);
    expect(m.senderDomain).toBe(longDomain.slice(0, 200));
  });

  test('replyToDomain is capped at 200 chars when the domain part is very long', () => {
    const longDomain = 'y'.repeat(300);
    const m = computeHeaderMetrics({
      headers: { 'reply-to': [`b@${longDomain}`] },
      fromDomain: 'example.com',
    });
    expect(m.replyToDomain).toHaveLength(200);
  });

  test('returnPathDomain is capped at 200 chars when the domain part is very long', () => {
    const longDomain = 'z'.repeat(300);
    const m = computeHeaderMetrics({
      headers: { 'return-path': [`c@${longDomain}`] },
      fromDomain: 'example.com',
    });
    expect(m.returnPathDomain).toHaveLength(200);
  });
});

// ─── Multiple headers present together ───────────────────────────────────────

describe('computeHeaderMetrics — combined headers', () => {
  test('all three address headers parsed independently', () => {
    const m = computeHeaderMetrics({
      headers: {
        sender: ['sender@mail.example.com'],
        'reply-to': ['replies@other.org'],
        'return-path': ['<bounce@mail.example.com>'],
      },
      fromDomain: 'example.com',
    });
    expect(m.senderDomainMatchesFromDomain).toBe(true);
    expect(m.replyToDomainMatchesFromDomain).toBe(false);
    expect(m.returnPathDomainMatchesFromDomain).toBe(true);
  });

  test('list headers and address headers coexist', () => {
    const m = computeHeaderMetrics({
      headers: {
        sender: ['newsletter@lists.example.com'],
        'list-id': ['<weekly.lists.example.com>'],
        'list-unsubscribe': ['<mailto:unsub@lists.example.com>'],
      },
      fromDomain: 'example.com',
    });
    expect(m.senderDomainMatchesFromDomain).toBe(true);
    expect(m.hasListHeaders).toBe(true);
  });
});
