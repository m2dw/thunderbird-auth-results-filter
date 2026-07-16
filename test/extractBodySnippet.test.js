import { extractBodySnippet } from '../src/modules/bodySnippet.js';

// ─── extractBodySnippet ───────────────────────────────────────────────────────

describe('extractBodySnippet', () => {
  // ── Null / empty input ──

  test('returns null for undefined parts', () => {
    expect(extractBodySnippet(undefined)).toBeNull();
  });

  test('returns null for null parts', () => {
    expect(extractBodySnippet(null)).toBeNull();
  });

  test('returns null for empty parts array', () => {
    expect(extractBodySnippet([])).toBeNull();
  });

  // ── Simple flat text/plain ──

  test('returns body from a flat text/plain part', () => {
    const parts = [{ contentType: 'text/plain', body: 'Hello, world!' }];
    expect(extractBodySnippet(parts)).toBe('Hello, world!');
  });

  test('normalises internal whitespace', () => {
    const parts = [{ contentType: 'text/plain', body: '  Hello   \n  world  ' }];
    expect(extractBodySnippet(parts)).toBe('Hello world');
  });

  test('trims leading and trailing whitespace', () => {
    const parts = [{ contentType: 'text/plain', body: '\n\n  Meeting agenda  \n\n' }];
    expect(extractBodySnippet(parts)).toBe('Meeting agenda');
  });

  // ── Content-Type case-insensitivity (P2) ──

  test('matches Text/Plain (mixed case)', () => {
    const parts = [{ contentType: 'Text/Plain', body: 'Mixed case type' }];
    expect(extractBodySnippet(parts)).toBe('Mixed case type');
  });

  test('matches TEXT/PLAIN (uppercase)', () => {
    const parts = [{ contentType: 'TEXT/PLAIN', body: 'Uppercase type' }];
    expect(extractBodySnippet(parts)).toBe('Uppercase type');
  });

  test('matches text/plain with charset parameter (lowercase)', () => {
    const parts = [{ contentType: 'text/plain; charset=utf-8', body: 'With charset' }];
    expect(extractBodySnippet(parts)).toBe('With charset');
  });

  test('matches TEXT/PLAIN; CHARSET=UTF-8 (fully uppercase with param)', () => {
    const parts = [{ contentType: 'TEXT/PLAIN; CHARSET=UTF-8', body: 'Upper with param' }];
    expect(extractBodySnippet(parts)).toBe('Upper with param');
  });

  // ── Truncation ──

  test('truncates to maxLength with ellipsis when body exceeds limit', () => {
    const long = 'a'.repeat(200);
    const result = extractBodySnippet([{ contentType: 'text/plain', body: long }]);
    expect(result).toHaveLength(161); // 160 chars + ellipsis character
    expect(result.endsWith('…')).toBe(true);
  });

  test('does not truncate when body equals maxLength exactly', () => {
    const exact = 'b'.repeat(160);
    const result = extractBodySnippet([{ contentType: 'text/plain', body: exact }]);
    expect(result).toBe(exact);
  });

  test('custom maxLength is respected', () => {
    const long = 'c'.repeat(50);
    const result = extractBodySnippet([{ contentType: 'text/plain', body: long }], 20);
    expect(result).toHaveLength(21); // 20 + ellipsis
  });

  // ── text/html is skipped ──

  test('skips text/html parts', () => {
    const parts = [{ contentType: 'text/html', body: '<p>Hello</p>' }];
    expect(extractBodySnippet(parts)).toBeNull();
  });

  test('skips text/html and finds text/plain in sibling part', () => {
    const parts = [
      { contentType: 'text/html',  body: '<p>Hello</p>' },
      { contentType: 'text/plain', body: 'Plain hello' },
    ];
    expect(extractBodySnippet(parts)).toBe('Plain hello');
  });

  // ── Recursive multipart ──

  test('finds text/plain inside multipart/alternative', () => {
    const parts = [
      {
        contentType: 'multipart/alternative',
        parts: [
          { contentType: 'text/plain', body: 'Plain version' },
          { contentType: 'text/html',  body: '<p>HTML version</p>' },
        ],
      },
    ];
    expect(extractBodySnippet(parts)).toBe('Plain version');
  });

  test('finds text/plain inside multipart/mixed with attachment', () => {
    const parts = [
      {
        contentType: 'multipart/mixed',
        parts: [
          {
            contentType: 'multipart/alternative',
            parts: [
              { contentType: 'text/plain', body: 'Meeting at 3pm' },
              { contentType: 'text/html',  body: '<p>Meeting at 3pm</p>' },
            ],
          },
          { contentType: 'application/pdf', body: '' },
        ],
      },
    ];
    expect(extractBodySnippet(parts)).toBe('Meeting at 3pm');
  });

  test('returns null when only non-text parts exist', () => {
    const parts = [{ contentType: 'application/pdf' }];
    expect(extractBodySnippet(parts)).toBeNull();
  });

  // ── Empty / whitespace-only body ──

  test('returns null for text/plain with empty body string', () => {
    const parts = [{ contentType: 'text/plain', body: '' }];
    expect(extractBodySnippet(parts)).toBeNull();
  });

  test('returns null for text/plain with whitespace-only body', () => {
    const parts = [{ contentType: 'text/plain', body: '   \n   \t   ' }];
    expect(extractBodySnippet(parts)).toBeNull();
  });

  test('skips whitespace-only text/plain and falls through to sibling', () => {
    const parts = [
      { contentType: 'text/plain', body: '   ' },
      { contentType: 'text/plain', body: 'Second part' },
    ];
    expect(extractBodySnippet(parts)).toBe('Second part');
  });

  // ── Robustness ──

  test('handles null part in array without throwing', () => {
    const parts = [null, { contentType: 'text/plain', body: 'Safe' }];
    expect(extractBodySnippet(parts)).toBe('Safe');
  });

  test('handles part with no contentType without throwing', () => {
    const parts = [
      { body: 'No content type' },
      { contentType: 'text/plain', body: 'With type' },
    ];
    expect(extractBodySnippet(parts)).toBe('With type');
  });

  test('handles part with no body property without throwing', () => {
    const parts = [
      { contentType: 'text/plain' },
      { contentType: 'text/plain', body: 'Has body' },
    ];
    expect(extractBodySnippet(parts)).toBe('Has body');
  });
});
