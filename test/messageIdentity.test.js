import { extractMessageIdentity, parseMailboxAddress, parseMessageIdDomain, parseFromHeader } from '../src/core/messageIdentity.js';

// ─── parseMailboxAddress ──────────────────────────────────────────────────────

describe('parseMailboxAddress', () => {
  test('bare addr-spec returns the address lowercased', () =>
    expect(parseMailboxAddress('user@example.com')).toBe('user@example.com'));

  test('name-addr returns the angle-bracket address', () =>
    expect(parseMailboxAddress('Display Name <user@example.com>')).toBe('user@example.com'));

  test('name-addr with quoted display name', () =>
    expect(parseMailboxAddress('"Display Name" <user@example.com>')).toBe('user@example.com'));

  test('spoofed display name resolves to real envelope address', () =>
    // The angle-bracket address must win over any email-like string in the display name.
    expect(parseMailboxAddress('"trusted@example.com" <attacker@evil.test>')).toBe('attacker@evil.test'));

  test('returns lowercased address', () =>
    expect(parseMailboxAddress('User@Example.COM')).toBe('user@example.com'));

  test('angle-bracket address is also lowercased', () =>
    expect(parseMailboxAddress('"Name" <User@Example.COM>')).toBe('user@example.com'));

  test('returns empty string for header with no address', () =>
    expect(parseMailboxAddress('not an email')).toBe(''));

  test('returns empty string for empty string', () =>
    expect(parseMailboxAddress('')).toBe(''));
});

// ─── extractMessageIdentity ───────────────────────────────────────────────────

describe('extractMessageIdentity', () => {
  // ── Return shape ──

  test('returns all expected keys', () => {
    const keys = Object.keys(extractMessageIdentity({}, {}));
    expect(keys).toEqual([
      'thunderbirdMessageId',
      'rfcMessageId',
      'initialAccountId',
      'initialFolderId',
      'initialFolderName',
      'initialFolderPath',
      'initialFolderType',
      'subject',
      'from',
      'date',
    ]);
  });

  // ── RFC Message-ID ──

  test('rfcMessageId extracted from message-id header', () => {
    const id = extractMessageIdentity(
      { id: 1, folder: null },
      { 'message-id': ['<unique-1234@mail.example.com>'] },
    );
    expect(id.rfcMessageId).toBe('<unique-1234@mail.example.com>');
  });

  test('rfcMessageId is trimmed', () => {
    const id = extractMessageIdentity(
      { id: 1, folder: null },
      { 'message-id': ['  <spaced@example.com>  '] },
    );
    expect(id.rfcMessageId).toBe('<spaced@example.com>');
  });

  test('rfcMessageId is null when message-id header is absent', () => {
    const id = extractMessageIdentity({ id: 1, folder: null }, {});
    expect(id.rfcMessageId).toBeNull();
  });

  // ── Thunderbird message ID ──

  test('thunderbirdMessageId stores message.id', () => {
    const id = extractMessageIdentity({ id: 42, folder: null }, {});
    expect(id.thunderbirdMessageId).toBe(42);
  });

  test('thunderbirdMessageId is null when message.id absent', () => {
    const id = extractMessageIdentity({}, {});
    expect(id.thunderbirdMessageId).toBeNull();
  });

  // ── Folder / account fields ──

  test('folder fields copied when available', () => {
    const message = {
      id: 10,
      subject: 'Test',
      folder: {
        accountId: 'account1',
        id: 'folder42',
        name: 'Inbox',
        path: '/INBOX',
        type: 'inbox',
      },
    };
    const id = extractMessageIdentity(message, {});
    expect(id.initialAccountId).toBe('account1');
    expect(id.initialFolderId).toBe('folder42');
    expect(id.initialFolderName).toBe('Inbox');
    expect(id.initialFolderPath).toBe('/INBOX');
    expect(id.initialFolderType).toBe('inbox');
  });

  test('folder fields are null when message.folder is null', () => {
    const id = extractMessageIdentity({ id: 1, folder: null }, {});
    expect(id.initialAccountId).toBeNull();
    expect(id.initialFolderId).toBeNull();
    expect(id.initialFolderName).toBeNull();
    expect(id.initialFolderPath).toBeNull();
    expect(id.initialFolderType).toBeNull();
  });

  test('folder fields are null when message.folder is undefined', () => {
    const id = extractMessageIdentity({ id: 1 }, {});
    expect(id.initialAccountId).toBeNull();
    expect(id.initialFolderId).toBeNull();
  });

  test('individual folder fields fall back to null when absent from folder object', () => {
    // folder exists but path/type may not be present on all Thunderbird builds
    const message = {
      id: 5,
      folder: { accountId: 'acc1', id: 'f1', name: 'Inbox' },
    };
    const id = extractMessageIdentity(message, {});
    expect(id.initialFolderPath).toBeNull();
    expect(id.initialFolderType).toBeNull();
  });

  // ── Fallback fingerprint fields ──

  test('subject comes from message.subject', () => {
    const id = extractMessageIdentity({ id: 1, subject: 'Hello World', folder: null }, {});
    expect(id.subject).toBe('Hello World');
  });

  test('subject is null when message.subject absent', () => {
    const id = extractMessageIdentity({ id: 1, folder: null }, {});
    expect(id.subject).toBeNull();
  });

  test('from stores raw From header value', () => {
    const id = extractMessageIdentity(
      { id: 1, folder: null },
      { 'from': ['Display Name <user@example.com>'] },
    );
    expect(id.from).toBe('Display Name <user@example.com>');
  });

  test('from is null when From header absent', () => {
    const id = extractMessageIdentity({ id: 1, folder: null }, {});
    expect(id.from).toBeNull();
  });

  test('date stores raw Date header value', () => {
    const id = extractMessageIdentity(
      { id: 1, folder: null },
      { 'date': ['Sat, 30 May 2026 12:34:56 +0900'] },
    );
    expect(id.date).toBe('Sat, 30 May 2026 12:34:56 +0900');
  });

  test('date is null when Date header absent', () => {
    const id = extractMessageIdentity({ id: 1, folder: null }, {});
    expect(id.date).toBeNull();
  });

  // ── Robustness ──

  test('does not throw when called with no arguments', () => {
    expect(() => extractMessageIdentity()).not.toThrow();
  });

  test('does not throw when message and headers are empty objects', () => {
    expect(() => extractMessageIdentity({}, {})).not.toThrow();
  });

  test('all fields are null when message and headers are empty', () => {
    const id = extractMessageIdentity({}, {});
    for (const val of Object.values(id)) {
      expect(val).toBeNull();
    }
  });
});

// ─── parseMessageIdDomain ─────────────────────────────────────────────────────

describe('parseMessageIdDomain', () => {
  test('extracts domain from standard Message-ID', () =>
    expect(parseMessageIdDomain('<unique-1234@mail.example.com>')).toBe('mail.example.com'));

  test('returns lowercased domain', () =>
    expect(parseMessageIdDomain('<abc@Mail.Example.COM>')).toBe('mail.example.com'));

  test('handles subdomain in Message-ID domain', () =>
    expect(parseMessageIdDomain('<id@smtp.sender.example.co.jp>')).toBe('smtp.sender.example.co.jp'));

  test('returns null for null input', () =>
    expect(parseMessageIdDomain(null)).toBeNull());

  test('returns null for undefined input', () =>
    expect(parseMessageIdDomain(undefined)).toBeNull());

  test('returns null for empty string', () =>
    expect(parseMessageIdDomain('')).toBeNull());

  test('returns null when no angle brackets', () =>
    expect(parseMessageIdDomain('localpart@domain.com')).toBeNull());

  test('returns null when no @ inside angle brackets', () =>
    expect(parseMessageIdDomain('<noemail>')).toBeNull());

  test('returns null when domain portion is empty', () =>
    expect(parseMessageIdDomain('<localpart@>')).toBeNull());

  test('whitespace in header value does not match', () =>
    expect(parseMessageIdDomain('<local part@domain.com>')).toBeNull());

  test('handles realistic Message-ID with leading/trailing whitespace around the ID', () =>
    expect(parseMessageIdDomain('  <abc@mail.example.com>  ')).toBe('mail.example.com'));
});

// ─── parseFromHeader ──────────────────────────────────────────────────────────

describe('parseFromHeader', () => {
  test('ok: bare addr-spec', () => {
    const r = parseFromHeader('user@example.com');
    expect(r.parseStatus).toBe('ok');
    expect(r.fromDomain).toBe('example.com');
    expect(r.mailboxAddress).toBe('user@example.com');
    expect(r.rawFrom).toBe('user@example.com');
  });

  test('ok: name-addr form', () => {
    const r = parseFromHeader('Display Name <user@example.com>');
    expect(r.parseStatus).toBe('ok');
    expect(r.fromDomain).toBe('example.com');
    expect(r.mailboxAddress).toBe('user@example.com');
  });

  test('ok: quoted display name with angle-bracket address', () => {
    const r = parseFromHeader('"Test User" <sender@mail.example.co.jp>');
    expect(r.parseStatus).toBe('ok');
    expect(r.fromDomain).toBe('mail.example.co.jp');
  });

  test('missing: null input returns status missing', () => {
    const r = parseFromHeader(null);
    expect(r.parseStatus).toBe('missing');
    expect(r.rawFrom).toBeNull();
    expect(r.mailboxAddress).toBeNull();
    expect(r.fromDomain).toBeNull();
  });

  test('missing: undefined input returns status missing', () => {
    const r = parseFromHeader(undefined);
    expect(r.parseStatus).toBe('missing');
  });

  test('missing: empty string returns status missing', () => {
    const r = parseFromHeader('');
    expect(r.parseStatus).toBe('missing');
  });

  test('invalid: header value with no parseable address', () => {
    const r = parseFromHeader('not an email at all');
    expect(r.parseStatus).toBe('invalid');
    expect(r.rawFrom).toBe('not an email at all');
    expect(r.mailboxAddress).toBeNull();
    expect(r.fromDomain).toBeNull();
  });

  test('invalid: angle-bracket form without @', () => {
    const r = parseFromHeader('<nodomain>');
    expect(r.parseStatus).toBe('invalid');
    expect(r.fromDomain).toBeNull();
  });

  test('ok: spoofed display name resolves to real angle-bracket address', () => {
    const r = parseFromHeader('"trusted@example.com" <attacker@evil.test>');
    expect(r.parseStatus).toBe('ok');
    expect(r.fromDomain).toBe('evil.test');
    expect(r.mailboxAddress).toBe('attacker@evil.test');
  });

  test('ok: address is lowercased', () => {
    const r = parseFromHeader('User@Example.COM');
    expect(r.parseStatus).toBe('ok');
    expect(r.fromDomain).toBe('example.com');
    expect(r.mailboxAddress).toBe('user@example.com');
  });

  test('rawFrom preserves original case and display name', () => {
    const raw = 'Display Name <USER@EXAMPLE.COM>';
    const r = parseFromHeader(raw);
    expect(r.rawFrom).toBe(raw);
    expect(r.mailboxAddress).toBe('user@example.com');
  });
});
