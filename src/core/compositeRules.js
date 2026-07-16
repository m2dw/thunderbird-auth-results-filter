/**
 * Layer 4: Composite Detection Rules
 *
 * Combines Layer 1/2/3 facts to emit high-confidence spam signals.
 * Individual heuristic signals are often weak alone; composite rules require
 * convergence of multiple Layer 1–3 facts before scoring.
 *
 * Design notes:
 * - anyDkimAligned: true is a strong mitigation signal; rules requiring
 *   DKIM to be unaligned will not fire when DKIM is aligned.
 * - spfAligned: true is only set when a trusted SPF pass result has an
 *   smtp.mailfrom domain aligning with header.from. Null Sender / empty
 *   smtp.mailfrom produces spfAligned: false, so rules requiring
 *   spfAligned: true do not fire for bounces or null-sender mail.
 * - Short local parts (raw length < 7) do not trigger random-local rules.
 */

import { isRandomLookingLocalPart, isRandomLookingLabel } from './heuristics.js';
import { getDomainParts } from './domainParts.js';
import {
  BRAND_INFERENCE_MIN_SCORE,
  extractDomainCoreLabel,
  normalizeForComparison,
} from './displayNameMetrics.js';

/**
 * Default Layer 4 composite score values.
 *
 * Add-on-specific rules that have no equivalent in mail-auth-signal v0.2.x yet
 * (follow-up candidates for upstream contribution):
 *   - spfAlignedDkimUnalignedRandomLocal
 *   - authAlignedRandomDomain
 *   - thirdPartyAuthRandomLocal
 *   - messageIdMismatchWithUnalignedAuth  (PSL-aware; mail-auth-signal uses exact-domain)
 *   - messageIdUnregistrableMismatch
 *   - fromSenderMismatchWithUnalignedAuth (Sender header; not covered upstream)
 *   - deepRandomFromSubdomain
 *   - unsecuredDeepSubdomain
 *   - delegatedDkimAlignedRouteConsistent
 *   - spfPassDkimFailRandomLocal
 *   - dkimAlignedLexicalMitigation
 *   - ownDomainAuthFail
 *   - unparseableFromWithInfrastructureMismatch
 *   - dmarcFailDkimAlignedListMitigation
 *   - geoTokenCompoundDomain
 *   - deepServiceWordSubdomain
 *   - dkimFailWithAlignedPass
 *   - brandDivergencePhishing
 *
 * mail-auth-signal composite signal scores (consumed via adaptCompositeSignals):
 *   - unauthenticatedFromSpoof: From has no aligned auth and a sender inconsistency signal.
 *     Complements messageIdMismatchWithUnalignedAuth and fromSenderMismatchWithUnalignedAuth
 *     by covering Reply-To / Return-Path / DMARC header.from mismatches and exact-domain
 *     SPF/DKIM disagreements. Suppressed by the adapter when the add-on's PSL-aware check
 *     considers auth aligned (prevents penalising subdomain senders like news.example.com
 *     when SPF passes for example.com).
 *   - authenticatedDisplayNameSpoof: Authenticated sender's display name embeds a different
 *     domain (e.g. From: "user@evil.com" <alice@example.com>). Distinct from
 *     brandDivergencePhishing, which uses brand-inference Jaro-Winkler matching.
 *   - publicDomainSpoofing: Header From claims a major public mailbox provider domain
 *     (Outlook, iCloud, Yahoo, etc.) but the sender's infrastructure is inconsistent —
 *     failed DMARC/SPF and mismatched Return-Path or Message-ID provider domains.
 *     Genuine mail from these providers should have aligned authentication.
 *     Signal emitted by mail-auth-signal as composite.publicMailboxSpoofingCandidate.
 */
export const DEFAULT_COMPOSITE_SCORES = {
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
  geoTokenCompoundDomain: 50,
  deepServiceWordSubdomain: 30,
  dkimFailWithAlignedPass: 35,
  brandDivergencePhishing: 50,
  // mail-auth-signal composite signal scores
  unauthenticatedFromSpoof: 35,
  authenticatedDisplayNameSpoof: 40,
  publicDomainSpoofing: 45,
};

/**
 * Geo/token risk tokens found exclusively in spam registrable domain cores.
 * These tokens alone are not sufficient — they must appear in a hyphen-compound
 * registrable domain core alongside an auth context and no DKIM alignment.
 */
const GEO_RISK_TOKENS = new Set(['cn', 'zh', 'china', 'official', 'svip', 'apps']);

/**
 * Service-like intermediate subdomain labels observed in deep-subdomain spam.
 * Plain "mail" is intentionally excluded; only the "mail-NN" pattern fires.
 */
const SERVICE_WORD_LABELS = new Set(['payment', 'notice', 'portal', 'ship', 'auth', 'promo']);

/** Returns true when a label matches the mail-NN pattern (e.g. mail-14). */
function isMailNNLabel(label) {
  return /^mail-\d+$/.test(label);
}

/**
 * Compute raw Message-ID / From domain mismatch metrics for decision-log storage.
 *
 * All five metrics are always returned so the log has a complete picture even when
 * the composite rule does not fire.
 *
 * @param {object} opts
 * @param {string|null} [opts.messageIdDomain]  - Domain parsed from the Message-ID header
 * @param {string}      [opts.fromDomain]       - RFC5322 From domain (lowercased)
 * @param {boolean}     [opts.anyAuthAligned]   - Whether any trusted auth pass aligns with From
 * @returns {{
 *   messageIdDomain: string|null,
 *   messageIdRegistrableDomain: string|null,
 *   messageIdIsIcann: boolean|null,
 *   messageIdSubdomainDepth: number|null,
 *   messageIdDomainMatchesFromDomain: boolean|null,
 *   messageIdFromDomainMismatch: boolean,
 *   messageIdMismatchWithUnalignedAuth: boolean
 * }}
 */
export function computeMessageIdMetrics({ messageIdDomain = null, fromDomain = '', anyAuthAligned = false } = {}) {
  const fromParts = getDomainParts(fromDomain);
  const midParts = messageIdDomain ? getDomainParts(messageIdDomain) : null;
  const messageIdRegistrableDomain = midParts?.registrableDomain ?? null;
  const messageIdIsIcann = midParts?.isIcann ?? null;
  const messageIdSubdomainDepth = midParts ? midParts.subdomainDepth : null;

  const canCompare = fromParts.registrableDomain !== null && messageIdRegistrableDomain !== null;
  const messageIdDomainMatchesFromDomain = canCompare
    ? messageIdRegistrableDomain === fromParts.registrableDomain
    : null;
  const messageIdFromDomainMismatch = canCompare && messageIdDomainMatchesFromDomain === false;
  const messageIdMismatchWithUnalignedAuth = messageIdFromDomainMismatch && !anyAuthAligned;

  return {
    messageIdDomain,
    messageIdRegistrableDomain,
    messageIdIsIcann,
    messageIdSubdomainDepth,
    messageIdDomainMatchesFromDomain,
    messageIdFromDomainMismatch,
    messageIdMismatchWithUnalignedAuth,
  };
}

/**
 * Score Layer 4 composite detection rules.
 *
 * @param {object} opts
 * @param {object}      [opts.alignmentSummary]             - { spfAligned, anyDkimAligned, anyAuthAligned, anyTrustedAuthPass }
 * @param {string}      [opts.fromDomain]                   - RFC5322 From domain (lowercased)
 * @param {string}      [opts.fromLocalPart]                - RFC5322 From local part, original case
 * @param {string|null} [opts.messageIdDomain]              - Domain parsed from the Message-ID header
 * @param {object}      [opts.compositeScores]              - Configurable score values; falls back to defaults
 * @param {string|null} [opts.senderRegistrableDomain]      - PSL registrable domain of Sender header, or null when absent
 * @param {boolean|null} [opts.senderDomainMatchesFromDomain] - Whether Sender registrable domain matches From, or null
 * @param {boolean}     [opts.hasListHeaders]               - True when List-Id or List-Unsubscribe header is present
 * @param {string|null} [opts.spfMailFromRegistrableDomain] - PSL registrable domain of the first trusted SPF pass MAIL FROM, or null
 * @param {boolean}     [opts.hasLexicalPenalty]           - True when Layer 3 produced at least one lexical penalty reason
 * @param {string[]}     [opts.accountDomains]               - PSL registrable domains of all receiving account identities, or empty array when unavailable
 * @param {string|null} [opts.returnPathRegistrableDomain]  - PSL registrable domain of Return-Path header, or null when absent
 * @param {object|null} [opts.displayNameMetrics]           - Display-name brand inference metrics, or null when unavailable
 * @returns {{ score: number, scoreReasons: Array }}
 */
export function scoreLayer4({
  alignmentSummary = {},
  fromDomain = '',
  fromLocalPart = '',
  messageIdDomain = null,
  compositeScores,
  senderRegistrableDomain = null,
  senderDomainMatchesFromDomain = null,
  hasListHeaders = false,
  spfMailFromRegistrableDomain = null,
  hasLexicalPenalty = false,
  accountDomains = [],
  returnPathRegistrableDomain = null,
  displayNameMetrics = null,
} = {}) {
  const scores = { ...DEFAULT_COMPOSITE_SCORES, ...compositeScores };
  const scoreReasons = [];
  let totalDelta = 0;

  const {
    spfAligned = false,
    anyDkimAligned = false,
    anyAuthAligned = false,
    anyTrustedAuthPass = false,
    anyTrustedSpfPass = false,
    anyTrustedDkimFail = false,
    dkimFailDomains = [],
    anyTrustedDmarcFail = false,
    anyTrustedDmarcPass = false,
    anyTrustedDmarcNonNone = false,
    anyTrustedDmarcNone = false,
    anyTrustedSpfFail = false,
  } = alignmentSummary;

  // composite.spfAlignedDkimUnalignedRandomLocal:
  //   SPF aligned + DKIM not aligned + local part random-looking + length >= 7.
  //   The length gate prevents false positives on short local parts like "info".
  if (
    spfAligned &&
    !anyDkimAligned &&
    fromLocalPart.length >= 7 &&
    isRandomLookingLocalPart(fromLocalPart)
  ) {
    const delta = scores.spfAlignedDkimUnalignedRandomLocal;
    scoreReasons.push({
      key: 'composite.spfAlignedDkimUnalignedRandomLocal',
      label: 'SPF aligned, DKIM unaligned, random local part',
      delta,
      localPart: fromLocalPart,
    });
    totalDelta += delta;
  }

  // composite.authAlignedRandomDomain:
  //   Any auth-pass result aligned with From domain + domain label is random-looking.
  //   Catches authenticated senders whose domain itself looks disposable.
  if (anyAuthAligned && fromDomain) {
    const labels = fromDomain.split('.');
    for (const label of labels) {
      if (isRandomLookingLabel(label)) {
        const delta = scores.authAlignedRandomDomain;
        scoreReasons.push({
          key: 'composite.authAlignedRandomDomain',
          label: 'Auth-aligned sender with random-looking domain',
          delta,
          domain: fromDomain,
          matchedLabel: label,
        });
        totalDelta += delta;
        break;
      }
    }
  }

  // composite.thirdPartyAuthRandomLocal:
  //   A trusted auth pass exists (SPF or DKIM) but none of those passes align
  //   with the RFC5322 From domain, and the local part looks random-generated.
  //   Catches delivery-service-abuse spam where infrastructure auth passes while
  //   the visible From domain is unrelated.
  if (
    anyTrustedAuthPass &&
    !anyAuthAligned &&
    fromLocalPart.length >= 7 &&
    isRandomLookingLocalPart(fromLocalPart)
  ) {
    const delta = scores.thirdPartyAuthRandomLocal;
    scoreReasons.push({
      key: 'composite.thirdPartyAuthRandomLocal',
      label: 'Third-party auth pass with random local part, no alignment',
      delta,
      localPart: fromLocalPart,
    });
    totalDelta += delta;
  }

  // composite.messageIdMismatchWithUnalignedAuth:
  //   The Message-ID registrable domain differs from the From registrable domain
  //   AND no trusted SPF or DKIM pass aligns with the From domain.
  //   Plain Message-ID / From mismatch is not scored alone; mismatch becomes a
  //   useful signal only when combined with unaligned authentication.
  //   DKIM-aligned messages are never penalised by this rule.
  const midMetrics = computeMessageIdMetrics({ messageIdDomain, fromDomain, anyAuthAligned });
  if (midMetrics.messageIdMismatchWithUnalignedAuth) {
    const delta = scores.messageIdMismatchWithUnalignedAuth;
    scoreReasons.push({
      key: 'composite.messageIdMismatchWithUnalignedAuth',
      label: 'Message-ID domain mismatch with unaligned authentication',
      delta,
      messageIdDomain,
      messageIdRegistrableDomain: midMetrics.messageIdRegistrableDomain,
      fromDomain: fromDomain || null,
    });
    totalDelta += delta;
  }

  // composite.messageIdUnregistrableMismatch:
  //   From has a registrable domain + Message-ID domain is present but its
  //   registrable domain is null (e.g. unrecognised TLD) + a trusted SPF pass
  //   exists (authentication context for the sender) + the Message-ID host domain
  //   differs from the From domain at the host level.
  //   Plain mismatch is not scored; the signal requires an unregistrable Message-ID
  //   domain so that normal third-party senders with parseable domains (sendgrid.net
  //   etc.) are not penalised by this rule.
  //   Missing Message-ID does not trigger this rule (messageIdDomain must be non-null).
  //   Suppressed when anyDkimAligned is true: a passing DKIM signature aligned with
  //   the From domain is strong evidence of legitimate delegated delivery even when
  //   the Message-ID domain is an internal delivery host (e.g. geopod-ismtpd-15).
  if (
    midMetrics.messageIdDomain !== null &&
    midMetrics.messageIdRegistrableDomain === null &&
    getDomainParts(fromDomain).registrableDomain !== null &&
    anyTrustedSpfPass &&
    !anyDkimAligned &&
    midMetrics.messageIdDomain.toLowerCase() !== fromDomain.toLowerCase()
  ) {
    const delta = scores.messageIdUnregistrableMismatch;
    scoreReasons.push({
      key: 'composite.messageIdUnregistrableMismatch',
      label: 'Message-ID domain unregistrable, mismatch with From',
      delta,
      fromDomain: fromDomain || null,
      messageIdDomain: midMetrics.messageIdDomain,
      messageIdRegistrableDomain: midMetrics.messageIdRegistrableDomain,
    });
    totalDelta += delta;
  }

  // composite.deepRandomFromSubdomain:
  //   PSL-backed subdomainDepth >= 2 AND the leftmost domain label is random-looking
  //   AND at least one trusted auth pass aligns with the From domain.
  //   Catches spam like ppbwwcyr.customer.233biz.com where a random-looking
  //   leftmost subdomain label rides a multi-level subdomain structure.
  //   anyAuthAligned is required (safer than anyTrustedAuthPass) to avoid firing
  //   on unauthenticated disposable senders.
  if (anyAuthAligned && fromDomain) {
    const fromParts = getDomainParts(fromDomain);
    if (fromParts.subdomainDepth >= 2) {
      const leftmost = fromDomain.split('.')[0];
      if (isRandomLookingLabel(leftmost)) {
        const delta = scores.deepRandomFromSubdomain;
        scoreReasons.push({
          key: 'composite.deepRandomFromSubdomain',
          label: 'Deep random-looking From subdomain',
          delta,
          fromDomain,
          subdomainDepth: fromParts.subdomainDepth,
          matchedLabel: leftmost,
          registrableDomain: fromParts.registrableDomain,
        });
        totalDelta += delta;
      }
    }
  }

  // composite.unsecuredDeepSubdomain:
  //   PSL-backed subdomainDepth >= 2
  //   AND no trusted authentication aligns with the From domain (anyAuthAligned is false)
  //   AND a trusted Authentication-Results header explicitly reported dmarc=none
  //   (anyTrustedDmarcNone is true). Requiring a positive trusted dmarc=none observation
  //   prevents false positives when no trusted AR headers exist at all or when the
  //   trusted server omitted DMARC reporting. Treats dmarc=none as confirmation that
  //   the domain has no enforcement policy (p=none or no DMARC record).
  //   AND no other trusted header reported a non-none DMARC result (!anyTrustedDmarcNonNone).
  //   Suppresses the rule when mixed results exist (e.g. one header reports dmarc=none
  //   while another reports dmarc=pass or dmarc=fail), since a trusted server already
  //   evaluated DMARC enforcement for this message.
  //   Catches deep-subdomain senders whose domain has no DMARC enforcement policy,
  //   allowing plausible-looking subdomain structures (e.g. sivakeso.support.sn5799.com)
  //   to evade both random-label and service-word heuristics.
  //   Complements deepRandomFromSubdomain (which requires anyAuthAligned) and
  //   deepServiceWordSubdomain (which requires anyTrustedAuthPass, not DMARC context).
  if (!anyAuthAligned && anyTrustedDmarcNone && !anyTrustedDmarcNonNone && fromDomain) {
    const fromParts = getDomainParts(fromDomain);
    if (fromParts.subdomainDepth >= 2) {
      const delta = scores.unsecuredDeepSubdomain;
      scoreReasons.push({
        key: 'composite.unsecuredDeepSubdomain',
        label: 'DMARC-none deep subdomain',
        delta,
        fromDomain,
        subdomainDepth: fromParts.subdomainDepth,
        registrableDomain: fromParts.registrableDomain,
      });
      totalDelta += delta;
    }
  }

  // composite.spfPassDkimFailRandomLocal:
  //   A trusted SPF pass exists + at least one trusted DKIM result is fail
  //   + no passing DKIM signature aligns with From + random-looking local part.
  //   Targets spam patterns where attackers own a domain so SPF passes, but DKIM
  //   is absent or broken, while the visible From local part is random-generated.
  //   DKIM fail can occur in forwarding/mailing-list scenarios, so this is a
  //   scored contribution rather than a hard verdict.
  if (
    anyTrustedSpfPass &&
    anyTrustedDkimFail &&
    !anyDkimAligned &&
    fromLocalPart.length >= 7 &&
    isRandomLookingLocalPart(fromLocalPart)
  ) {
    const delta = scores.spfPassDkimFailRandomLocal;
    scoreReasons.push({
      key: 'composite.spfPassDkimFailRandomLocal',
      label: 'SPF pass, DKIM fail, random local part',
      delta,
      localPart: fromLocalPart,
      dkimFailDomains,
    });
    totalDelta += delta;
  }

  // composite.fromSenderMismatchWithUnalignedAuth:
  //   Sender header present + Sender registrable domain differs from From
  //   registrable domain + no trusted auth pass aligns with From + no list headers.
  //   Plain From/Sender mismatch is not scored alone because it is common in
  //   legitimate mailing lists and delegated sending. The mismatch becomes a
  //   useful signal only when authentication is also unaligned and the message
  //   is not list mail. ARC/forwarding guard is omitted pending a trusted-ARC
  //   metric in a future release; see SPEC.md Layer 4 for the guard rationale.
  if (
    senderRegistrableDomain !== null &&
    senderDomainMatchesFromDomain === false &&
    !anyAuthAligned &&
    !hasListHeaders
  ) {
    const delta = scores.fromSenderMismatchWithUnalignedAuth;
    scoreReasons.push({
      key: 'composite.fromSenderMismatchWithUnalignedAuth',
      label: 'From/Sender mismatch with unaligned authentication',
      delta,
      senderRegistrableDomain,
      fromDomain: fromDomain || null,
    });
    totalDelta += delta;
  }

  // composite.delegatedDkimAlignedRouteConsistent (mitigation):
  //   DKIM pass aligned with From + SPF not aligned with From + Message-ID
  //   registrable domain matches SPF MAIL FROM registrable domain + list headers
  //   present. Legitimate delegated senders (ESP/newsletter/CRM) typically have
  //   DKIM signed by the brand domain while both the SPF MAIL FROM and Message-ID
  //   come from the delivery provider. The route consistency (Message-ID domain
  //   matching SPF MAIL FROM domain) distinguishes genuine delegated delivery
  //   from spoofing where those fields are uncoordinated. hasListHeaders is
  //   required because the route-consistency pattern can also be satisfied by a
  //   self-signed disposable-domain sender using only their own controlled
  //   domains (anyDkimAligned + !spfAligned + matching Message-ID/SPF MAIL FROM
  //   domain). List headers limit this mitigation to the newsletter/list use
  //   case it was designed to rescue. List headers alone are not a trust anchor
  //   — attackers can spoof them — but here they serve as a narrowing condition
  //   on an already DKIM-aligned route.
  if (
    anyDkimAligned &&
    !spfAligned &&
    midMetrics.messageIdRegistrableDomain !== null &&
    spfMailFromRegistrableDomain !== null &&
    midMetrics.messageIdRegistrableDomain === spfMailFromRegistrableDomain &&
    hasListHeaders
  ) {
    const delta = scores.delegatedDkimAlignedRouteConsistent;
    scoreReasons.push({
      key: 'composite.delegatedDkimAlignedRouteConsistent',
      label: 'Delegated newsletter: DKIM-aligned, route-consistent',
      delta,
      fromDomain: fromDomain || null,
      messageIdRegistrableDomain: midMetrics.messageIdRegistrableDomain,
      spfMailFromRegistrableDomain,
    });
    totalDelta += delta;
  }

  // composite.dkimAlignedLexicalMitigation (mitigation):
  //   Reduces lexical false positives for legitimate delegated senders.
  //   Fires when DKIM aligns with From, Layer 3 produced a lexical penalty,
  //   the From registrable domain main label is not itself random-looking,
  //   the delivery route is consistent (same conditions as
  //   delegatedDkimAlignedRouteConsistent), and list headers are present.
  //   Does not fire when the stronger messageIdUnregistrableMismatch rule
  //   already penalised this message. hasListHeaders is required for the same
  //   reason as delegatedDkimAlignedRouteConsistent: the delegated-route pattern
  //   can be satisfied by self-signed disposable-domain senders; list headers
  //   narrow the mitigation to the newsletter/list use case it was intended to
  //   rescue. List headers alone are not a trust anchor — attackers can spoof
  //   them — but here they serve as a narrowing condition on an already
  //   DKIM-aligned route.
  if (
    anyDkimAligned &&
    hasLexicalPenalty &&
    !spfAligned &&
    midMetrics.messageIdRegistrableDomain !== null &&
    spfMailFromRegistrableDomain !== null &&
    midMetrics.messageIdRegistrableDomain === spfMailFromRegistrableDomain &&
    !scoreReasons.some(r => r.key === 'composite.messageIdUnregistrableMismatch') &&
    hasListHeaders
  ) {
    const fromParts = getDomainParts(fromDomain);
    const registrableDomain = fromParts.registrableDomain;
    const mainLabel = registrableDomain ? registrableDomain.split('.')[0] : null;
    if (mainLabel && !isRandomLookingLabel(mainLabel)) {
      const delta = scores.dkimAlignedLexicalMitigation;
      scoreReasons.push({
        key: 'composite.dkimAlignedLexicalMitigation',
        label: 'DKIM-aligned lexical false-positive mitigation',
        delta,
        fromDomain: fromDomain || null,
        fromRegistrableDomain: registrableDomain,
        messageIdRegistrableDomain: midMetrics.messageIdRegistrableDomain,
        spfMailFromRegistrableDomain,
      });
      totalDelta += delta;
    }
  }

  // composite.ownDomainAuthFail:
  //   The From registrable domain matches any receiving account identity's registrable domain
  //   AND trusted authentication shows DMARC fail or SPF fail.
  //   Account-domain spoofing (claiming to be from your own domain while failing auth)
  //   is a strong phishing signal. Conservative when accountDomains is empty.
  if (accountDomains.length > 0 && fromDomain) {
    const fromRegistrableDomain = getDomainParts(fromDomain).registrableDomain;
    const matchedAccountDomain = fromRegistrableDomain
      ? accountDomains.find(d => d === fromRegistrableDomain)
      : undefined;
    if (matchedAccountDomain !== undefined && (anyTrustedDmarcFail || anyTrustedSpfFail)) {
      const delta = scores.ownDomainAuthFail;
      scoreReasons.push({
        key: 'composite.ownDomainAuthFail',
        label: 'Own account domain with failed authentication',
        delta,
        fromDomain,
        accountDomain: matchedAccountDomain,
        ...(anyTrustedDmarcFail ? { dmarcResult: 'fail' } : {}),
        ...(anyTrustedSpfFail ? { spfResult: 'fail' } : {}),
      });
      totalDelta += delta;
    }
  }

  // composite.dmarcFailDkimAlignedListMitigation (mitigation):
  //   DMARC fail + DKIM aligned with From + list headers present.
  //   Legitimate mailing-list and delegated-sender mail routinely fails DMARC
  //   because SPF is delegated while DKIM is signed by the brand domain.
  //   When both DKIM alignment and list headers confirm the mailing-list pattern,
  //   the DMARC fail score is mitigated. The explicit scoreReasons entry explains
  //   in the log why the DMARC fail did not push the message to Review.
  if (anyTrustedDmarcFail && anyDkimAligned && hasListHeaders) {
    const delta = scores.dmarcFailDkimAlignedListMitigation;
    scoreReasons.push({
      key: 'composite.dmarcFailDkimAlignedListMitigation',
      label: 'DMARC fail mitigated: DKIM aligned and list headers present',
      delta,
    });
    totalDelta += delta;
  }

  // composite.geoTokenCompoundDomain:
  //   The registrable domain core (left of the public suffix) is hyphen-compound
  //   AND at least one hyphen-separated token matches a small static set of
  //   geo/spam tokens (cn, zh, china, official, svip, apps)
  //   AND a trusted auth pass exists (disposable domain uses real auth infra)
  //   AND no passing DKIM signature is aligned with From.
  //   cn or china alone are not sufficient; the token must appear inside a
  //   hyphenated compound domain to fire.
  if (anyTrustedAuthPass && !anyDkimAligned && fromDomain) {
    const fromParts = getDomainParts(fromDomain);
    const regDomain = fromParts.registrableDomain;
    const pubSuffix = fromParts.publicSuffix;
    if (regDomain && pubSuffix) {
      const core = regDomain.slice(0, -(pubSuffix.length + 1));
      if (core.includes('-')) {
        const tokens = core.split('-');
        const matchedToken = tokens.find(t => GEO_RISK_TOKENS.has(t));
        if (matchedToken !== undefined) {
          const delta = scores.geoTokenCompoundDomain;
          scoreReasons.push({
            key: 'composite.geoTokenCompoundDomain',
            label: 'Geo/token compound registrable domain',
            delta,
            fromDomain,
            registrableDomain: regDomain,
            registrableDomainCore: core,
            matchedToken,
          });
          totalDelta += delta;
        }
      }
    }
  }

  // composite.deepServiceWordSubdomain:
  //   PSL-backed subdomainDepth >= 2
  //   AND at least one intermediate subdomain label (between leftmost and
  //   registrable domain) matches a service-like word or the mail-NN pattern
  //   AND a trusted auth pass exists (disposable domain uses real auth infra)
  //   AND no passing DKIM signature is aligned with From.
  //   Plain "mail" is NOT a service word here; only mail-NN (e.g. mail-14) fires.
  if (anyTrustedAuthPass && !anyDkimAligned && fromDomain) {
    const fromParts = getDomainParts(fromDomain);
    if (fromParts.subdomainDepth >= 2 && fromParts.subdomain) {
      const subLabels = fromParts.subdomain.split('.');
      const leftmostLabel = subLabels[0];
      // Intermediate labels are all subdomain labels except the leftmost.
      const intermediateLabels = subLabels.slice(1);
      const matchedLabel = intermediateLabels.find(
        l => SERVICE_WORD_LABELS.has(l) || isMailNNLabel(l)
      );
      if (matchedLabel !== undefined) {
        const delta = scores.deepServiceWordSubdomain;
        scoreReasons.push({
          key: 'composite.deepServiceWordSubdomain',
          label: 'Deep service-word subdomain',
          delta,
          fromDomain,
          subdomainDepth: fromParts.subdomainDepth,
          matchedLabel,
          leftmostLabel,
          registrableDomain: fromParts.registrableDomain,
        });
        totalDelta += delta;
      }
    }
  }

  // composite.dkimFailWithAlignedPass:
  //   At least one trusted DKIM result is fail AND at least one passing DKIM
  //   signature is aligned with the RFC5322 From domain.
  //   This looks like a sloppy double-signature or bulk-sender fingerprint:
  //   a broken or extra DKIM signature alongside a genuine brand DKIM pass.
  //   DKIM fail alone is not scored highly because mailing lists and forwarding
  //   can break DKIM signatures, but when an aligned DKIM pass is also present
  //   the failure is not from those scenarios (they typically lose the aligned pass).
  if (anyTrustedDkimFail && anyDkimAligned) {
    const delta = scores.dkimFailWithAlignedPass;
    scoreReasons.push({
      key: 'composite.dkimFailWithAlignedPass',
      label: 'DKIM fail with aligned DKIM pass',
      delta,
      dkimFailDomains,
    });
    totalDelta += delta;
  }

  // composite.unparseableFromWithInfrastructureMismatch:
  //   From domain could not be extracted (empty fromDomain) AND no trusted auth
  //   pass exists (authentication does not vouch for any sender identity) AND at
  //   least one infrastructure header (Sender, Return-Path, or Message-ID) is
  //   present. A missing From domain should not silently score 0 when other
  //   infrastructure signals indicate that something sent this message. This is
  //   a composite rule — a parse failure alone does not trigger it.
  if (
    !fromDomain &&
    !anyTrustedAuthPass &&
    (senderRegistrableDomain !== null ||
      returnPathRegistrableDomain !== null ||
      messageIdDomain !== null)
  ) {
    const delta = scores.unparseableFromWithInfrastructureMismatch;
    scoreReasons.push({
      key: 'composite.unparseableFromWithInfrastructureMismatch',
      label: 'Unparseable From with infrastructure mismatch',
      delta,
      ...(senderRegistrableDomain !== null ? { senderRegistrableDomain } : {}),
      ...(returnPathRegistrableDomain !== null ? { returnPathRegistrableDomain } : {}),
      ...(messageIdDomain !== null ? { messageIdDomain } : {}),
    });
    totalDelta += delta;
  }

  // composite.brandDivergencePhishing:
  //   The visible From display name matches a well-known brand (Jaro-Winkler
  //   score >= BRAND_INFERENCE_MIN_SCORE, unambiguous) but the From registrable
  //   domain does not match that brand's canonical domain. brandDomainMismatch is
  //   null when inference did not fire, so checking === true already gates all
  //   threshold and ambiguity requirements.
  //
  //   Personal-name guard: when displayNameBrandLikeShape is false (two title-case
  //   words), only fire if:
  //   (a) the second word is a common brand-service noun ("Apple Support",
  //       "Amazon Security") — these are phishing display names, not personal names; or
  //   (b) the normalized display name closely covers the brand core
  //       (brand-core length / display-name length >= 0.8). Genuine two-word brands
  //       ("American Express" → "americanexpress") equal the core; personal names
  //       whose first word is a brand ("Apple Martin" → "applemartin" vs core
  //       "apple") are suppressed. When displayNameNormalized is absent the guard
  //       is bypassed.
  //
  //   Regional-variant guard: a From domain whose core label matches the inferred
  //   brand core is exempt only when it uses an ICANN compound ccTLD (e.g. co.jp,
  //   co.uk) or a classic 2-letter ccTLD that is not commonly registered as a
  //   generic (see _GENERIC_USE_CCTLDS). Generic multi-letter TLDs (.xyz, .app,
  //   .dev) and commonly-used-as-generic ccTLDs (.co, .io, .me, etc.) are NOT
  //   exempt. Private-suffix domains (apple.blogspot.com) always fire because
  //   they are multi-tenant hosting platforms, not legitimate regional brand sites.
  const _fromPartsForBrand = getDomainParts(fromDomain);
  const _fromIsPrivateSuffix = _fromPartsForBrand.isPrivate === true;
  // ccTLDs commonly registered as generic-purpose TLDs; not treated as regional
  // brand indicators even though they are 2-letter ICANN entries.
  const _GENERIC_USE_CCTLDS = new Set(['co', 'io', 'me', 'ai', 'tv', 'cc', 'vc', 'la', 'to', 'ws']);
  const _fromPublicSuffix = _fromPartsForBrand.publicSuffix ?? '';
  const _inferredBrandDomain = displayNameMetrics?.inferredBrandDomain ?? null;
  const _fromCoreMatchesBrand =
    _inferredBrandDomain !== null &&
    extractDomainCoreLabel(fromDomain) === extractDomainCoreLabel(_inferredBrandDomain);
  // A regional brand variant must be ICANN, share the core label, and use either a
  // compound ccTLD (co.jp, co.uk) or a classic 2-letter ccTLD not in the generic list.
  const _fromIsRegionalBrandVariant =
    !_fromIsPrivateSuffix &&
    _fromPartsForBrand.isIcann === true &&
    _fromCoreMatchesBrand &&
    (_fromPublicSuffix.includes('.') ||
      (_fromPublicSuffix.length === 2 && !_GENERIC_USE_CCTLDS.has(_fromPublicSuffix)));

  // Personal-name guard.
  // Service nouns that commonly follow a brand name in phishing display names
  // ("Apple Support", "Amazon Security").  A two-Title-Case-word display name
  // whose second token is in this set is treated as a brand+service shape and
  // passes the guard even though isBrandLikeShape() returns false for it.
  const _BRAND_SERVICE_WORDS = new Set([
    'account', 'accounts', 'admin', 'alert', 'alerts', 'billing',
    'care', 'center', 'customer', 'delivery', 'help', 'helpdesk',
    'info', 'mail', 'message', 'messages', 'noreply', 'notice',
    'notices', 'notification', 'notifications', 'official', 'online',
    'payment', 'payments', 'security', 'service', 'services',
    'support', 'team', 'update', 'updates', 'verification', 'verify',
  ]);
  const _brandCoreNormalized = normalizeForComparison(
    extractDomainCoreLabel(_inferredBrandDomain) ?? '',
  );
  const _displayNameNorm = displayNameMetrics?.displayNameNormalized ?? null;
  const _isPersonalNameShape = displayNameMetrics?.displayNameBrandLikeShape === false;
  // Brand+service shape: two Title-Case words where the second is a service noun.
  const _displayNameWords = (displayNameMetrics?.displayNameRaw ?? '').trim().split(/\s+/);
  const _isBrandServiceShape =
    _isPersonalNameShape &&
    _displayNameWords.length === 2 &&
    _BRAND_SERVICE_WORDS.has((_displayNameWords[1] ?? '').toLowerCase());
  const _personalNameGuardPassed =
    !_isPersonalNameShape ||
    _isBrandServiceShape ||
    _displayNameNorm === null ||
    (_brandCoreNormalized.length > 0 &&
      _displayNameNorm.length > 0 &&
      _brandCoreNormalized.length / _displayNameNorm.length >= 0.8);

  if (
    displayNameMetrics !== null &&
    displayNameMetrics.brandDomainMismatch === true &&
    displayNameMetrics.inferredBrandDomain !== null &&
    displayNameMetrics.inferredBrandScore !== null &&
    displayNameMetrics.inferredBrandScore >= BRAND_INFERENCE_MIN_SCORE &&
    !_fromIsRegionalBrandVariant &&
    _personalNameGuardPassed
  ) {
    const delta = scores.brandDivergencePhishing;
    scoreReasons.push({
      key: 'composite.brandDivergencePhishing',
      label: 'Display-name brand divergence phishing',
      delta,
      inferredBrandDomain: displayNameMetrics.inferredBrandDomain,
      inferredBrandScore: displayNameMetrics.inferredBrandScore,
      ...(displayNameMetrics.displayNameSpacedCamouflage
        ? { displayNameSpacedCamouflage: true, displayNameRaw: displayNameMetrics.displayNameRaw ?? null }
        : {}),
    });
    totalDelta += delta;
  }

  return { score: totalDelta, scoreReasons };
}
