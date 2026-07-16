import { DEFAULTS, getStorage } from '../src/modules/storage.js';

function makeBrowserMock(stored) {
  return {
    storage: {
      local: {
        get: async () => ({ authResultsFilter: stored }),
        set: async () => {},
      },
    },
  };
}

describe('getStorage — settings deep merge', () => {
  afterEach(() => {
    delete globalThis.browser;
  });

  test('missing settings entirely gets all DEFAULTS.settings keys', async () => {
    globalThis.browser = makeBrowserMock({});
    const data = await getStorage();
    expect(data.settings.moveToReview).toBe(DEFAULTS.settings.moveToReview);
    expect(data.settings.heuristicScores).toEqual(DEFAULTS.settings.heuristicScores);
    expect(data.settings.layer2Scores).toEqual(DEFAULTS.settings.layer2Scores);
    expect(data.settings.setupHints).toEqual(DEFAULTS.settings.setupHints);
    expect(data.settings.authScores).toEqual(DEFAULTS.settings.authScores);
  });

  test('stored settings with extra top-level key do not lose newer DEFAULTS.settings keys', async () => {
    globalThis.browser = makeBrowserMock({
      settings: { moveToReview: false },
    });
    const data = await getStorage();
    expect(data.settings.moveToReview).toBe(false);
    expect(data.settings.heuristicScores).toEqual(DEFAULTS.settings.heuristicScores);
    expect(data.settings.layer2Scores).toEqual(DEFAULTS.settings.layer2Scores);
    expect(data.settings.setupHints).toEqual(DEFAULTS.settings.setupHints);
    expect(data.settings.authScores).toEqual(DEFAULTS.settings.authScores);
  });

  test('partial heuristicScores does not lose missing keys from DEFAULTS', async () => {
    globalThis.browser = makeBrowserMock({
      settings: { heuristicScores: { randomFromDomainLabel: 99 } },
    });
    const data = await getStorage();
    expect(data.settings.heuristicScores.randomFromDomainLabel).toBe(99);
    expect(data.settings.heuristicScores.randomFromLocalPart).toBe(
      DEFAULTS.settings.heuristicScores.randomFromLocalPart,
    );
    expect(data.settings.heuristicScores.layer3Cap).toBe(
      DEFAULTS.settings.heuristicScores.layer3Cap,
    );
  });

  test('partial layer2Scores does not lose missing keys from DEFAULTS', async () => {
    globalThis.browser = makeBrowserMock({
      settings: { layer2Scores: { spfMailFromMismatch: 7 } },
    });
    const data = await getStorage();
    expect(data.settings.layer2Scores.spfMailFromMismatch).toBe(7);
    expect(data.settings.layer2Scores.dkimDomainMismatch).toBe(
      DEFAULTS.settings.layer2Scores.dkimDomainMismatch,
    );
  });

  test('partial setupHints does not lose missing keys from DEFAULTS', async () => {
    globalThis.browser = makeBrowserMock({
      settings: { setupHints: { dnsLookupEnabled: true } },
    });
    const data = await getStorage();
    expect(data.settings.setupHints.dnsLookupEnabled).toBe(true);
    expect(data.settings.setupHints.dnsResolver).toBe(DEFAULTS.settings.setupHints.dnsResolver);
    expect(data.settings.setupHints.dnsTimeoutMs).toBe(DEFAULTS.settings.setupHints.dnsTimeoutMs);
  });

  test('partial authScores.spf does not lose missing keys from DEFAULTS', async () => {
    globalThis.browser = makeBrowserMock({
      settings: {
        scoreDefaultsVersion: 'v1',
        authScores: { spf: { fail: 99 } },
      },
    });
    const data = await getStorage();
    expect(data.settings.authScores.spf.fail).toBe(99);
    expect(data.settings.authScores.spf.pass).toBe(DEFAULTS.settings.authScores.spf.pass);
    expect(data.settings.authScores.dmarc).toEqual(DEFAULTS.settings.authScores.dmarc);
    expect(data.settings.authScores.dkim).toEqual(DEFAULTS.settings.authScores.dkim);
  });

  test('user-customized heuristicScores are preserved through merge', async () => {
    const custom = { randomFromDomainLabel: 20, randomFromLocalPart: 10, layer3Cap: 50 };
    globalThis.browser = makeBrowserMock({
      settings: { scoreDefaultsVersion: 'v1', heuristicScores: custom },
    });
    const data = await getStorage();
    expect(data.settings.heuristicScores).toEqual(custom);
  });

  test('legacy stored settings without scoreDefaultsVersion are migrated to current defaults', async () => {
    // Simulate a v0.3.3 installation: stored scores match the known v0.3.3
    // profile exactly, and no scoreDefaultsVersion is present. The merge must
    // NOT inject scoreDefaultsVersion before calling migrateScoreDefaults, or
    // the migration returns immediately and leaves stale scores in place.
    globalThis.browser = makeBrowserMock({
      settings: {
        heuristicScores: { randomFromDomainLabel: 30, randomFromLocalPart: 10, layer3Cap: 40 },
        layer2Scores: { spfMailFromMismatch: 15, dkimDomainMismatch: 10, dmarcNoneWithThirdPartyAuth: 20 },
        authScores: {
          dmarc: { pass: 0, fail: 20, none: 15, policy: 0 },
          spf: { pass: 0, fail: 60, none: 5, softfail: 15, neutral: 5, temperror: 10, permerror: 20 },
          dkim: { pass: 0, fail: 25, none: 5, temperror: 10, permerror: 20 },
        },
      },
    });
    const data = await getStorage();
    expect(data.settings.heuristicScores).toEqual(DEFAULTS.settings.heuristicScores);
    expect(data.settings.layer2Scores).toEqual(DEFAULTS.settings.layer2Scores);
    expect(data.settings.authScores).toEqual(DEFAULTS.settings.authScores);
    expect(data.settings.scoreDefaultsVersion).toBe('v3');
  });
});
