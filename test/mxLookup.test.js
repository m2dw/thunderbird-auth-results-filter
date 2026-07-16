import { resolverToDoHUrl, parseMxAnswer, PERMITTED_RESOLVERS } from '../src/modules/mxLookup.js';
import { generateMxSuggestionsFromHosts } from '../src/modules/setupSuggestions.js';

describe('PERMITTED_RESOLVERS', () => {
  test('contains exactly the manifest-covered resolver values', () => {
    expect(PERMITTED_RESOLVERS.has('8.8.8.8')).toBe(true);
    expect(PERMITTED_RESOLVERS.has('8.8.4.4')).toBe(true);
    expect(PERMITTED_RESOLVERS.has('1.1.1.1')).toBe(true);
    expect(PERMITTED_RESOLVERS.has('1.0.0.1')).toBe(true);
    expect(PERMITTED_RESOLVERS.has('cloudflare-dns.com')).toBe(true);
    expect(PERMITTED_RESOLVERS.has('9.9.9.9')).toBe(false);
  });
});

describe('resolverToDoHUrl', () => {
  test('maps 8.8.8.8 to dns.google JSON endpoint', () => {
    expect(resolverToDoHUrl('8.8.8.8')).toBe('https://dns.google/resolve');
  });

  test('maps 8.8.4.4 to dns.google JSON endpoint', () => {
    expect(resolverToDoHUrl('8.8.4.4')).toBe('https://dns.google/resolve');
  });

  test('maps 1.1.1.1 to DoH URL', () => {
    expect(resolverToDoHUrl('1.1.1.1')).toBe('https://1.1.1.1/dns-query');
  });

  test('maps 1.0.0.1 to DoH URL', () => {
    expect(resolverToDoHUrl('1.0.0.1')).toBe('https://1.0.0.1/dns-query');
  });

  test('maps cloudflare-dns.com to DoH URL', () => {
    expect(resolverToDoHUrl('cloudflare-dns.com')).toBe('https://cloudflare-dns.com/dns-query');
  });

  test('returns null for resolver not in permitted set', () => {
    expect(resolverToDoHUrl('9.9.9.9')).toBeNull();
  });

  test('returns null for arbitrary hostname not in permitted set', () => {
    expect(resolverToDoHUrl('dns.example.com')).toBeNull();
  });

  test('trims whitespace from resolver', () => {
    expect(resolverToDoHUrl('  8.8.8.8  ')).toBe('https://dns.google/resolve');
  });

  test('returns null for empty string', () => {
    expect(resolverToDoHUrl('')).toBeNull();
  });

  test('returns null for whitespace-only string', () => {
    expect(resolverToDoHUrl('   ')).toBeNull();
  });

  test('returns null for null', () => {
    expect(resolverToDoHUrl(null)).toBeNull();
  });

  test('returns null for undefined', () => {
    expect(resolverToDoHUrl(undefined)).toBeNull();
  });

  test('returns null for non-string', () => {
    expect(resolverToDoHUrl(8888)).toBeNull();
  });
});

describe('parseMxAnswer', () => {
  test('parses a standard MX answer', () => {
    const answer = [{ type: 15, data: '10 mail.example.com.' }];
    expect(parseMxAnswer(answer)).toEqual([{ exchange: 'mail.example.com', priority: 10 }]);
  });

  test('strips trailing dot from exchange', () => {
    const answer = [{ type: 15, data: '20 mx.example.org.' }];
    expect(parseMxAnswer(answer)).toEqual([{ exchange: 'mx.example.org', priority: 20 }]);
  });

  test('lowercases exchange hostname', () => {
    const answer = [{ type: 15, data: '10 MAIL.EXAMPLE.COM.' }];
    expect(parseMxAnswer(answer)).toEqual([{ exchange: 'mail.example.com', priority: 10 }]);
  });

  test('ignores non-MX records', () => {
    const answer = [
      { type: 1, data: '93.184.216.34' },
      { type: 15, data: '10 mail.example.com.' },
    ];
    expect(parseMxAnswer(answer)).toEqual([{ exchange: 'mail.example.com', priority: 10 }]);
  });

  test('handles multiple MX records', () => {
    const answer = [
      { type: 15, data: '10 mx1.example.com.' },
      { type: 15, data: '20 mx2.example.com.' },
    ];
    const result = parseMxAnswer(answer);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.exchange)).toEqual(['mx1.example.com', 'mx2.example.com']);
  });

  test('returns empty array for null input', () => {
    expect(parseMxAnswer(null)).toEqual([]);
  });

  test('returns empty array for undefined input', () => {
    expect(parseMxAnswer(undefined)).toEqual([]);
  });

  test('returns empty array for empty array', () => {
    expect(parseMxAnswer([])).toEqual([]);
  });

  test('skips records with missing data', () => {
    const answer = [{ type: 15, data: undefined }];
    expect(parseMxAnswer(answer)).toEqual([]);
  });

  test('skips records with only priority and no exchange', () => {
    const answer = [{ type: 15, data: '10' }];
    expect(parseMxAnswer(answer)).toEqual([]);
  });

  test('falls back to priority 10 when priority is not a number', () => {
    const answer = [{ type: 15, data: 'bad mail.example.com.' }];
    const result = parseMxAnswer(answer);
    expect(result).toEqual([{ exchange: 'mail.example.com', priority: 10 }]);
  });
});

describe('generateMxSuggestionsFromHosts', () => {
  test('returns suggestion with source mx for each host', () => {
    const s = generateMxSuggestionsFromHosts(['mail.example.com'], 'example.com');
    expect(s).toEqual([{ host: 'mail.example.com', source: 'mx', domain: 'example.com' }]);
  });

  test('deduplicates identical hosts', () => {
    const s = generateMxSuggestionsFromHosts(['mail.example.com', 'mail.example.com'], 'example.com');
    expect(s).toHaveLength(1);
  });

  test('lowercases hosts', () => {
    const s = generateMxSuggestionsFromHosts(['MAIL.EXAMPLE.COM'], 'example.com');
    expect(s[0].host).toBe('mail.example.com');
  });

  test('lowercases domain', () => {
    const s = generateMxSuggestionsFromHosts(['mail.example.com'], 'EXAMPLE.COM');
    expect(s[0].domain).toBe('example.com');
  });

  test('handles multiple hosts', () => {
    const s = generateMxSuggestionsFromHosts(['mx1.example.com', 'mx2.example.com'], 'example.com');
    expect(s).toHaveLength(2);
    expect(s.map(e => e.host)).toEqual(['mx1.example.com', 'mx2.example.com']);
  });

  test('returns empty array for null hosts', () => {
    expect(generateMxSuggestionsFromHosts(null, 'example.com')).toEqual([]);
  });

  test('returns empty array for non-array hosts', () => {
    expect(generateMxSuggestionsFromHosts('mail.example.com', 'example.com')).toEqual([]);
  });

  test('returns empty array for empty hosts array', () => {
    expect(generateMxSuggestionsFromHosts([], 'example.com')).toEqual([]);
  });

  test('returns empty array for null domain', () => {
    expect(generateMxSuggestionsFromHosts(['mail.example.com'], null)).toEqual([]);
  });

  test('returns empty array for empty domain', () => {
    expect(generateMxSuggestionsFromHosts(['mail.example.com'], '')).toEqual([]);
  });

  test('skips non-string entries in hosts', () => {
    const s = generateMxSuggestionsFromHosts([null, 42, 'mail.example.com'], 'example.com');
    expect(s).toHaveLength(1);
    expect(s[0].host).toBe('mail.example.com');
  });

  test('each suggestion has host, source, and domain fields', () => {
    const s = generateMxSuggestionsFromHosts(['mx.example.com'], 'example.com');
    expect(typeof s[0].host).toBe('string');
    expect(s[0].source).toBe('mx');
    expect(typeof s[0].domain).toBe('string');
  });
});
