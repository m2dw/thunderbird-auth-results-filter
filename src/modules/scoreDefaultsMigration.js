/**
 * Score Defaults Migration
 *
 * Conservative migration policy for stored score settings.
 * When DEFAULT_* score constants change, users who already have those values
 * stored in browser storage will not automatically receive new defaults.
 * This module detects stored values that exactly match a known old default
 * profile and replaces them with current defaults.
 *
 * Policy:
 * - Migration is attempted only when settings.scoreDefaultsVersion is absent
 *   (user installed before versioning was introduced).
 * - For each known old profile, each score group is compared to the stored
 *   values. If ALL values in a group match the profile exactly, the group is
 *   replaced with the current defaults.
 * - If any value in a group differs from the profile, the group is treated as
 *   user-customized and is never overwritten.
 * - After migration (or first load without migration), scoreDefaultsVersion is
 *   set to SCORE_DEFAULTS_VERSION so future loads skip the check.
 */

import { DEFAULT_HEURISTIC_SCORES } from '../core/heuristics.js';
import { DEFAULT_COMPOSITE_SCORES } from '../core/compositeRules.js';
import { DEFAULT_AUTH_SCORES, DEFAULT_LAYER2_SCORES } from '../core/scoring.js';

export const SCORE_DEFAULTS_VERSION = 'v3';

/**
 * Registry of known old score profiles.
 * Each entry documents what the defaults were for a given profile version.
 * Only groups that changed between versions need entries; absent groups in a
 * profile are not checked.
 */
export const KNOWN_SCORE_PROFILES = [
  {
    // Earliest known profile: users who installed v0.2.0 or v0.2.1 before the
    // 0.2.2 score tuning changed dmarc.fail from 50→40 and spf.fail from 50→60.
    // Only authScores is listed; heuristic/composite scores are handled by v0.
    version: 'pre-v0.2.2',
    authScores: {
      dmarc: { pass: 0, fail: 50, none: 10, policy: 0 },
      spf: {
        pass: 0, fail: 50, none: 5, softfail: 15,
        neutral: 5, temperror: 10, permerror: 20,
      },
      dkim: { pass: 0, fail: 25, none: 5, temperror: 10, permerror: 20 },
    },
  },
  {
    version: 'v0',
    // Layer 3 heuristic defaults before the low-pass/high-combo tuning.
    // randomFromDomainLabel was raised from 20 to 30.
    heuristicScores: {
      randomFromDomainLabel: 20,
      randomFromLocalPart: 10,
      layer3Cap: 40,
    },
    // Layer 4 composite defaults before the low-pass/high-combo tuning.
    // authAlignedRandomDomain was raised from 25 to 40.
    // Only five composite rules existed at that time; the remaining rules were
    // added in later releases and must not appear here or scoreObjectsEqual will
    // reject stored objects that only have the original five keys.
    compositeScores: {
      spfAlignedDkimUnalignedRandomLocal: 30,
      authAlignedRandomDomain: 25,
      thirdPartyAuthRandomLocal: 25,
      messageIdMismatchWithUnalignedAuth: 20,
      fromSenderMismatchWithUnalignedAuth: 15,
    },
    // Layer 1 auth-result defaults before the low-pass/high-combo tuning.
    // dmarc.fail was lowered from 40 to 25 (later to 20) at the same release.
    authScores: {
      dmarc: { pass: 0, fail: 40, none: 10, policy: 0 },
      spf: {
        pass: 0, fail: 60, none: 5, softfail: 15,
        neutral: 5, temperror: 10, permerror: 20,
      },
      dkim: { pass: 0, fail: 25, none: 5, temperror: 10, permerror: 20 },
    },
  },
  {
    // Intermediate profile: users who updated to the low-pass/high-combo
    // release (which set dmarc.fail to 25 and dmarc.none to 15) but before
    // scoreDefaultsVersion was introduced. Their heuristic and composite
    // scores already match the current defaults, so only authScores is listed.
    // Without this profile they would never be migrated from dmarc.fail=25 to
    // the current dmarc.fail=20.
    version: 'v0-dmarc25',
    authScores: {
      dmarc: { pass: 0, fail: 25, none: 15, policy: 0 },
      spf: {
        pass: 0, fail: 60, none: 5, softfail: 15,
        neutral: 5, temperror: 10, permerror: 20,
      },
      dkim: { pass: 0, fail: 25, none: 5, temperror: 10, permerror: 20 },
    },
  },
  {
    // Released v0.3.3 defaults. Users who installed before scoreDefaultsVersion
    // was introduced (PR #181) and who never opened Score Settings still have
    // these stored values. PR #179 subsequently lowered all three auth-fail
    // scores, all three heuristic scores, and all three Layer 2 scores.
    version: 'v0.3.3',
    heuristicScores: {
      randomFromDomainLabel: 30,
      randomFromLocalPart: 10,
      layer3Cap: 40,
    },
    layer2Scores: {
      spfMailFromMismatch: 15,
      dkimDomainMismatch: 10,
      dmarcNoneWithThirdPartyAuth: 20,
    },
    authScores: {
      dmarc: { pass: 0, fail: 20, none: 15, policy: 0 },
      spf: {
        pass: 0, fail: 60, none: 5, softfail: 15,
        neutral: 5, temperror: 10, permerror: 20,
      },
      dkim: { pass: 0, fail: 25, none: 5, temperror: 10, permerror: 20 },
    },
  },
  {
    // v1 defaults (issue #220 rebalancing). Users with scoreDefaultsVersion
    // 'v1' who still have the v1 defaults are migrated to v2. Groups that are
    // user-customized are preserved unchanged.
    version: 'v1',
    layer2Scores: {
      spfMailFromMismatch: 10,
      dkimDomainMismatch: 5,
      dmarcNoneWithThirdPartyAuth: 10,
    },
    compositeScores: {
      spfAlignedDkimUnalignedRandomLocal: 30,
      authAlignedRandomDomain: 40,
      thirdPartyAuthRandomLocal: 25,
      messageIdMismatchWithUnalignedAuth: 20,
      messageIdUnregistrableMismatch: 50,
      fromSenderMismatchWithUnalignedAuth: 15,
      deepRandomFromSubdomain: 25,
      delegatedDkimAlignedRouteConsistent: -30,
      spfPassDkimFailRandomLocal: 25,
      dkimAlignedLexicalMitigation: -30,
      ownDomainAuthFail: 75,
      unparseableFromWithInfrastructureMismatch: 50,
      dmarcFailDkimAlignedListMitigation: -15,
      geoTokenCompoundDomain: 30,
      deepServiceWordSubdomain: 30,
    },
    authScores: {
      dmarc: { pass: 0, fail: 15, none: 10, policy: 0 },
      spf: {
        pass: 0, fail: 50, none: 5, softfail: 15,
        neutral: 5, temperror: 10, permerror: 20,
      },
      dkim: { pass: 0, fail: 15, none: 5, temperror: 10, permerror: 20 },
    },
  },
  {
    // v2 defaults (issue #341 / v0.8.x). Users with scoreDefaultsVersion 'v2'
    // who still have the v2 defaults are migrated to v3 (geoTokenCompoundDomain
    // raised from 30 to 50 per issue #343 analysis). Groups that are
    // user-customized are preserved unchanged.
    version: 'v2',
    compositeScores: {
      spfAlignedDkimUnalignedRandomLocal: 30,
      authAlignedRandomDomain: 40,
      thirdPartyAuthRandomLocal: 25,
      messageIdMismatchWithUnalignedAuth: 30,
      messageIdUnregistrableMismatch: 50,
      fromSenderMismatchWithUnalignedAuth: 15,
      deepRandomFromSubdomain: 25,
      unsecuredDeepSubdomain: 25,
      delegatedDkimAlignedRouteConsistent: -30,
      spfPassDkimFailRandomLocal: 25,
      dkimAlignedLexicalMitigation: -30,
      ownDomainAuthFail: 75,
      unparseableFromWithInfrastructureMismatch: 50,
      dmarcFailDkimAlignedListMitigation: -15,
      geoTokenCompoundDomain: 30,
      deepServiceWordSubdomain: 30,
      dkimFailWithAlignedPass: 35,
      brandDivergencePhishing: 50,
      unauthenticatedFromSpoof: 35,
      authenticatedDisplayNameSpoof: 40,
      publicDomainSpoofing: 45,
    },
  },
];

/** Key-order-independent equality for plain score objects with primitive values. */
function scoreObjectsEqual(a, b) {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  if (keysA.join('\0') !== keysB.join('\0')) return false;
  return keysA.every(k => a[k] === b[k]);
}

/** Key-order-independent equality for one-level-nested score objects (e.g. authScores). */
function nestedScoreObjectsEqual(a, b) {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  if (keysA.join('\0') !== keysB.join('\0')) return false;
  return keysA.every(k => scoreObjectsEqual(a[k], b[k]));
}

/**
 * Conservative migration of stored score settings to current defaults.
 *
 * This is a pure function suitable for unit testing. Storage persistence is
 * the caller's responsibility.
 *
 * @param {object} settings - The settings object from stored data.
 * @returns {{ settings: object, migrated: boolean }}
 *   `settings` is the (possibly updated) settings object.
 *   `migrated` is true when at least one score group was replaced.
 */
export function migrateScoreDefaults(settings) {
  if (settings.scoreDefaultsVersion === SCORE_DEFAULTS_VERSION) {
    return { settings, migrated: false };
  }

  let next = { ...settings };
  let migrated = false;

  // When scoreDefaultsVersion is already set to a known older version, only
  // compare against that version's profile. Scanning all older profiles would
  // risk treating scores that the user customized back to an older shape as an
  // unmodified legacy baseline and silently overwriting them.
  const storedVersion = settings.scoreDefaultsVersion;
  const profilesToCheck = storedVersion
    ? KNOWN_SCORE_PROFILES.filter(p => p.version === storedVersion)
    : KNOWN_SCORE_PROFILES;

  for (const profile of profilesToCheck) {
    if (
      profile.heuristicScores &&
      settings.heuristicScores &&
      scoreObjectsEqual(settings.heuristicScores, profile.heuristicScores)
    ) {
      next = { ...next, heuristicScores: { ...DEFAULT_HEURISTIC_SCORES } };
      migrated = true;
    }

    if (
      profile.layer2Scores &&
      settings.layer2Scores &&
      scoreObjectsEqual(settings.layer2Scores, profile.layer2Scores)
    ) {
      next = { ...next, layer2Scores: { ...DEFAULT_LAYER2_SCORES } };
      migrated = true;
    }

    if (
      profile.compositeScores &&
      settings.compositeScores &&
      scoreObjectsEqual(settings.compositeScores, profile.compositeScores)
    ) {
      next = { ...next, compositeScores: { ...DEFAULT_COMPOSITE_SCORES } };
      migrated = true;
    }

    if (
      profile.authScores &&
      settings.authScores &&
      nestedScoreObjectsEqual(settings.authScores, profile.authScores)
    ) {
      next = { ...next, authScores: { ...DEFAULT_AUTH_SCORES } };
      migrated = true;
    }
  }

  next = { ...next, scoreDefaultsVersion: SCORE_DEFAULTS_VERSION };
  return { settings: next, migrated };
}
