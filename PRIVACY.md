# Privacy

Thunderbird Auth Results Filter is designed to process mail locally.

## Data Access

The add-on needs access to message headers and selected message metadata to evaluate authentication results and sender domains.

## Local Storage

The add-on may store:

- Trusted authentication service domains selected by the user.
- Untrusted `authserv-id` candidates, capped at 50 entries.
- Sender-domain scoring rules created by the user.
- Manual whitelist entries (sender email addresses) created by the user.
- Recent decision log entries, capped at 1000 entries. Each entry includes
  identity header metrics: parsed Sender, Reply-To, and Return-Path addresses
  (truncated to 200 characters each), extracted domain names, and List-Id /
  List-Unsubscribe header values (truncated to 200 characters). When the
  own-account-domain spoofing rule fires, the entry also includes the receiving
  account's registrable domain (`accountDomain`). Each entry also includes From
  parse metrics (`fromParseMetrics`): the raw From header value, the parsed
  mailbox address, a parse status (`ok`, `missing`, `invalid`, or `no_domain`),
  and the extracted From domain. Each entry also includes display-name divergence
  metrics (`displayNameMetrics`): the raw and normalized RFC5322 From display
  name, the normalized registrable-domain core label, a brand-like shape flag,
  an optional 3-gram Jaccard similarity value between the display name and domain
  core, and an applicability flag with reason when the metric cannot be computed
  (e.g. non-Latin script, short token). Each entry also includes log-only
  brand inference fields (`inferredBrandDomain`, `inferredBrandScore`,
  `brandDomainMismatch`, `brandInferenceCandidateRank`): these record the
  best-matching domain from a static bundled top-domain subset, its
  Jaro-Winkler similarity score, whether the actual From domain differs from
  the inferred brand domain, and the candidate rank when available. Each
  entry also includes sender identity metrics (`senderIdentity`) derived from
  the `mail-auth-signal` package: the From display-name text and structural
  flags (presence, character count, non-ASCII indicator, whether it contains
  an embedded email address, and the list of any embedded domains); the From
  local part (the username portion of the From address); lexical statistics
  for the local part and From domain (length, digit count, hyphen count,
  non-ASCII indicator); PSL-derived domain-part facts for the From domain and
  Message-ID domain (full domain, label list, label count, top-level label,
  registrable domain, and subdomain depth); and a flag indicating whether the
  Message-ID registrable domain matches the From registrable domain. These
  values are stored for local observability only and are never sent to
  external services.
- Custom scoring formulas created by the user (Advanced/Diagnostics feature). Each entry stores a formula ID, name, expression string, and mode (`observe`, `add`, or `disabled`). Formulas are stored locally and are never sent to external services.
- Add-on settings.

## External Services

The add-on does not send message contents, headers, metadata, logs, or settings to external services.

### DNS Lookup for Setup Hints (opt-in)

The setup assistant includes an optional MX lookup feature that is disabled by default. When the user explicitly enables "Use DNS lookup for MX setup hints", account email domains are sent to the configured DNS resolver to look up MX records. This is the only case where any data is sent to an external service, and it is subject to the following constraints:

- The feature is opt-in and off by default.
- Only account email domains (not message data) are sent.
- Lookups are performed only when the user opens the setup assistant.
- The resolver is restricted to a fixed list of permitted endpoints (Google Public DNS and Cloudflare).
- The user may change the resolver or disable the feature at any time.
- No MX results are trusted or stored automatically; the user must explicitly add any entry.

### Address Book Access (opt-in)

The address-book whitelist mitigation feature is disabled by default. When the user enables "Address Book Whitelist" in the add-on settings, the add-on requests the optional `addressBooks` permission and checks whether the RFC5322 From address of each incoming message is present in the user's Thunderbird address books. This check is performed locally and no contact data is stored by the add-on or sent to external services.

## User Controls

Users should be able to:

- Clear decision logs.
- Remove trusted domains.
- Remove candidate entries.
- Remove manual whitelist entries.
- Disable automatic movement.
- Disable add-on notifications.
