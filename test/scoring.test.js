import {
  scoreMessage,
  classifyScore,
  recalculateLogEntry,
  recalculateScoreReasons,
  sumCurrentDeltas,
  authResultKey,
  labelForScoreKey,
  DEFAULT_AUTH_SCORES,
  DEFAULT_LAYER2_SCORES,
  DEFAULT_COMPOSITE_SCORES,
} from '../src/core/scoring.js';

describe('classifyScore', () => {
  test('0 → normal',   () => expect(classifyScore(0)).toBe('normal'));
  test('49 → normal',  () => expect(classifyScore(49)).toBe('normal'));
  test('50 → review',  () => expect(classifyScore(50)).toBe('review'));
  test('99 → review',  () => expect(classifyScore(99)).toBe('review'));
  test('100 → high-risk', () => expect(classifyScore(100)).toBe('high-risk'));
  test('200 → high-risk', () => expect(classifyScore(200)).toBe('high-risk'));
  test('negative → normal', () => expect(classifyScore(-10)).toBe('normal'));
});

describe('authResultKey', () => {
  test('produces stable dotted key', () => {
    expect(authResultKey('dmarc', 'fail')).toBe('auth.dmarc.fail');
    expect(authResultKey('spf', 'pass')).toBe('auth.spf.pass');
    expect(authResultKey('dkim', 'temperror')).toBe('auth.dkim.temperror');
  });
});

describe('labelForScoreKey', () => {
  test('authserv.untrusted → human label', () =>
    expect(labelForScoreKey('authserv.untrusted')).toBe('Untrusted authserv-id'));
  test('sender.rule → human label', () =>
    expect(labelForScoreKey('sender.rule')).toBe('Sender domain rule'));
  test('auth.dmarc.fail → DMARC fail', () =>
    expect(labelForScoreKey('auth.dmarc.fail')).toBe('DMARC fail'));
  test('auth.spf.softfail → SPF softfail', () =>
    expect(labelForScoreKey('auth.spf.softfail')).toBe('SPF softfail'));
  test('unknown key → returns key unchanged', () =>
    expect(labelForScoreKey('unknown.key')).toBe('unknown.key'));
  test('composite.messageIdUnregistrableMismatch → human label', () =>
    expect(labelForScoreKey('composite.messageIdUnregistrableMismatch')).toBe(
      'Message-ID domain is unregistrable or mismatches From',
    ));
});

describe('DEFAULT_AUTH_SCORES — pass results default to zero', () => {
  test('DMARC pass = 0', () => expect(DEFAULT_AUTH_SCORES.dmarc.pass).toBe(0));
  test('SPF pass = 0',   () => expect(DEFAULT_AUTH_SCORES.spf.pass).toBe(0));
  test('DKIM pass = 0',  () => expect(DEFAULT_AUTH_SCORES.dkim.pass).toBe(0));
});

describe('DEFAULT_AUTH_SCORES — rebalanced none/fail defaults (issue #220)', () => {
  test('DMARC none = 35', () => expect(DEFAULT_AUTH_SCORES.dmarc.none).toBe(35));
  test('SPF none = 15',   () => expect(DEFAULT_AUTH_SCORES.spf.none).toBe(15));
  test('DKIM fail = 15 (unchanged)', () => expect(DEFAULT_AUTH_SCORES.dkim.fail).toBe(15));
});

describe('DEFAULT_COMPOSITE_SCORES — rebalanced defaults (issue #220)', () => {
  test('messageIdMismatchWithUnalignedAuth = 30', () =>
    expect(DEFAULT_COMPOSITE_SCORES.messageIdMismatchWithUnalignedAuth).toBe(30));
});

const base = {
  trustedDomains: [{ value: 'example.com', matchType: 'domain' }],
  senderDomain: 'example.com',
  senderDomainRules: [],
  authScores: DEFAULT_AUTH_SCORES,
};

describe('scoreMessage — Authentication-Results', () => {
  test('no AR headers → score 0, normal', () => {
    const r = scoreMessage({ ...base, parsedAuthResults: [] });
    expect(r.score).toBe(0);
    expect(r.classification).toBe('normal');
    expect(r.scoreReasons).toEqual([]);
  });

  test('one untrusted AR → score 0, normal (untrusted AR not scored)', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [{ authservId: 'evil.attacker.com', results: [] }],
    });
    expect(r.score).toBe(0);
    expect(r.classification).toBe('normal');
  });

  test('two untrusted ARs → score 0, normal (untrusted AR not scored)', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [
        { authservId: 'evil1.com', results: [] },
        { authservId: 'evil2.com', results: [] },
      ],
    });
    expect(r.score).toBe(0);
    expect(r.classification).toBe('normal');
  });

  test('untrusted AR with dmarc=pass: not scored and pass results are not used', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [{ authservId: 'evil.com', results: [{ method: 'dmarc', result: 'pass' }] }],
    });
    expect(r.score).toBe(0);
  });

  test('trusted AR with dmarc=pass → no safety credit (score 0)', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [{ authservId: 'mail.example.com', results: [{ method: 'dmarc', result: 'pass' }] }],
    });
    expect(r.score).toBe(0); // pass = 0 by default
    expect(r.classification).toBe('normal');
  });

  test('trusted AR with dmarc=fail alone → normal (15 is below review threshold)', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [{ authservId: 'mail.example.com', results: [{ method: 'dmarc', result: 'fail' }] }],
    });
    expect(r.score).toBe(DEFAULT_AUTH_SCORES.dmarc.fail); // 15
    expect(r.classification).toBe('normal'); // 15 < 50 threshold; intended: DMARC fail alone is not review-level
  });

  test('trusted AR with spf=pass + dkim=pass → no safety credit (score 0)', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [{
        authservId: 'mail.example.com',
        results: [
          { method: 'spf', result: 'pass' },
          { method: 'dkim', result: 'pass' },
        ],
      }],
    });
    expect(r.score).toBe(0); // spf.pass=0 + dkim.pass=0
  });

  test('trusted subdomain authservId is treated as trusted', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [{ authservId: 'mx1.mail.example.com', results: [{ method: 'dmarc', result: 'pass' }] }],
    });
    expect(r.score).toBe(DEFAULT_AUTH_SCORES.dmarc.pass); // 0
  });

  test('spf=fail + dmarc=fail from trusted AR → score 65, review', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [{
        authservId: 'mail.example.com',
        results: [
          { method: 'spf',   result: 'fail' },
          { method: 'dmarc', result: 'fail' },
        ],
      }],
    });
    expect(r.score).toBe(65); // spf.fail=50 + dmarc.fail=15
    expect(r.classification).toBe('review');
  });

  test('scoreReasons includes untrusted authserv-id entry with delta 0 (diagnostic only)', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [{ authservId: 'evil.com', results: [] }],
    });
    expect(r.scoreReasons).toContainEqual(
      expect.objectContaining({ key: 'authserv.untrusted', authservId: 'evil.com', delta: 0 }),
    );
  });

  test('scoreReasons includes auth-result entry for trusted AR', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [{ authservId: 'mail.example.com', results: [{ method: 'dmarc', result: 'fail' }] }],
    });
    expect(r.scoreReasons).toContainEqual(
      expect.objectContaining({ key: 'auth.dmarc.fail', method: 'dmarc', result: 'fail' }),
    );
  });

  test('scoreReasons records dmarc=pass with delta 0 (enables future recalculation)', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [{ authservId: 'mail.example.com', results: [{ method: 'dmarc', result: 'pass' }] }],
    });
    expect(r.scoreReasons).toContainEqual(
      expect.objectContaining({ key: 'auth.dmarc.pass', delta: 0, method: 'dmarc', result: 'pass' }),
    );
    expect(r.score).toBe(0); // score is still 0
  });

  test('scoreReasons does not record unknown auth results', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [{ authservId: 'mail.example.com', results: [{ method: 'dmarc', result: 'unknown-result' }] }],
    });
    expect(r.scoreReasons).toHaveLength(0);
  });

  test('scoreReason has label field', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [{ authservId: 'mail.example.com', results: [{ method: 'spf', result: 'fail' }] }],
    });
    expect(r.scoreReasons[0]).toMatchObject({ key: 'auth.spf.fail', label: 'SPF fail', delta: 50 });
  });
});

describe('scoreMessage — sender domain rules', () => {
  test('exact rule matches sender domain', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [],
      senderDomain: 'spam.example.net',
      senderDomainRules: [{ domain: 'spam.example.net', matchType: 'exact', score: 80 }],
    });
    expect(r.score).toBe(80);
    expect(r.classification).toBe('review');
  });

  test('exact rule does not match subdomain', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [],
      senderDomain: 'sub.spam.example.net',
      senderDomainRules: [{ domain: 'spam.example.net', matchType: 'exact', score: 80 }],
    });
    expect(r.scoreReasons.find(reason => reason.key === 'sender.rule')).toBeUndefined();
  });

  test('suffix rule matches exact domain', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [],
      senderDomain: 'spammer.example',
      senderDomainRules: [{ domain: 'spammer.example', matchType: 'suffix', score: 60 }],
    });
    expect(r.score).toBe(60);
  });

  test('suffix rule matches subdomain', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [],
      senderDomain: 'sub.spammer.example',
      senderDomainRules: [{ domain: 'spammer.example', matchType: 'suffix', score: 60 }],
    });
    expect(r.score).toBe(60);
  });

  test('negative sender rule applies regardless of untrusted AR (now 0)', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [{ authservId: 'evil.com', results: [] }],
      senderDomain: 'good.example.com',
      senderDomainRules: [{ domain: 'good.example.com', matchType: 'exact', score: -100 }],
    });
    expect(r.score).toBe(0 - 100); // -100 → normal
    expect(r.classification).toBe('normal');
  });

  test('scoreReasons includes sender-rule entry', () => {
    const r = scoreMessage({
      ...base,
      parsedAuthResults: [],
      senderDomain: 'bad.example',
      senderDomainRules: [{ domain: 'bad.example', matchType: 'exact', score: 50 }],
    });
    expect(r.scoreReasons).toContainEqual(
      expect.objectContaining({ key: 'sender.rule', domain: 'bad.example' }),
    );
  });
});

describe('recalculateScoreReasons', () => {
  test('returns empty array when scoreReasons is missing', () => {
    expect(recalculateScoreReasons({ score: 75 })).toEqual([]);
  });

  test('returns empty array when scoreReasons is empty', () => {
    expect(recalculateScoreReasons({ score: 0, scoreReasons: [] })).toEqual([]);
  });

  test('unchanged auth score reason — deltaChanged false, currentDelta equals delta', () => {
    const entry = {
      score: 15,
      scoreReasons: [{ key: 'auth.dmarc.fail', label: 'DMARC fail', delta: 15, authservId: 'mx.example.com', method: 'dmarc', result: 'fail' }],
    };
    const [r] = recalculateScoreReasons(entry);
    expect(r.currentDelta).toBe(15);
    expect(r.deltaChanged).toBe(false);
  });

  test('changed auth score reason — deltaChanged true, currentDelta reflects new setting', () => {
    const entry = {
      score: 25,
      scoreReasons: [{ key: 'auth.spf.fail', label: 'SPF fail', delta: 25, authservId: 'mx.example.com', method: 'spf', result: 'fail' }],
    };
    const [r] = recalculateScoreReasons(entry, {
      authScores: { ...DEFAULT_AUTH_SCORES, spf: { ...DEFAULT_AUTH_SCORES.spf, fail: 50 } },
    });
    expect(r.currentDelta).toBe(50);
    expect(r.deltaChanged).toBe(true);
  });

  test('authserv.untrusted always recalculates to currentDelta 0 (scoring disabled)', () => {
    const entry = {
      score: 50,
      scoreReasons: [{ key: 'authserv.untrusted', label: 'Untrusted authserv-id', delta: 50, authservId: 'evil.com' }],
    };
    const [r] = recalculateScoreReasons(entry);
    expect(r.currentDelta).toBe(0);
    expect(r.deltaChanged).toBe(true);
  });

  test('sender rule reason preserves original delta regardless of settings', () => {
    const entry = {
      score: 80,
      scoreReasons: [{ key: 'sender.rule', label: 'Sender domain rule', delta: 80, domain: 'spam.net', matchType: 'exact' }],
    };
    const [r] = recalculateScoreReasons(entry);
    expect(r.currentDelta).toBe(80);
    expect(r.deltaChanged).toBe(false);
  });

  test('spreads original reason fields onto result', () => {
    const entry = {
      score: 50,
      scoreReasons: [{ key: 'auth.dkim.fail', label: 'DKIM fail', delta: 25, authservId: 'mx.example.com', method: 'dkim', result: 'fail' }],
    };
    const [r] = recalculateScoreReasons(entry);
    expect(r).toMatchObject({ key: 'auth.dkim.fail', label: 'DKIM fail', delta: 25, authservId: 'mx.example.com' });
  });

  test('zero-delta pass reason updated when pass score changes', () => {
    const entry = {
      score: 0,
      scoreReasons: [{ key: 'auth.spf.pass', label: 'SPF pass', delta: 0, authservId: 'mx.example.com', method: 'spf', result: 'pass' }],
    };
    const [r] = recalculateScoreReasons(entry, {
      authScores: { ...DEFAULT_AUTH_SCORES, spf: { ...DEFAULT_AUTH_SCORES.spf, pass: -5 } },
    });
    expect(r.currentDelta).toBe(-5);
    expect(r.deltaChanged).toBe(true);
  });

  test('heuristic.randomFromDomainLabel recalculated from heuristicScores', () => {
    const entry = {
      score: 20,
      scoreReasons: [{ key: 'heuristic.randomFromDomainLabel', label: 'Random-looking From domain label', delta: 20, domain: 'wlikqkgi.auth.ltazy.com', matchedLabel: 'wlikqkgi' }],
    };
    const [r] = recalculateScoreReasons(entry, {
      heuristicScores: { randomFromDomainLabel: 5, randomFromLocalPart: 10, layer3Cap: 40 },
    });
    expect(r.currentDelta).toBe(5);
    expect(r.deltaChanged).toBe(true);
  });

  test('heuristic.randomFromLocalPart recalculated from heuristicScores', () => {
    const entry = {
      score: 10,
      scoreReasons: [{ key: 'heuristic.randomFromLocalPart', label: 'Random-looking From local part', delta: 10 }],
    };
    const [r] = recalculateScoreReasons(entry, {
      heuristicScores: { randomFromDomainLabel: 20, randomFromLocalPart: 3, layer3Cap: 40 },
    });
    expect(r.currentDelta).toBe(3);
    expect(r.deltaChanged).toBe(true);
  });

  test('heuristic reasons unchanged when heuristicScores matches stored delta', () => {
    const entry = {
      score: 20,
      scoreReasons: [{ key: 'heuristic.randomFromDomainLabel', delta: 20 }],
    };
    const [r] = recalculateScoreReasons(entry, {
      heuristicScores: { randomFromDomainLabel: 20, randomFromLocalPart: 10, layer3Cap: 40 },
    });
    expect(r.currentDelta).toBe(20);
    expect(r.deltaChanged).toBe(false);
  });

  test('heuristic reasons fall back to DEFAULT_HEURISTIC_SCORES when heuristicScores is absent', () => {
    const entry = {
      score: 15,
      scoreReasons: [{ key: 'heuristic.randomFromDomainLabel', delta: 15 }],
    };
    const [r] = recalculateScoreReasons(entry);
    expect(r.currentDelta).toBe(15); // DEFAULT_HEURISTIC_SCORES.randomFromDomainLabel
    expect(r.deltaChanged).toBe(false);
  });
});

describe('recalculateLogEntry', () => {
  const baseEntry = {
    score: 65,
    classification: 'review',
    scoreReasons: [
      { key: 'auth.spf.fail',   label: 'SPF fail',   delta: 50 },
      { key: 'auth.dmarc.fail', label: 'DMARC fail', delta: 15 },
    ],
  };

  test('with unchanged settings → currentScore equals originalScore', () => {
    const r = recalculateLogEntry(baseEntry);
    expect(r.originalScore).toBe(65);
    expect(r.currentScore).toBe(65);
    expect(r.originalClassification).toBe('review');
    expect(r.currentClassification).toBe('review');
    expect(r.reasonDiffs).toEqual([]);
  });

  test('lowering dmarc.fail changes currentScore and classification', () => {
    const r = recalculateLogEntry(baseEntry, {
      authScores: { ...DEFAULT_AUTH_SCORES, dmarc: { ...DEFAULT_AUTH_SCORES.dmarc, fail: 10 } },
    });
    expect(r.currentScore).toBe(60); // spf.fail=50 + dmarc.fail=10
    expect(r.currentClassification).toBe('review');
    expect(r.originalClassification).toBe('review');
    expect(r.reasonDiffs).toContainEqual(
      expect.objectContaining({ key: 'auth.dmarc.fail', originalDelta: 15, currentDelta: 10 }),
    );
  });

  test('old log with authserv.untrusted recalculates to currentScore 0 (scoring disabled)', () => {
    const entry = {
      score: 50,
      classification: 'review',
      scoreReasons: [{ key: 'authserv.untrusted', label: 'Untrusted authserv-id', delta: 50, authservId: 'x.com' }],
    };
    const r = recalculateLogEntry(entry);
    expect(r.currentScore).toBe(0);
    expect(r.currentClassification).toBe('normal');
    expect(r.reasonDiffs).toContainEqual(
      expect.objectContaining({ key: 'authserv.untrusted', originalDelta: 50, currentDelta: 0 }),
    );
  });

  test('sender.rule delta is preserved unchanged', () => {
    const entry = {
      score: 80,
      classification: 'review',
      scoreReasons: [{ key: 'sender.rule', label: 'Sender domain rule', delta: 80, domain: 'spam.net' }],
    };
    const r = recalculateLogEntry(entry, {
      authScores: DEFAULT_AUTH_SCORES,
      untrustedArScore: 999, // irrelevant for sender rule
    });
    expect(r.currentScore).toBe(80); // preserved
    expect(r.reasonDiffs).toEqual([]);
  });

  test('recalculation reflects pass score changed from 0 to non-zero', () => {
    const entry = {
      score: 0,
      classification: 'normal',
      scoreReasons: [
        { key: 'auth.dmarc.pass', label: 'DMARC pass', delta: 0, authservId: 'mail.example.com', method: 'dmarc', result: 'pass' },
        { key: 'auth.spf.pass',   label: 'SPF pass',   delta: 0, authservId: 'mail.example.com', method: 'spf',   result: 'pass' },
      ],
    };
    const r = recalculateLogEntry(entry, {
      authScores: {
        ...DEFAULT_AUTH_SCORES,
        dmarc: { ...DEFAULT_AUTH_SCORES.dmarc, pass: -10 },
        spf:   { ...DEFAULT_AUTH_SCORES.spf,   pass: -5  },
      },
    });
    expect(r.originalScore).toBe(0);
    expect(r.currentScore).toBe(-15);
    expect(r.currentClassification).toBe('normal');
    expect(r.reasonDiffs).toContainEqual(
      expect.objectContaining({ key: 'auth.dmarc.pass', originalDelta: 0, currentDelta: -10 }),
    );
    expect(r.reasonDiffs).toContainEqual(
      expect.objectContaining({ key: 'auth.spf.pass', originalDelta: 0, currentDelta: -5 }),
    );
  });

  test('entry without scoreReasons → currentScore 0', () => {
    const r = recalculateLogEntry({ score: 75 });
    expect(r.originalScore).toBe(75);
    expect(r.currentScore).toBe(0);
  });

  test('entry without classification uses classifyScore fallback', () => {
    const r = recalculateLogEntry({ score: 75, scoreReasons: [] });
    expect(r.originalClassification).toBe('review');
  });

  test('Layer 3 cap applied when heuristic subtotal exceeds layer3Cap', () => {
    // domain(30) + localPart(20) = 50; cap=40 → Layer 3 contributes 40, not 50
    const entry = {
      score: 50,
      scoreReasons: [
        { key: 'heuristic.randomFromDomainLabel', delta: 20 },
        { key: 'heuristic.randomFromLocalPart',   delta: 10 },
      ],
    };
    const r = recalculateLogEntry(entry, {
      heuristicScores: { randomFromDomainLabel: 30, randomFromLocalPart: 20, layer3Cap: 40 },
    });
    expect(r.currentScore).toBe(40);
  });

  test('Layer 3 cap of 0 disables all heuristic contribution', () => {
    const entry = {
      score: 30,
      scoreReasons: [
        { key: 'heuristic.randomFromDomainLabel', delta: 20 },
        { key: 'heuristic.randomFromLocalPart',   delta: 10 },
      ],
    };
    const r = recalculateLogEntry(entry, {
      heuristicScores: { randomFromDomainLabel: 20, randomFromLocalPart: 10, layer3Cap: 0 },
    });
    expect(r.currentScore).toBe(0);
  });

  test('Layer 3 cap does not affect non-heuristic reasons', () => {
    // auth reason + heuristic reasons; cap only applies to heuristic subtotal
    const entry = {
      score: 75,
      scoreReasons: [
        { key: 'auth.spf.fail', delta: 50 },
        { key: 'heuristic.randomFromDomainLabel', delta: 20 },
        { key: 'heuristic.randomFromLocalPart',   delta: 10 },
      ],
    };
    const r = recalculateLogEntry(entry, {
      heuristicScores: { randomFromDomainLabel: 20, randomFromLocalPart: 10, layer3Cap: 15 },
    });
    // spf.fail(50) + min(20+10, 15) = 50 + 15 = 65
    expect(r.currentScore).toBe(65);
  });
});

describe('sumCurrentDeltas', () => {
  test('sums non-heuristic reasons normally', () => {
    const reasons = [
      { key: 'auth.spf.fail', currentDelta: 60 },
      { key: 'auth.dmarc.fail', currentDelta: 40 },
    ];
    expect(sumCurrentDeltas(reasons)).toBe(100);
  });

  test('applies layer3Cap to heuristic subtotal', () => {
    const reasons = [
      { key: 'heuristic.randomFromDomainLabel', currentDelta: 30 },
      { key: 'heuristic.randomFromLocalPart',   currentDelta: 20 },
    ];
    expect(sumCurrentDeltas(reasons, { layer3Cap: 40 })).toBe(40);
  });

  test('does not cap when heuristic subtotal is below layer3Cap', () => {
    const reasons = [
      { key: 'heuristic.randomFromDomainLabel', currentDelta: 20 },
      { key: 'heuristic.randomFromLocalPart',   currentDelta: 10 },
    ];
    expect(sumCurrentDeltas(reasons, { layer3Cap: 40 })).toBe(30);
  });

  test('combines capped heuristic total with other reasons', () => {
    const reasons = [
      { key: 'auth.spf.fail',                   currentDelta: 60 },
      { key: 'heuristic.randomFromDomainLabel', currentDelta: 30 },
      { key: 'heuristic.randomFromLocalPart',   currentDelta: 20 },
    ];
    expect(sumCurrentDeltas(reasons, { layer3Cap: 40 })).toBe(100);
  });

  test('falls back to DEFAULT_HEURISTIC_SCORES when heuristicScores is absent', () => {
    const reasons = [
      { key: 'heuristic.randomFromDomainLabel', currentDelta: 15 },
      { key: 'heuristic.randomFromLocalPart',   currentDelta: 5 },
    ];
    // default cap=25; 20 < 25, no capping
    expect(sumCurrentDeltas(reasons)).toBe(20);
  });
});

// ── Layer 2: identity.spfMailFromMismatch ─────────────────────────────────────

const trustedExact = value => ({ value, matchType: 'exact' });
const arEntry = (authservId, results) => ({ authservId, results });
const spfResult = (result, smtpMailFrom) => ({
  method: 'spf', result, properties: smtpMailFrom ? { 'smtp.mailfrom': smtpMailFrom } : {},
});

describe('DEFAULT_LAYER2_SCORES', () => {
  test('spfMailFromMismatch defaults to 0', () => {
    expect(DEFAULT_LAYER2_SCORES.spfMailFromMismatch).toBe(0);
  });
});

describe('labelForScoreKey — Layer 2', () => {
  test('identity.spfMailFromMismatch → human label', () =>
    expect(labelForScoreKey('identity.spfMailFromMismatch')).toBe('SPF MAIL FROM differs from From'));
});

describe('scoreMessage — Layer 2 identity.spfMailFromMismatch', () => {
  const baseL2 = {
    trustedDomains: [trustedExact('mx.example.com')],
    senderDomainRules: [],

    authScores: DEFAULT_AUTH_SCORES,
    heuristicScores: { randomFromDomainLabel: 0, randomFromLocalPart: 0, layer3Cap: 0 },
  };

  test('SPF pass with same registrable domain adds no Layer 2 score', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [spfResult('pass', 'bounce@mail.example.com')])],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.spfMailFromMismatch')).toBeUndefined();
    expect(r.score).toBe(0);
  });

  test('SPF pass with different registrable domain adds the configured Layer 2 score', () => {
    const r = scoreMessage({
      ...baseL2,
      // DMARC pass prevents dmarcNoneWithThirdPartyAuth from also firing.
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dmarc', result: 'pass', properties: {} },
        spfResult('pass', 'bounce@mailer.example.net'),
      ])],
      senderDomain: 'example.com',
    });
    const reason = r.scoreReasons.find(s => s.key === 'identity.spfMailFromMismatch');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_LAYER2_SCORES.spfMailFromMismatch);
    expect(r.score).toBe(DEFAULT_LAYER2_SCORES.spfMailFromMismatch);
  });

  test('uses PSL-backed registrable-domain comparison (co.jp TLD)', () => {
    const r = scoreMessage({
      ...baseL2,
      trustedDomains: [trustedExact('mx.example.co.jp')],
      parsedAuthResults: [arEntry('mx.example.co.jp', [spfResult('pass', 'bounce@mail.example.co.jp')])],
      senderDomain: 'example.co.jp',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.spfMailFromMismatch')).toBeUndefined();
  });

  test('untrusted Authentication-Results never produce Layer 2 score', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('evil.attacker.com', [spfResult('pass', 'bounce@evil.attacker.com')])],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.spfMailFromMismatch')).toBeUndefined();
  });

  test('missing smtp.mailfrom does not crash and does not score', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [{ method: 'spf', result: 'pass', properties: {} }])],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.spfMailFromMismatch')).toBeUndefined();
    expect(r.score).toBe(0);
  });

  test('SPF fail with mismatched domain does not produce Layer 2 score', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [spfResult('fail', 'bounce@other.net')])],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.spfMailFromMismatch')).toBeUndefined();
  });

  test('scoreReason includes fromDomain, fromRegistrableDomain, smtpMailFromDomain, smtpMailFromRegistrableDomain', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [spfResult('pass', 'bounce@mailer.example.net')])],
      senderDomain: 'example.com',
    });
    const reason = r.scoreReasons.find(s => s.key === 'identity.spfMailFromMismatch');
    expect(reason).toMatchObject({
      fromDomain: 'example.com',
      fromRegistrableDomain: 'example.com',
      smtpMailFromDomain: 'mailer.example.net',
      smtpMailFromRegistrableDomain: 'example.net',
    });
  });

  test('configurable layer2Scores.spfMailFromMismatch is used', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dmarc', result: 'pass', properties: {} },
        spfResult('pass', 'bounce@mailer.example.net'),
      ])],
      senderDomain: 'example.com',
      layer2Scores: { spfMailFromMismatch: 20 },
    });
    const reason = r.scoreReasons.find(s => s.key === 'identity.spfMailFromMismatch');
    expect(reason.delta).toBe(20);
    expect(r.score).toBe(20);
  });

  test('second trusted AR with SPF pass mismatch scores when first AR has SPF fail', () => {
    // The first trusted AR has SPF fail; the second has SPF pass with a mismatched
    // MAIL FROM. The fix ensures the second AR is not silently ignored.
    const r = scoreMessage({
      ...baseL2,
      trustedDomains: [trustedExact('mx.example.com'), trustedExact('mx2.example.com')],
      parsedAuthResults: [
        arEntry('mx.example.com',  [
          { method: 'dmarc', result: 'pass', properties: {} },
          spfResult('fail',  'bounce@example.com'),
        ]),
        arEntry('mx2.example.com', [spfResult('pass',  'bounce@mailer.example.net')]),
      ],
      senderDomain: 'example.com',
    });
    const reason = r.scoreReasons.find(s => s.key === 'identity.spfMailFromMismatch');
    expect(reason).toBeDefined();
    expect(reason.smtpMailFromRegistrableDomain).toBe('example.net');
    expect(r.score).toBe(DEFAULT_AUTH_SCORES.spf.fail + DEFAULT_LAYER2_SCORES.spfMailFromMismatch);
  });

  test('second trusted AR with SPF pass mismatch scores when first AR has no SPF result', () => {
    const r = scoreMessage({
      ...baseL2,
      trustedDomains: [trustedExact('mx.example.com'), trustedExact('mx2.example.com')],
      parsedAuthResults: [
        arEntry('mx.example.com',  [
          { method: 'dmarc', result: 'pass', properties: {} },
          { method: 'dkim', result: 'pass', properties: {} },
        ]),
        arEntry('mx2.example.com', [spfResult('pass',  'bounce@mailer.example.net')]),
      ],
      senderDomain: 'example.com',
    });
    const reason = r.scoreReasons.find(s => s.key === 'identity.spfMailFromMismatch');
    expect(reason).toBeDefined();
    expect(r.score).toBe(DEFAULT_LAYER2_SCORES.spfMailFromMismatch);
  });

  test('multiple trusted ARs with SPF pass mismatch score only once per message', () => {
    // Seven trusted AR headers each with a mismatched MAIL FROM must not
    // accumulate 7× the Layer 2 delta — the mismatch is capped at one score entry.
    // First AR also carries DMARC pass to prevent dmarcNoneWithThirdPartyAuth from firing.
    const arHeaders = Array.from({ length: 7 }, (_, i) =>
      arEntry(`mx${i}.example.com`, [spfResult('pass', `bounce@mailer${i}.example.net`)]));
    arHeaders[0].results.unshift({ method: 'dmarc', result: 'pass', properties: {} });
    const r = scoreMessage({
      ...baseL2,
      trustedDomains: arHeaders.map(ar => trustedExact(ar.authservId)),
      parsedAuthResults: arHeaders,
      senderDomain: 'example.com',
    });
    const reasons = r.scoreReasons.filter(s => s.key === 'identity.spfMailFromMismatch');
    expect(reasons).toHaveLength(1);
    expect(r.score).toBe(DEFAULT_LAYER2_SCORES.spfMailFromMismatch);
  });
});

describe('recalculateScoreReasons — identity.spfMailFromMismatch', () => {
  test('uses current layer2Scores.spfMailFromMismatch', () => {
    const entry = {
      score: 15,
      scoreReasons: [{
        key: 'identity.spfMailFromMismatch',
        label: 'SPF MAIL FROM differs from From',
        delta: 15,
        fromDomain: 'example.com',
        fromRegistrableDomain: 'example.com',
        smtpMailFromDomain: 'mailer.example.net',
        smtpMailFromRegistrableDomain: 'example.net',
      }],
    };
    const [r] = recalculateScoreReasons(entry, { layer2Scores: { spfMailFromMismatch: 20 } });
    expect(r.currentDelta).toBe(20);
    expect(r.deltaChanged).toBe(true);
  });

  test('falls back to DEFAULT_LAYER2_SCORES when layer2Scores absent', () => {
    const entry = {
      score: 0,
      scoreReasons: [{ key: 'identity.spfMailFromMismatch', delta: 0 }],
    };
    const [r] = recalculateScoreReasons(entry);
    expect(r.currentDelta).toBe(DEFAULT_LAYER2_SCORES.spfMailFromMismatch);
    expect(r.deltaChanged).toBe(false);
  });

  test('unchanged score → deltaChanged false', () => {
    const entry = {
      score: 15,
      scoreReasons: [{ key: 'identity.spfMailFromMismatch', delta: 15 }],
    };
    const [r] = recalculateScoreReasons(entry, { layer2Scores: { spfMailFromMismatch: 15 } });
    expect(r.deltaChanged).toBe(false);
  });
});

describe('recalculateLogEntry — identity.spfMailFromMismatch', () => {
  test('changing layer2Scores reflects in currentScore', () => {
    const entry = {
      score: 15,
      classification: 'normal',
      scoreReasons: [{ key: 'identity.spfMailFromMismatch', delta: 15 }],
    };
    const r = recalculateLogEntry(entry, { layer2Scores: { spfMailFromMismatch: 20 } });
    expect(r.currentScore).toBe(20);
    expect(r.reasonDiffs).toContainEqual(
      expect.objectContaining({ key: 'identity.spfMailFromMismatch', originalDelta: 15, currentDelta: 20 }),
    );
  });
});

describe('recalculateLogEntry — updated defaults (issue #220)', () => {
  test('old dmarc.none=10 entry recalculates to current default 35', () => {
    const entry = {
      score: 10,
      classification: 'normal',
      scoreReasons: [{ key: 'auth.dmarc.none', label: 'DMARC none', delta: 10 }],
    };
    const r = recalculateLogEntry(entry, { authScores: DEFAULT_AUTH_SCORES });
    expect(r.currentScore).toBe(35);
    expect(r.reasonDiffs).toContainEqual(
      expect.objectContaining({ key: 'auth.dmarc.none', originalDelta: 10, currentDelta: 35 }),
    );
  });

  test('old spf.none=5 entry recalculates to current default 15', () => {
    const entry = {
      score: 5,
      classification: 'normal',
      scoreReasons: [{ key: 'auth.spf.none', label: 'SPF none', delta: 5 }],
    };
    const r = recalculateLogEntry(entry, { authScores: DEFAULT_AUTH_SCORES });
    expect(r.currentScore).toBe(15);
  });

  test('old spfMailFromMismatch=10 entry recalculates to current default 0', () => {
    const entry = {
      score: 10,
      classification: 'normal',
      scoreReasons: [{ key: 'identity.spfMailFromMismatch', delta: 10 }],
    };
    const r = recalculateLogEntry(entry, { layer2Scores: DEFAULT_LAYER2_SCORES });
    expect(r.currentScore).toBe(0);
    expect(r.reasonDiffs).toContainEqual(
      expect.objectContaining({ key: 'identity.spfMailFromMismatch', originalDelta: 10, currentDelta: 0 }),
    );
  });

  test('old messageIdMismatchWithUnalignedAuth=20 recalculates to current default 30', () => {
    const entry = {
      score: 20,
      classification: 'normal',
      scoreReasons: [{ key: 'composite.messageIdMismatchWithUnalignedAuth', delta: 20 }],
    };
    const r = recalculateLogEntry(entry, { compositeScores: DEFAULT_COMPOSITE_SCORES });
    expect(r.currentScore).toBe(30);
    expect(r.reasonDiffs).toContainEqual(
      expect.objectContaining({
        key: 'composite.messageIdMismatchWithUnalignedAuth',
        originalDelta: 20,
        currentDelta: 30,
      }),
    );
  });

  test('dkim.fail remains 15 (unchanged by issue #220)', () => {
    const entry = {
      score: 15,
      classification: 'normal',
      scoreReasons: [{ key: 'auth.dkim.fail', delta: 15 }],
    };
    const r = recalculateLogEntry(entry, { authScores: DEFAULT_AUTH_SCORES });
    expect(r.currentScore).toBe(15);
    expect(r.reasonDiffs).toHaveLength(0);
  });
});

// ── Layer 2: identity.dkimDomainMismatch ─────────────────────────────────────

const dkimResult = (result, domain) => ({
  method: 'dkim', result,
  properties: domain ? { 'header.d': domain } : {},
});

describe('DEFAULT_LAYER2_SCORES — dkimDomainMismatch', () => {
  test('dkimDomainMismatch defaults to 5', () => {
    expect(DEFAULT_LAYER2_SCORES.dkimDomainMismatch).toBe(5);
  });
});

describe('labelForScoreKey — identity.dkimDomainMismatch', () => {
  test('returns human label', () =>
    expect(labelForScoreKey('identity.dkimDomainMismatch')).toBe('DKIM signing domain differs from From'));
});

describe('scoreMessage — Layer 2 identity.dkimDomainMismatch', () => {
  const baseL2 = {
    trustedDomains: [trustedExact('mx.example.com')],
    senderDomainRules: [],

    authScores: DEFAULT_AUTH_SCORES,
    heuristicScores: { randomFromDomainLabel: 0, randomFromLocalPart: 0, layer3Cap: 0 },
  };

  test('DKIM pass aligned with From adds no Layer 2 score', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [dkimResult('pass', 'mail.example.com')])],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.dkimDomainMismatch')).toBeUndefined();
    expect(r.score).toBe(0);
  });

  test('DKIM pass only for unrelated registrable domain adds configured Layer 2 score', () => {
    const r = scoreMessage({
      ...baseL2,
      // DMARC pass prevents dmarcNoneWithThirdPartyAuth from also firing.
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dmarc', result: 'pass', properties: {} },
        dkimResult('pass', 'mailer.example.net'),
      ])],
      senderDomain: 'example.com',
    });
    const reason = r.scoreReasons.find(s => s.key === 'identity.dkimDomainMismatch');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_LAYER2_SCORES.dkimDomainMismatch);
    expect(r.score).toBe(DEFAULT_LAYER2_SCORES.dkimDomainMismatch);
  });

  test('untrusted Authentication-Results never produce Layer 2 DKIM score', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('evil.attacker.com', [dkimResult('pass', 'evil.attacker.com')])],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.dkimDomainMismatch')).toBeUndefined();
  });

  test('DKIM pass with unparseable domain does not crash and does not score', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [{ method: 'dkim', result: 'pass', properties: {} }])],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.dkimDomainMismatch')).toBeUndefined();
    expect(r.score).toBe(0);
  });

  test('DKIM fail with mismatched domain does not produce Layer 2 score', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [dkimResult('fail', 'mailer.example.net')])],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.dkimDomainMismatch')).toBeUndefined();
  });

  test('absence of DKIM results does not produce Layer 2 score', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [spfResult('pass', 'bounce@example.com')])],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.dkimDomainMismatch')).toBeUndefined();
  });

  test('mix of aligned and unaligned DKIM pass adds no score', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        dkimResult('pass', 'mail.example.com'),
        dkimResult('pass', 'mailer.example.net'),
      ])],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.dkimDomainMismatch')).toBeUndefined();
    expect(r.score).toBe(0);
  });

  test('multiple unaligned DKIM pass signatures score only once per message', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dmarc', result: 'pass', properties: {} },
        dkimResult('pass', 'mailer1.example.net'),
        dkimResult('pass', 'mailer2.example.org'),
      ])],
      senderDomain: 'example.com',
    });
    const reasons = r.scoreReasons.filter(s => s.key === 'identity.dkimDomainMismatch');
    expect(reasons).toHaveLength(1);
    expect(r.score).toBe(DEFAULT_LAYER2_SCORES.dkimDomainMismatch);
  });

  test('unaligned DKIM pass across multiple trusted ARs scores only once', () => {
    const r = scoreMessage({
      ...baseL2,
      trustedDomains: [trustedExact('mx.example.com'), trustedExact('mx2.example.com')],
      parsedAuthResults: [
        arEntry('mx.example.com',  [
          { method: 'dmarc', result: 'pass', properties: {} },
          dkimResult('pass', 'mailer.example.net'),
        ]),
        arEntry('mx2.example.com', [dkimResult('pass', 'mailer2.example.org')]),
      ],
      senderDomain: 'example.com',
    });
    const reasons = r.scoreReasons.filter(s => s.key === 'identity.dkimDomainMismatch');
    expect(reasons).toHaveLength(1);
    expect(r.score).toBe(DEFAULT_LAYER2_SCORES.dkimDomainMismatch);
  });

  test('uses PSL-backed registrable-domain comparison (co.jp TLD)', () => {
    const r = scoreMessage({
      ...baseL2,
      trustedDomains: [trustedExact('mx.example.co.jp')],
      parsedAuthResults: [arEntry('mx.example.co.jp', [dkimResult('pass', 'mail.example.co.jp')])],
      senderDomain: 'example.co.jp',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.dkimDomainMismatch')).toBeUndefined();
  });

  test('scoreReason includes fromDomain, fromRegistrableDomain, and dkimDomains', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        dkimResult('pass', 'mailer.example.net'),
        dkimResult('pass', 'sub.mailer.example.net'),
      ])],
      senderDomain: 'example.com',
    });
    const reason = r.scoreReasons.find(s => s.key === 'identity.dkimDomainMismatch');
    expect(reason).toMatchObject({
      fromDomain: 'example.com',
      fromRegistrableDomain: 'example.com',
    });
    expect(reason.dkimDomains).toEqual(['example.net']);
  });

  test('configurable layer2Scores.dkimDomainMismatch is used', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dmarc', result: 'pass', properties: {} },
        dkimResult('pass', 'mailer.example.net'),
      ])],
      senderDomain: 'example.com',
      layer2Scores: { dkimDomainMismatch: 20 },
    });
    const reason = r.scoreReasons.find(s => s.key === 'identity.dkimDomainMismatch');
    expect(reason.delta).toBe(20);
    expect(r.score).toBe(20);
  });

  test('DKIM pass with only header.i=@repica.jp and From matsuo1956.jp produces dkimDomainMismatch', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dkim', result: 'pass', properties: { 'header.i': '@repica.jp' } },
      ])],
      senderDomain: 'matsuo1956.jp',
    });
    const reason = r.scoreReasons.find(s => s.key === 'identity.dkimDomainMismatch');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_LAYER2_SCORES.dkimDomainMismatch);
    expect(reason.dkimDomains).toEqual(['repica.jp']);
  });

  test('DKIM pass with only header.i=user@sub.example.com and From example.com is aligned (no mismatch)', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dkim', result: 'pass', properties: { 'header.i': 'user@sub.example.com' } },
      ])],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.dkimDomainMismatch')).toBeUndefined();
  });

  test('header.d is preferred over header.i when both present', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dkim', result: 'pass', properties: { 'header.d': 'example.com', 'header.i': '@other.net' } },
      ])],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.dkimDomainMismatch')).toBeUndefined();
  });

  test('malformed header.i without @ does not crash and does not score', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dkim', result: 'pass', properties: { 'header.i': 'not-an-email' } },
      ])],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.dkimDomainMismatch')).toBeUndefined();
  });
});

describe('recalculateScoreReasons — identity.dkimDomainMismatch', () => {
  test('uses current layer2Scores.dkimDomainMismatch', () => {
    const entry = {
      score: 10,
      scoreReasons: [{
        key: 'identity.dkimDomainMismatch',
        label: 'DKIM signing domain differs from From',
        delta: 10,
        fromDomain: 'example.com',
        fromRegistrableDomain: 'example.com',
        dkimDomains: ['example.net'],
      }],
    };
    const [r] = recalculateScoreReasons(entry, { layer2Scores: { dkimDomainMismatch: 20 } });
    expect(r.currentDelta).toBe(20);
    expect(r.deltaChanged).toBe(true);
  });

  test('falls back to DEFAULT_LAYER2_SCORES when layer2Scores absent', () => {
    const entry = {
      score: 5,
      scoreReasons: [{ key: 'identity.dkimDomainMismatch', delta: 5 }],
    };
    const [r] = recalculateScoreReasons(entry);
    expect(r.currentDelta).toBe(DEFAULT_LAYER2_SCORES.dkimDomainMismatch);
    expect(r.deltaChanged).toBe(false);
  });

  test('unchanged score → deltaChanged false', () => {
    const entry = {
      score: 10,
      scoreReasons: [{ key: 'identity.dkimDomainMismatch', delta: 10 }],
    };
    const [r] = recalculateScoreReasons(entry, { layer2Scores: { dkimDomainMismatch: 10 } });
    expect(r.deltaChanged).toBe(false);
  });
});

describe('recalculateLogEntry — identity.dkimDomainMismatch', () => {
  test('changing layer2Scores reflects in currentScore', () => {
    const entry = {
      score: 10,
      classification: 'normal',
      scoreReasons: [{ key: 'identity.dkimDomainMismatch', delta: 10 }],
    };
    const r = recalculateLogEntry(entry, { layer2Scores: { dkimDomainMismatch: 20 } });
    expect(r.currentScore).toBe(20);
    expect(r.reasonDiffs).toContainEqual(
      expect.objectContaining({ key: 'identity.dkimDomainMismatch', originalDelta: 10, currentDelta: 20 }),
    );
  });
});

// ── Layer 2: identity.dmarcNoneWithThirdPartyAuth ─────────────────────────────

describe('DEFAULT_LAYER2_SCORES — dmarcNoneWithThirdPartyAuth', () => {
  test('dmarcNoneWithThirdPartyAuth defaults to 10', () => {
    expect(DEFAULT_LAYER2_SCORES.dmarcNoneWithThirdPartyAuth).toBe(10);
  });
});

describe('labelForScoreKey — identity.dmarcNoneWithThirdPartyAuth', () => {
  test('returns human label', () =>
    expect(labelForScoreKey('identity.dmarcNoneWithThirdPartyAuth'))
      .toBe('DMARC none with only third-party auth'));
});

describe('scoreMessage — Layer 2 identity.dmarcNoneWithThirdPartyAuth', () => {
  const baseL2 = {
    trustedDomains: [trustedExact('mx.example.com')],
    senderDomainRules: [],

    authScores: DEFAULT_AUTH_SCORES,
    heuristicScores: { randomFromDomainLabel: 0, randomFromLocalPart: 0, layer3Cap: 0 },
  };

  test('DMARC none + SPF pass for third-party domain adds the score', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dmarc', result: 'none', properties: {} },
        spfResult('pass', 'bounce@mailer.example.net'),
      ])],
      senderDomain: 'example.com',
    });
    const reason = r.scoreReasons.find(s => s.key === 'identity.dmarcNoneWithThirdPartyAuth');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_LAYER2_SCORES.dmarcNoneWithThirdPartyAuth);
    expect(reason.dmarcResult).toBe('none');
    expect(r.score).toBeGreaterThanOrEqual(DEFAULT_LAYER2_SCORES.dmarcNoneWithThirdPartyAuth);
  });

  test('DMARC absent + SPF pass for third-party domain adds the score', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        spfResult('pass', 'bounce@mailer.example.net'),
      ])],
      senderDomain: 'example.com',
    });
    const reason = r.scoreReasons.find(s => s.key === 'identity.dmarcNoneWithThirdPartyAuth');
    expect(reason).toBeDefined();
    expect(reason.dmarcResult).toBe('absent');
  });

  test('DMARC absent + DKIM pass for third-party domain adds the score', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        dkimResult('pass', 'mailer.example.net'),
      ])],
      senderDomain: 'example.com',
    });
    const reason = r.scoreReasons.find(s => s.key === 'identity.dmarcNoneWithThirdPartyAuth');
    expect(reason).toBeDefined();
    expect(reason.dmarcResult).toBe('absent');
  });

  test('DMARC none + both SPF and DKIM pass for third-party adds the score once', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dmarc', result: 'none', properties: {} },
        spfResult('pass', 'bounce@mailer.example.net'),
        dkimResult('pass', 'other.example.org'),
      ])],
      senderDomain: 'example.com',
    });
    const reasons = r.scoreReasons.filter(s => s.key === 'identity.dmarcNoneWithThirdPartyAuth');
    expect(reasons).toHaveLength(1);
  });

  test('DMARC none + aligned SPF pass does not add the score', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dmarc', result: 'none', properties: {} },
        spfResult('pass', 'bounce@mail.example.com'),
      ])],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.dmarcNoneWithThirdPartyAuth')).toBeUndefined();
  });

  test('DMARC none + aligned DKIM pass does not add the score', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dmarc', result: 'none', properties: {} },
        dkimResult('pass', 'sub.example.com'),
      ])],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.dmarcNoneWithThirdPartyAuth')).toBeUndefined();
  });

  test('DMARC pass does not trigger the score even if SPF is third-party', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dmarc', result: 'pass', properties: {} },
        spfResult('pass', 'bounce@mailer.example.net'),
      ])],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.dmarcNoneWithThirdPartyAuth')).toBeUndefined();
  });

  test('DMARC fail does not trigger the score', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dmarc', result: 'fail', properties: {} },
        spfResult('pass', 'bounce@mailer.example.net'),
      ])],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.dmarcNoneWithThirdPartyAuth')).toBeUndefined();
  });

  test('no trusted pass results (only fails) does not add the score', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dmarc', result: 'none', properties: {} },
        spfResult('fail', 'bounce@mailer.example.net'),
      ])],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.dmarcNoneWithThirdPartyAuth')).toBeUndefined();
  });

  test('untrusted Authentication-Results never produce the score', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('evil.attacker.com', [
        { method: 'dmarc', result: 'none', properties: {} },
        spfResult('pass', 'bounce@evil.attacker.com'),
      ])],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.dmarcNoneWithThirdPartyAuth')).toBeUndefined();
  });

  test('scoreReason includes fromDomain, fromRegistrableDomain, dmarcResult, thirdPartyDomains', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dmarc', result: 'none', properties: {} },
        spfResult('pass', 'bounce@mailer.example.net'),
        dkimResult('pass', 'other.example.org'),
      ])],
      senderDomain: 'example.com',
    });
    const reason = r.scoreReasons.find(s => s.key === 'identity.dmarcNoneWithThirdPartyAuth');
    expect(reason).toMatchObject({
      fromDomain: 'example.com',
      fromRegistrableDomain: 'example.com',
      dmarcResult: 'none',
    });
    expect(reason.thirdPartyDomains).toEqual(expect.arrayContaining(['example.net', 'example.org']));
  });

  test('configurable layer2Scores.dmarcNoneWithThirdPartyAuth is used', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        spfResult('pass', 'bounce@mailer.example.net'),
      ])],
      senderDomain: 'example.com',
      layer2Scores: { dmarcNoneWithThirdPartyAuth: 25 },
    });
    const reason = r.scoreReasons.find(s => s.key === 'identity.dmarcNoneWithThirdPartyAuth');
    expect(reason.delta).toBe(25);
  });

  test('no trusted AR at all does not add the score', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.dmarcNoneWithThirdPartyAuth')).toBeUndefined();
  });

  test('first trusted AR has dmarc=none but second has dmarc=pass — does not add the score', () => {
    const r = scoreMessage({
      ...baseL2,
      trustedDomains: [trustedExact('mx1.example.com'), trustedExact('mx2.example.com')],
      parsedAuthResults: [
        arEntry('mx1.example.com', [
          { method: 'dmarc', result: 'none', properties: {} },
          spfResult('pass', 'bounce@mailer.example.net'),
        ]),
        arEntry('mx2.example.com', [
          { method: 'dmarc', result: 'pass', properties: {} },
        ]),
      ],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.dmarcNoneWithThirdPartyAuth')).toBeUndefined();
  });

  test('all trusted ARs have dmarc=none — does add the score', () => {
    const r = scoreMessage({
      ...baseL2,
      trustedDomains: [trustedExact('mx1.example.com'), trustedExact('mx2.example.com')],
      parsedAuthResults: [
        arEntry('mx1.example.com', [
          { method: 'dmarc', result: 'none', properties: {} },
        ]),
        arEntry('mx2.example.com', [
          { method: 'dmarc', result: 'none', properties: {} },
          spfResult('pass', 'bounce@mailer.example.net'),
        ]),
      ],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.dmarcNoneWithThirdPartyAuth')).toBeDefined();
  });

  test('DKIM pass with only header.i contributes to dmarcNoneWithThirdPartyAuth', () => {
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dkim', result: 'pass', properties: { 'header.i': '@repica.jp' } },
      ])],
      senderDomain: 'matsuo1956.jp',
    });
    const reason = r.scoreReasons.find(s => s.key === 'identity.dmarcNoneWithThirdPartyAuth');
    expect(reason).toBeDefined();
    expect(reason.thirdPartyDomains).toContain('repica.jp');
  });
});

describe('recalculateScoreReasons — identity.dmarcNoneWithThirdPartyAuth', () => {
  test('uses current layer2Scores.dmarcNoneWithThirdPartyAuth', () => {
    const entry = {
      score: 10,
      scoreReasons: [{
        key: 'identity.dmarcNoneWithThirdPartyAuth',
        label: 'DMARC none with only third-party auth',
        delta: 10,
        fromDomain: 'example.com',
        fromRegistrableDomain: 'example.com',
        dmarcResult: 'none',
        thirdPartyDomains: ['example.net'],
      }],
    };
    const [r] = recalculateScoreReasons(entry, { layer2Scores: { dmarcNoneWithThirdPartyAuth: 25 } });
    expect(r.currentDelta).toBe(25);
    expect(r.deltaChanged).toBe(true);
  });

  test('falls back to DEFAULT_LAYER2_SCORES when layer2Scores absent', () => {
    const entry = {
      score: 10,
      scoreReasons: [{ key: 'identity.dmarcNoneWithThirdPartyAuth', delta: 10 }],
    };
    const [r] = recalculateScoreReasons(entry);
    expect(r.currentDelta).toBe(DEFAULT_LAYER2_SCORES.dmarcNoneWithThirdPartyAuth);
    expect(r.deltaChanged).toBe(false);
  });

  test('unchanged score → deltaChanged false', () => {
    const entry = {
      score: 20,
      scoreReasons: [{ key: 'identity.dmarcNoneWithThirdPartyAuth', delta: 20 }],
    };
    const [r] = recalculateScoreReasons(entry, { layer2Scores: { dmarcNoneWithThirdPartyAuth: 20 } });
    expect(r.deltaChanged).toBe(false);
  });
});

describe('recalculateLogEntry — identity.dmarcNoneWithThirdPartyAuth', () => {
  test('changing layer2Scores reflects in currentScore', () => {
    const entry = {
      score: 10,
      classification: 'normal',
      scoreReasons: [{ key: 'identity.dmarcNoneWithThirdPartyAuth', delta: 10 }],
    };
    const r = recalculateLogEntry(entry, { layer2Scores: { dmarcNoneWithThirdPartyAuth: 25 } });
    expect(r.currentScore).toBe(25);
    expect(r.reasonDiffs).toContainEqual(
      expect.objectContaining({ key: 'identity.dmarcNoneWithThirdPartyAuth', originalDelta: 10, currentDelta: 25 }),
    );
  });
});

// ── Layer 4: Composite detection rules ────────────────────────────────────────

// Helper to build a trusted AR entry with SPF pass and matching MAIL FROM.
const spfPassAligned = (authservId, fromDomain) =>
  arEntry(authservId, [spfResult('pass', `bounce@${fromDomain}`)]);

// Helper to build a trusted AR entry with DKIM pass aligned to From domain.
const dkimPassAligned = (authservId, fromDomain) =>
  arEntry(authservId, [dkimResult('pass', fromDomain)]);

describe('DEFAULT_COMPOSITE_SCORES', () => {
  test('spfAlignedDkimUnalignedRandomLocal defaults to 30', () =>
    expect(DEFAULT_COMPOSITE_SCORES.spfAlignedDkimUnalignedRandomLocal).toBe(30));
  test('authAlignedRandomDomain defaults to 40', () =>
    expect(DEFAULT_COMPOSITE_SCORES.authAlignedRandomDomain).toBe(40));
});

describe('labelForScoreKey — Layer 4', () => {
  test('composite.spfAlignedDkimUnalignedRandomLocal → human label', () =>
    expect(labelForScoreKey('composite.spfAlignedDkimUnalignedRandomLocal'))
      .toBe('SPF aligned, DKIM unaligned, random local part'));
  test('composite.authAlignedRandomDomain → human label', () =>
    expect(labelForScoreKey('composite.authAlignedRandomDomain'))
      .toBe('Auth-aligned sender with random-looking domain'));
  test('composite.deepRandomFromSubdomain → human label', () =>
    expect(labelForScoreKey('composite.deepRandomFromSubdomain'))
      .toBe('Deep random-looking From subdomain'));
});

describe('scoreMessage — Layer 4 composite.spfAlignedDkimUnalignedRandomLocal', () => {
  // Base with heuristics disabled (Layer 3 zeros) to isolate Layer 4 signals.
  const baseL4 = {
    trustedDomains: [trustedExact('mx.example.com')],
    senderDomainRules: [],

    authScores: DEFAULT_AUTH_SCORES,
    heuristicScores: { randomFromDomainLabel: 0, randomFromLocalPart: 0, layer3Cap: 0 },
  };

  test('all conditions met → composite rule fires', () => {
    // SPF aligned, no DKIM, random-looking local part of length >= 7
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [spfPassAligned('mx.example.com', 'example.com')],
      senderDomain: 'example.com',
      senderLocalPart: 'xkqrtbvz', // length 8, random-looking
    });
    const reason = r.scoreReasons.find(s => s.key === 'composite.spfAlignedDkimUnalignedRandomLocal');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_COMPOSITE_SCORES.spfAlignedDkimUnalignedRandomLocal);
    expect(r.score).toBe(DEFAULT_COMPOSITE_SCORES.spfAlignedDkimUnalignedRandomLocal);
  });

  test('does not fire when anyDkimAligned is true (DKIM mitigation)', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [arEntry('mx.example.com', [
        spfResult('pass', 'bounce@example.com'),
        dkimResult('pass', 'example.com'),
      ])],
      senderDomain: 'example.com',
      senderLocalPart: 'xkqrtbvz',
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.spfAlignedDkimUnalignedRandomLocal'))
      .toBeUndefined();
  });

  test('does not fire when SPF is not aligned (mismatched MAIL FROM)', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [arEntry('mx.example.com', [
        spfResult('pass', 'bounce@mailer.example.net'), // mismatched
      ])],
      senderDomain: 'example.com',
      senderLocalPart: 'xkqrtbvz',
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.spfAlignedDkimUnalignedRandomLocal'))
      .toBeUndefined();
  });

  test('does not fire when local part is too short (< 7 chars)', () => {
    // "info" and short names should not trigger composite random-local penalties
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [spfPassAligned('mx.example.com', 'example.com')],
      senderDomain: 'example.com',
      senderLocalPart: 'xkqrt', // length 5, meets Layer 3 check but < 7
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.spfAlignedDkimUnalignedRandomLocal'))
      .toBeUndefined();
  });

  test('does not fire when local part is not random-looking', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [spfPassAligned('mx.example.com', 'example.com')],
      senderDomain: 'example.com',
      senderLocalPart: 'noreply', // common, not random-looking
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.spfAlignedDkimUnalignedRandomLocal'))
      .toBeUndefined();
  });

  test('does not fire when no trusted AR is present', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [],
      senderDomain: 'example.com',
      senderLocalPart: 'xkqrtbvz',
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.spfAlignedDkimUnalignedRandomLocal'))
      .toBeUndefined();
  });

  test('scoreReason includes localPart field', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [spfPassAligned('mx.example.com', 'example.com')],
      senderDomain: 'example.com',
      senderLocalPart: 'xkqrtbvz',
    });
    const reason = r.scoreReasons.find(s => s.key === 'composite.spfAlignedDkimUnalignedRandomLocal');
    expect(reason).toMatchObject({ localPart: 'xkqrtbvz' });
  });
});

describe('scoreMessage — Layer 4 composite.authAlignedRandomDomain', () => {
  const baseL4 = {
    trustedDomains: [trustedExact('mx.example.com')],
    senderDomainRules: [],

    authScores: DEFAULT_AUTH_SCORES,
    heuristicScores: { randomFromDomainLabel: 0, randomFromLocalPart: 0, layer3Cap: 0 },
  };

  test('auth aligned + random-looking domain label → composite rule fires', () => {
    // "wlikqkgi" satisfies isRandomLookingLabel (length >= 6, entropy >= 2.3, low vowels)
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [dkimPassAligned('mx.example.com', 'wlikqkgi.example.com')],
      senderDomain: 'wlikqkgi.example.com',
    });
    const reason = r.scoreReasons.find(s => s.key === 'composite.authAlignedRandomDomain');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_COMPOSITE_SCORES.authAlignedRandomDomain);
    expect(reason.matchedLabel).toBe('wlikqkgi');
  });

  test('does not fire when no auth is aligned', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [arEntry('mx.example.com', [
        dkimResult('pass', 'mailer.example.net'), // unaligned
      ])],
      senderDomain: 'wlikqkgi.example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.authAlignedRandomDomain'))
      .toBeUndefined();
  });

  test('does not fire when domain label is not random-looking', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [dkimPassAligned('mx.example.com', 'example.com')],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.authAlignedRandomDomain'))
      .toBeUndefined();
  });

  test('fires with SPF alignment as well as DKIM', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [spfPassAligned('mx.example.com', 'wlikqkgi.example.com')],
      senderDomain: 'wlikqkgi.example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.authAlignedRandomDomain'))
      .toBeDefined();
  });

  test('scoreReason includes domain and matchedLabel', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [dkimPassAligned('mx.example.com', 'wlikqkgi.example.com')],
      senderDomain: 'wlikqkgi.example.com',
    });
    const reason = r.scoreReasons.find(s => s.key === 'composite.authAlignedRandomDomain');
    expect(reason).toMatchObject({ domain: 'wlikqkgi.example.com', matchedLabel: 'wlikqkgi' });
  });

  test('scores only once even if multiple domain labels are random-looking', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [dkimPassAligned('mx.example.com', 'wlikqkgi.ztxqrbn.example.com')],
      senderDomain: 'wlikqkgi.ztxqrbn.example.com',
    });
    const reasons = r.scoreReasons.filter(s => s.key === 'composite.authAlignedRandomDomain');
    expect(reasons).toHaveLength(1);
  });
});

describe('scoreMessage — Layer 4 pass-only alignment (P2 regression)', () => {
  // Verifies that non-pass SPF/DKIM results with aligned domains do NOT trigger
  // composite scoring even though their smtp.mailfrom / header.d matches From.
  const baseL4 = {
    trustedDomains: [trustedExact('mx.example.com')],
    senderDomainRules: [],

    authScores: DEFAULT_AUTH_SCORES,
    heuristicScores: { randomFromDomainLabel: 0, randomFromLocalPart: 0, layer3Cap: 0 },
  };

  test('spf=fail with aligned smtp.mailfrom does not fire spfAlignedDkimUnalignedRandomLocal', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [arEntry('mx.example.com', [spfResult('fail', 'sender@example.com')])],
      senderDomain: 'example.com',
      senderLocalPart: 'xkqrtbvz',
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.spfAlignedDkimUnalignedRandomLocal'))
      .toBeUndefined();
  });

  test('spf=softfail with aligned smtp.mailfrom does not fire spfAlignedDkimUnalignedRandomLocal', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [arEntry('mx.example.com', [spfResult('softfail', 'sender@example.com')])],
      senderDomain: 'example.com',
      senderLocalPart: 'xkqrtbvz',
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.spfAlignedDkimUnalignedRandomLocal'))
      .toBeUndefined();
  });

  test('dkim=fail with aligned domain does not fire authAlignedRandomDomain', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [arEntry('mx.example.com', [dkimResult('fail', 'wlikqkgi.example.com')])],
      senderDomain: 'wlikqkgi.example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.authAlignedRandomDomain'))
      .toBeUndefined();
  });

  test('second trusted AR with spf=pass aligned fires rule even when first was spf=fail aligned', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [
        arEntry('mx1.example.com', [spfResult('fail', 'sender@example.com')]),
        arEntry('mx2.example.com', [spfResult('pass', 'sender@example.com')]),
      ],
      trustedDomains: [trustedExact('mx1.example.com'), trustedExact('mx2.example.com')],
      senderDomain: 'example.com',
      senderLocalPart: 'xkqrtbvz',
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.spfAlignedDkimUnalignedRandomLocal'))
      .toBeDefined();
  });
});

describe('recalculateScoreReasons — composite keys', () => {
  test('composite reason preserves stored delta (not yet user-configurable)', () => {
    const entry = {
      score: 30,
      scoreReasons: [{
        key: 'composite.spfAlignedDkimUnalignedRandomLocal',
        label: 'SPF aligned, DKIM unaligned, random local part',
        delta: 30,
        localPart: 'xkqrtbvz',
      }],
    };
    const [r] = recalculateScoreReasons(entry);
    expect(r.currentDelta).toBe(30);
    expect(r.deltaChanged).toBe(false);
  });

  test('composite.authAlignedRandomDomain preserves stored delta', () => {
    const entry = {
      score: 40,
      scoreReasons: [{
        key: 'composite.authAlignedRandomDomain',
        label: 'Auth-aligned sender with random-looking domain',
        delta: 40,
        domain: 'wlikqkgi.example.com',
        matchedLabel: 'wlikqkgi',
      }],
    };
    const [r] = recalculateScoreReasons(entry);
    expect(r.currentDelta).toBe(40);
    expect(r.deltaChanged).toBe(false);
  });

  test('composite.thirdPartyAuthRandomLocal preserves stored delta', () => {
    const entry = {
      score: 25,
      scoreReasons: [{
        key: 'composite.thirdPartyAuthRandomLocal',
        label: 'Third-party auth pass with random local part, no alignment',
        delta: 25,
        localPart: 'xkqrtbvz',
      }],
    };
    const [r] = recalculateScoreReasons(entry);
    expect(r.currentDelta).toBe(25);
    expect(r.deltaChanged).toBe(false);
  });
});

// ── Layer 4: composite.thirdPartyAuthRandomLocal ──────────────────────────────

describe('DEFAULT_COMPOSITE_SCORES — thirdPartyAuthRandomLocal', () => {
  test('thirdPartyAuthRandomLocal defaults to 25', () =>
    expect(DEFAULT_COMPOSITE_SCORES.thirdPartyAuthRandomLocal).toBe(25));
});

describe('labelForScoreKey — composite.thirdPartyAuthRandomLocal', () => {
  test('returns human label', () =>
    expect(labelForScoreKey('composite.thirdPartyAuthRandomLocal'))
      .toBe('Third-party auth pass with random local part, no alignment'));
});

describe('scoreMessage — Layer 4 composite.thirdPartyAuthRandomLocal', () => {
  // Zero Layer 2 and Layer 3 to isolate the Layer 4 composite signal.
  const baseL4 = {
    trustedDomains: [trustedExact('mx.delivery.net')],
    senderDomainRules: [],

    authScores: DEFAULT_AUTH_SCORES,
    heuristicScores: { randomFromDomainLabel: 0, randomFromLocalPart: 0, layer3Cap: 0 },
    layer2Scores: { spfMailFromMismatch: 0, dkimDomainMismatch: 0, dmarcNoneWithThirdPartyAuth: 0 },
  };

  // SPF pass for delivery.net (unaligned with From example.com) + random local
  const thirdPartySpfPass = arEntry('mx.delivery.net', [
    spfResult('pass', 'bounce@delivery.net'),
  ]);

  // DKIM pass for delivery.net (unaligned with From example.com) + random local
  const thirdPartyDkimPass = arEntry('mx.delivery.net', [
    dkimResult('pass', 'delivery.net'),
  ]);

  test('trusted SPF pass unaligned + random local >= 7 → rule fires', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [thirdPartySpfPass],
      senderDomain: 'example.com',
      senderLocalPart: 'xkqrtbvz',
    });
    const reason = r.scoreReasons.find(s => s.key === 'composite.thirdPartyAuthRandomLocal');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_COMPOSITE_SCORES.thirdPartyAuthRandomLocal);
    expect(r.score).toBe(DEFAULT_COMPOSITE_SCORES.thirdPartyAuthRandomLocal);
  });

  test('trusted DKIM pass unaligned + random local >= 7 → rule fires', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [thirdPartyDkimPass],
      senderDomain: 'example.com',
      senderLocalPart: 'xkqrtbvz',
    });
    const reason = r.scoreReasons.find(s => s.key === 'composite.thirdPartyAuthRandomLocal');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_COMPOSITE_SCORES.thirdPartyAuthRandomLocal);
  });

  test('does not fire when any auth is aligned', () => {
    // SPF pass aligned with From example.com
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [spfPassAligned('mx.delivery.net', 'example.com')],
      senderDomain: 'example.com',
      senderLocalPart: 'xkqrtbvz',
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.thirdPartyAuthRandomLocal'))
      .toBeUndefined();
  });

  test('does not fire when DKIM is aligned', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [dkimPassAligned('mx.delivery.net', 'example.com')],
      senderDomain: 'example.com',
      senderLocalPart: 'xkqrtbvz',
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.thirdPartyAuthRandomLocal'))
      .toBeUndefined();
  });

  test('does not fire when local part is too short (< 7 chars)', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [thirdPartySpfPass],
      senderDomain: 'example.com',
      senderLocalPart: 'info',
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.thirdPartyAuthRandomLocal'))
      .toBeUndefined();
  });

  test('does not fire when local part is not random-looking', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [thirdPartySpfPass],
      senderDomain: 'example.com',
      senderLocalPart: 'noreply',
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.thirdPartyAuthRandomLocal'))
      .toBeUndefined();
  });

  test('does not fire when no trusted auth pass exists', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [],
      senderDomain: 'example.com',
      senderLocalPart: 'xkqrtbvz',
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.thirdPartyAuthRandomLocal'))
      .toBeUndefined();
  });

  test('does not fire when only untrusted auth pass exists', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [arEntry('mx.untrusted.net', [spfResult('pass', 'bounce@untrusted.net')])],
      senderDomain: 'example.com',
      senderLocalPart: 'xkqrtbvz',
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.thirdPartyAuthRandomLocal'))
      .toBeUndefined();
  });

  test('scoreReason includes localPart field', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [thirdPartySpfPass],
      senderDomain: 'example.com',
      senderLocalPart: 'xkqrtbvz',
    });
    const reason = r.scoreReasons.find(s => s.key === 'composite.thirdPartyAuthRandomLocal');
    expect(reason).toMatchObject({ localPart: 'xkqrtbvz' });
  });

  test('configurable score is applied correctly', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [thirdPartySpfPass],
      senderDomain: 'example.com',
      senderLocalPart: 'xkqrtbvz',
      compositeScores: { thirdPartyAuthRandomLocal: 30 },
    });
    const reason = r.scoreReasons.find(s => s.key === 'composite.thirdPartyAuthRandomLocal');
    expect(reason.delta).toBe(30);
    expect(r.score).toBe(30);
  });
});

// ── Layer 4: composite.dkimAlignedLexicalMitigation ──────────────────────────

describe('scoreMessage — Layer 4 composite.dkimAlignedLexicalMitigation', () => {
  // Delegated newsletter route: DKIM aligned, SPF via ESP (not aligned).
  const baseL4 = {
    trustedDomains: [trustedExact('mx.brand.com')],
    senderDomainRules: [],

    authScores: DEFAULT_AUTH_SCORES,
    layer2Scores: { spfMailFromMismatch: 0, dkimDomainMismatch: 0, dmarcNoneWithThirdPartyAuth: 0 },
  };

  // AR entry with DKIM aligned to brand.com + SPF via esp.com (delegated, not aligned).
  const delegatedNewsletterAr = arEntry('mx.brand.com', [
    dkimResult('pass', 'newsletter.brand.com'),
    spfResult('pass', 'bounce@esp.com'),
  ]);

  test('mitigation does not apply when lexical heuristic scores are disabled (delta=0)', () => {
    // xkqrtbvz is random-looking (>= 7 chars) so Layer 3 *would* emit a reason,
    // but with randomFromLocalPart=0 the delta is 0 — hasLexicalPenalty must be false.
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [delegatedNewsletterAr],
      senderDomain: 'newsletter.brand.com',
      senderLocalPart: 'xkqrtbvz',
      messageIdDomain: 'smtp.esp.com',
      heuristicScores: { randomFromDomainLabel: 0, randomFromLocalPart: 0, layer3Cap: 0 },
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.dkimAlignedLexicalMitigation'))
      .toBeUndefined();
  });

  test('mitigation applies when lexical heuristic scores are positive (delta>0) and list headers present', () => {
    // Same scenario but with positive heuristic scores and list headers — mitigation should fire.
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [delegatedNewsletterAr],
      senderDomain: 'newsletter.brand.com',
      senderLocalPart: 'xkqrtbvz',
      messageIdDomain: 'smtp.esp.com',
      heuristicScores: { randomFromDomainLabel: 30, randomFromLocalPart: 10, layer3Cap: 40 },
      headerMetrics: { hasListHeaders: true },
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.dkimAlignedLexicalMitigation'))
      .toBeDefined();
  });

  test('mitigation does not apply without list headers even when lexical heuristic scores are positive', () => {
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [delegatedNewsletterAr],
      senderDomain: 'newsletter.brand.com',
      senderLocalPart: 'xkqrtbvz',
      messageIdDomain: 'smtp.esp.com',
      heuristicScores: { randomFromDomainLabel: 30, randomFromLocalPart: 10, layer3Cap: 40 },
      headerMetrics: { hasListHeaders: false },
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.dkimAlignedLexicalMitigation'))
      .toBeUndefined();
  });

  test('mitigation does not apply when layer3Cap is 0 even if heuristic scores are positive', () => {
    // Heuristic deltas are non-zero but layer3Cap=0 clamps layer3.score to 0,
    // so the lexical penalty did not actually affect the total — mitigation must not fire.
    const r = scoreMessage({
      ...baseL4,
      parsedAuthResults: [delegatedNewsletterAr],
      senderDomain: 'newsletter.brand.com',
      senderLocalPart: 'xkqrtbvz',
      messageIdDomain: 'smtp.esp.com',
      heuristicScores: { randomFromDomainLabel: 30, randomFromLocalPart: 10, layer3Cap: 0 },
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.dkimAlignedLexicalMitigation'))
      .toBeUndefined();
  });
});

// ── recalculateScoreReasons — composite.* ─────────────────────────────────────

describe('recalculateScoreReasons — composite.* with compositeScores', () => {
  test('recalculates composite delta from compositeScores', () => {
    const entry = {
      score: 30,
      scoreReasons: [{ key: 'composite.spfAlignedDkimUnalignedRandomLocal', label: 'SPF aligned, DKIM unaligned, random local part', delta: 30 }],
    };
    const [r] = recalculateScoreReasons(entry, { compositeScores: { spfAlignedDkimUnalignedRandomLocal: 40 } });
    expect(r.currentDelta).toBe(40);
    expect(r.deltaChanged).toBe(true);
  });

  test('falls back to DEFAULT_COMPOSITE_SCORES when compositeScores absent', () => {
    const entry = {
      score: 30,
      scoreReasons: [{ key: 'composite.spfAlignedDkimUnalignedRandomLocal', delta: 30 }],
    };
    const [r] = recalculateScoreReasons(entry);
    expect(r.currentDelta).toBe(DEFAULT_COMPOSITE_SCORES.spfAlignedDkimUnalignedRandomLocal);
    expect(r.deltaChanged).toBe(false);
  });

  test('unchanged composite score → deltaChanged false', () => {
    const entry = {
      score: 25,
      scoreReasons: [{ key: 'composite.authAlignedRandomDomain', delta: 25 }],
    };
    const [r] = recalculateScoreReasons(entry, { compositeScores: { authAlignedRandomDomain: 25 } });
    expect(r.deltaChanged).toBe(false);
  });

  test('partial compositeScores: overrides only specified key, others use defaults', () => {
    const entry = {
      score: 55,
      scoreReasons: [
        { key: 'composite.spfAlignedDkimUnalignedRandomLocal', delta: 30 },
        { key: 'composite.authAlignedRandomDomain', delta: 40 },
      ],
    };
    const reasons = recalculateScoreReasons(entry, { compositeScores: { spfAlignedDkimUnalignedRandomLocal: 50 } });
    expect(reasons[0].currentDelta).toBe(50);
    expect(reasons[0].deltaChanged).toBe(true);
    // authAlignedRandomDomain not overridden → uses DEFAULT_COMPOSITE_SCORES value
    expect(reasons[1].currentDelta).toBe(DEFAULT_COMPOSITE_SCORES.authAlignedRandomDomain);
    expect(reasons[1].deltaChanged).toBe(false);
  });

  test('all implemented composite keys are recalculated', () => {
    const compositeKeys = [
      'composite.spfAlignedDkimUnalignedRandomLocal',
      'composite.authAlignedRandomDomain',
      'composite.thirdPartyAuthRandomLocal',
      'composite.messageIdMismatchWithUnalignedAuth',
      'composite.fromSenderMismatchWithUnalignedAuth',
      'composite.deepRandomFromSubdomain',
    ];
    const compositeScores = {
      spfAlignedDkimUnalignedRandomLocal: 10,
      authAlignedRandomDomain: 11,
      thirdPartyAuthRandomLocal: 12,
      messageIdMismatchWithUnalignedAuth: 13,
      fromSenderMismatchWithUnalignedAuth: 14,
      deepRandomFromSubdomain: 15,
    };
    const entry = {
      score: 0,
      scoreReasons: compositeKeys.map((key, i) => ({ key, delta: i + 1 })),
    };
    const reasons = recalculateScoreReasons(entry, { compositeScores });
    const expected = [10, 11, 12, 13, 14, 15];
    reasons.forEach((r, i) => {
      expect(r.currentDelta).toBe(expected[i]);
      expect(r.deltaChanged).toBe(true);
    });
  });

  test('composite.deepRandomFromSubdomain recalculates from compositeScores', () => {
    const entry = {
      score: 25,
      scoreReasons: [{ key: 'composite.deepRandomFromSubdomain', delta: 25 }],
    };
    const [r] = recalculateScoreReasons(entry, { compositeScores: { deepRandomFromSubdomain: 30 } });
    expect(r.currentDelta).toBe(30);
    expect(r.deltaChanged).toBe(true);
  });
});

describe('recalculateLogEntry — composite.* with compositeScores', () => {
  test('changing compositeScores reflects in currentScore and reasonDiffs', () => {
    const entry = {
      score: 30,
      classification: 'normal',
      scoreReasons: [{ key: 'composite.authAlignedRandomDomain', delta: 25 }],
    };
    const r = recalculateLogEntry(entry, { compositeScores: { authAlignedRandomDomain: 40 } });
    expect(r.currentScore).toBe(40);
    expect(r.reasonDiffs).toContainEqual(
      expect.objectContaining({ key: 'composite.authAlignedRandomDomain', originalDelta: 25, currentDelta: 40 }),
    );
  });
});

// ── recalculateScoreReasons — composite.dkimAlignedLexicalMitigation gate ────

describe('recalculateScoreReasons — composite.dkimAlignedLexicalMitigation lexical gate', () => {
  // Entry with both a lexical heuristic reason and the mitigation reason stored.
  const entryWithLexical = {
    score: -20,
    scoreReasons: [
      { key: 'heuristic.randomFromLocalPart', delta: 10 },
      { key: 'composite.dkimAlignedLexicalMitigation', delta: -30 },
    ],
  };

  test('preserves stored mitigation delta when lexical heuristic is still active', () => {
    const [, r] = recalculateScoreReasons(entryWithLexical, {
      heuristicScores: { randomFromLocalPart: 10, randomFromDomainLabel: 0, layer3Cap: 50 },
      compositeScores: { dkimAlignedLexicalMitigation: -30 },
    });
    expect(r.key).toBe('composite.dkimAlignedLexicalMitigation');
    expect(r.currentDelta).toBe(-30);
  });

  test('zeroes mitigation currentDelta when randomFromLocalPart score is set to 0', () => {
    const [, r] = recalculateScoreReasons(entryWithLexical, {
      heuristicScores: { randomFromLocalPart: 0, randomFromDomainLabel: 0, layer3Cap: 50 },
      compositeScores: { dkimAlignedLexicalMitigation: -30 },
    });
    expect(r.key).toBe('composite.dkimAlignedLexicalMitigation');
    expect(r.currentDelta).toBe(0);
    expect(r.deltaChanged).toBe(true);
  });

  test('zeroes mitigation currentDelta when layer3Cap is 0', () => {
    const [, r] = recalculateScoreReasons(entryWithLexical, {
      heuristicScores: { randomFromLocalPart: 10, randomFromDomainLabel: 0, layer3Cap: 0 },
      compositeScores: { dkimAlignedLexicalMitigation: -30 },
    });
    expect(r.key).toBe('composite.dkimAlignedLexicalMitigation');
    expect(r.currentDelta).toBe(0);
    expect(r.deltaChanged).toBe(true);
  });

  test('uses configured composite score when lexical penalty is active', () => {
    const [, r] = recalculateScoreReasons(entryWithLexical, {
      heuristicScores: { randomFromLocalPart: 10, randomFromDomainLabel: 0, layer3Cap: 50 },
      compositeScores: { dkimAlignedLexicalMitigation: -15 },
    });
    expect(r.currentDelta).toBe(-15);
  });

  test('mitigation stored without lexical reason — still gates to 0 when heuristics disabled', () => {
    // Edge case: old log entry has only the mitigation stored, no heuristic reason.
    const entryMitigationOnly = {
      score: -30,
      scoreReasons: [{ key: 'composite.dkimAlignedLexicalMitigation', delta: -30 }],
    };
    const [r] = recalculateScoreReasons(entryMitigationOnly, {
      heuristicScores: { randomFromLocalPart: 0, randomFromDomainLabel: 0, layer3Cap: 50 },
      compositeScores: { dkimAlignedLexicalMitigation: -30 },
    });
    expect(r.currentDelta).toBe(0);
  });
});

// ── Issue #214: Mailing-list false-positive mitigation ───────────────────────

describe('scoreMessage — issue #214: SPF MAIL FROM mismatch gated by DKIM alignment', () => {
  const baseL2 = {
    trustedDomains: [trustedExact('mx.example.com')],
    senderDomainRules: [],
    authScores: DEFAULT_AUTH_SCORES,
    heuristicScores: { randomFromDomainLabel: 0, randomFromLocalPart: 0, layer3Cap: 0 },
  };

  test('SPF MAIL FROM mismatch does NOT score when an aligned DKIM pass exists', () => {
    // Brand sends via ESP: DKIM aligned with brand, SPF aligned with ESP (mismatch).
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dmarc', result: 'pass', properties: {} },
        spfResult('pass', 'bounce@esp.net'),
        dkimResult('pass', 'example.com'),
      ])],
      senderDomain: 'example.com',
    });
    expect(r.scoreReasons.find(s => s.key === 'identity.spfMailFromMismatch')).toBeUndefined();
    expect(r.score).toBe(0);
  });

  test('SPF MAIL FROM mismatch DOES score when no aligned DKIM pass exists', () => {
    // Only SPF from ESP — no DKIM aligned with brand.
    const r = scoreMessage({
      ...baseL2,
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dmarc', result: 'pass', properties: {} },
        spfResult('pass', 'bounce@esp.net'),
      ])],
      senderDomain: 'example.com',
    });
    const reason = r.scoreReasons.find(s => s.key === 'identity.spfMailFromMismatch');
    expect(reason).toBeDefined();
    expect(reason.delta).toBe(DEFAULT_LAYER2_SCORES.spfMailFromMismatch);
  });
});

describe('scoreMessage — issue #214: legitimate mailing-list message stays below Review', () => {
  const trustedDomains = [trustedExact('mx.example.com')];

  // Scenario: legitimate mailing-list message
  //   - DMARC fail (list rewrites break DMARC)
  //   - SPF MAIL FROM mismatch (ESP sends on behalf)
  //   - DKIM aligned with brand From domain
  //   - List-Id and List-Unsubscribe headers present
  // Expected: score below Review (50) because:
  //   - auth.dmarc.fail (+15) is mitigated by composite.dmarcFailDkimAlignedListMitigation (-15)
  //   - identity.spfMailFromMismatch is suppressed (anyDkimAligned = true)
  test('DMARC fail + SPF mismatch + DKIM aligned + list headers → score below Review', () => {
    const r = scoreMessage({
      trustedDomains,
      senderDomain: 'brand.example.com',
      senderLocalPart: 'newsletter',
      senderDomainRules: [],
      authScores: DEFAULT_AUTH_SCORES,
      heuristicScores: { randomFromDomainLabel: 0, randomFromLocalPart: 0, layer3Cap: 0 },
      headerMetrics: { hasListHeaders: true },
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dmarc', result: 'fail', properties: {} },
        spfResult('pass', 'bounce@esp.net'),
        dkimResult('pass', 'brand.example.com'),
      ])],
    });
    expect(r.score).toBeLessThan(50);
    expect(r.classification).toBe('normal');
    // DMARC fail should be present but mitigated
    expect(r.scoreReasons.find(s => s.key === 'auth.dmarc.fail')).toBeDefined();
    expect(r.scoreReasons.find(s => s.key === 'composite.dmarcFailDkimAlignedListMitigation')).toBeDefined();
    // SPF mismatch should not appear (suppressed by DKIM alignment)
    expect(r.scoreReasons.find(s => s.key === 'identity.spfMailFromMismatch')).toBeUndefined();
  });

  test('DMARC fail without DKIM alignment and no list headers → still scores (not mitigated)', () => {
    const r = scoreMessage({
      trustedDomains,
      senderDomain: 'brand.example.com',
      senderDomainRules: [],
      authScores: DEFAULT_AUTH_SCORES,
      heuristicScores: { randomFromDomainLabel: 0, randomFromLocalPart: 0, layer3Cap: 0 },
      headerMetrics: { hasListHeaders: false },
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dmarc', result: 'fail', properties: {} },
        spfResult('pass', 'bounce@esp.net'),
      ])],
    });
    // DMARC fail scores; no mitigation fires
    const dmarcReason = r.scoreReasons.find(s => s.key === 'auth.dmarc.fail');
    expect(dmarcReason).toBeDefined();
    expect(dmarcReason.delta).toBe(DEFAULT_AUTH_SCORES.dmarc.fail);
    expect(r.scoreReasons.find(s => s.key === 'composite.dmarcFailDkimAlignedListMitigation')).toBeUndefined();
    expect(r.score).toBeGreaterThan(0);
  });

  test('DMARC fail with DKIM aligned but no list headers → mitigation does not fire', () => {
    const r = scoreMessage({
      trustedDomains,
      senderDomain: 'brand.example.com',
      senderDomainRules: [],
      authScores: DEFAULT_AUTH_SCORES,
      heuristicScores: { randomFromDomainLabel: 0, randomFromLocalPart: 0, layer3Cap: 0 },
      headerMetrics: { hasListHeaders: false },
      parsedAuthResults: [arEntry('mx.example.com', [
        { method: 'dmarc', result: 'fail', properties: {} },
        dkimResult('pass', 'brand.example.com'),
      ])],
    });
    expect(r.scoreReasons.find(s => s.key === 'composite.dmarcFailDkimAlignedListMitigation')).toBeUndefined();
    const dmarcReason = r.scoreReasons.find(s => s.key === 'auth.dmarc.fail');
    expect(dmarcReason).toBeDefined();
  });
});
