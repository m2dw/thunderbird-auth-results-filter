import {
  migrateScoreDefaults,
  SCORE_DEFAULTS_VERSION,
  KNOWN_SCORE_PROFILES,
} from '../src/modules/scoreDefaultsMigration.js';
import { DEFAULT_HEURISTIC_SCORES } from '../src/core/heuristics.js';
import { DEFAULT_COMPOSITE_SCORES } from '../src/core/compositeRules.js';
import { DEFAULT_AUTH_SCORES, DEFAULT_LAYER2_SCORES } from '../src/core/scoring.js';

const PRE_V022_PROFILE = KNOWN_SCORE_PROFILES.find(p => p.version === 'pre-v0.2.2');
const V0_PROFILE = KNOWN_SCORE_PROFILES.find(p => p.version === 'v0');
const V0_DMARC25_PROFILE = KNOWN_SCORE_PROFILES.find(p => p.version === 'v0-dmarc25');
const V033_PROFILE = KNOWN_SCORE_PROFILES.find(p => p.version === 'v0.3.3');
const V1_PROFILE = KNOWN_SCORE_PROFILES.find(p => p.version === 'v1');
const V2_PROFILE = KNOWN_SCORE_PROFILES.find(p => p.version === 'v2');

describe('SCORE_DEFAULTS_VERSION', () => {
  test('is v3', () => expect(SCORE_DEFAULTS_VERSION).toBe('v3'));
});

describe('KNOWN_SCORE_PROFILES', () => {
  test('contains a pre-v0.2.2 entry', () => {
    expect(PRE_V022_PROFILE).toBeDefined();
  });

  test('pre-v0.2.2 authScores.dmarc.fail is 50', () => {
    expect(PRE_V022_PROFILE.authScores.dmarc.fail).toBe(50);
  });

  test('pre-v0.2.2 authScores.spf.fail is 50', () => {
    expect(PRE_V022_PROFILE.authScores.spf.fail).toBe(50);
  });

  test('contains a v0 entry', () => {
    expect(V0_PROFILE).toBeDefined();
  });

  test('v0 heuristicScores.randomFromDomainLabel is 20', () => {
    expect(V0_PROFILE.heuristicScores.randomFromDomainLabel).toBe(20);
  });

  test('v0 compositeScores.authAlignedRandomDomain is 25', () => {
    expect(V0_PROFILE.compositeScores.authAlignedRandomDomain).toBe(25);
  });

  test('v0 compositeScores has exactly the five keys present before later composite rules were added', () => {
    expect(Object.keys(V0_PROFILE.compositeScores).sort()).toEqual([
      'authAlignedRandomDomain',
      'fromSenderMismatchWithUnalignedAuth',
      'messageIdMismatchWithUnalignedAuth',
      'spfAlignedDkimUnalignedRandomLocal',
      'thirdPartyAuthRandomLocal',
    ]);
  });

  test('v0 authScores.dmarc.fail is 40 (pre-tuning default)', () => {
    expect(V0_PROFILE.authScores.dmarc.fail).toBe(40);
  });

  test('v0 authScores.dmarc.none is 10 (pre-tuning default)', () => {
    expect(V0_PROFILE.authScores.dmarc.none).toBe(10);
  });

  test('current DEFAULT_HEURISTIC_SCORES differs from v0', () => {
    expect(DEFAULT_HEURISTIC_SCORES.randomFromDomainLabel).not.toBe(
      V0_PROFILE.heuristicScores.randomFromDomainLabel,
    );
  });

  test('current DEFAULT_COMPOSITE_SCORES differs from v0', () => {
    expect(DEFAULT_COMPOSITE_SCORES.authAlignedRandomDomain).not.toBe(
      V0_PROFILE.compositeScores.authAlignedRandomDomain,
    );
  });

  test('contains a v0.3.3 entry', () => {
    expect(V033_PROFILE).toBeDefined();
  });

  test('v0.3.3 heuristicScores.randomFromDomainLabel is 30', () => {
    expect(V033_PROFILE.heuristicScores.randomFromDomainLabel).toBe(30);
  });

  test('v0.3.3 layer2Scores.spfMailFromMismatch is 15', () => {
    expect(V033_PROFILE.layer2Scores.spfMailFromMismatch).toBe(15);
  });

  test('v0.3.3 authScores.dmarc.fail is 20', () => {
    expect(V033_PROFILE.authScores.dmarc.fail).toBe(20);
  });

  test('v0.3.3 authScores.spf.fail is 60', () => {
    expect(V033_PROFILE.authScores.spf.fail).toBe(60);
  });

  test('v0.3.3 authScores.dkim.fail is 25', () => {
    expect(V033_PROFILE.authScores.dkim.fail).toBe(25);
  });

  test('current DEFAULT_HEURISTIC_SCORES differs from v0.3.3', () => {
    expect(DEFAULT_HEURISTIC_SCORES.randomFromDomainLabel).not.toBe(
      V033_PROFILE.heuristicScores.randomFromDomainLabel,
    );
  });

  test('current DEFAULT_LAYER2_SCORES differs from v0.3.3', () => {
    expect(DEFAULT_LAYER2_SCORES.spfMailFromMismatch).not.toBe(
      V033_PROFILE.layer2Scores.spfMailFromMismatch,
    );
  });
});

describe('migrateScoreDefaults — already at current version', () => {
  test('returns unchanged settings when scoreDefaultsVersion matches current', () => {
    const settings = {
      scoreDefaultsVersion: SCORE_DEFAULTS_VERSION,
      heuristicScores: { ...DEFAULT_HEURISTIC_SCORES },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(false);
    expect(result).toBe(settings);
  });

  test('does not return early when scoreDefaultsVersion is v1 (old version)', () => {
    const settings = {
      scoreDefaultsVersion: 'v1',
      layer2Scores: { ...V1_PROFILE.layer2Scores },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.layer2Scores).toEqual(DEFAULT_LAYER2_SCORES);
  });
});

describe('migrateScoreDefaults — no scoreDefaultsVersion (old user)', () => {
  test('migrates heuristicScores when they exactly match v0 profile', () => {
    const settings = {
      heuristicScores: { ...V0_PROFILE.heuristicScores },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.heuristicScores).toEqual(DEFAULT_HEURISTIC_SCORES);
  });

  test('migrates compositeScores when they exactly match v0 profile', () => {
    const settings = {
      compositeScores: { ...V0_PROFILE.compositeScores },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.compositeScores).toEqual(DEFAULT_COMPOSITE_SCORES);
  });

  test('migrates both groups when both match v0 profile', () => {
    const settings = {
      heuristicScores: { ...V0_PROFILE.heuristicScores },
      compositeScores: { ...V0_PROFILE.compositeScores },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.heuristicScores).toEqual(DEFAULT_HEURISTIC_SCORES);
    expect(result.compositeScores).toEqual(DEFAULT_COMPOSITE_SCORES);
  });

  test('stamps scoreDefaultsVersion after migration', () => {
    const settings = {
      heuristicScores: { ...V0_PROFILE.heuristicScores },
    };
    const { settings: result } = migrateScoreDefaults(settings);
    expect(result.scoreDefaultsVersion).toBe(SCORE_DEFAULTS_VERSION);
  });

  test('stamps scoreDefaultsVersion even when no migration occurs', () => {
    const settings = {
      heuristicScores: { randomFromDomainLabel: 99, randomFromLocalPart: 10, layer3Cap: 40 },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(false);
    expect(result.scoreDefaultsVersion).toBe(SCORE_DEFAULTS_VERSION);
  });

  test('does not migrate heuristicScores when one value is user-customized', () => {
    const settings = {
      heuristicScores: {
        ...V0_PROFILE.heuristicScores,
        randomFromDomainLabel: 15,
      },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(result.heuristicScores.randomFromDomainLabel).toBe(15);
    expect(migrated).toBe(false);
  });

  test('does not migrate compositeScores when one value is user-customized', () => {
    const settings = {
      compositeScores: {
        ...V0_PROFILE.compositeScores,
        authAlignedRandomDomain: 99,
      },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(result.compositeScores.authAlignedRandomDomain).toBe(99);
    expect(migrated).toBe(false);
  });

  test('migrates compositeScores independently of heuristicScores customization', () => {
    const settings = {
      heuristicScores: { randomFromDomainLabel: 5, randomFromLocalPart: 10, layer3Cap: 40 },
      compositeScores: { ...V0_PROFILE.compositeScores },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.heuristicScores.randomFromDomainLabel).toBe(5);
    expect(result.compositeScores).toEqual(DEFAULT_COMPOSITE_SCORES);
  });

  test('does not migrate when score groups are absent (no stored scores)', () => {
    const settings = { moveToReview: true };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(false);
    expect(result.scoreDefaultsVersion).toBe(SCORE_DEFAULTS_VERSION);
    expect(result.heuristicScores).toBeUndefined();
    expect(result.compositeScores).toBeUndefined();
  });

  test('migrates compositeScores even when stored keys are in a different order', () => {
    // Simulate a stored object whose keys were inserted in a different order
    // than KNOWN_SCORE_PROFILES (e.g. thirdPartyAuthRandomLocal before spfAligned…).
    const reordered = {};
    const v0 = V0_PROFILE.compositeScores;
    // Insert thirdPartyAuthRandomLocal first, then the rest.
    reordered.thirdPartyAuthRandomLocal = v0.thirdPartyAuthRandomLocal;
    for (const [k, val] of Object.entries(v0)) {
      if (k !== 'thirdPartyAuthRandomLocal') reordered[k] = val;
    }
    const settings = { compositeScores: reordered };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.compositeScores).toEqual(DEFAULT_COMPOSITE_SCORES);
  });

  test('migrates authScores when they match pre-v0.2.2 profile (dmarc.fail=50, spf.fail=50)', () => {
    const storedAuth = {
      dmarc: { ...PRE_V022_PROFILE.authScores.dmarc },
      spf: { ...PRE_V022_PROFILE.authScores.spf },
      dkim: { ...PRE_V022_PROFILE.authScores.dkim },
    };
    const settings = { authScores: storedAuth };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.authScores).toEqual(DEFAULT_AUTH_SCORES);
    expect(result.authScores.dmarc.fail).toBe(DEFAULT_AUTH_SCORES.dmarc.fail);
  });

  test('does not migrate authScores for pre-v0.2.2 when dmarc is user-customized', () => {
    const settings = {
      authScores: {
        dmarc: { ...PRE_V022_PROFILE.authScores.dmarc, fail: 99 },
        spf: { ...PRE_V022_PROFILE.authScores.spf },
        dkim: { ...PRE_V022_PROFILE.authScores.dkim },
      },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(result.authScores.dmarc.fail).toBe(99);
    expect(migrated).toBe(false);
  });

  test('does not mutate the input settings object', () => {
    const settings = {
      heuristicScores: { ...V0_PROFILE.heuristicScores },
    };
    const original = JSON.stringify(settings);
    migrateScoreDefaults(settings);
    expect(JSON.stringify(settings)).toBe(original);
  });

  test('migrated heuristicScores is a new object, not DEFAULT_HEURISTIC_SCORES reference', () => {
    const settings = { heuristicScores: { ...V0_PROFILE.heuristicScores } };
    const { settings: result } = migrateScoreDefaults(settings);
    expect(result.heuristicScores).not.toBe(DEFAULT_HEURISTIC_SCORES);
    expect(result.heuristicScores).toEqual(DEFAULT_HEURISTIC_SCORES);
  });

  test('migrates authScores when they exactly match v0 profile', () => {
    const storedAuth = {
      dmarc: { ...V0_PROFILE.authScores.dmarc },
      spf: { ...V0_PROFILE.authScores.spf },
      dkim: { ...V0_PROFILE.authScores.dkim },
    };
    const settings = { authScores: storedAuth };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.authScores).toEqual(DEFAULT_AUTH_SCORES);
  });

  test('does not migrate authScores when dmarc is user-customized', () => {
    const settings = {
      authScores: {
        dmarc: { ...V0_PROFILE.authScores.dmarc, fail: 99 },
        spf: { ...V0_PROFILE.authScores.spf },
        dkim: { ...V0_PROFILE.authScores.dkim },
      },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(result.authScores.dmarc.fail).toBe(99);
    expect(migrated).toBe(false);
  });

  test('migrates authScores independently of compositeScores customization', () => {
    const settings = {
      compositeScores: { ...V0_PROFILE.compositeScores, authAlignedRandomDomain: 99 },
      authScores: {
        dmarc: { ...V0_PROFILE.authScores.dmarc },
        spf: { ...V0_PROFILE.authScores.spf },
        dkim: { ...V0_PROFILE.authScores.dkim },
      },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.compositeScores.authAlignedRandomDomain).toBe(99);
    expect(result.authScores).toEqual(DEFAULT_AUTH_SCORES);
  });

  test('migrates authScores when they match v0-dmarc25 intermediate profile', () => {
    const storedAuth = {
      dmarc: { ...V0_DMARC25_PROFILE.authScores.dmarc },
      spf: { ...V0_DMARC25_PROFILE.authScores.spf },
      dkim: { ...V0_DMARC25_PROFILE.authScores.dkim },
    };
    const settings = { authScores: storedAuth };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.authScores).toEqual(DEFAULT_AUTH_SCORES);
    expect(result.authScores.dmarc.fail).toBe(DEFAULT_AUTH_SCORES.dmarc.fail);
  });

  test('does not migrate authScores for v0-dmarc25 when dmarc is user-customized', () => {
    const settings = {
      authScores: {
        dmarc: { ...V0_DMARC25_PROFILE.authScores.dmarc, fail: 99 },
        spf: { ...V0_DMARC25_PROFILE.authScores.spf },
        dkim: { ...V0_DMARC25_PROFILE.authScores.dkim },
      },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(result.authScores.dmarc.fail).toBe(99);
    expect(migrated).toBe(false);
  });

  test('does not migrate authScores when stored object has extra methods', () => {
    const settings = {
      authScores: {
        dmarc: { ...V0_PROFILE.authScores.dmarc },
        spf: { ...V0_PROFILE.authScores.spf },
        dkim: { ...V0_PROFILE.authScores.dkim },
        arc: { pass: 0, fail: 10 },
      },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(result.authScores.dmarc.fail).toBe(40);
    expect(migrated).toBe(false);
  });

  test('migrates layer2Scores when they exactly match v0.3.3 profile', () => {
    const settings = { layer2Scores: { ...V033_PROFILE.layer2Scores } };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.layer2Scores).toEqual(DEFAULT_LAYER2_SCORES);
  });

  test('does not migrate layer2Scores when one value is user-customized', () => {
    const settings = {
      layer2Scores: { ...V033_PROFILE.layer2Scores, spfMailFromMismatch: 99 },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(result.layer2Scores.spfMailFromMismatch).toBe(99);
    expect(migrated).toBe(false);
  });

  test('migrates heuristicScores when they match v0.3.3 profile', () => {
    const settings = { heuristicScores: { ...V033_PROFILE.heuristicScores } };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.heuristicScores).toEqual(DEFAULT_HEURISTIC_SCORES);
  });

  test('migrates authScores when they match v0.3.3 profile', () => {
    const storedAuth = {
      dmarc: { ...V033_PROFILE.authScores.dmarc },
      spf: { ...V033_PROFILE.authScores.spf },
      dkim: { ...V033_PROFILE.authScores.dkim },
    };
    const settings = { authScores: storedAuth };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.authScores).toEqual(DEFAULT_AUTH_SCORES);
  });

  test('migrates all three v0.3.3 groups together', () => {
    const settings = {
      heuristicScores: { ...V033_PROFILE.heuristicScores },
      layer2Scores: { ...V033_PROFILE.layer2Scores },
      authScores: {
        dmarc: { ...V033_PROFILE.authScores.dmarc },
        spf: { ...V033_PROFILE.authScores.spf },
        dkim: { ...V033_PROFILE.authScores.dkim },
      },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.heuristicScores).toEqual(DEFAULT_HEURISTIC_SCORES);
    expect(result.layer2Scores).toEqual(DEFAULT_LAYER2_SCORES);
    expect(result.authScores).toEqual(DEFAULT_AUTH_SCORES);
  });

  test('migrates layer2Scores independently when authScores is user-customized', () => {
    const settings = {
      layer2Scores: { ...V033_PROFILE.layer2Scores },
      authScores: {
        dmarc: { ...V033_PROFILE.authScores.dmarc, fail: 99 },
        spf: { ...V033_PROFILE.authScores.spf },
        dkim: { ...V033_PROFILE.authScores.dkim },
      },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.layer2Scores).toEqual(DEFAULT_LAYER2_SCORES);
    expect(result.authScores.dmarc.fail).toBe(99);
  });
});

describe('KNOWN_SCORE_PROFILES — v1 profile', () => {
  test('contains a v1 entry', () => {
    expect(V1_PROFILE).toBeDefined();
  });

  test('v1 layer2Scores.spfMailFromMismatch is 10 (old default)', () => {
    expect(V1_PROFILE.layer2Scores.spfMailFromMismatch).toBe(10);
  });

  test('v1 authScores.dmarc.none is 10 (old default)', () => {
    expect(V1_PROFILE.authScores.dmarc.none).toBe(10);
  });

  test('v1 authScores.spf.none is 5 (old default)', () => {
    expect(V1_PROFILE.authScores.spf.none).toBe(5);
  });

  test('v1 compositeScores.messageIdMismatchWithUnalignedAuth is 20 (old default)', () => {
    expect(V1_PROFILE.compositeScores.messageIdMismatchWithUnalignedAuth).toBe(20);
  });

  test('v1 authScores.dkim.fail is 15 (unchanged)', () => {
    expect(V1_PROFILE.authScores.dkim.fail).toBe(15);
  });

  test('current DEFAULT_LAYER2_SCORES.spfMailFromMismatch differs from v1', () => {
    expect(DEFAULT_LAYER2_SCORES.spfMailFromMismatch).not.toBe(
      V1_PROFILE.layer2Scores.spfMailFromMismatch,
    );
  });

  test('current DEFAULT_AUTH_SCORES.dmarc.none differs from v1', () => {
    expect(DEFAULT_AUTH_SCORES.dmarc.none).not.toBe(V1_PROFILE.authScores.dmarc.none);
  });

  test('current DEFAULT_COMPOSITE_SCORES.messageIdMismatchWithUnalignedAuth differs from v1', () => {
    expect(DEFAULT_COMPOSITE_SCORES.messageIdMismatchWithUnalignedAuth).not.toBe(
      V1_PROFILE.compositeScores.messageIdMismatchWithUnalignedAuth,
    );
  });
});

describe('migrateScoreDefaults — v1 profile (scoreDefaultsVersion: v1)', () => {
  test('migrates layer2Scores when they match v1 profile', () => {
    const settings = {
      scoreDefaultsVersion: 'v1',
      layer2Scores: { ...V1_PROFILE.layer2Scores },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.layer2Scores).toEqual(DEFAULT_LAYER2_SCORES);
    expect(result.layer2Scores.spfMailFromMismatch).toBe(0);
  });

  test('migrates authScores when they match v1 profile', () => {
    const settings = {
      scoreDefaultsVersion: 'v1',
      authScores: {
        dmarc: { ...V1_PROFILE.authScores.dmarc },
        spf: { ...V1_PROFILE.authScores.spf },
        dkim: { ...V1_PROFILE.authScores.dkim },
      },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.authScores.dmarc.none).toBe(35);
    expect(result.authScores.spf.none).toBe(15);
    expect(result.authScores.dkim.fail).toBe(15);
  });

  test('migrates compositeScores when they match v1 profile', () => {
    const settings = {
      scoreDefaultsVersion: 'v1',
      compositeScores: { ...V1_PROFILE.compositeScores },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.compositeScores.messageIdMismatchWithUnalignedAuth).toBe(30);
  });

  test('migrates all three changed groups when all match v1 profile', () => {
    const settings = {
      scoreDefaultsVersion: 'v1',
      layer2Scores: { ...V1_PROFILE.layer2Scores },
      compositeScores: { ...V1_PROFILE.compositeScores },
      authScores: {
        dmarc: { ...V1_PROFILE.authScores.dmarc },
        spf: { ...V1_PROFILE.authScores.spf },
        dkim: { ...V1_PROFILE.authScores.dkim },
      },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.layer2Scores).toEqual(DEFAULT_LAYER2_SCORES);
    expect(result.compositeScores).toEqual(DEFAULT_COMPOSITE_SCORES);
    expect(result.authScores).toEqual(DEFAULT_AUTH_SCORES);
  });

  test('does not migrate layer2Scores when user-customized', () => {
    const settings = {
      scoreDefaultsVersion: 'v1',
      layer2Scores: { ...V1_PROFILE.layer2Scores, spfMailFromMismatch: 99 },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(result.layer2Scores.spfMailFromMismatch).toBe(99);
    expect(migrated).toBe(false);
  });

  test('does not migrate authScores when user-customized', () => {
    const settings = {
      scoreDefaultsVersion: 'v1',
      authScores: {
        dmarc: { ...V1_PROFILE.authScores.dmarc, none: 99 },
        spf: { ...V1_PROFILE.authScores.spf },
        dkim: { ...V1_PROFILE.authScores.dkim },
      },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(result.authScores.dmarc.none).toBe(99);
    expect(migrated).toBe(false);
  });

  test('does not migrate compositeScores when user-customized', () => {
    const settings = {
      scoreDefaultsVersion: 'v1',
      compositeScores: { ...V1_PROFILE.compositeScores, messageIdMismatchWithUnalignedAuth: 99 },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(result.compositeScores.messageIdMismatchWithUnalignedAuth).toBe(99);
    expect(migrated).toBe(false);
  });

  test('stamps scoreDefaultsVersion as v3 after migration', () => {
    const settings = {
      scoreDefaultsVersion: 'v1',
      layer2Scores: { ...V1_PROFILE.layer2Scores },
    };
    const { settings: result } = migrateScoreDefaults(settings);
    expect(result.scoreDefaultsVersion).toBe(SCORE_DEFAULTS_VERSION);
  });

  test('stamps scoreDefaultsVersion as v3 even when all scores are customized', () => {
    const settings = {
      scoreDefaultsVersion: 'v1',
      layer2Scores: { ...V1_PROFILE.layer2Scores, spfMailFromMismatch: 99 },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(false);
    expect(result.scoreDefaultsVersion).toBe(SCORE_DEFAULTS_VERSION);
  });

  test('migrates layer2Scores independently when authScores is user-customized', () => {
    const settings = {
      scoreDefaultsVersion: 'v1',
      layer2Scores: { ...V1_PROFILE.layer2Scores },
      authScores: {
        dmarc: { ...V1_PROFILE.authScores.dmarc, none: 99 },
        spf: { ...V1_PROFILE.authScores.spf },
        dkim: { ...V1_PROFILE.authScores.dkim },
      },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.layer2Scores).toEqual(DEFAULT_LAYER2_SCORES);
    expect(result.authScores.dmarc.none).toBe(99);
  });

  test('does not overwrite v1 layer2Scores customized to match an older profile shape', () => {
    // A v1 user who set their layer2Scores back to v0.3.3 values. The migration
    // must not treat the match against the v0.3.3 profile as uncustomized and
    // overwrite with v2 defaults.
    const settings = {
      scoreDefaultsVersion: 'v1',
      layer2Scores: { ...V033_PROFILE.layer2Scores },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(false);
    expect(result.layer2Scores.spfMailFromMismatch).toBe(V033_PROFILE.layer2Scores.spfMailFromMismatch);
  });

  test('preserves user-customized spfMailFromMismatch when migrating authScores', () => {
    const settings = {
      scoreDefaultsVersion: 'v1',
      layer2Scores: { ...V1_PROFILE.layer2Scores, spfMailFromMismatch: 5 },
      authScores: {
        dmarc: { ...V1_PROFILE.authScores.dmarc },
        spf: { ...V1_PROFILE.authScores.spf },
        dkim: { ...V1_PROFILE.authScores.dkim },
      },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.layer2Scores.spfMailFromMismatch).toBe(5);
    expect(result.authScores.dmarc.none).toBe(35);
  });
});

describe('KNOWN_SCORE_PROFILES — v2 profile', () => {
  test('contains a v2 entry', () => {
    expect(V2_PROFILE).toBeDefined();
  });

  test('v2 compositeScores.geoTokenCompoundDomain is 30 (old default)', () => {
    expect(V2_PROFILE.compositeScores.geoTokenCompoundDomain).toBe(30);
  });

  test('current DEFAULT_COMPOSITE_SCORES.geoTokenCompoundDomain differs from v2', () => {
    expect(DEFAULT_COMPOSITE_SCORES.geoTokenCompoundDomain).not.toBe(
      V2_PROFILE.compositeScores.geoTokenCompoundDomain,
    );
  });
});

describe('migrateScoreDefaults — v2 profile (scoreDefaultsVersion: v2)', () => {
  test('migrates compositeScores when they match v2 profile', () => {
    const settings = {
      scoreDefaultsVersion: 'v2',
      compositeScores: { ...V2_PROFILE.compositeScores },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(true);
    expect(result.compositeScores).toEqual(DEFAULT_COMPOSITE_SCORES);
    expect(result.compositeScores.geoTokenCompoundDomain).toBe(50);
  });

  test('does not overwrite compositeScores when geoTokenCompoundDomain is user-customized', () => {
    const settings = {
      scoreDefaultsVersion: 'v2',
      compositeScores: { ...V2_PROFILE.compositeScores, geoTokenCompoundDomain: 99 },
    };
    const { settings: result, migrated } = migrateScoreDefaults(settings);
    expect(migrated).toBe(false);
    expect(result.compositeScores.geoTokenCompoundDomain).toBe(99);
  });

  test('stamps scoreDefaultsVersion as v3 after migration', () => {
    const settings = {
      scoreDefaultsVersion: 'v2',
      compositeScores: { ...V2_PROFILE.compositeScores },
    };
    const { settings: result } = migrateScoreDefaults(settings);
    expect(result.scoreDefaultsVersion).toBe(SCORE_DEFAULTS_VERSION);
  });
});
