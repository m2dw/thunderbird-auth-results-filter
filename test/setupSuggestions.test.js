import {
  extractEmailDomain,
  generateHeuristicSuggestions,
  generateSuggestionsFromEmails,
} from '../src/modules/setupSuggestions.js';

describe('extractEmailDomain', () => {
  test('returns domain for simple address', () => {
    expect(extractEmailDomain('user@example.com')).toBe('example.com');
  });

  test('normalises domain to lowercase', () => {
    expect(extractEmailDomain('user@Example.COM')).toBe('example.com');
  });

  test('handles subdomain address', () => {
    expect(extractEmailDomain('user@mail.example.co.jp')).toBe('mail.example.co.jp');
  });

  test('returns null for string without @', () => {
    expect(extractEmailDomain('notanemail')).toBeNull();
  });

  test('returns null for null input', () => {
    expect(extractEmailDomain(null)).toBeNull();
  });

  test('returns null for number input', () => {
    expect(extractEmailDomain(42)).toBeNull();
  });

  test('returns null for empty domain part', () => {
    expect(extractEmailDomain('user@')).toBeNull();
  });

  test('uses last @ for address with multiple @ signs', () => {
    expect(extractEmailDomain('a@b@example.com')).toBe('example.com');
  });

  test('trims whitespace from domain', () => {
    expect(extractEmailDomain('user@ example.com ')).toBe('example.com');
  });
});

describe('generateHeuristicSuggestions', () => {
  test('generates six entries for a single domain', () => {
    const s = generateHeuristicSuggestions('example.com');
    expect(s).toHaveLength(6);
  });

  test('first entry is the bare domain', () => {
    const s = generateHeuristicSuggestions('example.com');
    expect(s[0].host).toBe('example.com');
  });

  test('includes all expected heuristic prefixes', () => {
    const hosts = generateHeuristicSuggestions('example.com').map(s => s.host);
    expect(hosts).toEqual([
      'example.com',
      'mail.example.com',
      'mx.example.com',
      'imap.example.com',
      'pop.example.com',
      'smtp.example.com',
    ]);
  });

  test('source is heuristic for all entries', () => {
    const s = generateHeuristicSuggestions('example.com');
    expect(s.every(e => e.source === 'heuristic')).toBe(true);
  });

  test('domain field matches input domain on each entry', () => {
    const s = generateHeuristicSuggestions('example.com');
    expect(s.every(e => e.domain === 'example.com')).toBe(true);
  });

  test('returns empty array for empty string', () => {
    expect(generateHeuristicSuggestions('')).toEqual([]);
  });

  test('returns empty array for null', () => {
    expect(generateHeuristicSuggestions(null)).toEqual([]);
  });

  test('returns empty array for undefined', () => {
    expect(generateHeuristicSuggestions(undefined)).toEqual([]);
  });

  test('normalises domain to lowercase', () => {
    const s = generateHeuristicSuggestions('EXAMPLE.COM');
    expect(s[0].host).toBe('example.com');
    expect(s[1].host).toBe('mail.example.com');
  });

  test('works with multi-label TLD domain', () => {
    const hosts = generateHeuristicSuggestions('example.co.jp').map(s => s.host);
    expect(hosts).toContain('example.co.jp');
    expect(hosts).toContain('mx.example.co.jp');
  });
});

describe('generateSuggestionsFromEmails', () => {
  test('returns empty array for null input', () => {
    expect(generateSuggestionsFromEmails(null)).toEqual([]);
  });

  test('returns empty array for string input', () => {
    expect(generateSuggestionsFromEmails('user@example.com')).toEqual([]);
  });

  test('returns empty array for empty array', () => {
    expect(generateSuggestionsFromEmails([])).toEqual([]);
  });

  test('generates six suggestions from one email', () => {
    const s = generateSuggestionsFromEmails(['user@example.com']);
    expect(s).toHaveLength(6);
  });

  test('bare domain is first suggestion', () => {
    const s = generateSuggestionsFromEmails(['user@example.com']);
    expect(s[0].host).toBe('example.com');
  });

  test('includes mail. prefix suggestion', () => {
    const s = generateSuggestionsFromEmails(['user@example.com']);
    expect(s.map(e => e.host)).toContain('mail.example.com');
  });

  test('deduplicates same domain from multiple emails', () => {
    const s = generateSuggestionsFromEmails([
      'alice@example.com',
      'bob@example.com',
    ]);
    expect(s).toHaveLength(6);
  });

  test('generates entries for multiple distinct domains', () => {
    const s = generateSuggestionsFromEmails([
      'alice@example.com',
      'bob@other.org',
    ]);
    expect(s).toHaveLength(12);
    const hosts = s.map(e => e.host);
    expect(hosts).toContain('example.com');
    expect(hosts).toContain('mail.other.org');
  });

  test('produces no duplicate hosts', () => {
    const s = generateSuggestionsFromEmails([
      'alice@example.com',
      'bob@other.org',
      'carol@example.com',
    ]);
    const hosts = s.map(e => e.host);
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  test('skips malformed email entries gracefully', () => {
    const s = generateSuggestionsFromEmails(['notanemail', 'user@example.com', null, 42]);
    const hosts = s.map(e => e.host);
    expect(hosts).toContain('example.com');
    expect(s).toHaveLength(6);
  });

  test('each suggestion has host, source, and domain fields', () => {
    const s = generateSuggestionsFromEmails(['user@example.com']);
    for (const item of s) {
      expect(typeof item.host).toBe('string');
      expect(typeof item.source).toBe('string');
      expect(typeof item.domain).toBe('string');
    }
  });

  test('domain field on each suggestion reflects account domain', () => {
    const s = generateSuggestionsFromEmails(['user@example.com']);
    expect(s.every(e => e.domain === 'example.com')).toBe(true);
  });
});
