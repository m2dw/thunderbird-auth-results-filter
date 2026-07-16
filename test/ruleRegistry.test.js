import { getRuleMeta, titleForKey, summaryForKey, tooltipForKey, REGISTRY } from '../src/core/ruleRegistry.js';

describe('REGISTRY integrity', () => {
  test('every entry has required fields', () => {
    for (const entry of REGISTRY) {
      expect(typeof entry.key).toBe('string');
      expect(entry.key.length).toBeGreaterThan(0);
      expect(typeof entry.title).toBe('string');
      expect(entry.title.length).toBeGreaterThan(0);
      expect(typeof entry.summary).toBe('string');
      expect(entry.summary.length).toBeGreaterThan(0);
      expect(['risk', 'mitigation', 'diagnostic']).toContain(entry.type);
    }
  });

  test('no duplicate keys', () => {
    const keys = REGISTRY.map(e => e.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  test('all keys follow a known namespace prefix', () => {
    const validPrefixes = ['authserv.', 'sender.', 'whitelist.', 'identity.', 'heuristic.', 'composite.'];
    for (const entry of REGISTRY) {
      const ok = validPrefixes.some(p => entry.key.startsWith(p));
      expect(ok).toBe(true);
    }
  });
});

describe('getRuleMeta', () => {
  test('returns entry for a known key', () => {
    const meta = getRuleMeta('authserv.untrusted');
    expect(meta).not.toBeNull();
    expect(meta.key).toBe('authserv.untrusted');
    expect(meta.title).toBe('Untrusted authserv-id');
    expect(meta.type).toBe('diagnostic');
  });

  test('returns entry for composite key', () => {
    const meta = getRuleMeta('composite.ownDomainAuthFail');
    expect(meta).not.toBeNull();
    expect(meta.title).toBe('Own account domain with failed authentication');
    expect(meta.type).toBe('risk');
  });

  test('synthesizes entry for auth.method.result key', () => {
    const meta = getRuleMeta('auth.dmarc.fail');
    expect(meta).not.toBeNull();
    expect(meta.key).toBe('auth.dmarc.fail');
    expect(meta.title).toBe('DMARC fail');
    expect(meta.type).toBe('risk');
    expect(typeof meta.summary).toBe('string');
  });

  test('synthesized auth pass entry has type diagnostic', () => {
    const meta = getRuleMeta('auth.spf.pass');
    expect(meta.type).toBe('diagnostic');
    expect(meta.title).toBe('SPF pass');
  });

  test('returns null for completely unknown key', () => {
    expect(getRuleMeta('unknown.xyz')).toBeNull();
  });

  test('returns null for null/undefined input', () => {
    expect(getRuleMeta(null)).toBeNull();
    expect(getRuleMeta(undefined)).toBeNull();
  });
});

describe('titleForKey', () => {
  test('returns title for known key', () => {
    expect(titleForKey('whitelist.manual')).toBe('Manual whitelist');
    expect(titleForKey('whitelist.addressBook')).toBe('Address book contact');
    expect(titleForKey('sender.rule')).toBe('Sender domain rule');
  });

  test('returns synthesized title for auth key', () => {
    expect(titleForKey('auth.dkim.temperror')).toBe('DKIM temperror');
    expect(titleForKey('auth.spf.softfail')).toBe('SPF softfail');
  });

  test('falls back to the key itself for unknown keys', () => {
    expect(titleForKey('unknown.key')).toBe('unknown.key');
  });

  test('matches labelForScoreKey output for all known keys', async () => {
    const { labelForScoreKey } = await import('../src/core/scoring.js');
    const testKeys = [
      'authserv.untrusted',
      'sender.rule',
      'whitelist.manual',
      'whitelist.addressBook',
      'identity.spfMailFromMismatch',
      'identity.dkimDomainMismatch',
      'identity.dmarcNoneWithThirdPartyAuth',
      'composite.messageIdUnregistrableMismatch',
      'composite.dkimFailWithAlignedPass',
      'auth.dmarc.fail',
      'auth.spf.softfail',
    ];
    for (const key of testKeys) {
      expect(titleForKey(key)).toBe(labelForScoreKey(key));
    }
  });
});

describe('summaryForKey', () => {
  test('returns summary string for known key', () => {
    const s = summaryForKey('identity.dkimDomainMismatch');
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThan(0);
  });

  test('returns non-null summary for auth key', () => {
    expect(summaryForKey('auth.dmarc.none')).not.toBeNull();
  });

  test('returns null for unknown key', () => {
    expect(summaryForKey('totally.unknown')).toBeNull();
  });

  test('all REGISTRY entries have a non-empty summary', () => {
    for (const entry of REGISTRY) {
      expect(entry.summary.length).toBeGreaterThan(0);
    }
  });
});

describe('tooltipForKey', () => {
  test('returns why field for a key with no caveat', () => {
    const tooltip = tooltipForKey('composite.authAlignedRandomDomain');
    expect(tooltip).toBe('Attacker owns a random-string domain and uses a real ESP to get aligned auth.');
  });

  test('appends caveat when present', () => {
    const tooltip = tooltipForKey('composite.fromSenderMismatchWithUnalignedAuth');
    expect(typeof tooltip).toBe('string');
    expect(tooltip).toContain('Mismatch between From and Sender');
    expect(tooltip).toContain('Note:');
    expect(tooltip).toContain('Mailing lists');
  });

  test('falls back to summary when why is absent', () => {
    // Synthesized auth key entries have no why field in REGISTRY itself,
    // but getRuleMeta generates one. Verify the function returns a string.
    const tooltip = tooltipForKey('auth.dmarc.fail');
    expect(typeof tooltip).toBe('string');
    expect(tooltip.length).toBeGreaterThan(0);
  });

  test('returns null for unknown key', () => {
    expect(tooltipForKey('totally.unknown')).toBeNull();
  });

  test('returns null for null/undefined', () => {
    expect(tooltipForKey(null)).toBeNull();
    expect(tooltipForKey(undefined)).toBeNull();
  });

  test('all composite REGISTRY entries produce a non-empty tooltip', () => {
    const composites = REGISTRY.filter(e => e.key.startsWith('composite.'));
    expect(composites.length).toBeGreaterThan(0);
    for (const entry of composites) {
      const tooltip = tooltipForKey(entry.key);
      expect(typeof tooltip).toBe('string');
      expect(tooltip.length).toBeGreaterThan(0);
    }
  });

  test('tooltip for caveat rule contains both why and caveat text', () => {
    const tooltip = tooltipForKey('composite.messageIdMismatchWithUnalignedAuth');
    expect(tooltip).toContain('Forged messages');
    expect(tooltip).toContain('Note:');
    expect(tooltip).toContain('Forwarded or aliased mail');
  });
});

describe('mitigation entries', () => {
  test('mitigation entries have negative defaultScore', () => {
    const mitigations = REGISTRY.filter(e => e.type === 'mitigation');
    expect(mitigations.length).toBeGreaterThan(0);
    for (const entry of mitigations) {
      if (entry.defaultScore !== undefined) {
        expect(entry.defaultScore).toBeLessThan(0);
      }
    }
  });
});
