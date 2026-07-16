import { isTrustedAuthservId } from './trust.js';
import { scoreLayer3, DEFAULT_HEURISTIC_SCORES, entropy } from './heuristics.js';
import { getDomainParts } from './domainParts.js';
import { resolveDkimDomain, computePassAlignmentSummary } from './alignment.js';
import { scoreLayer4, DEFAULT_COMPOSITE_SCORES } from './compositeRules.js';
import { applyManualWhitelist, DEFAULT_WHITELIST_MITIGATION, applyAddressBookWhitelist, DEFAULT_ADDRESS_BOOK_MITIGATION } from './whitelist.js';
import { titleForKey } from './ruleRegistry.js';
import { applyCustomFormulas, buildFormulaContext } from './customFormulas.js';

export { DEFAULT_WHITELIST_MITIGATION };
export { DEFAULT_ADDRESS_BOOK_MITIGATION };

export { DEFAULT_COMPOSITE_SCORES };

export const DEFAULT_LAYER2_SCORES = {
  spfMailFromMismatch: 0,
  dkimDomainMismatch: 5,
  dmarcNoneWithThirdPartyAuth: 10,
};

export const DEFAULT_AUTH_SCORES = {
  dmarc: { pass: 0, fail: 15, none: 35, policy: 0 },
  spf: {
    pass: 0, fail: 50, none: 15, softfail: 15,
    neutral: 5, temperror: 10, permerror: 20,
  },
  dkim: { pass: 0, fail: 15, none: 5, temperror: 10, permerror: 20 },
};

/** Stable score key for an auth-result reason. e.g. 'auth.dmarc.fail' */
export function authResultKey(method, result) {
  return `auth.${method}.${result}`;
}

/** Human-readable label for a score key. Delegates to the rule registry. */
export function labelForScoreKey(key) {
  return titleForKey(key);
}

/** Map a numeric score to a classification string. */
export function classifyScore(score) {
  if (score >= 100) return 'high-risk';
  if (score >= 50) return 'review';
  return 'normal';
}

/**
 * Score a message and return { score, classification, scoreReasons }.
 *
 * Each scoreReason has a stable `key` (e.g. 'auth.dmarc.fail', 'authserv.untrusted'),
 * a human-readable `label`, and the numeric `delta` applied at scoring time.
 * Additional context fields (authservId, method, result, domain, matchType) are
 * included where relevant to support log display and future diagnostics.
 *
 * @param {object} opts
 * @param {Array}  opts.parsedAuthResults      - from parseAllAuthResults()
 * @param {Array}  opts.trustedDomains         - [{ value, matchType }] authserv-id trust rules
 * @param {string} opts.senderDomain           - RFC5322 From domain (lowercased)
 * @param {string} [opts.senderLocalPart]      - RFC5322 From local part, original case
 * @param {string|null} [opts.messageIdDomain] - Domain parsed from the Message-ID header
 * @param {Array}  opts.senderDomainRules      - [{ domain, matchType, score }]
 * @param {object} [opts.authScores]           - per-method result scores
 * @param {object} [opts.heuristicScores]      - Layer 3 heuristic score values
 * @param {object} [opts.layer2Scores]         - Layer 2 identity alignment score values
 * @param {object} [opts.compositeScores]      - Layer 4 composite rule score values
 * @param {object} [opts.alignmentSummary]     - Pre-computed pass-alignment summary (from computePassAlignmentSummary); skips internal computePassAlignmentSummary when provided
 * @param {Array}  [opts.whitelistEntries]     - [{ value, matchType }] manual whitelist
 * @param {number} [opts.whitelistMitigationScore] - Negative delta for whitelist match
 * @param {boolean} [opts.isInAddressBook]    - True when sender is found in user's address books
 * @param {number} [opts.addressBookMitigationScore] - Negative delta for address-book match
 * @param {object} [opts.headerMetrics]       - Raw identity header metrics from computeHeaderMetrics()
 * @param {string[]} [opts.accountDomains] - PSL registrable domains of all receiving account identities, or empty array when unavailable
 * @param {Array}  [opts.customFormulas]      - L5 custom formula definitions from settings.customFormulas
 * @param {object} [opts.displayNameMetrics]  - Display-name metrics for formula context
 * @param {object} [opts.messageIdMetrics]    - Message-ID metrics for formula context
 * @param {{ score: number, scoreReasons: Array }|null} [opts.mailAuthSignalReasons]
 *   Pre-computed composite signal score reasons from adaptCompositeSignals(). When provided,
 *   these are applied after Layer 4 and before Layer 5 mitigations.
 */
export function scoreMessage({
  parsedAuthResults,
  trustedDomains,
  senderDomain,
  senderLocalPart = '',
  messageIdDomain = null,
  senderDomainRules,
  authScores = DEFAULT_AUTH_SCORES,
  heuristicScores,
  layer2Scores,
  compositeScores,
  alignmentSummary = null,
  whitelistEntries = [],
  whitelistMitigationScore = DEFAULT_WHITELIST_MITIGATION,
  isInAddressBook = false,
  addressBookMitigationScore = DEFAULT_ADDRESS_BOOK_MITIGATION,
  headerMetrics = {},
  accountDomains = [],
  customFormulas = [],
  displayNameMetrics = null,
  messageIdMetrics = null,
  mailAuthSignalReasons = null,
}) {
  let score = 0;
  const scoreReasons = [];

  for (const ar of parsedAuthResults) {
    if (!isTrustedAuthservId(ar.authservId, trustedDomains)) {
      scoreReasons.push({
        key: 'authserv.untrusted',
        label: 'Untrusted authserv-id',
        authservId: ar.authservId,
        delta: 0,
      });
    } else {
      for (const { method, result } of ar.results) {
        const methodScores = authScores[method];
        if (!methodScores) continue;
        // Skip results not present in the configured score table (unknown results).
        // Known results with a configured score of 0 (e.g. pass) are always recorded
        // so that a later score change can be reflected in recalculation.
        if (!(result in methodScores)) continue;
        const delta = methodScores[result];
        const key = authResultKey(method, result);
        if (delta !== 0) score += delta;
        scoreReasons.push({
          key,
          label: labelForScoreKey(key),
          authservId: ar.authservId,
          method,
          result,
          delta,
        });
      }
    }
  }

  // Compute pass-only alignment summary early so Layer 2 can use anyDkimAligned
  // to gate the SPF MAIL FROM mismatch signal. Layer 4 reuses this summary.
  // When the caller pre-computes the summary via computePassAlignmentSummary,
  // the local computation here is skipped.
  const layer4AlignmentSummary = alignmentSummary ?? computePassAlignmentSummary({
    parsedAuthResults,
    trustedDomains,
    fromDomain: senderDomain,
  });

  // Layer 2: Sender identity alignment — check all trusted SPF pass results, not
  // just the first one, so a later trusted AR with SPF pass and mismatched MAIL
  // FROM is not silently ignored when an earlier AR had a different SPF result.
  const l2s = { ...DEFAULT_LAYER2_SCORES, ...layer2Scores };
  const fromParts = getDomainParts(senderDomain);
  // SPF MAIL FROM mismatch is suppressed when a trusted aligned DKIM pass exists.
  // A DKIM-aligned message is already vouched for by the brand domain, so SPF
  // MAIL FROM mismatch is an expected delegated-delivery pattern, not a risk signal.
  if (fromParts.registrableDomain !== null && !layer4AlignmentSummary.anyDkimAligned) {
    let spfMismatchScored = false;
    outer: for (const ar of parsedAuthResults) {
      if (!isTrustedAuthservId(ar.authservId, trustedDomains)) continue;
      for (const r of ar.results) {
        if (r.method !== 'spf' || r.result !== 'pass') continue;
        const rawSmtp = r.properties?.['smtp.mailfrom'] ?? null;
        if (!rawSmtp) continue;
        const atIdx = rawSmtp.indexOf('@');
        const smtpDomain = (atIdx >= 0 ? rawSmtp.slice(atIdx + 1) : rawSmtp).toLowerCase();
        const smtpParts = getDomainParts(smtpDomain);
        if (smtpParts.registrableDomain === null) continue;
        if (smtpParts.registrableDomain === fromParts.registrableDomain) continue;
        if (spfMismatchScored) break outer;
        spfMismatchScored = true;
        const delta = l2s.spfMailFromMismatch;
        score += delta;
        scoreReasons.push({
          key: 'identity.spfMailFromMismatch',
          label: 'SPF MAIL FROM differs from From',
          delta,
          fromDomain: senderDomain || null,
          fromRegistrableDomain: fromParts.registrableDomain,
          smtpMailFromDomain: smtpDomain,
          smtpMailFromRegistrableDomain: smtpParts.registrableDomain,
        });
      }
    }
  }

  // Layer 2: DKIM domain mismatch — score when all passing DKIM signatures are
  // from domains unrelated to the RFC5322 From registrable domain. Collect all
  // passing DKIM results across all trusted ARs before deciding; one reason entry
  // is added even when multiple unaligned signatures exist.
  if (fromParts.registrableDomain !== null) {
    const passingDkimRegistrableDomains = [];
    let anyDkimAligned = false;

    for (const ar of parsedAuthResults) {
      if (!isTrustedAuthservId(ar.authservId, trustedDomains)) continue;
      for (const r of ar.results) {
        if (r.method !== 'dkim' || r.result !== 'pass') continue;
        const domain = resolveDkimDomain(r.properties);
        if (!domain) continue;
        const dkimParts = getDomainParts(domain);
        if (dkimParts.registrableDomain === null) continue;
        if (dkimParts.registrableDomain === fromParts.registrableDomain) {
          anyDkimAligned = true;
        } else {
          passingDkimRegistrableDomains.push(dkimParts.registrableDomain);
        }
      }
    }

    if (!anyDkimAligned && passingDkimRegistrableDomains.length > 0) {
      const delta = l2s.dkimDomainMismatch;
      score += delta;
      scoreReasons.push({
        key: 'identity.dkimDomainMismatch',
        label: 'DKIM signing domain differs from From',
        delta,
        fromDomain: senderDomain || null,
        fromRegistrableDomain: fromParts.registrableDomain,
        dkimDomains: [...new Set(passingDkimRegistrableDomains)],
      });
    }
  }

  // Layer 2: DMARC none with only third-party auth — fires when DMARC result is
  // none or absent from trusted headers and every passing SPF/DKIM result
  // authenticates a domain unrelated to the RFC5322 From registrable domain.
  // This is intentionally stackable with spfMailFromMismatch and dkimDomainMismatch;
  // at default deltas (15+10+20=45) the combined Layer 2 total stays below the
  // Review threshold (50) on its own.
  if (fromParts.registrableDomain !== null) {
    const trustedDmarcResults = [];
    let anyTrustedPass = false;
    let anyTrustedPassAligned = false;
    const thirdPartyPassDomains = [];

    for (const ar of parsedAuthResults) {
      if (!isTrustedAuthservId(ar.authservId, trustedDomains)) continue;
      for (const r of ar.results) {
        if (r.method === 'dmarc') {
          trustedDmarcResults.push(r.result);
        }
        if (r.method === 'spf' && r.result === 'pass') {
          const rawSmtp = r.properties?.['smtp.mailfrom'] ?? null;
          if (rawSmtp) {
            const atIdx = rawSmtp.indexOf('@');
            const smtpDomain = (atIdx >= 0 ? rawSmtp.slice(atIdx + 1) : rawSmtp).toLowerCase();
            const smtpParts = getDomainParts(smtpDomain);
            if (smtpParts.registrableDomain !== null) {
              anyTrustedPass = true;
              if (smtpParts.registrableDomain === fromParts.registrableDomain) {
                anyTrustedPassAligned = true;
              } else {
                thirdPartyPassDomains.push(smtpParts.registrableDomain);
              }
            }
          }
        }
        if (r.method === 'dkim' && r.result === 'pass') {
          const domain = resolveDkimDomain(r.properties);
          if (domain) {
            const dkimParts = getDomainParts(domain);
            if (dkimParts.registrableDomain !== null) {
              anyTrustedPass = true;
              if (dkimParts.registrableDomain === fromParts.registrableDomain) {
                anyTrustedPassAligned = true;
              } else {
                thirdPartyPassDomains.push(dkimParts.registrableDomain);
              }
            }
          }
        }
      }
    }

    // Only score as "none or absent" if no trusted DMARC header reported pass or fail.
    const hasTrustedDmarc = trustedDmarcResults.length > 0;
    const dmarcIsNoneOrAbsent =
      !hasTrustedDmarc || trustedDmarcResults.every(res => res === 'none');
    if (dmarcIsNoneOrAbsent && anyTrustedPass && !anyTrustedPassAligned) {
      const delta = l2s.dmarcNoneWithThirdPartyAuth;
      score += delta;
      scoreReasons.push({
        key: 'identity.dmarcNoneWithThirdPartyAuth',
        label: 'DMARC none with only third-party auth',
        delta,
        fromDomain: senderDomain || null,
        fromRegistrableDomain: fromParts.registrableDomain,
        dmarcResult: hasTrustedDmarc ? trustedDmarcResults[0] : 'absent',
        thirdPartyDomains: [...new Set(thirdPartyPassDomains)],
      });
    }
  }

  // Layer 3: Sender heuristics (random-looking From domain labels / local part).
  const layer3 = scoreLayer3({ fromDomain: senderDomain, fromLocalPart: senderLocalPart, heuristicScores });
  score += layer3.score;
  scoreReasons.push(...layer3.scoreReasons);

  // Derived flag passed to Layer 4 for the lexical mitigation rule.
  // Guard with layer3.score > 0: when the cap reduces the Layer 3 contribution
  // to zero the penalty did not actually affect the final score, so mitigation
  // must not fire either.
  const hasLexicalPenalty = layer3.score > 0 && layer3.scoreReasons.some(
    r => (r.key === 'heuristic.randomFromDomainLabel' || r.key === 'heuristic.randomFromLocalPart') && r.delta > 0
  );

  // Layer 4: Composite detection rules — combine Layer 1/2/3 facts.
  // layer4AlignmentSummary was already computed above for Layer 2 gating.
  const layer4 = scoreLayer4({
    alignmentSummary: layer4AlignmentSummary,
    fromDomain: senderDomain,
    fromLocalPart: senderLocalPart,
    messageIdDomain,
    compositeScores,
    senderRegistrableDomain: headerMetrics.senderRegistrableDomain ?? null,
    senderDomainMatchesFromDomain: headerMetrics.senderDomainMatchesFromDomain ?? null,
    hasListHeaders: headerMetrics.hasListHeaders ?? false,
    spfMailFromRegistrableDomain: layer4AlignmentSummary.spfMailFromRegistrableDomain ?? null,
    hasLexicalPenalty,
    accountDomains,
    returnPathRegistrableDomain: headerMetrics.returnPathRegistrableDomain ?? null,
    displayNameMetrics,
  });
  score += layer4.score;
  scoreReasons.push(...layer4.scoreReasons);

  // mail-auth-signal composite signal reasons (pre-computed by adaptCompositeSignals).
  // Inserted after Layer 4 so they participate in the same whitelist/sender-rule
  // Layer 5 pass without altering the Layer 4 decision logic.
  if (mailAuthSignalReasons) {
    score += mailAuthSignalReasons.score;
    scoreReasons.push(...mailAuthSignalReasons.scoreReasons);
  }

  // Layer 5: Manual whitelist mitigation — applied before sender-domain rules.
  // A match adds a negative score reason; it does not hard-bypass classification.
  if (whitelistEntries.length > 0) {
    const senderAddress = senderLocalPart
      ? `${senderLocalPart.toLowerCase()}@${senderDomain.toLowerCase()}`
      : '';
    if (senderAddress) {
      const wl = applyManualWhitelist({ senderAddress, whitelistEntries, mitigationScore: whitelistMitigationScore });
      score += wl.score;
      scoreReasons.push(...wl.scoreReasons);
    }
  }

  // Layer 5: Address-book whitelist mitigation — separate from manual whitelist.
  if (isInAddressBook) {
    const ab = applyAddressBookWhitelist({ isInAddressBook, mitigationScore: addressBookMitigationScore });
    score += ab.score;
    scoreReasons.push(...ab.scoreReasons);
  }

  // Layer 5: User sender-domain rules.
  for (const rule of senderDomainRules) {
    if (matchesSenderRule(senderDomain, rule)) {
      score += rule.score;
      scoreReasons.push({
        key: 'sender.rule',
        label: 'Sender domain rule',
        domain: rule.domain,
        matchType: rule.matchType,
        delta: rule.score,
      });
    }
  }

  // Layer 5: Custom formulas (observe or add mode).
  // Applied after all other L5 signals so baseScore and baseVerdict reflect the
  // full L1-L5 whitelist/rule contribution when formulas are evaluated.
  let formulaDiagnostics = [];
  if (customFormulas && customFormulas.length > 0) {
    const fromParts2 = getDomainParts(senderDomain);
    // Compute entropy of the leftmost domain label for formula context
    const leftLabel = senderDomain ? senderDomain.split('.')[0] : '';
    const leftLabelEntropy = entropy(leftLabel);

    const formulaContext = buildFormulaContext({
      baseScore: score,
      classification: classifyScore(score),
      senderDomain,
      senderLocalPart,
      domainParts: fromParts2,
      leftLabelEntropy,
      displayNameMetrics,
      alignmentSummary: layer4AlignmentSummary,
      scoreReasons,
      messageIdMetrics,
      headerMetrics,
    });

    const formulaResult = applyCustomFormulas(customFormulas, formulaContext, {
      baseScore: score,
      baseVerdict: classifyScore(score),
    });

    score += formulaResult.score;
    scoreReasons.push(...formulaResult.scoreReasons);
    formulaDiagnostics = formulaResult.formulaDiagnostics;
  }

  return { score, classification: classifyScore(score), scoreReasons, formulaDiagnostics };
}

/**
 * Compute the current delta for every score reason in a log entry.
 *
 * Returns a new array where each element is the original reason object spread
 * with two additional fields:
 *   - `currentDelta`  — the delta that would apply under the given settings
 *   - `deltaChanged`  — true when `currentDelta !== delta`
 *
 * Auth-result deltas are re-derived from `authScores`.
 * Untrusted-AR deltas always recalculate to 0 (untrusted AR is not scored).
 * Sender-rule deltas are preserved unchanged because re-matching requires the
 * original sender address, which is not stored in the log entry.
 *
 * @param {object} entry                       - Log entry (may have no scoreReasons).
 * @param {object} [settings]
 * @param {object} [settings.authScores]        - current per-method result scores
 * @param {object} [settings.heuristicScores]   - current Layer 3 heuristic scores
 * @returns {Array} Annotated reason objects.
 */
export function recalculateScoreReasons(entry, {
  authScores = DEFAULT_AUTH_SCORES,
  heuristicScores,
  layer2Scores,
  compositeScores,
  whitelistMitigationScore = DEFAULT_WHITELIST_MITIGATION,
  addressBookMitigationScore = DEFAULT_ADDRESS_BOOK_MITIGATION,
} = {}) {
  const hs = { ...DEFAULT_HEURISTIC_SCORES, ...heuristicScores };
  const l2s = { ...DEFAULT_LAYER2_SCORES, ...layer2Scores };
  const cs = { ...DEFAULT_COMPOSITE_SCORES, ...compositeScores };

  // Mirror the hasLexicalPenalty gate from scoreMessage(): dkimAlignedLexicalMitigation
  // only fires when lexical heuristics contribute a positive amount to the final score.
  // If the user has since zeroed heuristic scores or layer3Cap, the mitigation should
  // also recalculate to 0 rather than keeping its stored negative delta.
  const lexicalKeys = new Set(['heuristic.randomFromDomainLabel', 'heuristic.randomFromLocalPart']);
  const hasEffectiveLexicalPenalty = hs.layer3Cap > 0 &&
    (entry.scoreReasons ?? []).some(r =>
      lexicalKeys.has(r.key) &&
      (r.key === 'heuristic.randomFromDomainLabel' ? hs.randomFromDomainLabel : hs.randomFromLocalPart) > 0
    );

  return (entry.scoreReasons ?? []).map(reason => {
    let currentDelta;

    if (reason.key === 'authserv.untrusted') {
      // Untrusted AR is no longer scored; old log entries always recalculate to 0.
      currentDelta = 0;
    } else if (reason.key === 'identity.spfMailFromMismatch') {
      currentDelta = l2s.spfMailFromMismatch;
    } else if (reason.key === 'identity.dkimDomainMismatch') {
      currentDelta = l2s.dkimDomainMismatch;
    } else if (reason.key === 'identity.dmarcNoneWithThirdPartyAuth') {
      currentDelta = l2s.dmarcNoneWithThirdPartyAuth;
    } else if (reason.key === 'heuristic.randomFromDomainLabel') {
      currentDelta = hs.randomFromDomainLabel;
    } else if (reason.key === 'heuristic.randomFromLocalPart') {
      currentDelta = hs.randomFromLocalPart;
    } else if (reason.key === 'whitelist.manual') {
      currentDelta = whitelistMitigationScore;
    } else if (reason.key === 'whitelist.addressBook') {
      currentDelta = addressBookMitigationScore;
    } else if (reason.key === 'sender.rule') {
      // Sender rules can't be recalculated without re-matching; preserve stored delta.
      currentDelta = reason.delta;
    } else if (reason.key === 'composite.dkimAlignedLexicalMitigation') {
      // Only active when lexical penalties would still fire under current settings.
      currentDelta = hasEffectiveLexicalPenalty ? cs.dkimAlignedLexicalMitigation : 0;
    } else if (reason.key?.startsWith('composite.')) {
      const compositeKey = reason.key.slice('composite.'.length);
      currentDelta = compositeKey in cs ? cs[compositeKey] : reason.delta;
    } else if (reason.key?.startsWith('custom.formula.')) {
      // Custom formula deltas cannot be recalculated without re-running the formula;
      // preserve the stored delta so it appears unchanged in recalculation views.
      currentDelta = reason.delta;
    } else {
      // auth.<method>.<result>: re-derive from current settings.
      // Other non-configurable keys: preserve stored delta.
      const m = reason.key.match(/^auth\.(\w+)\.(\w+)$/);
      currentDelta = m ? (authScores[m[1]]?.[m[2]] ?? 0) : reason.delta;
    }

    return { ...reason, currentDelta, deltaChanged: currentDelta !== reason.delta };
  });
}

/**
 * Sum the currentDelta values of recalculated reasons, applying the Layer 3 cap
 * to the combined heuristic subtotal.
 *
 * Individual heuristic reason rows continue to show their configured currentDelta;
 * this function only adjusts the aggregate contribution from Layer 3 reasons when
 * their sum exceeds layer3Cap.
 *
 * @param {Array}  reasons          - Output of recalculateScoreReasons().
 * @param {object} [heuristicScores] - Current Layer 3 settings; falls back to defaults.
 * @returns {number} Total score with Layer 3 cap applied.
 */
export function sumCurrentDeltas(reasons, heuristicScores) {
  const hs = { ...DEFAULT_HEURISTIC_SCORES, ...heuristicScores };
  let heuristicTotal = 0;
  let otherTotal = 0;
  for (const r of reasons) {
    if (r.key?.startsWith('heuristic.')) {
      heuristicTotal += r.currentDelta;
    } else {
      otherTotal += r.currentDelta;
    }
  }
  return otherTotal + Math.min(heuristicTotal, hs.layer3Cap);
}

/**
 * Recalculate a log entry's total score using current score settings.
 * Delegates per-reason computation to recalculateScoreReasons().
 * Applies the Layer 3 cap to the combined heuristic subtotal via sumCurrentDeltas().
 *
 * @param {object} entry                        - Log entry with scoreReasons, score, and optional classification.
 * @param {object} [settings]
 * @param {object} [settings.authScores]        - current per-method result scores
 * @param {object} [settings.heuristicScores]   - current Layer 3 heuristic scores
 * @returns {{ originalScore, currentScore, originalClassification, currentClassification, reasonDiffs }}
 */
export function recalculateLogEntry(entry, settings = {}) {
  const reasonDetails = recalculateScoreReasons(entry, settings);
  const currentScore = sumCurrentDeltas(reasonDetails, settings.heuristicScores);
  const originalScore = entry.score;
  const originalClassification = entry.classification ?? classifyScore(originalScore);

  return {
    originalScore,
    currentScore,
    originalClassification,
    currentClassification: classifyScore(currentScore),
    reasonDiffs: reasonDetails
      .filter(r => r.deltaChanged)
      .map(r => ({
        key: r.key,
        label: r.label ?? labelForScoreKey(r.key),
        originalDelta: r.delta,
        currentDelta: r.currentDelta,
      })),
  };
}

function matchesSenderRule(senderDomain, rule) {
  const d = senderDomain.toLowerCase();
  const r = rule.domain.toLowerCase();
  if (rule.matchType === 'exact') return d === r;
  if (rule.matchType === 'suffix') return d === r || d.endsWith('.' + r);
  return false;
}
