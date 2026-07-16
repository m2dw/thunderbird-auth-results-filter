/**
 * Rule metadata registry.
 *
 * Single source of user-facing text for every stable score-reason key.
 * Scoring logic, options labels, popup tooltips, and decision-log display
 * all derive from this registry — keeping internal keys out of user-visible
 * surfaces except in advanced/diagnostic contexts.
 *
 * Fields per entry:
 *   key          - Stable internal score-reason key (never renamed).
 *   title        - Short user-facing label (matches labelForScoreKey output).
 *   summary      - One-sentence description for tooltips / reason display.
 *   signals      - Headers / fields / signals this rule examines.
 *   why          - Why it matters for spam detection.
 *   caveat       - Common false-positive scenario (omitted when none known).
 *   type         - 'risk' | 'mitigation' | 'diagnostic'
 *   defaultScore - Numeric default delta when the rule has a fixed default.
 */
const REGISTRY = [
  // ── Diagnostic ──────────────────────────────────────────────────────────
  {
    key: 'authserv.untrusted',
    title: 'Untrusted authserv-id',
    summary: 'Authentication-Results header is from a domain you have not trusted.',
    signals: ['Authentication-Results authserv-id', 'trusted domain list'],
    why: 'Untrusted servers can forge auth results; their pass results are ignored for scoring.',
    type: 'diagnostic',
  },
  // ── Sender rules ────────────────────────────────────────────────────────
  {
    key: 'sender.rule',
    title: 'Sender domain rule',
    summary: 'A user-defined sender-domain rule matched this message.',
    signals: ['RFC5322 From domain', 'user sender-domain rules'],
    why: 'Lets you apply a fixed score to mail from a specific domain.',
    type: 'risk',
  },
  // ── Whitelists ──────────────────────────────────────────────────────────
  {
    key: 'whitelist.manual',
    title: 'Manual whitelist',
    summary: 'Sender address is on your manual whitelist.',
    signals: ['RFC5322 From address', 'manual whitelist entries'],
    why: 'Trusted senders should not be flagged; the whitelist overrides scoring.',
    type: 'mitigation',
    defaultScore: -50,
  },
  {
    key: 'whitelist.addressBook',
    title: 'Address book contact',
    summary: 'Sender is in your Thunderbird address book.',
    signals: ['RFC5322 From address', 'Thunderbird address books'],
    why: 'Known contacts are unlikely to be spam.',
    type: 'mitigation',
    defaultScore: -50,
  },
  // ── Layer 2: Identity alignment ─────────────────────────────────────────
  {
    key: 'identity.spfMailFromMismatch',
    title: 'SPF MAIL FROM differs from From',
    summary: 'SPF passed for a different domain than the visible From address.',
    signals: ['RFC5321 MAIL FROM (smtp.mailfrom)', 'RFC5322 From', 'SPF pass result'],
    why: 'Spammers route mail through unrelated infrastructure to pass SPF while showing a different brand.',
    caveat: 'ESP-relayed newsletters commonly use their own domain in MAIL FROM.',
    type: 'risk',
    defaultScore: 0,
  },
  {
    key: 'identity.dkimDomainMismatch',
    title: 'DKIM signing domain differs from From',
    summary: 'All passing DKIM signatures are from a domain unrelated to the From address.',
    signals: ['DKIM d=/header.d= signing domain', 'RFC5322 From registrable domain'],
    why: 'Legitimate services sign with their own domain; third-party signing alone does not authenticate the From brand.',
    caveat: 'Transactional mail routed through a dedicated sending platform may only carry platform DKIM.',
    type: 'risk',
    defaultScore: 5,
  },
  {
    key: 'identity.dmarcNoneWithThirdPartyAuth',
    title: 'DMARC none with only third-party auth',
    summary: 'No DMARC policy and all passing SPF/DKIM are from unrelated domains.',
    signals: ['DMARC result', 'SPF/DKIM signing domains', 'RFC5322 From domain'],
    why: 'The From domain offers no DMARC protection and all authentication is from an unrelated party.',
    type: 'risk',
    defaultScore: 10,
  },
  // ── Layer 3: Sender heuristics ───────────────────────────────────────────
  {
    key: 'heuristic.randomFromDomainLabel',
    title: 'Random-looking From domain label',
    summary: 'A label in the From domain looks machine-generated (high entropy, low vowels).',
    signals: ['RFC5322 From domain labels', 'Shannon entropy', 'vowel ratio', 'consonant runs'],
    why: 'Spam campaigns often register random-string domains to evade blocklists.',
    caveat: 'Short technical abbreviations (e.g. "mktg", "crm") may score poorly even when legitimate.',
    type: 'risk',
    defaultScore: 15,
  },
  {
    key: 'heuristic.randomFromLocalPart',
    title: 'Random-looking From local part',
    summary: 'The local part (before @) of the From address looks machine-generated.',
    signals: ['RFC5322 From local part', 'Shannon entropy', 'vowel ratio', 'consonant runs'],
    why: 'Randomised local parts are a common spam pattern used to bypass per-address blocking.',
    caveat: 'Short randomly generated customer IDs used by legitimate services may trigger this.',
    type: 'risk',
    defaultScore: 5,
  },
  // ── Layer 4: Composite risk ──────────────────────────────────────────────
  {
    key: 'composite.spfAlignedDkimUnalignedRandomLocal',
    title: 'SPF aligned, DKIM unaligned, random local part',
    summary: 'SPF is aligned but DKIM is unaligned and the local part looks random.',
    signals: ['SPF alignment', 'DKIM alignment', 'From local part entropy'],
    why: 'Spam that controls only the MAIL FROM domain to pass SPF while using throwaway local parts.',
    type: 'risk',
    defaultScore: 30,
  },
  {
    key: 'composite.authAlignedRandomDomain',
    title: 'Auth-aligned sender with random-looking domain',
    summary: 'Authentication is aligned but the From domain itself looks machine-generated.',
    signals: ['SPF or DKIM alignment', 'From domain label entropy'],
    why: 'Attacker owns a random-string domain and uses a real ESP to get aligned auth.',
    type: 'risk',
    defaultScore: 40,
  },
  {
    key: 'composite.thirdPartyAuthRandomLocal',
    title: 'Third-party auth pass with random local part, no alignment',
    summary: 'Only third-party authentication passed and the local part looks random, with no alignment.',
    signals: ['SPF/DKIM alignment', 'From local part entropy'],
    why: 'Spam relayed through a third party with throwaway From addresses.',
    type: 'risk',
    defaultScore: 25,
  },
  {
    key: 'composite.messageIdMismatchWithUnalignedAuth',
    title: 'Message-ID domain mismatch with unaligned authentication',
    summary: 'The Message-ID domain differs from the From domain and auth is not aligned.',
    signals: ['Message-ID domain', 'RFC5322 From domain', 'SPF/DKIM alignment'],
    why: 'Forged messages often have mismatched Message-ID domains when the auth infrastructure is unrelated.',
    caveat: 'Forwarded or aliased mail may show a Message-ID from the original originating domain.',
    type: 'risk',
    defaultScore: 30,
  },
  {
    key: 'composite.messageIdUnregistrableMismatch',
    title: 'Message-ID domain is unregistrable or mismatches From',
    summary: 'The Message-ID domain is unregistrable (TLD-only) or has no valid registrable domain.',
    signals: ['Message-ID domain', 'PSL registrable domain'],
    why: 'A strong forgery indicator; legitimate mail always has a valid Message-ID domain.',
    type: 'risk',
    defaultScore: 50,
  },
  {
    key: 'composite.fromSenderMismatchWithUnalignedAuth',
    title: 'From/Sender mismatch with unaligned authentication',
    summary: 'The From and Sender headers point to different domains and auth is not aligned.',
    signals: ['RFC5322 From', 'RFC5322 Sender', 'SPF/DKIM alignment'],
    why: 'Mismatch between From and Sender is a resend or impersonation pattern.',
    caveat: 'Mailing lists and forwarding services may set Sender to their own domain.',
    type: 'risk',
    defaultScore: 15,
  },
  {
    key: 'composite.deepRandomFromSubdomain',
    title: 'Deep random-looking From subdomain',
    summary: 'The From address uses a deep subdomain with a random-looking label.',
    signals: ['RFC5322 From subdomain depth', 'subdomain label entropy'],
    why: 'Spam campaigns register one domain and send from many random sub-paths to evade per-domain blocking.',
    type: 'risk',
    defaultScore: 25,
  },
  {
    key: 'composite.delegatedDkimAlignedRouteConsistent',
    title: 'Delegated newsletter: DKIM-aligned, route-consistent',
    summary: 'DKIM is aligned and the delivery route is consistent with a legitimate ESP.',
    signals: ['DKIM alignment', 'Return-Path domain', 'List-* headers'],
    why: 'Reduces false positives for bulk mail sent via delegated DKIM-signing ESPs.',
    type: 'mitigation',
    defaultScore: -30,
  },
  {
    key: 'composite.spfPassDkimFailRandomLocal',
    title: 'SPF pass, DKIM fail, random local part',
    summary: 'SPF passes but DKIM fails and the local part looks random.',
    signals: ['SPF result', 'DKIM result', 'From local part entropy'],
    why: 'Indicates a bulk sender relying only on SPF with throwaway local parts.',
    type: 'risk',
    defaultScore: 25,
  },
  {
    key: 'composite.dkimAlignedLexicalMitigation',
    title: 'DKIM-aligned lexical false-positive mitigation',
    summary: 'DKIM is aligned; reduces the heuristic penalty for random-looking names.',
    signals: ['DKIM alignment', 'Layer 3 heuristic score'],
    why: 'A valid aligned DKIM signature means the From domain signed the message, making random local parts less suspicious.',
    type: 'mitigation',
    defaultScore: -30,
  },
  {
    key: 'composite.ownDomainAuthFail',
    title: 'Own account domain with failed authentication',
    summary: 'Message claims to come from one of your account domains but authentication failed.',
    signals: ['RFC5322 From domain', 'account identity domains', 'DMARC/SPF/DKIM results'],
    why: 'A high-confidence impersonation signal: your own domain should always authenticate successfully.',
    type: 'risk',
    defaultScore: 75,
  },
  {
    key: 'composite.unparseableFromWithInfrastructureMismatch',
    title: 'Unparseable From with infrastructure mismatch',
    summary: 'The From header could not be parsed as a valid address and infrastructure signals differ.',
    signals: ['RFC5322 From parseability', 'SPF/DKIM domains'],
    why: 'Malformed From headers with mismatched infrastructure are a strong forgery indicator.',
    type: 'risk',
    defaultScore: 50,
  },
  {
    key: 'composite.geoTokenCompoundDomain',
    title: 'Geo/token compound registrable domain',
    summary: 'The registrable domain is a hyphen-compound containing a known spam geo/token and auth is unaligned.',
    signals: ['RFC5322 From registrable domain', 'geo/token keyword list', 'DKIM alignment'],
    why: 'A common disposable-domain spam pattern using geographic or keyword tokens.',
    type: 'risk',
    defaultScore: 30,
  },
  {
    key: 'composite.deepServiceWordSubdomain',
    title: 'Deep service-word subdomain',
    summary: 'A deep subdomain contains a service-like word (e.g. mail-01) associated with disposable-domain spam.',
    signals: ['RFC5322 From subdomain labels', 'service-word list', 'subdomain depth'],
    why: 'Spammers reuse patterns like mail-01.random-domain.tld to evade per-domain reputation.',
    type: 'risk',
    defaultScore: 30,
  },
  {
    key: 'composite.dmarcFailDkimAlignedListMitigation',
    title: 'DMARC fail mitigated: DKIM aligned and list headers present',
    summary: 'DMARC failed but DKIM is aligned and List headers are present — likely a mailing list.',
    signals: ['DMARC result', 'DKIM alignment', 'List-* headers'],
    why: 'Mailing lists often break DMARC while preserving DKIM; treating this as high-risk causes false positives.',
    type: 'mitigation',
    defaultScore: -15,
  },
  {
    key: 'composite.dkimFailWithAlignedPass',
    title: 'DKIM fail with aligned DKIM pass',
    summary: 'At least one DKIM signature failed but another aligned signature passed.',
    signals: ['DKIM results', 'DKIM signing domains', 'RFC5322 From domain'],
    why: 'Having both a passing and failing aligned DKIM signature is unusual and associated with message manipulation.',
    type: 'risk',
    defaultScore: 35,
  },
  {
    key: 'composite.brandDivergencePhishing',
    title: 'Display-name brand divergence phishing',
    summary: 'The From display name matches a well-known brand but the From domain is unrelated to that brand.',
    signals: ['RFC5322 From display name', 'inferred brand domain', 'RFC5322 From registrable domain'],
    why: 'A phishing sender controls an unrelated domain and authenticates it correctly, while using a famous brand name in the visible From field to deceive the recipient.',
    caveat: 'Official brand aliases (e.g. aexp.com for American Express) and regional brand domains not in the top-domain list may appear as mismatches.',
    type: 'risk',
    defaultScore: 50,
  },
  {
    key: 'composite.unsecuredDeepSubdomain',
    title: 'DMARC-none deep subdomain',
    summary: 'The From address uses a deep subdomain on a domain with no DMARC enforcement policy and no aligned authentication.',
    signals: ['RFC5322 From subdomain depth', 'DMARC result', 'SPF/DKIM alignment'],
    why: 'Disposable domains often configure deep service-looking subdomains (e.g. sivakeso.support.sn5799.com) while leaving DMARC unset, evading per-label and auth-enforcement checks.',
    type: 'risk',
    defaultScore: 25,
  },
  // ── mail-auth-signal composite signals ─────────────────────────────────────
  {
    key: 'composite.unauthenticatedFromSpoof',
    title: 'Unauthenticated From with sender inconsistency',
    summary: 'The visible From domain has no aligned, trusted authentication and another sender identifier disagrees with it.',
    signals: ['RFC5322 From domain', 'SPF/DKIM alignment', 'Message-ID / Reply-To / Return-Path / DMARC header.from'],
    why: 'Forged messages typically lack aligned authentication while carrying mismatched infrastructure headers (Message-ID, Return-Path, Reply-To) that reveal the true sending infrastructure.',
    caveat: 'Suppressed when the add-on\'s PSL-aware alignment considers auth aligned (e.g. SPF pass for example.com when From is news.example.com).',
    type: 'risk',
    defaultScore: 35,
  },
  {
    key: 'composite.authenticatedDisplayNameSpoof',
    title: 'Authenticated sender with spoofed display-name email',
    summary: 'The message authenticates for its From domain but the display name contains an email address pointing to a different domain.',
    signals: ['RFC5322 From display name', 'embedded email domains', 'SPF/DKIM alignment'],
    why: 'Attackers craft display names like "user@victim.com" while sending from an authenticated but unrelated domain, deceiving users who only see the display name.',
    caveat: 'Legitimate mail clients and mailing lists rarely embed email addresses in display names; this pattern is almost exclusively a phishing technique.',
    type: 'risk',
    defaultScore: 40,
  },
  {
    key: 'composite.alignedAuthenticationConfirmed',
    title: 'Aligned authentication confirmed',
    summary: 'The visible From domain has aligned, trusted authentication with no conflicting signal.',
    signals: ['SPF/DKIM/DMARC alignment', 'trusted Authentication-Results headers'],
    why: 'Positive confirmation that the sender domain is properly authenticated; logged as a diagnostic signal for the decision log.',
    type: 'diagnostic',
  },
  {
    key: 'composite.publicDomainSpoofing',
    title: 'Public mailbox provider domain with failed authentication',
    summary: 'The visible From domain is a major public mailbox provider but authentication failed and the sending infrastructure is inconsistent.',
    signals: ['RFC5322 From domain', 'SPF/DKIM/DMARC alignment', 'Return-Path domain', 'Message-ID domain', 'public mailbox provider catalog'],
    why: 'Legitimate messages from providers such as Outlook, iCloud, and Yahoo are always authenticated; a failed-auth message claiming to originate from these domains almost certainly has a spoofed From.',
    caveat: 'Suppressed when the add-on\'s PSL-aware alignment considers the sender authenticated (e.g. SPF pass from a subdomain of the provider domain such as bounce.mail.outlook.com).',
    type: 'risk',
    defaultScore: 45,
  },
];

/** O(1) lookup map. */
const REGISTRY_MAP = new Map(REGISTRY.map(e => [e.key, e]));

/**
 * Look up metadata for a score reason key.
 *
 * For `auth.method.result` keys (e.g. 'auth.dmarc.fail'), a synthetic entry
 * is returned when no explicit registry entry exists.
 *
 * @param {string} key - Stable score reason key.
 * @returns {object|null} Registry entry, or null if unknown.
 */
export function getRuleMeta(key) {
  if (REGISTRY_MAP.has(key)) return REGISTRY_MAP.get(key);
  const m = key?.match(/^auth\.(\w+)\.(\w+)$/);
  if (m) {
    const method = m[1].toUpperCase();
    const result = m[2];
    return {
      key,
      title: `${method} ${result}`,
      summary: `${method} authentication result: ${result}.`,
      signals: [`${method} authentication result`],
      why: `${method} ${result} is used to evaluate the trustworthiness of the sender's authentication.`,
      type: result === 'pass' ? 'diagnostic' : 'risk',
    };
  }
  const cf = key?.match(/^custom\.formula\.(.+)$/);
  if (cf) {
    return {
      key,
      title: `Custom formula: ${cf[1]}`,
      summary: 'User-defined custom scoring formula (L5 advanced feature).',
      signals: ['custom formula expression', 'L1-L4 scoring facts'],
      why: 'Allows advanced users to define scoring rules based on combinations of L1-L4 signals.',
      type: 'risk',
    };
  }
  return null;
}

/**
 * Return the user-facing title for a score reason key.
 * Falls back to the raw key when no entry is registered.
 *
 * @param {string} key
 * @returns {string}
 */
export function titleForKey(key) {
  return getRuleMeta(key)?.title ?? key;
}

/**
 * Return the short summary sentence for a score reason key, suitable for a tooltip.
 * Returns null when no entry is registered.
 *
 * @param {string} key
 * @returns {string|null}
 */
export function summaryForKey(key) {
  return getRuleMeta(key)?.summary ?? null;
}

/**
 * Return a scenario-oriented tooltip string for a score reason key.
 * Prefers the `why` field (explains the attacker/spam pattern) over `summary`.
 * Appends `caveat` when present to flag false-positive risks.
 * Falls back to `summary` when `why` is absent.
 * Returns null when no entry is registered.
 *
 * @param {string} key
 * @returns {string|null}
 */
export function tooltipForKey(key) {
  const meta = getRuleMeta(key);
  if (!meta) return null;
  if (!meta.why) return meta.summary ?? null;
  return meta.caveat ? `${meta.why} Note: ${meta.caveat}` : meta.why;
}

export { REGISTRY };
