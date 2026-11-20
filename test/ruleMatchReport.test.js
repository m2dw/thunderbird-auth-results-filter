import { ruleLayerForKey, compareRuleKeys, aggregateRuleMatches } from '../src/core/ruleMatchReport.js';

describe('ruleLayerForKey', () => {
  test.each([
    ['auth.dmarc.fail', 'L1'],
    ['authserv.untrusted', 'L1'],
    ['identity.dkimDomainMismatch', 'L2'],
    ['heuristic.randomFromLocalPart', 'L3'],
    ['composite.ownDomainAuthFail', 'L4'],
    ['composite.publicDomainSpoofing', 'L4'],
    ['whitelist.manual', 'L5'],
    ['whitelist.addressBook', 'L5'],
    ['sender.rule', 'L5'],
    ['custom.formula.f1', 'L5'],
    ['something.unknown', null],
  ])('%s → %s', (key, layer) => {
    expect(ruleLayerForKey(key)).toBe(layer);
  });
});

describe('compareRuleKeys', () => {
  test('orders by layer, then auth method/result, then registry, then unknown', () => {
    const keys = [
      'something.unknown',
      'custom.formula.b',
      'sender.rule',
      'whitelist.manual',
      'composite.ownDomainAuthFail',
      'heuristic.randomFromDomainLabel',
      'identity.spfMailFromMismatch',
      'authserv.untrusted',
      'auth.dkim.fail',
      'auth.spf.fail',
      'auth.dmarc.none',
      'auth.dmarc.fail',
      'custom.formula.a',
    ];
    expect([...keys].sort(compareRuleKeys)).toEqual([
      'auth.dmarc.fail',
      'auth.dmarc.none',
      'auth.spf.fail',
      'auth.dkim.fail',
      'authserv.untrusted',
      'identity.spfMailFromMismatch',
      'heuristic.randomFromDomainLabel',
      'composite.ownDomainAuthFail',
      'sender.rule',
      'whitelist.manual',
      'custom.formula.a',
      'custom.formula.b',
      'something.unknown',
    ]);
  });
});

describe('aggregateRuleMatches', () => {
  test('counts duplicate reasons on one message once and each message individually', () => {
    const rules = aggregateRuleMatches([
      {
        messageId: 1, score: 0, classification: 'normal',
        scoreReasons: [
          { key: 'authserv.untrusted', delta: 0, authservId: 'a.test' },
          { key: 'authserv.untrusted', delta: 0, authservId: 'b.test' },
        ],
      },
      {
        messageId: 2, score: 0, classification: 'normal',
        scoreReasons: [{ key: 'authserv.untrusted', delta: 0 }],
      },
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      key: 'authserv.untrusted',
      layer: 'L1',
      type: 'diagnostic',
      diagnostic: true,
      matchCount: 2,
      zeroDeltaMatchCount: 2,
    });
    expect(rules[0].messages).toEqual([
      { messageId: 1, delta: 0, occurrences: 2, score: 0, classification: 'normal' },
      { messageId: 2, delta: 0, occurrences: 1, score: 0, classification: 'normal' },
    ]);
  });

  test('includes zero-delta matches, sums deltas, and returns canonical order', () => {
    const rules = aggregateRuleMatches([
      {
        messageId: 7, score: 65, classification: 'review',
        scoreReasons: [
          { key: 'whitelist.manual', delta: -50 },
          { key: 'composite.ownDomainAuthFail', delta: 0 },
          { key: 'auth.spf.fail', delta: 50 },
          { key: 'auth.dmarc.fail', delta: 15 },
        ],
      },
      {
        messageId: 8, score: 50, classification: 'review',
        scoreReasons: [{ key: 'auth.spf.fail', delta: 50 }],
      },
    ]);
    expect(rules.map(r => r.key)).toEqual([
      'auth.dmarc.fail', 'auth.spf.fail', 'composite.ownDomainAuthFail', 'whitelist.manual',
    ]);
    const spf = rules.find(r => r.key === 'auth.spf.fail');
    expect(spf).toMatchObject({ matchCount: 2, totalDelta: 100, zeroDeltaMatchCount: 0, type: 'risk', diagnostic: false });
    expect(spf.messages.map(m => m.messageId)).toEqual([7, 8]);
    const composite = rules.find(r => r.key === 'composite.ownDomainAuthFail');
    expect(composite).toMatchObject({ matchCount: 1, zeroDeltaMatchCount: 1, layer: 'L4' });
    expect(rules.find(r => r.key === 'whitelist.manual').type).toBe('mitigation');
  });

  test('derives the diagnostic flag from actual scoring, not registry type alone', () => {
    const rules = aggregateRuleMatches([
      { messageId: 1, score: 10, classification: 'normal', scoreReasons: [{ key: 'auth.spf.pass', delta: 10 }] },
      { messageId: 2, score: -5, classification: 'normal', scoreReasons: [{ key: 'auth.dkim.pass', delta: -5 }] },
      { messageId: 3, score: 0, classification: 'normal', scoreReasons: [{ key: 'auth.dmarc.pass', delta: 0 }] },
    ]);
    expect(rules.find(r => r.key === 'auth.spf.pass')).toMatchObject({ diagnostic: false, type: 'risk' });
    expect(rules.find(r => r.key === 'auth.dkim.pass')).toMatchObject({ diagnostic: false, type: 'mitigation' });
    expect(rules.find(r => r.key === 'auth.dmarc.pass')).toMatchObject({ diagnostic: true, type: 'diagnostic' });
  });

  test('returns an empty list for no messages', () => {
    expect(aggregateRuleMatches([])).toEqual([]);
  });
});
