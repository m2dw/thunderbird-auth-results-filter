# Thunderbird Add-ons Store Listing

## Summary (short description, ≤ 250 characters)

Scores incoming mail using Authentication-Results headers from your trusted mail servers. Suspicious messages go to a review folder. All processing stays local — nothing is sent to external services.

---

## Full Description

**Thunderbird Auth Results Filter** evaluates every incoming message against the `Authentication-Results` headers written by your mail server and moves suspicious mail to a review folder before you see it.

### How it works

Modern mail servers record the results of SPF, DKIM, and DMARC checks in `Authentication-Results` headers on each incoming message. This add-on reads those results from servers you explicitly mark as trusted, combines them with sender-domain patterns and heuristic signals, and assigns each message a risk score.

- **Score 0–49 (Normal):** message is left in your Inbox.
- **Score 50–99 (Review):** message is moved to an "Auth Review" folder.
- **Score 100+ (High risk):** moved to review, or optionally directly to Junk.

Scoring uses a "low-pass, high-combo" approach: no single weak signal can move a message into Review on its own. Multiple independent signals must converge, reducing false positives from ordinary forwarded or newsletter mail.

### Trust model

The add-on relies on `Authentication-Results` headers written by **your** mail infrastructure. You must configure at least one trusted authentication server (identified by its `authserv-id`) for authentication-based scoring to take effect. Headers from servers you have not trusted are recorded in the diagnostic log for visibility but are ignored for scoring — they never add or subtract points.

This design follows RFC 8601 trust boundaries: an `Authentication-Results` header is only meaningful if it was written by a server you control or trust. The add-on does not perform DNS lookups or contact external services during message processing.

### What gets scored

**Authentication results (Layer 1):** DMARC, SPF, and DKIM pass/fail results from trusted servers.

**Identity alignment (Layer 2):** Whether the authenticated domain matches the visible From address — for example, when SPF authenticates a delivery provider's domain rather than the brand domain.

**Sender heuristics (Layer 3):** Local, offline checks on the From address — entropy of the domain label, vowel ratios, consonant runs — that flag random-looking machine-generated addresses.

**Composite rules (Layer 4):** Patterns that combine multiple signals: random local part combined with unaligned authentication, deep random-looking subdomains, geo/token compound domains, and others. These are the primary drivers of Review and High-risk classification.

**User rules (Layer 5):** Manual whitelist entries, sender-domain score adjustments, and optional address-book integration.

### Privacy

All mail data is processed and stored locally on your device. The add-on does not send message contents, headers, metadata, or logs to any external service.

The only optional exception is an MX lookup in the setup assistant, which is **disabled by default**. When you enable it, your account email domains (not message data) are sent to a DNS resolver you select (Google Public DNS or Cloudflare) to look up MX records as setup hints. You must manually add any suggested entry — nothing is trusted automatically.

Address-book integration is also **disabled by default**. When enabled, Thunderbird contact data is read locally and is never sent externally.

### Setup requirements

1. Open the add-on's Options page (Basic tab).
2. Under **Trusted Authentication Servers**, add the `authserv-id` of your incoming mail server (for example `mail.example.com`). You can use the setup assistant to look up MX records, or enter the value manually.
3. Optionally configure a review folder per account, or accept the default "Auth Review" folder.
4. Allow a day or two of normal mail flow to build up a decision log, then check the Diagnostics tab to tune score thresholds.

Until at least one trusted server is configured, no authentication-based scoring runs and the add-on will note this on the Protection Status panel.

### Known limitations

- **Setup is required.** The add-on does not work out of the box. You must identify and add your mail server's `authserv-id` before authentication scoring has any effect.
- **Only trusted servers count.** If your mail provider does not write `Authentication-Results` headers (uncommon but possible), authentication-based scoring cannot fire. The heuristic and composite rules still run.
- **Not a spam filter replacement.** The add-on is not a Bayesian classifier and does not learn from spam feedback. It is a rule-based filter focused on authentication signals and sender-identity heuristics. Some spam will still reach your Inbox; some legitimate mail may occasionally land in the review folder and need to be whitelisted.
- **Score thresholds are fixed at 50 and 100** in this release. Individual rule scores are configurable, but the Review and High-risk threshold values are not.
- **Direct Junk movement is off by default.** High-risk messages go to the review folder unless you explicitly enable "Move high-risk mail directly to Junk" in settings.
- **Authentication-Results trust is explicit and per-server.** There is no automatic discovery or auto-trust of `authserv-id` values.
- **No modification of message headers or source.** The add-on never rewrites or tags message content.
- **Thunderbird 102 or later required.**

---

## Screenshot Checklist

The following screenshots should be captured from a working test installation to accompany the store listing. They do not need to be final-quality artwork — clear, readable captures from a real Thunderbird session are sufficient.

### 1. Basic setup — Protection Status panel

**What to show:**
- Options page, Basic tab, Protection Status section.
- One state showing "protected" (at least one trusted server configured, recent messages assessed).
- One state showing the warning when no trusted servers are configured (optional but useful for documentation).

**Why:** First thing users see; confirms the add-on is active.

### 2. Trusted Authentication Servers settings

**What to show:**
- Options page, Basic tab, Trusted Authentication Servers section.
- At least one trusted entry visible (e.g. `mail.example.com`, match type shown).
- Setup assistant open, showing MX hint suggestions (optional).

**Why:** Communicates the required setup step and what the workflow looks like.

### 3. Review folder — message list

**What to show:**
- Thunderbird message list for the "Auth Review" folder.
- A handful of messages moved there by the add-on.

**Why:** Shows the primary action the add-on takes — moving suspicious mail out of the Inbox.

### 4. Message display popup — score details

**What to show:**
- A message open in Thunderbird with the add-on's toolbar button visible.
- The popup open, showing:
  - Classification label (e.g. "review" or "high-risk").
  - Total score.
  - Primary score reasons with labels and deltas.
  - Protective factors section (if applicable).
  - "Score details" panel expanded to show full reason list.

**Why:** The popup is the main per-message explanation surface. Users deciding whether to whitelist or investigate need to see what it looks like.

### 5. Score details with a mitigation visible

**What to show:**
- Popup open on a legitimate newsletter or mailing-list message that reached the review folder.
- Score reasons showing both a risk signal (e.g. "SPF MAIL FROM differs from From") and a mitigation (e.g. "Delegated newsletter: DKIM-aligned, route-consistent").
- Protective factors section naming the mitigation.

**Why:** Demonstrates that the add-on explains why a message was *not* treated as higher risk, which builds trust with users who encounter false positives.

### 6. Review Actions (Move to Inbox / Whitelist Sender)

**What to show:**
- Popup open on a message currently in the Auth Review folder.
- Review Actions section visible at the bottom with "Move to Inbox" and "Whitelist Sender" buttons.
- Optionally: the confirmation step for "Whitelist Sender".

**Why:** Communicates the self-service remediation workflow for false positives.

### 7. Diagnostics / Decision Log (optional)

**What to show:**
- Options page, Diagnostics tab, Decision Log section.
- A few log entries with score reasons visible, original and recalculated scores.
- Export button visible.

**Why:** Signals to power users that full diagnostic data is available and exportable without leaving Thunderbird.

---

## Store Metadata Notes

- **Category:** Security / Privacy (or Filters, if that is the best-fit category on ATN).
- **License:** Mozilla Public License 2.0.
- **Homepage / Support URL:** project repository.
- **Tags to consider:** authentication, spam filter, DMARC, SPF, DKIM, email security, review folder.

---

## Verification Checklist

Before submitting the listing:

- [ ] Description does not claim to block all spam or guarantee accuracy.
- [ ] Description clearly states mail data stays local (no external uploads).
- [ ] Known limitations section is present and honest.
- [ ] Privacy section is consistent with PRIVACY.md.
- [ ] Trust model explanation (trusted servers required, untrusted headers ignored) is accurate.
- [ ] Setup requirement (manual `authserv-id` configuration) is stated upfront.
- [ ] All screenshots show the current UI (not an earlier design).
- [ ] Screenshot checklist items 1–4 are covered at minimum.
