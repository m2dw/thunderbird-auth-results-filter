import { migrateScoreDefaults, SCORE_DEFAULTS_VERSION } from './scoreDefaultsMigration.js';
import {
  MAX_CUSTOM_FORMULAS,
  MAX_FORMULA_EXPRESSION_LENGTH,
  MAX_FORMULA_ID_LENGTH,
  MAX_FORMULA_NAME_LENGTH,
} from '../core/customFormulas.js';

export { SCORE_DEFAULTS_VERSION };

const STORAGE_KEY = 'authResultsFilter';

/**
 * Clamp the custom formulas array to the documented limits so that storage
 * growth stays bounded even if entries were written by an older version or
 * tampered with externally.
 */
const VALID_FORMULA_MODES = new Set(['observe', 'add', 'disabled']);

function sanitizeFormulas(formulas) {
  if (!Array.isArray(formulas)) return [];
  return formulas
    .slice(0, MAX_CUSTOM_FORMULAS)
    .map(f => {
      if (!f || typeof f !== 'object') return null;
      return {
        id: typeof f.id === 'string' ? f.id.slice(0, MAX_FORMULA_ID_LENGTH) : '',
        name: typeof f.name === 'string' ? f.name.slice(0, MAX_FORMULA_NAME_LENGTH) : '',
        expression: typeof f.expression === 'string'
          ? f.expression.slice(0, MAX_FORMULA_EXPRESSION_LENGTH)
          : '',
        mode: VALID_FORMULA_MODES.has(f.mode) ? f.mode : 'observe',
      };
    })
    .filter(Boolean);
}

export const DEFAULTS = {
  trustedDomains: [],
  senderDomainRules: [],
  manualWhitelist: [],
  candidates: [],
  decisionLog: [],
  customFormulas: [],
  settings: {
    moveToReview: true,
    reviewFolders: {},
    moveHighRiskToJunk: false,
    notifyAfterAssessment: false,
    notificationMaxScore: 49,
    notificationDelayMs: 3000,
    notificationMinIntervalMs: 4000,
    whitelistMitigationScore: -50,
    addressBookWhitelistEnabled: false,
    addressBookMitigationScore: -50,
    diagnosticsMode: false,
    heuristicScores: {
      randomFromDomainLabel: 15,
      randomFromLocalPart: 5,
      layer3Cap: 25,
    },
    layer2Scores: {
      spfMailFromMismatch: 0,
      dkimDomainMismatch: 5,
      dmarcNoneWithThirdPartyAuth: 10,
    },
    setupHints: {
      dnsLookupEnabled: false,
      dnsResolver: '8.8.8.8',
      dnsTimeoutMs: 5000,
    },
    scoreDefaultsVersion: SCORE_DEFAULTS_VERSION,
    authScores: {
      dmarc: { pass: 0, fail: 15, none: 35, policy: 0 },
      spf: {
        pass: 0, fail: 50, none: 15, softfail: 15,
        neutral: 5, temperror: 10, permerror: 20,
      },
      dkim: { pass: 0, fail: 15, none: 5, temperror: 10, permerror: 20 },
    },
  },
};

export async function getStorage() {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] ?? {};
  // Migrate any legacy plain-string trusted entries to typed exact entries.
  if (Array.isArray(stored.trustedDomains)) {
    stored.trustedDomains = stored.trustedDomains.map(d =>
      typeof d === 'string' ? { value: d, matchType: 'exact' } : d,
    );
  }
  const storedSettings = stored.settings ?? {};
  // Omit scoreDefaultsVersion from the DEFAULTS spread so migrateScoreDefaults
  // sees only the stored version (if any). Injecting 'v1' here would make
  // migrateScoreDefaults return immediately, silently skipping legacy migration.
  const { scoreDefaultsVersion: _defaultVersion, ...defaultSettingsBase } = DEFAULTS.settings;
  const data = {
    ...DEFAULTS,
    ...stored,
    customFormulas: sanitizeFormulas(stored.customFormulas ?? DEFAULTS.customFormulas),
    settings: {
      ...defaultSettingsBase,
      ...storedSettings,
      authScores: {
        ...DEFAULTS.settings.authScores,
        ...(storedSettings.authScores ?? {}),
        dmarc: { ...DEFAULTS.settings.authScores.dmarc, ...(storedSettings.authScores?.dmarc ?? {}) },
        spf: { ...DEFAULTS.settings.authScores.spf, ...(storedSettings.authScores?.spf ?? {}) },
        dkim: { ...DEFAULTS.settings.authScores.dkim, ...(storedSettings.authScores?.dkim ?? {}) },
      },
      heuristicScores: { ...DEFAULTS.settings.heuristicScores, ...(storedSettings.heuristicScores ?? {}) },
      layer2Scores: { ...DEFAULTS.settings.layer2Scores, ...(storedSettings.layer2Scores ?? {}) },
      compositeScores: { ...DEFAULTS.settings.compositeScores, ...(storedSettings.compositeScores ?? {}) },
      setupHints: { ...DEFAULTS.settings.setupHints, ...(storedSettings.setupHints ?? {}) },
    },
  };
  // Migrate score defaults if stored values match a known old profile.
  const { settings: migratedSettings, migrated } = migrateScoreDefaults(data.settings ?? {});
  if (migrated) {
    data.settings = migratedSettings;
    await saveStorage(data);
  } else if (data.settings?.scoreDefaultsVersion !== SCORE_DEFAULTS_VERSION) {
    data.settings = migratedSettings;
    await saveStorage(data);
  }
  return data;
}

export async function saveStorage(data) {
  const sanitized = {
    ...data,
    customFormulas: sanitizeFormulas(data.customFormulas ?? []),
  };
  await browser.storage.local.set({ [STORAGE_KEY]: sanitized });
}

/**
 * Latest-state read-modify-write helper.
 * Reads the latest storage, applies `updater` synchronously, and saves the result.
 * Returns the new storage state so callers can use it for rendering.
 *
 * This reduces the window for stale writes by reading immediately before
 * applying the update, but it is NOT atomic: WebExtension local storage has
 * no compare-and-swap, so two concurrent callers can still both read the same
 * state and last-write-wins. Acceptable for the options UI where saves are
 * user-driven and infrequent.
 *
 * @param {function(object): object} updater - Pure function that receives current data and returns next data.
 * @returns {Promise<object>} The saved (next) storage state.
 */
export async function updateStorage(updater) {
  const data = await getStorage();
  const next = updater(data);
  await saveStorage(next);
  return next;
}
