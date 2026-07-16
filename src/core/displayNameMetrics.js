/**
 * Display-name / domain divergence metrics (log-only).
 *
 * Computes 3-gram Jaccard similarity between the RFC5322 From display name
 * and the registrable-domain core label. This is observability data only —
 * no score is added. The metric is used to gather distribution data for
 * brand-impersonation analysis before any scoring weight is assigned.
 *
 * Non-Latin/Japanese display names are treated as not applicable because
 * character-level 3-grams carry no meaningful brand-alignment signal across
 * script boundaries.
 */

import { getDomainParts } from './domainParts.js';
import { computeJaroWinkler } from '../vendor/mail-auth-signal.esm.js';
import { TOP_DOMAINS } from '../data/topDomains.js';

/** Maximum display-name length stored in log entries (raw and normalized). */
const DISPLAY_NAME_MAX_LEN = 200;

/**
 * Extract the display name (the "personal name" part) from an RFC5322 From
 * header value.
 *
 * Handles two forms:
 *   "Display Name" <user@example.com>   → "Display Name"
 *   Display Name <user@example.com>     → "Display Name"
 *   user@example.com                    → null (no display name)
 *
 * Returns null when no display name is present or the value is empty.
 * The result is trimmed but not otherwise normalised; call
 * normalizeDisplayName() for comparison purposes.
 *
 * @param {string|null|undefined} fromHeader
 * @returns {string|null}
 */
export function extractDisplayName(fromHeader) {
  if (!fromHeader) return null;
  const angleMatch = fromHeader.match(/^(.*?)\s*<[^>]+>\s*$/);
  if (!angleMatch) return null;
  // Strip surrounding double-quotes if present.
  const raw = angleMatch[1].replace(/^"|"$/g, '').trim();
  return raw || null;
}

/**
 * Normalize a string for 3-gram comparison: lowercase and strip all
 * non-alphanumeric characters so that "American Express" → "americanexpress".
 *
 * @param {string} str
 * @returns {string}
 */
export function normalizeForComparison(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Return the set of overlapping trigrams (3-character substrings) for a string.
 *
 * @param {string} str - Already normalized (lowercase alphanumeric).
 * @returns {Set<string>}
 */
export function getTrigramSet(str) {
  const grams = new Set();
  if (str.length < 3) return grams;
  for (let i = 0; i <= str.length - 3; i++) {
    grams.add(str.slice(i, i + 3));
  }
  return grams;
}

/**
 * Compute 3-gram Jaccard similarity between two normalized strings.
 *
 * Returns a number in [0, 1]:
 *   1.0 = identical trigram sets
 *   0.0 = no shared trigrams (or one side is too short)
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} Rounded to 3 decimal places.
 */
export function trigramJaccard(a, b) {
  const ga = getTrigramSet(a);
  const gb = getTrigramSet(b);
  if (ga.size === 0 && gb.size === 0) return 1;
  if (ga.size === 0 || gb.size === 0) return 0;
  let intersection = 0;
  for (const g of ga) {
    if (gb.has(g)) intersection++;
  }
  const union = ga.size + gb.size - intersection;
  return Math.round((intersection / union) * 1000) / 1000;
}

/**
 * Return true when the string contains characters from a known non-Latin
 * script (Cyrillic, Greek, Hebrew, Arabic, Devanagari, Thai, Hangul,
 * Hiragana, Katakana, CJK Unified Ideographs, etc.).
 *
 * Used to mark display names as not applicable before computing 3-gram
 * Jaccard, because cross-script comparison is not meaningful.
 *
 * @param {string} str
 * @returns {boolean}
 */
export function hasNonLatinScript(str) {
  return /[Ͱ-ϿЀ-ӿ֐-׿؀-ۿऀ-ॿ฀-๿ᄀ-ᇿ぀-ヿ一-鿿가-힯]/.test(str);
}

/**
 * Extract the "core label" from a From domain: the part of the registrable
 * domain that remains after stripping the public suffix.
 *
 * Examples:
 *   americanexpress.com  → "americanexpress"
 *   amex.co.jp           → "amex"
 *   myblog.blogspot.com  → "myblog"
 *
 * Returns null when the domain is absent or cannot be decomposed.
 *
 * @param {string|null|undefined} fromDomain
 * @returns {string|null}
 */
export function extractDomainCoreLabel(fromDomain) {
  if (!fromDomain) return null;
  const parts = getDomainParts(fromDomain);
  if (!parts.registrableDomain || !parts.publicSuffix) return null;
  const core = parts.registrableDomain.slice(
    0,
    parts.registrableDomain.length - parts.publicSuffix.length - 1,
  );
  return core || null;
}

/**
 * Return true when the display name looks like a brand name rather than
 * a personal ("First Last") name.
 *
 * Heuristic:
 *   - 1 word            → brand-like  (e.g. "PayPal", "Google")
 *   - 3+ words          → brand-like  (e.g. "American Express Card")
 *   - 2 words:
 *       Each word matches /^[A-Z][a-z'-]+$/ with no digits
 *       → personal-name shape → not brand-like
 *       Otherwise → brand-like
 *
 * This is observability-only; callers must not gate scoring on it.
 *
 * @param {string|null} displayName - Raw (un-normalized) display name.
 * @returns {boolean|null} null when displayName is absent.
 */
export function isBrandLikeShape(displayName) {
  if (!displayName) return null;
  const words = displayName.trim().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return null;
  if (words.length === 1) return true;
  if (words.length >= 3) return true;
  // Two words: personal-name shape = both /^[A-Z][a-z'-]+$/, no digits.
  const isPersonName = words.every(w => /^[A-Z][a-z'-]+$/.test(w) && !/\d/.test(w));
  return !isPersonName;
}

/** Minimum JW score to accept a top-domain brand inference match. */
export const BRAND_INFERENCE_MIN_SCORE = 0.82;

/**
 * Minimum score gap between best and second-best candidate. When the gap is
 * smaller than this value the match is considered ambiguous and rejected.
 */
export const BRAND_INFERENCE_AMBIGUITY_MARGIN = 0.04;

/** Minimum normalized display-name length for brand inference to apply. */
export const BRAND_INFERENCE_MIN_NORMALIZED_LEN = 5;

/**
 * Minimum core-label length for a top-domain entry to participate in brand
 * inference. Entries with shorter cores (e.g. "dhl", "ups", "irs") are kept in
 * TOP_DOMAINS for documentation but excluded from JW comparison to avoid false
 * matches on common short-prefix strings.
 */
export const BRAND_INFERENCE_MIN_CORE_LEN = 4;

/**
 * Infer a brand domain from a normalized display name using Jaro-Winkler
 * similarity against a top-domain list.
 *
 * All returned values are log-only. No score is added.
 *
 * Returns null fields when:
 *   - normalizedDisplayName is too short (< BRAND_INFERENCE_MIN_NORMALIZED_LEN);
 *   - best match score is below BRAND_INFERENCE_MIN_SCORE;
 *   - the gap between the best and second-best candidate is less than
 *     BRAND_INFERENCE_AMBIGUITY_MARGIN (ambiguous match).
 *
 * @param {object} opts
 * @param {string|null} opts.normalizedDisplayName - Output of normalizeForComparison().
 * @param {string|null|undefined} opts.fromDomain  - RFC5322 From domain (lowercased).
 * @param {Array}  [opts.topDomains]               - Override for testing; defaults to TOP_DOMAINS.
 * @returns {{
 *   inferredBrandDomain:          string|null,
 *   inferredBrandScore:           number|null,
 *   brandDomainMismatch:          boolean|null,
 *   brandInferenceCandidateRank:  number|null
 * }}
 */
export function computeBrandInference({
  normalizedDisplayName,
  fromDomain,
  topDomains = TOP_DOMAINS,
} = {}) {
  const nullResult = {
    inferredBrandDomain: null,
    inferredBrandScore: null,
    brandDomainMismatch: null,
    brandInferenceCandidateRank: null,
  };

  if (!normalizedDisplayName || normalizedDisplayName.length < BRAND_INFERENCE_MIN_NORMALIZED_LEN) {
    return nullResult;
  }

  const scoredCandidates = topDomains
    .filter(e => e.core.length >= BRAND_INFERENCE_MIN_CORE_LEN)
    .filter(e => !e.coreSubstringRequired || normalizedDisplayName.includes(e.core))
    .map(e => ({ ...e, score: computeJaroWinkler(normalizedDisplayName, e.core) }))
    .sort((a, b) => b.score - a.score);

  if (scoredCandidates.length === 0) return nullResult;

  const best = scoredCandidates[0];
  const second = scoredCandidates[1];

  if (best.score < BRAND_INFERENCE_MIN_SCORE) return nullResult;

  if (second && (best.score - second.score) < BRAND_INFERENCE_AMBIGUITY_MARGIN) {
    return nullResult;
  }

  const fromParts = getDomainParts(fromDomain ?? '');
  let brandDomainMismatch = null;
  if (fromParts.registrableDomain !== null) {
    brandDomainMismatch = fromParts.registrableDomain !== best.domain;
  }

  return {
    inferredBrandDomain: best.domain,
    inferredBrandScore: best.score,
    brandDomainMismatch,
    brandInferenceCandidateRank: best.rank,
  };
}

/**
 * Return true when the display name uses the single-character-spacing camouflage
 * technique: each character of the original name is separated by a space
 * (e.g. "P a y P a l", "D a i i c h i L i f e I n s u r a n c e").
 *
 * Heuristic: at least 5 whitespace-separated tokens, with ≥ 80 % of tokens
 * being single characters. The 80 % threshold allows for a small number of
 * capitalised word-boundary tokens without requiring perfect uniformity.
 *
 * @param {string|null|undefined} displayName - Raw display name.
 * @returns {boolean}
 */
export function isSpacedDisplayName(displayName) {
  if (!displayName) return false;
  const tokens = displayName.trim().split(/\s+/);
  if (tokens.length < 5) return false;
  const singleCharCount = tokens.filter(t => [...t].length === 1).length;
  return singleCharCount / tokens.length >= 0.8;
}

/**
 * When a display name is in single-character-spaced form, join consecutive
 * single-character tokens to restore the human-readable brand name.
 *
 * Returns null when `displayName` is absent or not spaced.
 *
 * @param {string|null|undefined} displayName - Raw display name.
 * @returns {string|null}
 */
export function compactSpacedDisplayName(displayName) {
  if (!isSpacedDisplayName(displayName)) return null;
  return displayName.trim().split(/\s+/).join('');
}

/**
 * Return true when the display name is shaped like an email address.
 *
 * Detects patterns like "user@example.com" in the display-name position, which
 * is a common spoofing pattern where the visible "From" name contains an email
 * address that may differ from the real RFC5322 From address.
 *
 * The check is intentionally simple: a single `@`, a non-empty local part with
 * no whitespace, and a domain part that contains at least one dot with no
 * whitespace.
 *
 * @param {string|null|undefined} displayName - Raw (un-normalized) display name.
 * @returns {boolean}
 */
export function isEmailShapedDisplayName(displayName) {
  if (!displayName) return false;
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(displayName.trim());
}

/**
 * Compute display-name email-address spoofing metrics.
 *
 * All returned values are log-only observability data. No score is added.
 *
 * When `displayNameRaw` does not look like an email address,
 * `displayNameLooksLikeEmail` is false and all other fields are null.
 *
 * @param {object} opts
 * @param {string|null|undefined} opts.displayNameRaw  - Raw display-name string.
 * @param {string|null|undefined} opts.fromAddress     - Lowercased RFC5322 mailbox address.
 * @param {string|null|undefined} opts.fromDomain      - RFC5322 From domain (lowercased).
 * @returns {{
 *   displayNameLooksLikeEmail:              boolean,
 *   displayNameEmailAddress:                string|null,
 *   displayNameEmailDomain:                 string|null,
 *   displayNameEmailMatchesFromAddress:     boolean|null,
 *   displayNameEmailDomainMatchesFromDomain: boolean|null
 * }}
 */
export function computeDisplayNameEmailMetrics({ displayNameRaw, fromAddress, fromDomain } = {}) {
  if (!isEmailShapedDisplayName(displayNameRaw)) {
    return {
      displayNameLooksLikeEmail: false,
      displayNameEmailAddress: null,
      displayNameEmailDomain: null,
      displayNameEmailMatchesFromAddress: null,
      displayNameEmailDomainMatchesFromDomain: null,
    };
  }

  const emailAddr = displayNameRaw.trim().toLowerCase();
  const atIdx = emailAddr.indexOf('@');
  const displayNameEmailDomain = emailAddr.slice(atIdx + 1);

  let displayNameEmailMatchesFromAddress = null;
  if (fromAddress) {
    displayNameEmailMatchesFromAddress = emailAddr === fromAddress.toLowerCase();
  }

  let displayNameEmailDomainMatchesFromDomain = null;
  if (fromDomain && displayNameEmailDomain) {
    const dnEmailParts = getDomainParts(displayNameEmailDomain);
    const fromParts = getDomainParts(fromDomain);
    if (dnEmailParts.registrableDomain !== null && fromParts.registrableDomain !== null) {
      displayNameEmailDomainMatchesFromDomain =
        dnEmailParts.registrableDomain === fromParts.registrableDomain;
    }
  }

  return {
    displayNameLooksLikeEmail: true,
    displayNameEmailAddress: emailAddr,
    displayNameEmailDomain,
    displayNameEmailMatchesFromAddress,
    displayNameEmailDomainMatchesFromDomain,
  };
}

/**
 * Compute display-name / domain divergence metrics for a message's From header.
 *
 * All returned values are log-only observability data. No score is added.
 *
 * Applicable conditions (all must hold):
 *   - A display name is present in the From header.
 *   - The normalized display name has length >= 3.
 *   - The From domain resolves to a registrable-domain core label (length >= 3).
 *   - The display name does not contain non-Latin script characters.
 *
 * When not applicable, `displayNameDomainMetricApplicable` is false and
 * `displayNameDomainMetricNotApplicableReason` explains why.
 *
 * Brand inference fields (`inferredBrandDomain`, `inferredBrandScore`,
 * `brandDomainMismatch`, `brandInferenceCandidateRank`) are log-only and are
 * included in every return path. They are null when the display name is absent
 * or contains non-Latin script, or when no top-domain candidate meets the
 * applicability gates inside computeBrandInference().
 *
 * Email-shape fields (`displayNameLooksLikeEmail`, `displayNameEmailAddress`,
 * `displayNameEmailDomain`, `displayNameEmailMatchesFromAddress`,
 * `displayNameEmailDomainMatchesFromDomain`) are log-only and are included in
 * every return path. They reflect whether the display name itself is an
 * email-address-shaped string, which is a common spoofing pattern.
 *
 * @param {object} opts
 * @param {string|null|undefined} opts.fromHeader  - Raw RFC5322 From header value.
 * @param {string|null|undefined} opts.fromDomain  - RFC5322 From domain (lowercased).
 * @param {string|null|undefined} opts.fromAddress - Lowercased RFC5322 mailbox address.
 * @returns {{
 *   displayNameRaw:                           string|null,
 *   displayNameNormalized:                    string|null,
 *   displayNameSpacedCamouflage:              boolean,
 *   displayNameCompacted:                     string|null,
 *   fromDomainCoreNormalized:                 string|null,
 *   displayNameBrandLikeShape:                boolean|null,
 *   displayNameDomain3GramJaccardSimilarity:  number|null,
 *   displayNameDomainMetricApplicable:        boolean,
 *   displayNameDomainMetricNotApplicableReason: string|null,
 *   inferredBrandDomain:                      string|null,
 *   inferredBrandScore:                       number|null,
 *   brandDomainMismatch:                      boolean|null,
 *   brandInferenceCandidateRank:              number|null,
 *   displayNameLooksLikeEmail:                boolean,
 *   displayNameEmailAddress:                  string|null,
 *   displayNameEmailDomain:                   string|null,
 *   displayNameEmailMatchesFromAddress:       boolean|null,
 *   displayNameEmailDomainMatchesFromDomain:  boolean|null
 * }}
 */
export function computeDisplayNameMetrics({ fromHeader, fromDomain, fromAddress } = {}) {
  const nullBranding = {
    inferredBrandDomain: null,
    inferredBrandScore: null,
    brandDomainMismatch: null,
    brandInferenceCandidateRank: null,
  };

  const rawExtracted = extractDisplayName(fromHeader);
  const displayNameRaw = rawExtracted && rawExtracted.length > DISPLAY_NAME_MAX_LEN
    ? rawExtracted.slice(0, DISPLAY_NAME_MAX_LEN)
    : rawExtracted;

  const emailMetrics = computeDisplayNameEmailMetrics({ displayNameRaw, fromAddress, fromDomain });

  if (!displayNameRaw) {
    return {
      displayNameRaw: null,
      displayNameNormalized: null,
      displayNameSpacedCamouflage: false,
      displayNameCompacted: null,
      fromDomainCoreNormalized: null,
      displayNameBrandLikeShape: null,
      displayNameDomain3GramJaccardSimilarity: null,
      displayNameDomainMetricApplicable: false,
      displayNameDomainMetricNotApplicableReason: 'missing_display_name',
      ...nullBranding,
      ...emailMetrics,
    };
  }

  const displayNameSpacedCamouflage = isSpacedDisplayName(displayNameRaw);
  const displayNameCompacted = displayNameSpacedCamouflage
    ? compactSpacedDisplayName(displayNameRaw)
    : null;
  const displayNameNormalized = normalizeForComparison(displayNameRaw);
  const displayNameBrandLikeShape = isBrandLikeShape(displayNameRaw);

  const coreLabel = extractDomainCoreLabel(fromDomain);
  const fromDomainCoreNormalized = coreLabel ? normalizeForComparison(coreLabel) : null;

  if (hasNonLatinScript(displayNameRaw)) {
    return {
      displayNameRaw,
      displayNameNormalized,
      displayNameSpacedCamouflage,
      displayNameCompacted,
      fromDomainCoreNormalized,
      displayNameBrandLikeShape,
      displayNameDomain3GramJaccardSimilarity: null,
      displayNameDomainMetricApplicable: false,
      displayNameDomainMetricNotApplicableReason: 'non_latin_display_name',
      ...nullBranding,
      ...emailMetrics,
    };
  }

  // Brand inference: applicable for Latin display names, regardless of whether
  // the 3-gram Jaccard metric is applicable. computeBrandInference() applies its
  // own length and score-threshold gates internally.
  // When spaced camouflage is detected, the compacted (space-stripped) form is
  // used for inference because normalizeForComparison already collapses spaces,
  // which produces the same input. The compacted field is retained for logging.
  const branding = computeBrandInference({ normalizedDisplayName: displayNameNormalized, fromDomain });

  if (!fromDomainCoreNormalized) {
    return {
      displayNameRaw,
      displayNameNormalized,
      displayNameSpacedCamouflage,
      displayNameCompacted,
      fromDomainCoreNormalized: null,
      displayNameBrandLikeShape,
      displayNameDomain3GramJaccardSimilarity: null,
      displayNameDomainMetricApplicable: false,
      displayNameDomainMetricNotApplicableReason: 'missing_domain_core',
      ...branding,
      ...emailMetrics,
    };
  }

  if (fromDomainCoreNormalized.length < 3) {
    return {
      displayNameRaw,
      displayNameNormalized,
      displayNameSpacedCamouflage,
      displayNameCompacted,
      fromDomainCoreNormalized,
      displayNameBrandLikeShape,
      displayNameDomain3GramJaccardSimilarity: null,
      displayNameDomainMetricApplicable: false,
      displayNameDomainMetricNotApplicableReason: 'short_normalized',
      ...branding,
      ...emailMetrics,
    };
  }

  if (displayNameNormalized.length < 3) {
    return {
      displayNameRaw,
      displayNameNormalized,
      displayNameSpacedCamouflage,
      displayNameCompacted,
      fromDomainCoreNormalized,
      displayNameBrandLikeShape,
      displayNameDomain3GramJaccardSimilarity: null,
      displayNameDomainMetricApplicable: false,
      displayNameDomainMetricNotApplicableReason: 'short_normalized',
      ...branding,
      ...emailMetrics,
    };
  }

  const similarity = trigramJaccard(displayNameNormalized, fromDomainCoreNormalized);

  return {
    displayNameRaw,
    displayNameNormalized,
    displayNameSpacedCamouflage,
    displayNameCompacted,
    fromDomainCoreNormalized,
    displayNameBrandLikeShape,
    displayNameDomain3GramJaccardSimilarity: similarity,
    displayNameDomainMetricApplicable: true,
    displayNameDomainMetricNotApplicableReason: null,
    ...branding,
    ...emailMetrics,
  };
}
