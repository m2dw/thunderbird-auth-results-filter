import {
  analyzeMessage,
  defaultCompositeRules,
} from '../vendor/mail-auth-signal.esm.js';
import { DEFAULT_COMPOSITE_SCORES } from '../core/compositeRules.js';

/**
 * Strip the optional integer version token that follows the authserv-id in an
 * Authentication-Results header value.
 *
 * RFC 7601 §2.2: `authserv-id [SP version] ";"`. The package parser keeps the
 * version as part of the authservId string, which breaks exact-match trust checks
 * when callers supply bare hostnames. Stripping it before processing brings the
 * adapter into line with the existing core parser behavior.
 *
 * @param {string} arValue - Raw Authentication-Results header value
 * @returns {string}
 */
function stripArVersionToken(arValue) {
  // 'mx.example.com 1; dmarc=fail' → 'mx.example.com; dmarc=fail'
  return arValue.replace(/^(\S+)\s+\d+(\s*(?:;|$))/, '$1$2');
}

/**
 * Pre-normalize Authentication-Results header values in a headers input by
 * stripping optional version tokens from each authserv-id.
 *
 * @param {Record<string, string | string[]> | Array<{name: string, value: string}>} headers
 * @returns {Record<string, string | string[]> | Array<{name: string, value: string}>}
 */
function normalizeArVersionsInHeaders(headers) {
  if (Array.isArray(headers)) {
    return headers.map(h =>
      h.name.toLowerCase() === 'authentication-results'
        ? { ...h, value: stripArVersionToken(h.value) }
        : h
    );
  }
  if (headers && typeof headers === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === 'authentication-results') {
        result[key] = Array.isArray(value) ? value.map(stripArVersionToken) : stripArVersionToken(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  return headers;
}

// Add-on override of the upstream composite.publicMailboxSpoofingCandidate rule.
// mail-auth-signal 0.4.0 ships its own version of this rule, but that version
// uses a smaller Yahoo domain catalog and fires on any unaligned auth — it does
// not gate on infrastructure mismatch (Return-Path / Message-ID provider cross).
// This override replaces the upstream rule (see _DEFAULT_COMPOSITE_RULES below)
// to preserve the narrower, mismatch-gated detection and the broader Yahoo catalog.
const _PUBLIC_MAILBOX_PROVIDER_MAP = new Map([
  ['outlook.com', 'microsoft'],
  ['hotmail.com', 'microsoft'],
  ['live.com', 'microsoft'],
  ['msn.com', 'microsoft'],
  ['icloud.com', 'apple'],
  ['me.com', 'apple'],
  ['mac.com', 'apple'],
  ['yahoo.com', 'yahoo'],
  ['yahoo.co.jp', 'yahoo'],
  ['yahoo.co.uk', 'yahoo'],
  ['yahoo.fr', 'yahoo'],
  ['yahoo.de', 'yahoo'],
  ['yahoo.it', 'yahoo'],
  ['yahoo.es', 'yahoo'],
  ['yahoo.ca', 'yahoo'],
  ['yahoo.com.au', 'yahoo'],
  ['yahoo.com.br', 'yahoo'],
  ['gmail.com', 'google'],
  ['googlemail.com', 'google'],
  ['aol.com', 'aol'],
]);

const _PUBLIC_MAILBOX_DOMAINS = new Set(_PUBLIC_MAILBOX_PROVIDER_MAP.keys());

const publicMailboxSpoofingCandidateRule = {
  key: 'composite.publicMailboxSpoofingCandidate',
  description: 'From claims a major public mailbox provider domain but authentication is unaligned and infrastructure is inconsistent.',
  evaluate({ metrics }) {
    const { authentication, fromDomain } = metrics;
    if (!fromDomain || !_PUBLIC_MAILBOX_DOMAINS.has(fromDomain.toLowerCase())) return [];
    if (authentication.trustedHeaderCount === 0) return [];
    if (authentication.anyAuthAligned) return [];
    const fromProvider = _getPublicMailboxProvider(fromDomain);
    const returnPathMismatch =
      metrics.returnPathDomainMatchesFromDomain === false &&
      !metrics.returnPathNullReversePath &&
      metrics.returnPathDomain !== null &&
      _isPublicMailboxHost(metrics.returnPathDomain) &&
      _getPublicMailboxProvider(metrics.returnPathDomain) !== fromProvider;
    const messageIdMismatch =
      metrics.messageIdDomainMatchesFromDomain === false &&
      metrics.messageIdDomain !== null &&
      _isPublicMailboxHost(metrics.messageIdDomain) &&
      _getPublicMailboxProvider(metrics.messageIdDomain) !== fromProvider;
    if (!returnPathMismatch && !messageIdMismatch) return [];
    return [{
      key: 'composite.publicMailboxSpoofingCandidate',
      category: 'composite',
      severity: 'high',
      message: 'From claims a major public mailbox provider but authentication is unaligned and infrastructure disagrees.',
      data: {
        fromDomain,
        provider: fromDomain,
        anyAuthAligned: authentication.anyAuthAligned,
      },
    }];
  },
};

// Returns true if host is a catalogued public mailbox domain or any subdomain of one.
// e.g. 'bounce.mail.icloud.com' → true (icloud.com), 'mx.yahoo.co.jp' → true (yahoo.co.jp)
function _isPublicMailboxHost(host) {
  return _getPublicMailboxProvider(host) !== null;
}

// Returns the provider family string for a catalogued host or its subdomain, or null.
// e.g. 'bounce.mail.outlook.com' → 'microsoft', 'mx.yahoo.co.jp' → 'yahoo'
function _getPublicMailboxProvider(host) {
  if (!host) return null;
  const h = host.toLowerCase();
  if (_PUBLIC_MAILBOX_PROVIDER_MAP.has(h)) return _PUBLIC_MAILBOX_PROVIDER_MAP.get(h);
  for (const [domain, provider] of _PUBLIC_MAILBOX_PROVIDER_MAP) {
    if (h.endsWith('.' + domain)) return provider;
  }
  return null;
}

// Filter out the upstream publicMailboxSpoofingCandidateRule so our override below
// is the sole implementation; without this filter both rules would run and double-score.
const _DEFAULT_COMPOSITE_RULES = [
  ...defaultCompositeRules.filter(r => r.key !== 'composite.publicMailboxSpoofingCandidate'),
  publicMailboxSpoofingCandidateRule,
];

/**
 * Analyze a message's authentication headers using the mail-auth-signal package.
 *
 * Returns the raw `{ metrics, signals }` result from the package. Callers are
 * responsible for any scoring, thresholding, or action policy; this adapter only
 * bridges the package API to the add-on's calling convention.
 *
 * When `getRegistrableDomain` is supplied it is forwarded to the package as
 * `deps.getRegistrableDomain`. This activates the PSL-backed fields in
 * `metrics.senderIdentity`:
 *   - `fromDomainParts.registrableDomain` / `subdomainDepth`
 *   - `messageIdDomainParts.registrableDomain` / `subdomainDepth`
 *   - `messageIdRegistrableDomainMatchesFromDomain`
 *
 * PSL data and resolver ownership remain in the add-on; this parameter is the
 * injection point that connects the add-on's tldts-backed resolver to the core
 * package without moving the PSL bundle into `mail-auth-signal`.
 *
 * @param {object} opts
 * @param {Record<string, string | string[]> | Array<{name: string, value: string}>} opts.headers
 *   Message headers — either a name→value(s) map or an array of {name, value} pairs.
 * @param {string[]} [opts.trustedAuthservIds]
 *   Authserv-ids to treat as authoritative. Defaults to an empty list (all untrusted).
 * @param {((hostname: string) => string | null) | undefined} [opts.getRegistrableDomain]
 *   Optional PSL resolver injected into the package for registrable-domain computation.
 *   When omitted, `senderIdentity` PSL fields remain null.
 * @param {object[]} [opts.compositeRules]
 *   mail-auth-signal composite rules to run. Defaults to `defaultCompositeRules` with
 *   the upstream `publicMailboxSpoofingCandidateRule` replaced by the add-on's override
 *   (broader Yahoo catalog + infrastructure-mismatch gate). Pass `[]` to disable.
 * @returns {{ metrics: import('mail-auth-signal').MessageMetrics, signals: import('mail-auth-signal').Signal[] }}
 */
export function analyzeMailAuthSignals({ headers, trustedAuthservIds = [], getRegistrableDomain, compositeRules = _DEFAULT_COMPOSITE_RULES } = {}) {
  const deps = getRegistrableDomain ? { getRegistrableDomain } : undefined;
  return analyzeMessage(
    { headers: normalizeArVersionsInHeaders(headers), options: { trustedAuthservIds } },
    undefined,
    deps,
    compositeRules,
  );
}

/**
 * Translate mail-auth-signal composite signals into add-on score reasons.
 *
 * Only signals with `category === 'composite'` are processed; all others are
 * ignored. The function is intentionally stateless so it can be called with any
 * subset of signals without side effects.
 *
 * Semantic notes per signal:
 *   - composite.unauthenticatedFromSpoof: suppressed when the add-on's PSL-aware
 *     alignment considers auth aligned (`addonAnyAuthAligned === true`). The
 *     package uses exact-domain matching, so it can fire when From=news.example.com
 *     and SPF passes for example.com — a case the add-on treats as aligned via PSL.
 *   - composite.authenticatedDisplayNameSpoof: no additional gate; the package's
 *     exact-domain alignment requirement is stricter than the add-on's PSL-aware
 *     check, so it only fires when both agree the sender is authenticated.
 *   - composite.alignedAuthenticationConfirmed: diagnostic only — always delta=0,
 *     not user-configurable. Recorded so the decision log shows a positive auth
 *     confirmation when applicable.
 *   - composite.publicMailboxSpoofingCandidate: From claims a major public mailbox
 *     provider domain (Outlook, iCloud, Yahoo, etc.) but the sender's infrastructure
 *     is inconsistent — failed DMARC/SPF and mismatched envelope/Message-ID provider
 *     domains. Scored as composite.publicDomainSpoofing in the add-on.
 *
 * @param {import('mail-auth-signal').Signal[]} signals
 *   Signal array from analyzeMailAuthSignals() (may include composite signals).
 * @param {object} [compositeScores]
 *   User-configured composite score overrides; merged over DEFAULT_COMPOSITE_SCORES.
 * @param {object} [opts]
 * @param {boolean|null} [opts.addonAnyAuthAligned]
 *   PSL-aware anyAuthAligned from computePassAlignmentSummary(). When true,
 *   composite.unauthenticatedFromSpoof and composite.publicMailboxSpoofingCandidate
 *   are suppressed to prevent penalising legitimate subdomain senders.
 * @param {boolean} [opts.anyTrustedDmarcPass]
 *   True when a trusted Authentication-Results header reports dmarc=pass.
 *   When true, composite.publicMailboxSpoofingCandidate is suppressed: a trusted
 *   receiver already confirmed DMARC alignment, so penalising the message
 *   contradicts the rule's "failed authentication" premise.
 * @returns {{ score: number, scoreReasons: Array }}
 */
export function adaptCompositeSignals(signals, compositeScores = {}, { addonAnyAuthAligned = null, anyTrustedDmarcPass = false } = {}) {
  const cs = { ...DEFAULT_COMPOSITE_SCORES, ...compositeScores };
  let score = 0;
  const scoreReasons = [];

  for (const signal of signals) {
    if (signal.category !== 'composite') continue;

    switch (signal.key) {
      case 'composite.unauthenticatedFromSpoof': {
        if (addonAnyAuthAligned === true) break;
        const contributing = signal.data?.contributingSignals ?? [];
        // Suppress when Message-ID mismatch is the sole contributor: scoreMessage()
        // already penalises that evidence via composite.messageIdMismatchWithUnalignedAuth.
        // Stacking would double-count the same signal (+30 already applied in Layer 4).
        if (contributing.length > 0 && contributing.every(s => s === 'messageId.domainMismatch')) break;
        const delta = cs.unauthenticatedFromSpoof;
        scoreReasons.push({
          key: 'composite.unauthenticatedFromSpoof',
          label: 'From domain unauthenticated with sender inconsistency',
          delta,
          fromDomain: signal.data?.fromDomain ?? null,
          contributingSignals: contributing,
        });
        score += delta;
        break;
      }
      case 'composite.authenticatedDisplayNameSpoof': {
        const delta = cs.authenticatedDisplayNameSpoof;
        scoreReasons.push({
          key: 'composite.authenticatedDisplayNameSpoof',
          label: 'Authenticated sender with mismatched display-name email',
          delta,
          fromDomain: signal.data?.fromDomain ?? null,
          embeddedDomains: signal.data?.embeddedDomains ?? [],
          mismatchedDomains: signal.data?.mismatchedDomains ?? [],
        });
        score += delta;
        break;
      }
      case 'composite.alignedAuthenticationConfirmed': {
        scoreReasons.push({
          key: 'composite.alignedAuthenticationConfirmed',
          label: 'Aligned authentication confirmed',
          delta: 0,
          fromDomain: signal.data?.fromDomain ?? null,
        });
        break;
      }
      case 'composite.publicMailboxSpoofingCandidate': {
        if (addonAnyAuthAligned === true) break;
        if (anyTrustedDmarcPass) break;
        const delta = cs.publicDomainSpoofing;
        scoreReasons.push({
          key: 'composite.publicDomainSpoofing',
          label: 'Public mailbox provider domain with failed authentication',
          delta,
          fromDomain: signal.data?.fromDomain ?? null,
          provider: signal.data?.provider ?? null,
        });
        score += delta;
        break;
      }
    }
  }

  return { score, scoreReasons };
}

/**
 * Convert `metrics.authenticationResults` from analyzeMailAuthSignals() to the
 * add-on's parsedAuthResults format expected by scoreMessage() and alignment helpers.
 *
 * mail-auth-signal uses `methods` for the per-method array; the add-on scoring
 * engine expects `results`. This function re-shapes each entry so that downstream
 * consumers receive the correct shape without copying the method objects themselves.
 *
 * @param {Array<{authservId: string, trusted: boolean, methods: Array<{method: string, result: string, properties: object}>}>} authenticationResults
 *   The `metrics.authenticationResults` from analyzeMailAuthSignals().
 * @returns {Array<{authservId: string, results: Array<{method: string, result: string, properties: object}>}>}
 */
export function adaptAuthResults(authenticationResults) {
  return authenticationResults.map(({ authservId, methods }) => ({
    authservId: authservId.replace(/\s+\d+$/, ''),
    results: methods,
  }));
}
