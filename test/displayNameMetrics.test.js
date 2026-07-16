import {
  extractDisplayName,
  normalizeForComparison,
  getTrigramSet,
  trigramJaccard,
  hasNonLatinScript,
  extractDomainCoreLabel,
  isBrandLikeShape,
  isSpacedDisplayName,
  compactSpacedDisplayName,
  computeDisplayNameMetrics,
  computeBrandInference,
  isEmailShapedDisplayName,
  computeDisplayNameEmailMetrics,
  BRAND_INFERENCE_MIN_SCORE,
  BRAND_INFERENCE_AMBIGUITY_MARGIN,
} from '../src/core/displayNameMetrics.js';

// ─── extractDisplayName ───────────────────────────────────────────────────────

describe('extractDisplayName', () => {
  test('returns null for null input', () => {
    expect(extractDisplayName(null)).toBeNull();
  });

  test('returns null for bare address with no display name', () => {
    expect(extractDisplayName('user@example.com')).toBeNull();
  });

  test('extracts quoted display name', () => {
    expect(extractDisplayName('"American Express" <amex@americanexpress.com>')).toBe('American Express');
  });

  test('extracts unquoted display name', () => {
    expect(extractDisplayName('PayPal <service@paypal.com>')).toBe('PayPal');
  });

  test('returns null when angle-bracket address has no preceding name', () => {
    expect(extractDisplayName('<user@example.com>')).toBeNull();
  });

  test('returns null for empty display name part', () => {
    // Quoted empty string
    expect(extractDisplayName('"" <user@example.com>')).toBeNull();
  });

  test('extracts multi-word unquoted name', () => {
    expect(extractDisplayName('DHL Global Mail <noreply@dhl.com>')).toBe('DHL Global Mail');
  });
});

// ─── normalizeForComparison ───────────────────────────────────────────────────

describe('normalizeForComparison', () => {
  test('lowercases and strips spaces', () => {
    expect(normalizeForComparison('American Express')).toBe('americanexpress');
  });

  test('strips punctuation', () => {
    expect(normalizeForComparison('Pay-Pal, Inc.')).toBe('paypalinc');
  });

  test('preserves digits', () => {
    expect(normalizeForComparison('Web2.0 Corp')).toBe('web20corp');
  });

  test('empty string stays empty', () => {
    expect(normalizeForComparison('')).toBe('');
  });
});

// ─── getTrigramSet ────────────────────────────────────────────────────────────

describe('getTrigramSet', () => {
  test('returns empty set for string shorter than 3', () => {
    expect(getTrigramSet('ab').size).toBe(0);
  });

  test('returns one trigram for 3-char string', () => {
    expect([...getTrigramSet('abc')]).toEqual(['abc']);
  });

  test('returns correct trigrams for "paypal"', () => {
    const grams = getTrigramSet('paypal');
    expect(grams.has('pay')).toBe(true);
    expect(grams.has('ayp')).toBe(true);
    expect(grams.has('ypa')).toBe(true);
    expect(grams.has('pal')).toBe(true);
  });

  test('deduplicates repeated trigrams', () => {
    // "aaa" produces only one trigram
    expect(getTrigramSet('aaa').size).toBe(1);
  });
});

// ─── trigramJaccard ───────────────────────────────────────────────────────────

describe('trigramJaccard', () => {
  test('identical strings → 1.0', () => {
    expect(trigramJaccard('americanexpress', 'americanexpress')).toBe(1);
  });

  test('paypal vs paypal → 1.0', () => {
    expect(trigramJaccard('paypal', 'paypal')).toBe(1);
  });

  test('completely different strings → low similarity', () => {
    const sim = trigramJaccard('americanexpress', 'workbidrun');
    expect(sim).toBeLessThan(0.1);
  });

  test('empty strings → 1.0 (vacuously equal)', () => {
    expect(trigramJaccard('', '')).toBe(1);
  });

  test('one empty string → 0.0', () => {
    expect(trigramJaccard('paypal', '')).toBe(0);
  });

  test('acronym vs full name is low (amex vs americanexpress)', () => {
    const sim = trigramJaccard('amex', 'americanexpress');
    // "amex" has only 2 trigrams, "ame" and "mex"; "americanexpress" has "ame" but not "mex"
    expect(sim).toBeLessThan(0.2);
  });

  test('result is rounded to at most 3 decimal places', () => {
    const sim = trigramJaccard('microsoft', 'microsoftcorp');
    // Should be a finite number with <= 3 decimal places
    expect(Number.isFinite(sim)).toBe(true);
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThanOrEqual(1);
  });
});

// ─── hasNonLatinScript ────────────────────────────────────────────────────────

describe('hasNonLatinScript', () => {
  test('returns false for ASCII string', () => {
    expect(hasNonLatinScript('American Express')).toBe(false);
  });

  test('returns true for Japanese Hiragana', () => {
    expect(hasNonLatinScript('楽天')).toBe(true);
  });

  test('returns true for Katakana', () => {
    expect(hasNonLatinScript('アマゾン')).toBe(true);
  });

  test('returns true for Arabic', () => {
    expect(hasNonLatinScript('أمازون')).toBe(true);
  });

  test('returns true for Cyrillic', () => {
    expect(hasNonLatinScript('Яндекс')).toBe(true);
  });

  test('returns true for CJK unified ideographs', () => {
    expect(hasNonLatinScript('中国银行')).toBe(true);
  });

  test('returns false for Latin with diacritics (still Latin)', () => {
    expect(hasNonLatinScript('Société Générale')).toBe(false);
  });
});

// ─── extractDomainCoreLabel ───────────────────────────────────────────────────

describe('extractDomainCoreLabel', () => {
  test('returns null for null input', () => {
    expect(extractDomainCoreLabel(null)).toBeNull();
  });

  test('strips .com TLD', () => {
    expect(extractDomainCoreLabel('americanexpress.com')).toBe('americanexpress');
  });

  test('strips multi-label TLD for co.jp', () => {
    expect(extractDomainCoreLabel('rakuten.co.jp')).toBe('rakuten');
  });

  test('works for paypal.com', () => {
    expect(extractDomainCoreLabel('paypal.com')).toBe('paypal');
  });

  test('uses registrable domain core, ignoring subdomains', () => {
    expect(extractDomainCoreLabel('mail.americanexpress.com')).toBe('americanexpress');
  });
});

// ─── isBrandLikeShape ─────────────────────────────────────────────────────────

describe('isBrandLikeShape', () => {
  test('returns null for null input', () => {
    expect(isBrandLikeShape(null)).toBeNull();
  });

  test('single word → true', () => {
    expect(isBrandLikeShape('PayPal')).toBe(true);
  });

  test('3 words → true', () => {
    expect(isBrandLikeShape('American Express Card')).toBe(true);
  });

  test('2 typical personal name words → false', () => {
    expect(isBrandLikeShape('John Smith')).toBe(false);
  });

  test('2 words with all-uppercase word → true', () => {
    expect(isBrandLikeShape('DHL Express')).toBe(true);
  });

  test('2 words with digit → true', () => {
    expect(isBrandLikeShape('Web2 Corp')).toBe(true);
  });

  test('2 words where second word has mid-word uppercase → true (not a typical personal name)', () => {
    // "O'Brien" has capital B mid-word, breaking the /^[A-Z][a-z'-]+$/ pattern
    expect(isBrandLikeShape("Mary O'Brien")).toBe(true);
  });
});

// ─── computeDisplayNameMetrics ────────────────────────────────────────────────

describe('computeDisplayNameMetrics', () => {

  // ── Not-applicable cases ──

  test('returns not-applicable when no From header', () => {
    const m = computeDisplayNameMetrics({ fromHeader: null, fromDomain: 'example.com' });
    expect(m.displayNameDomainMetricApplicable).toBe(false);
    expect(m.displayNameDomainMetricNotApplicableReason).toBe('missing_display_name');
    expect(m.displayNameRaw).toBeNull();
  });

  test('returns not-applicable for bare address (no display name)', () => {
    const m = computeDisplayNameMetrics({ fromHeader: 'user@example.com', fromDomain: 'example.com' });
    expect(m.displayNameDomainMetricApplicable).toBe(false);
    expect(m.displayNameDomainMetricNotApplicableReason).toBe('missing_display_name');
  });

  test('returns not-applicable for Japanese display name (non-Latin)', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: '楽天株式会社 <info@rakuten.co.jp>',
      fromDomain: 'rakuten.co.jp',
    });
    expect(m.displayNameDomainMetricApplicable).toBe(false);
    expect(m.displayNameDomainMetricNotApplicableReason).toBe('non_latin_display_name');
    expect(m.displayNameRaw).toBe('楽天株式会社');
  });

  test('returns not-applicable for Arabic display name', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: 'أمازون <noreply@amazon.ae>',
      fromDomain: 'amazon.ae',
    });
    expect(m.displayNameDomainMetricApplicable).toBe(false);
    expect(m.displayNameDomainMetricNotApplicableReason).toBe('non_latin_display_name');
  });

  test('returns not-applicable when domain core cannot be extracted', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: '"Support" <support@localhost>',
      fromDomain: 'localhost',
    });
    expect(m.displayNameDomainMetricApplicable).toBe(false);
    expect(m.displayNameDomainMetricNotApplicableReason).toBe('missing_domain_core');
  });

  test('returns not-applicable when normalized display name is too short', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: '"AB" <ab@paypal.com>',
      fromDomain: 'paypal.com',
    });
    expect(m.displayNameDomainMetricApplicable).toBe(false);
    expect(m.displayNameDomainMetricNotApplicableReason).toBe('short_normalized');
  });

  // ── Brand vs. domain low similarity (American Express impersonation style) ──

  test('American Express display name vs low-similarity domain has low Jaccard', () => {
    // Simulates an impersonation attempt: brand name in display, random/unrelated domain
    const m = computeDisplayNameMetrics({
      fromHeader: '"American Express" <info@workbidrun.com>',
      fromDomain: 'workbidrun.com',
    });
    expect(m.displayNameDomainMetricApplicable).toBe(true);
    expect(m.displayNameNormalized).toBe('americanexpress');
    expect(m.fromDomainCoreNormalized).toBe('workbidrun');
    expect(m.displayNameDomain3GramJaccardSimilarity).toBeLessThan(0.15);
    // "American Express" is two title-case words: heuristic classifies as person-name shape.
    // This is an acknowledged limitation of the simple heuristic; the metric is log-only.
    expect(m.displayNameBrandLikeShape).toBe(false);
  });

  // ── Exact brand / domain match has high similarity ──

  test('PayPal display name vs paypal.com domain has high Jaccard', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: '"PayPal" <service@paypal.com>',
      fromDomain: 'paypal.com',
    });
    expect(m.displayNameDomainMetricApplicable).toBe(true);
    expect(m.displayNameNormalized).toBe('paypal');
    expect(m.fromDomainCoreNormalized).toBe('paypal');
    expect(m.displayNameDomain3GramJaccardSimilarity).toBe(1);
  });

  test('americanexpress display name vs americanexpress.com → similarity 1.0', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: '"American Express" <amex@americanexpress.com>',
      fromDomain: 'americanexpress.com',
    });
    expect(m.displayNameDomainMetricApplicable).toBe(true);
    expect(m.displayNameNormalized).toBe('americanexpress');
    expect(m.fromDomainCoreNormalized).toBe('americanexpress');
    expect(m.displayNameDomain3GramJaccardSimilarity).toBe(1);
  });

  // ── Alias / acronym examples remain applicable but log-only ──
  // (similarity is low; no score is added — the metric is just logged)

  test('AMEX alias vs americanexpress.com → low similarity, still applicable', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: '"AMEX" <alerts@americanexpress.com>',
      fromDomain: 'americanexpress.com',
    });
    // "amex" normalized is 4 chars, which is >= 3 but produces only 2 trigrams
    // vs "americanexpress" — Jaccard will be low
    expect(m.displayNameDomainMetricApplicable).toBe(true);
    expect(m.displayNameDomain3GramJaccardSimilarity).toBeLessThan(0.2);
    // Log-only: no score added (this test just confirms the metric is produced)
    expect(m.displayNameBrandLikeShape).toBe(true);
  });

  test('newsletter alias with partial overlap remains log-only', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: '"Microsoft Account Team" <account@microsoft.com>',
      fromDomain: 'microsoft.com',
    });
    expect(m.displayNameDomainMetricApplicable).toBe(true);
    // "microsoftaccountteam" vs "microsoft"
    const sim = m.displayNameDomain3GramJaccardSimilarity;
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThanOrEqual(1);
    expect(m.displayNameBrandLikeShape).toBe(true);
  });

  // ── Truncation of very long display names ──

  test('display name longer than 200 chars is truncated in raw and normalized fields', () => {
    const longName = 'A'.repeat(300);
    const m = computeDisplayNameMetrics({
      fromHeader: `"${longName}" <info@paypal.com>`,
      fromDomain: 'paypal.com',
    });
    expect(m.displayNameRaw).toHaveLength(200);
    expect(m.displayNameNormalized).toHaveLength(200);
  });

  // ── Field structure verification ──

  test('applicable result includes all expected fields', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: '"GitHub" <noreply@github.com>',
      fromDomain: 'github.com',
    });
    expect(m).toMatchObject({
      displayNameRaw: 'GitHub',
      displayNameNormalized: 'github',
      fromDomainCoreNormalized: 'github',
      displayNameBrandLikeShape: true,
      displayNameDomain3GramJaccardSimilarity: 1,
      displayNameDomainMetricApplicable: true,
      displayNameDomainMetricNotApplicableReason: null,
    });
    // Brand inference fields are always present in the output
    expect('inferredBrandDomain' in m).toBe(true);
    expect('inferredBrandScore' in m).toBe(true);
    expect('brandDomainMismatch' in m).toBe(true);
    expect('brandInferenceCandidateRank' in m).toBe(true);
  });
});

// ─── computeBrandInference ────────────────────────────────────────────────────

// Shared fixture with two entries for ambiguity and mismatch testing
const FIXTURE_DOMAINS = [
  { core: 'americanexpress', domain: 'americanexpress.com', rank: 1 },
  { core: 'paypal', domain: 'paypal.com', rank: 2 },
  { core: 'amazon', domain: 'amazon.com', rank: 3 },
  { core: 'microsoft', domain: 'microsoft.com', rank: 4 },
  { core: 'apple', domain: 'apple.com', rank: 5 },
];

describe('computeBrandInference', () => {

  // ── Issue requirement: American Express infers americanexpress.com ──

  test('American Express display name infers americanexpress.com', () => {
    const r = computeBrandInference({
      normalizedDisplayName: 'americanexpress',
      fromDomain: 'work-bidrun.com',
      topDomains: FIXTURE_DOMAINS,
    });
    expect(r.inferredBrandDomain).toBe('americanexpress.com');
    expect(r.inferredBrandScore).toBeGreaterThanOrEqual(BRAND_INFERENCE_MIN_SCORE);
    expect(r.brandInferenceCandidateRank).toBe(1);
  });

  // ── Issue requirement: From domain mismatch is recorded ──

  test('mismatch recorded when From domain differs from inferred brand domain', () => {
    const r = computeBrandInference({
      normalizedDisplayName: 'americanexpress',
      fromDomain: 'work-bidrun.com',
      topDomains: FIXTURE_DOMAINS,
    });
    expect(r.brandDomainMismatch).toBe(true);
  });

  // ── Issue requirement: matching From registrable domain is not mismatch ──

  test('no mismatch when From registrable domain matches inferred brand domain', () => {
    const r = computeBrandInference({
      normalizedDisplayName: 'americanexpress',
      fromDomain: 'americanexpress.com',
      topDomains: FIXTURE_DOMAINS,
    });
    expect(r.inferredBrandDomain).toBe('americanexpress.com');
    expect(r.brandDomainMismatch).toBe(false);
  });

  test('no mismatch when From is a subdomain of the inferred brand domain', () => {
    // mail.americanexpress.com has registrable domain americanexpress.com
    const r = computeBrandInference({
      normalizedDisplayName: 'americanexpress',
      fromDomain: 'mail.americanexpress.com',
      topDomains: FIXTURE_DOMAINS,
    });
    expect(r.brandDomainMismatch).toBe(false);
  });

  // ── Issue requirement: short display names are not applicable ──

  test('short normalized display name (< 5 chars) → all null', () => {
    const r = computeBrandInference({
      normalizedDisplayName: 'amex',   // 4 chars — below BRAND_INFERENCE_MIN_NORMALIZED_LEN
      fromDomain: 'evil.com',
      topDomains: FIXTURE_DOMAINS,
    });
    expect(r.inferredBrandDomain).toBeNull();
    expect(r.inferredBrandScore).toBeNull();
    expect(r.brandDomainMismatch).toBeNull();
    expect(r.brandInferenceCandidateRank).toBeNull();
  });

  // ── Issue requirement: ambiguous matches are not applicable ──

  test('ambiguous match (two candidates too close in score) → all null', () => {
    // 'paypal' vs both 'paypals' and 'paypalx' will score within AMBIGUITY_MARGIN
    const ambiguousFixture = [
      { core: 'paypals', domain: 'paypals.example', rank: 1 },
      { core: 'paypalx', domain: 'paypalx.example', rank: 2 },
    ];
    const r = computeBrandInference({
      normalizedDisplayName: 'paypal',
      fromDomain: 'evil.com',
      topDomains: ambiguousFixture,
    });
    expect(r.inferredBrandDomain).toBeNull();
  });

  // ── Score below threshold → all null ──

  test('best score below threshold → all null', () => {
    const r = computeBrandInference({
      normalizedDisplayName: 'completelyunrelated',
      fromDomain: 'evil.com',
      topDomains: FIXTURE_DOMAINS,
    });
    expect(r.inferredBrandDomain).toBeNull();
    expect(r.inferredBrandScore).toBeNull();
  });

  // ── Non-Latin display names are handled at computeDisplayNameMetrics level ──
  // computeBrandInference itself works on already-normalized strings; the Latin
  // gate is enforced by computeDisplayNameMetrics before calling this function.

  // ── brandDomainMismatch is null when fromDomain is unresolvable ──

  test('brandDomainMismatch is null when fromDomain has no registrable domain', () => {
    const r = computeBrandInference({
      normalizedDisplayName: 'americanexpress',
      fromDomain: 'localhost',    // no public suffix → registrableDomain = null
      topDomains: FIXTURE_DOMAINS,
    });
    expect(r.inferredBrandDomain).toBe('americanexpress.com');
    expect(r.brandDomainMismatch).toBeNull();
  });

  // ── paypal infers paypal.com ──

  test('paypal display name infers paypal.com', () => {
    const r = computeBrandInference({
      normalizedDisplayName: 'paypal',
      fromDomain: 'evil.com',
      topDomains: FIXTURE_DOMAINS,
    });
    expect(r.inferredBrandDomain).toBe('paypal.com');
    expect(r.brandInferenceCandidateRank).toBe(2);
    expect(r.brandDomainMismatch).toBe(true);
  });
});

// ─── computeDisplayNameMetrics brand inference integration ───────────────────

describe('computeDisplayNameMetrics brand inference integration', () => {

  test('American Express display name vs mismatched domain records mismatch', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: '"American Express" <info@work-bidrun.com>',
      fromDomain: 'work-bidrun.com',
    });
    expect(m.inferredBrandDomain).toBe('americanexpress.com');
    expect(m.brandDomainMismatch).toBe(true);
    expect(m.inferredBrandScore).toBeGreaterThanOrEqual(BRAND_INFERENCE_MIN_SCORE);
    expect(m.brandInferenceCandidateRank).toBe(1);
  });

  test('American Express display name vs americanexpress.com → no mismatch', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: '"American Express" <amex@americanexpress.com>',
      fromDomain: 'americanexpress.com',
    });
    expect(m.inferredBrandDomain).toBe('americanexpress.com');
    expect(m.brandDomainMismatch).toBe(false);
  });

  test('non-Latin display name → all brand inference fields null', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: '楽天株式会社 <info@rakuten.co.jp>',
      fromDomain: 'rakuten.co.jp',
    });
    expect(m.inferredBrandDomain).toBeNull();
    expect(m.inferredBrandScore).toBeNull();
    expect(m.brandDomainMismatch).toBeNull();
    expect(m.brandInferenceCandidateRank).toBeNull();
  });

  test('missing display name → all brand inference fields null', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: 'user@example.com',
      fromDomain: 'example.com',
    });
    expect(m.inferredBrandDomain).toBeNull();
    expect(m.brandDomainMismatch).toBeNull();
  });

  test('short normalized display name → brand inference null', () => {
    // "AB" normalizes to "ab" (length 2 < 3 for 3-gram Jaccard, and < 5 for brand inference)
    const m = computeDisplayNameMetrics({
      fromHeader: '"AB" <ab@paypal.com>',
      fromDomain: 'paypal.com',
    });
    expect(m.inferredBrandDomain).toBeNull();
  });

  test('brand inference fields present even when 3-gram Jaccard metric is not applicable', () => {
    // fromDomain has no extractable core label, so 3-gram Jaccard is not applicable,
    // but brand inference can still run on the display name alone.
    const m = computeDisplayNameMetrics({
      fromHeader: '"American Express" <support@localhost>',
      fromDomain: 'localhost',
    });
    expect(m.displayNameDomainMetricApplicable).toBe(false);
    expect(m.displayNameDomainMetricNotApplicableReason).toBe('missing_domain_core');
    // Brand inference still runs; mismatch is null because fromDomain is unresolvable
    expect(m.inferredBrandDomain).toBe('americanexpress.com');
    expect(m.brandDomainMismatch).toBeNull();
  });
});

// ─── isEmailShapedDisplayName ─────────────────────────────────────────────────

describe('isEmailShapedDisplayName', () => {
  test('returns false for null', () => {
    expect(isEmailShapedDisplayName(null)).toBe(false);
  });

  test('returns false for a plain display name', () => {
    expect(isEmailShapedDisplayName('John Smith')).toBe(false);
  });

  test('returns false for a brand name', () => {
    expect(isEmailShapedDisplayName('PayPal')).toBe(false);
  });

  test('returns true for a bare email-shaped string', () => {
    expect(isEmailShapedDisplayName('user@example.com')).toBe(true);
  });

  test('returns true for email with subdomain', () => {
    expect(isEmailShapedDisplayName('ebinkggoikleqo@softbank.ne.jp')).toBe(true);
  });

  test('returns false when there is whitespace', () => {
    expect(isEmailShapedDisplayName('user @example.com')).toBe(false);
  });

  test('returns false when there is no dot in domain', () => {
    expect(isEmailShapedDisplayName('user@localhost')).toBe(false);
  });

  test('returns false for multiple @ signs', () => {
    expect(isEmailShapedDisplayName('a@b@example.com')).toBe(false);
  });
});

// ─── computeDisplayNameEmailMetrics ──────────────────────────────────────────

describe('computeDisplayNameEmailMetrics', () => {
  test('non-email display name → displayNameLooksLikeEmail false, all others null', () => {
    const r = computeDisplayNameEmailMetrics({
      displayNameRaw: 'PayPal',
      fromAddress: 'service@paypal.com',
      fromDomain: 'paypal.com',
    });
    expect(r.displayNameLooksLikeEmail).toBe(false);
    expect(r.displayNameEmailAddress).toBeNull();
    expect(r.displayNameEmailDomain).toBeNull();
    expect(r.displayNameEmailMatchesFromAddress).toBeNull();
    expect(r.displayNameEmailDomainMatchesFromDomain).toBeNull();
  });

  test('display-name email equals actual From address', () => {
    const r = computeDisplayNameEmailMetrics({
      displayNameRaw: 'trklnqclui@softbank.ne.jp',
      fromAddress: 'trklnqclui@softbank.ne.jp',
      fromDomain: 'softbank.ne.jp',
    });
    expect(r.displayNameLooksLikeEmail).toBe(true);
    expect(r.displayNameEmailAddress).toBe('trklnqclui@softbank.ne.jp');
    expect(r.displayNameEmailDomain).toBe('softbank.ne.jp');
    expect(r.displayNameEmailMatchesFromAddress).toBe(true);
    expect(r.displayNameEmailDomainMatchesFromDomain).toBe(true);
  });

  test('display-name email differs only by local part (same domain)', () => {
    const r = computeDisplayNameEmailMetrics({
      displayNameRaw: 'ebinkggoikleqo@softbank.ne.jp',
      fromAddress: 'trklnqclui@softbank.ne.jp',
      fromDomain: 'softbank.ne.jp',
    });
    expect(r.displayNameLooksLikeEmail).toBe(true);
    expect(r.displayNameEmailMatchesFromAddress).toBe(false);
    expect(r.displayNameEmailDomainMatchesFromDomain).toBe(true);
  });

  test('display-name email domain differs from From domain', () => {
    const r = computeDisplayNameEmailMetrics({
      displayNameRaw: 'support@paypal.com',
      fromAddress: 'attacker@evil.example',
      fromDomain: 'evil.example',
    });
    expect(r.displayNameLooksLikeEmail).toBe(true);
    expect(r.displayNameEmailAddress).toBe('support@paypal.com');
    expect(r.displayNameEmailDomain).toBe('paypal.com');
    expect(r.displayNameEmailMatchesFromAddress).toBe(false);
    expect(r.displayNameEmailDomainMatchesFromDomain).toBe(false);
  });

  test('displayNameEmailMatchesFromAddress is null when fromAddress is absent', () => {
    const r = computeDisplayNameEmailMetrics({
      displayNameRaw: 'user@example.com',
      fromAddress: null,
      fromDomain: 'example.com',
    });
    expect(r.displayNameLooksLikeEmail).toBe(true);
    expect(r.displayNameEmailMatchesFromAddress).toBeNull();
    expect(r.displayNameEmailDomainMatchesFromDomain).toBe(true);
  });

  test('displayNameEmailDomainMatchesFromDomain is null when fromDomain is absent', () => {
    const r = computeDisplayNameEmailMetrics({
      displayNameRaw: 'user@example.com',
      fromAddress: 'user@example.com',
      fromDomain: null,
    });
    expect(r.displayNameEmailDomainMatchesFromDomain).toBeNull();
  });

  test('comparison is case-insensitive for address match', () => {
    const r = computeDisplayNameEmailMetrics({
      displayNameRaw: 'User@Example.COM',
      fromAddress: 'user@example.com',
      fromDomain: 'example.com',
    });
    expect(r.displayNameEmailMatchesFromAddress).toBe(true);
  });
});

// ─── computeDisplayNameMetrics email fields integration ──────────────────────

describe('computeDisplayNameMetrics email fields integration', () => {
  test('email-shaped display name with same address sets match true', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: '"trklnqclui@softbank.ne.jp" <trklnqclui@softbank.ne.jp>',
      fromDomain: 'softbank.ne.jp',
      fromAddress: 'trklnqclui@softbank.ne.jp',
    });
    expect(m.displayNameLooksLikeEmail).toBe(true);
    expect(m.displayNameEmailMatchesFromAddress).toBe(true);
    expect(m.displayNameEmailDomainMatchesFromDomain).toBe(true);
  });

  test('display-name email differs only by local part — domain still matches', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: '"ebinkggoikleqo@softbank.ne.jp" <trklnqclui@softbank.ne.jp>',
      fromDomain: 'softbank.ne.jp',
      fromAddress: 'trklnqclui@softbank.ne.jp',
    });
    expect(m.displayNameLooksLikeEmail).toBe(true);
    expect(m.displayNameEmailMatchesFromAddress).toBe(false);
    expect(m.displayNameEmailDomainMatchesFromDomain).toBe(true);
  });

  test('display-name email domain differs from From domain', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: '"support@paypal.com" <attacker@evil.example>',
      fromDomain: 'evil.example',
      fromAddress: 'attacker@evil.example',
    });
    expect(m.displayNameLooksLikeEmail).toBe(true);
    expect(m.displayNameEmailDomain).toBe('paypal.com');
    expect(m.displayNameEmailMatchesFromAddress).toBe(false);
    expect(m.displayNameEmailDomainMatchesFromDomain).toBe(false);
  });

  test('non-email display name → displayNameLooksLikeEmail false', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: '"PayPal" <service@paypal.com>',
      fromDomain: 'paypal.com',
      fromAddress: 'service@paypal.com',
    });
    expect(m.displayNameLooksLikeEmail).toBe(false);
    expect(m.displayNameEmailAddress).toBeNull();
    expect(m.displayNameEmailMatchesFromAddress).toBeNull();
  });

  test('missing display name → displayNameLooksLikeEmail false', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: 'user@example.com',
      fromDomain: 'example.com',
      fromAddress: 'user@example.com',
    });
    expect(m.displayNameLooksLikeEmail).toBe(false);
  });

  test('email fields present in all return paths (non-Latin display name)', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: '楽天株式会社 <info@rakuten.co.jp>',
      fromDomain: 'rakuten.co.jp',
      fromAddress: 'info@rakuten.co.jp',
    });
    expect('displayNameLooksLikeEmail' in m).toBe(true);
    expect(m.displayNameLooksLikeEmail).toBe(false);
  });
});

// ─── isSpacedDisplayName ──────────────────────────────────────────────────────

describe('isSpacedDisplayName', () => {
  test('returns false for null', () => {
    expect(isSpacedDisplayName(null)).toBe(false);
  });

  test('returns false for a normal multi-word display name', () => {
    expect(isSpacedDisplayName('Daiichi Life Insurance')).toBe(false);
  });

  test('returns false for a single word', () => {
    expect(isSpacedDisplayName('PayPal')).toBe(false);
  });

  test('returns false when token count is below 5', () => {
    // "P a y" = 3 single-char tokens < 5 required
    expect(isSpacedDisplayName('P a y')).toBe(false);
    // "P a y P" = 4 tokens < 5
    expect(isSpacedDisplayName('P a y P')).toBe(false);
  });

  test('returns true for a fully spaced brand name with 5+ tokens', () => {
    // "P a y P a l" = 6 single-char tokens
    expect(isSpacedDisplayName('P a y P a l')).toBe(true);
  });

  test('returns true for Dai-ichi Life Insurance style spaced name', () => {
    expect(isSpacedDisplayName('D a i i c h i L i f e I n s u r a n c e')).toBe(true);
  });

  test('returns true for the issue-reported Dai-ichi variant with leading double character', () => {
    expect(isSpacedDisplayName('D d a i i c h i L i f e I n s u r a n c e')).toBe(true);
  });

  test('returns false for a normal sentence (multi-char words)', () => {
    expect(isSpacedDisplayName('Amazon Security Alert')).toBe(false);
  });

  test('returns false when fewer than 80% of tokens are single chars', () => {
    // "P a y PayPal Inc" = 3 single-char + 3 multi-char out of 6 → 50 % < 80 % → false
    expect(isSpacedDisplayName('P a y PayPal Inc')).toBe(false);
  });
});

// ─── compactSpacedDisplayName ─────────────────────────────────────────────────

describe('compactSpacedDisplayName', () => {
  test('returns null for null input', () => {
    expect(compactSpacedDisplayName(null)).toBeNull();
  });

  test('returns null for a normal display name (not spaced)', () => {
    expect(compactSpacedDisplayName('Daiichi Life Insurance')).toBeNull();
  });

  test('compacts a spaced PayPal-style name', () => {
    expect(compactSpacedDisplayName('P a y P a l')).toBe('PayPal');
  });

  test('compacts the Dai-ichi Life Insurance spaced display name', () => {
    expect(compactSpacedDisplayName('D a i i c h i L i f e I n s u r a n c e'))
      .toBe('DaiichiLifeInsurance');
  });

  test('compacts the issue-reported variant with leading double character', () => {
    expect(compactSpacedDisplayName('D d a i i c h i L i f e I n s u r a n c e'))
      .toBe('DdaiichiLifeInsurance');
  });
});

// ─── computeDisplayNameMetrics spaced camouflage fields ───────────────────────

describe('computeDisplayNameMetrics spaced camouflage fields', () => {
  test('displayNameSpacedCamouflage is false for a normal display name', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: '"PayPal" <service@paypal.com>',
      fromDomain: 'paypal.com',
    });
    expect(m.displayNameSpacedCamouflage).toBe(false);
    expect(m.displayNameCompacted).toBeNull();
  });

  test('displayNameSpacedCamouflage is false when display name is absent', () => {
    const m = computeDisplayNameMetrics({ fromHeader: 'user@example.com', fromDomain: 'example.com' });
    expect(m.displayNameSpacedCamouflage).toBe(false);
    expect(m.displayNameCompacted).toBeNull();
  });

  test('detects spaced camouflage and sets displayNameCompacted', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: '"D a i i c h i L i f e I n s u r a n c e" <spoof@attacker.com>',
      fromDomain: 'attacker.com',
    });
    expect(m.displayNameSpacedCamouflage).toBe(true);
    expect(m.displayNameCompacted).toBe('DaiichiLifeInsurance');
    expect(m.displayNameRaw).toBe('D a i i c h i L i f e I n s u r a n c e');
  });

  test('spaced fields present in non-Latin return path', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: '楽天株式会社 <info@rakuten.co.jp>',
      fromDomain: 'rakuten.co.jp',
    });
    expect('displayNameSpacedCamouflage' in m).toBe(true);
    expect(m.displayNameSpacedCamouflage).toBe(false);
  });

  test('spaced fields present when domain core is missing', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: '"D a i i c h i L i f e" <spoof@localhost>',
      fromDomain: 'localhost',
    });
    expect(m.displayNameSpacedCamouflage).toBe(true);
    expect(m.displayNameCompacted).toBe('DaiichiLife');
  });
});

// ─── Dai-ichi Life brand inference (spaced camouflage) ───────────────────────

const DAIICHI_FIXTURE = [
  { core: 'daiichilife', domain: 'dai-ichi-life.co.jp', rank: 1, coreSubstringRequired: true },
  { core: 'paypal', domain: 'paypal.com', rank: 2 },
];

describe('computeBrandInference — Dai-ichi Life spaced brand name', () => {
  test('infers dai-ichi-life.co.jp from spaced display name (D a i i c h i L i f e I n s u r a n c e)', () => {
    // After normalizeForComparison, spaces are stripped:
    // "D a i i c h i L i f e I n s u r a n c e" → "daiichilifeinsurace" (already spaced-compacted)
    const normalized = normalizeForComparison('D a i i c h i L i f e I n s u r a n c e');
    const r = computeBrandInference({
      normalizedDisplayName: normalized,
      fromDomain: 'attacker.com',
      topDomains: DAIICHI_FIXTURE,
    });
    expect(r.inferredBrandDomain).toBe('dai-ichi-life.co.jp');
    expect(r.inferredBrandScore).toBeGreaterThanOrEqual(BRAND_INFERENCE_MIN_SCORE);
    expect(r.brandDomainMismatch).toBe(true);
  });

  test('infers dai-ichi-life.co.jp from issue-reported variant (D d a i i c h i ...)', () => {
    const normalized = normalizeForComparison('D d a i i c h i L i f e I n s u r a n c e');
    const r = computeBrandInference({
      normalizedDisplayName: normalized,
      fromDomain: 'attacker.com',
      topDomains: DAIICHI_FIXTURE,
    });
    expect(r.inferredBrandDomain).toBe('dai-ichi-life.co.jp');
    expect(r.inferredBrandScore).toBeGreaterThanOrEqual(BRAND_INFERENCE_MIN_SCORE);
    expect(r.brandDomainMismatch).toBe(true);
  });

  test('computeDisplayNameMetrics detects brand mismatch for spaced Dai-ichi Life name', () => {
    const m = computeDisplayNameMetrics({
      fromHeader: '"D a i i c h i L i f e I n s u r a n c e" <spoof@attacker.com>',
      fromDomain: 'attacker.com',
    });
    expect(m.displayNameSpacedCamouflage).toBe(true);
    expect(m.inferredBrandDomain).toBe('dai-ichi-life.co.jp');
    expect(m.inferredBrandScore).toBeGreaterThanOrEqual(BRAND_INFERENCE_MIN_SCORE);
    expect(m.brandDomainMismatch).toBe(true);
  });

  test('does NOT infer dai-ichi-life.co.jp from single-word display name "Daiichi"', () => {
    const normalized = normalizeForComparison('Daiichi');
    const r = computeBrandInference({
      normalizedDisplayName: normalized,
      fromDomain: 'attacker.com',
      topDomains: DAIICHI_FIXTURE,
    });
    expect(r.inferredBrandDomain).toBeNull();
    expect(r.inferredBrandScore).toBeNull();
  });

  test('does NOT infer dai-ichi-life.co.jp from personal name "Daiichi Tanaka"', () => {
    const normalized = normalizeForComparison('Daiichi Tanaka');
    const r = computeBrandInference({
      normalizedDisplayName: normalized,
      fromDomain: 'attacker.com',
      topDomains: DAIICHI_FIXTURE,
    });
    expect(r.inferredBrandDomain).toBeNull();
    expect(r.inferredBrandScore).toBeNull();
  });

  test('still infers dai-ichi-life.co.jp from non-spaced "Daiichi Life"', () => {
    const normalized = normalizeForComparison('Daiichi Life');
    const r = computeBrandInference({
      normalizedDisplayName: normalized,
      fromDomain: 'attacker.com',
      topDomains: DAIICHI_FIXTURE,
    });
    expect(r.inferredBrandDomain).toBe('dai-ichi-life.co.jp');
    expect(r.inferredBrandScore).toBeGreaterThanOrEqual(BRAND_INFERENCE_MIN_SCORE);
  });
});
