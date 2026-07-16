/**
 * Top-domain brand reference list for display-name brand inference (log-only).
 *
 * This is a small, static, hand-curated subset of well-known brand domains
 * commonly impersonated in phishing. A full Tranco-style production list is
 * not bundled; this fixture captures the most targeted brands and is intended
 * to be extended via a build-time import step or community contribution.
 *
 * Each entry:
 *   core   — normalized domain core label (lowercase alpha, no TLD/public-suffix).
 *            Must equal normalizeForComparison(registrableDomain minus publicSuffix).
 *   domain — full registrable domain used for mismatch comparison.
 *   rank   — 1-based position in this list (lower = higher impersonation priority).
 *
 * False-positive caveats (log-only — no score is added):
 *   - Official brand aliases (e.g. aexp.com for American Express) will appear as
 *     mismatches even though they are legitimate.
 *   - Regional brand domains (amazon.co.jp, amazon.de) are not listed here; mail
 *     from them will produce no inferred brand match.
 *   - ESP sending domains (sendgrid.net, mailchimp.com) are intentionally
 *     excluded; brand inference targets the visible From brand, not the transport.
 *   - Core labels shorter than 4 characters are retained here for documentation
 *     but are excluded from Jaro-Winkler inference by the applicability filter
 *     to avoid false matches on common short-prefix strings.
 *
 * Optional per-entry field:
 *   coreSubstringRequired — when true, brand inference only fires when the
 *     normalized display name contains `core` as a substring. Use for compound
 *     brand names whose first token is a common personal-name prefix (e.g.
 *     "daiichilife": "Daiichi" alone or "Daiichi Tanaka" must not fire, but
 *     "Daiichi Life Insurance" must, because "daiichilife" ⊆ normalized name).
 *
 * To add entries: append { core, domain, rank } and update rank values.
 * Do NOT fetch or modify this list at runtime.
 */

export const TOP_DOMAINS = [
  { core: 'americanexpress', domain: 'americanexpress.com', rank: 1 },
  { core: 'paypal', domain: 'paypal.com', rank: 2 },
  { core: 'amazon', domain: 'amazon.com', rank: 3 },
  { core: 'microsoft', domain: 'microsoft.com', rank: 4 },
  { core: 'apple', domain: 'apple.com', rank: 5 },
  { core: 'google', domain: 'google.com', rank: 6 },
  { core: 'netflix', domain: 'netflix.com', rank: 7 },
  { core: 'ebay', domain: 'ebay.com', rank: 8 },
  { core: 'bankofamerica', domain: 'bankofamerica.com', rank: 9 },
  { core: 'wellsfargo', domain: 'wellsfargo.com', rank: 10 },
  { core: 'chase', domain: 'chase.com', rank: 11 },
  { core: 'citibank', domain: 'citibank.com', rank: 12 },
  { core: 'discover', domain: 'discover.com', rank: 13 },
  { core: 'capitalone', domain: 'capitalone.com', rank: 14 },
  { core: 'usbank', domain: 'usbank.com', rank: 15 },
  /* rank 16–18: 3-char cores excluded from JW inference (see applicability filter) */
  { core: 'dhl', domain: 'dhl.com', rank: 16 },
  { core: 'ups', domain: 'ups.com', rank: 17 },
  { core: 'irs', domain: 'irs.gov', rank: 18 },
  { core: 'fedex', domain: 'fedex.com', rank: 19 },
  { core: 'usps', domain: 'usps.com', rank: 20 },
  { core: 'docusign', domain: 'docusign.com', rank: 21 },
  { core: 'dropbox', domain: 'dropbox.com', rank: 22 },
  { core: 'linkedin', domain: 'linkedin.com', rank: 23 },
  { core: 'facebook', domain: 'facebook.com', rank: 24 },
  { core: 'instagram', domain: 'instagram.com', rank: 25 },
  { core: 'walmart', domain: 'walmart.com', rank: 26 },
  { core: 'target', domain: 'target.com', rank: 27 },
  { core: 'costco', domain: 'costco.com', rank: 28 },
  { core: 'twitter', domain: 'twitter.com', rank: 29 },
  { core: 'rakuten', domain: 'rakuten.com', rank: 30 },
  { core: 'daiichilife', domain: 'dai-ichi-life.co.jp', rank: 31, coreSubstringRequired: true },
];
