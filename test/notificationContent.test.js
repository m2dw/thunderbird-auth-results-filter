import { buildNotificationContent } from '../src/modules/notificationContent.js';

// ── title: single message ─────────────────────────────────────────────────────

describe('buildNotificationContent — title, single message', () => {
  test('folder name only', () => {
    const { title } = buildNotificationContent({ folderName: 'Inbox' });
    expect(title).toBe('Inbox: 1 new message');
  });

  test('account name only (no email, no folder)', () => {
    const { title } = buildNotificationContent({ accountName: 'Work' });
    expect(title).toBe('Work: 1 new message');
  });

  test('account name preferred over folder when no email', () => {
    const { title } = buildNotificationContent({ folderName: 'Inbox', accountName: 'Work' });
    expect(title).toBe('Work: 1 new message');
  });

  test('falls back to folder when accountName is null', () => {
    const { title } = buildNotificationContent({ accountName: null, folderName: 'Inbox' });
    expect(title).toBe('Inbox: 1 new message');
  });

  test('falls back to Inbox when folderName is null and no accountName', () => {
    const { title } = buildNotificationContent({ accountName: null, folderName: null });
    expect(title).toBe('Inbox: 1 new message');
  });

  test('falls back to Inbox when both folderName and accountName are null', () => {
    const { title } = buildNotificationContent({});
    expect(title).toBe('Inbox: 1 new message');
  });

  test('no arguments', () => {
    const { title } = buildNotificationContent();
    expect(title).toBe('Inbox: 1 new message');
  });

  test('custom folder name', () => {
    const { title } = buildNotificationContent({ folderName: 'Newsletter' });
    expect(title).toBe('Newsletter: 1 new message');
  });

  test('accountEmail preferred over accountName', () => {
    const { title } = buildNotificationContent({ accountEmail: 'user@example.com', accountName: 'Work' });
    expect(title).toBe('user@example.com: 1 new message');
  });

  test('accountEmail preferred over folderName', () => {
    const { title } = buildNotificationContent({ accountEmail: 'user@example.com', folderName: 'Inbox' });
    expect(title).toBe('user@example.com: 1 new message');
  });

  test('whitespace-only accountEmail falls back to accountName', () => {
    const { title } = buildNotificationContent({ accountEmail: '  ', accountName: 'Work' });
    expect(title).toBe('Work: 1 new message');
  });

  test('accountEmail null falls back to accountName', () => {
    const { title } = buildNotificationContent({ accountEmail: null, accountName: 'Personal' });
    expect(title).toBe('Personal: 1 new message');
  });
});

// ── title: multiple messages ──────────────────────────────────────────────────

describe('buildNotificationContent — title, multiple messages', () => {
  test('count 2 uses New Messages title', () => {
    const { title } = buildNotificationContent({ folderName: 'Inbox', count: 2 });
    expect(title).toBe('New Messages');
  });

  test('count 3 with account name uses New Messages title', () => {
    const { title } = buildNotificationContent({ folderName: 'Inbox', accountName: 'Work', count: 3 });
    expect(title).toBe('New Messages');
  });

  test('count 3 with accountEmail uses New Messages title', () => {
    const { title } = buildNotificationContent({ accountEmail: 'user@example.com', count: 3 });
    expect(title).toBe('New Messages');
  });

  test('count 0 is not a normal use case but handled gracefully', () => {
    const { title } = buildNotificationContent({ folderName: 'Inbox', count: 0 });
    // count 0 is treated as multi path (count !== 1)
    expect(title).toBe('New Messages');
  });
});

// ── body: single message ──────────────────────────────────────────────────────

describe('buildNotificationContent — body, single message', () => {
  test('rawFrom, subject, snippet all present', () => {
    const { message } = buildNotificationContent({
      rawFrom: '"Alice" <alice@example.com>',
      subject: 'Hello',
      snippet: 'Body preview...',
    });
    expect(message).toBe('"Alice" <alice@example.com>\nHello\nBody preview...');
  });

  test('rawFrom absent — body starts with subject', () => {
    const { message } = buildNotificationContent({ subject: 'Hello', snippet: 'Preview' });
    expect(message).toBe('Hello\nPreview');
  });

  test('rawFrom null — body starts with subject', () => {
    const { message } = buildNotificationContent({ rawFrom: null, subject: 'Hello' });
    expect(message).toBe('Hello');
  });

  test('subject null falls back to (no subject)', () => {
    const { message } = buildNotificationContent({ rawFrom: 'a@b.com', subject: null });
    expect(message).toBe('a@b.com\n(no subject)');
  });

  test('snippet null — body ends with subject', () => {
    const { message } = buildNotificationContent({ subject: 'Hello', snippet: null });
    expect(message).toBe('Hello');
  });

  test('snippet whitespace-only is omitted', () => {
    const { message } = buildNotificationContent({ subject: 'Hello', snippet: '   ' });
    expect(message).toBe('Hello');
  });

  test('no arguments — (no subject) only', () => {
    const { message } = buildNotificationContent();
    expect(message).toBe('(no subject)');
  });

  test('rawFrom whitespace-only is omitted', () => {
    const { message } = buildNotificationContent({ rawFrom: '  ', subject: 'Hello' });
    expect(message).toBe('Hello');
  });

  test('subject whitespace-only falls back to (no subject)', () => {
    const { message } = buildNotificationContent({ subject: '  ' });
    expect(message).toBe('(no subject)');
  });
});

// ── body: multiple messages ───────────────────────────────────────────────────

describe('buildNotificationContent — body, multiple messages (coalesced)', () => {
  test('count 2: body starts with summary then representative message', () => {
    const { message } = buildNotificationContent({
      rawFrom: '"Alice" <alice@example.com>',
      subject: 'Hello',
      snippet: 'Preview',
      count: 2,
    });
    expect(message).toBe('There are 2 new messages.\n"Alice" <alice@example.com>\nHello\n+1 more messages');
  });

  test('count 3: body starts with summary then representative message', () => {
    const { message } = buildNotificationContent({
      rawFrom: '"Alice" <alice@example.com>',
      subject: 'Hello',
      snippet: 'Preview',
      count: 3,
    });
    expect(message).toBe('There are 3 new messages.\n"Alice" <alice@example.com>\nHello\n+2 more messages');
  });

  test('count 2 without snippet: still shows summary and +1 more messages', () => {
    const { message } = buildNotificationContent({ subject: 'Hello', count: 2 });
    expect(message).toBe('There are 2 new messages.\nHello\n+1 more messages');
  });

  test('count 2 without rawFrom', () => {
    const { message } = buildNotificationContent({ subject: 'Hello', snippet: 'Preview', count: 2 });
    expect(message).toBe('There are 2 new messages.\nHello\n+1 more messages');
  });
});

// ── full object shape ─────────────────────────────────────────────────────────

describe('buildNotificationContent — return shape', () => {
  test('returns { title, message } object', () => {
    const result = buildNotificationContent({ folderName: 'Inbox' });
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('message');
    expect(Object.keys(result)).toHaveLength(2);
  });

  test('title and message are strings', () => {
    const { title, message } = buildNotificationContent();
    expect(typeof title).toBe('string');
    expect(typeof message).toBe('string');
  });
});
