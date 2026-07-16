# Architecture: Integration Boundary — Add-on and `mail-auth-signal`

This document describes the integration boundary between the add-on and the
[`mail-auth-signal`][mas] npm package, and the add-on modules that remain local.
`mail-auth-signal` is now integrated as the authoritative source for
`Authentication-Results` parsing, metrics, and composite signals — extraction
is the current reality, not a future plan. The add-on retains its Thunderbird
adapter, scoring policy, UI labels, L1–L5 actions, and storage/move behaviour.
Nothing here changes the scoring behaviour or the repository structure.

---

## Module Boundaries

The codebase is organised into four logical zones. Zone 1 modules are pure or
supplemental — no Thunderbird API calls, no side effects. Some Zone 1
functionality has already migrated to `mail-auth-signal`; what remains local is
either richer than the package equivalent or has no package equivalent. Zones 3
and 4 are the Thunderbird integration layer.

### 1. Pure metrics / parsing / signal logic

These modules have no dependency on Thunderbird browser APIs and no side effects.
They take plain data and return plain data. Core parsing and metric logic has
moved to `mail-auth-signal`; the local modules either provide richer behaviour
than the package or have no package equivalent.

| File | Responsibility |
|------|---------------|
| `src/core/lexicalMetrics.js` | Supplemental local lexical metrics (vowel ratio including 'y', letter-digit transitions, hex-run, digit/hyphen ratios). Core entropy / normalized entropy / max consonant run / repeated-char / unique-char fields now come from `mail-auth-signal` `computeLexicalHeuristics`; output is merged into the combined `lexicalMetrics` field |
| `src/core/heuristics.js` | Layer 3 random-looking label / local-part checks |
| `src/core/alignment.js` | Layer 2 SPF / DKIM / DMARC domain-alignment facts |
| `src/core/domainParts.js` | PSL-backed registrable-domain and subdomain-depth extraction. The tldts resolver is injected into `analyzeMessage` via the `getRegistrableDomain` dependency. `mail-auth-signal` also exposes `computeDomainParts` and populates `senderIdentity.fromDomainParts` internally; the local module remains necessary as the PSL resolver owner |
| `src/core/messageIdentity.js` | From / Sender / Reply-To / Return-Path / Message-ID extraction |
| `src/core/displayNameMetrics.js` | Brand inference (Jaro-Winkler, trigram Jaccard) and display-name log observability. `mail-auth-signal` `senderIdentity` provides `displayName.containsEmail`, `displayName.embeddedDomains`, and whitespace metrics; the add-on layer adds the richer brand-inference / Jaro-Jaccard policy against `src/data/topDomains.js` |
| `src/core/headerMetrics.js` | Identity header raw observability fields |
| `src/core/bigramNaturalness.js` | Static bigram naturalness metric for domain labels |
| `src/core/psl.js` | Thin wrapper around the bundled tldts PSL library |

Constraint: none of these files should call `browser.*` or import from
`src/background/` or `src/options/`.

### 2. Policy layer — signals to scores / actions

This zone maps raw signals to scores and computes the final classification.
It depends only on zone 1 and on plain settings objects.

| File | Responsibility |
|------|---------------|
| `src/core/compositeRules.js` | Layer 4 composite rule evaluation |
| `src/core/scoring.js` | Orchestrates L1–L5; returns `{ score, scoreReasons, … }` |
| `src/core/trust.js` | Authserv-id trust checks (pure, PSL-backed) |
| `src/core/whitelist.js` | Layer 5 whitelist / address-book matching |
| `src/core/ruleRegistry.js` | User-facing metadata for every stable score-reason key |

`scoreReasons` is the Thunderbird policy adapter's current output shape — a
flat array of `{ key, delta, label, …context }` objects. See the
language-neutral output shape section below for a language-agnostic projection.

Constraint: keep all score defaults (the `DEFAULT_*` constants) inside this
zone and out of adapter / storage modules. This lets the scoring policy be
substituted independently of the Thunderbird adapter.

### 3. Thunderbird adapter code

This zone wraps Thunderbird browser APIs. It calls zone 1 and 2 functions with
data extracted from real messages and drives the move/tag actions.

| File | Responsibility |
|------|---------------|
| `src/background/background.js` | New-message listener; extracts headers via `browser.messages` and drives move/tag actions |
| `src/modules/storage.js` | `browser.storage.local` read/write and migration |
| `src/modules/notificationPolicy.js` | `browser.notifications` wrapper and notification policy |

Constraint: `background.js` should pass plain POJOs (strings, objects) into
zone 2, not live WebExtension objects. The boundary is already mostly respected;
keeping it explicit makes the adapter seam obvious.

### 4. UI / options / notification code

Strictly presentation. No scoring logic should live here.

| File / directory | Responsibility |
|-----------------|---------------|
| `src/options/` | Options page: settings UI, decision log, score-tuning |
| `src/message-display/` | Popup: per-message score detail and review quick actions |

---

## Language-Neutral Output Shape

The canonical output of a scoring run is expressible in any language without
Thunderbird-specific field names. The proposed shape, independent of
`scoreReasons` display metadata:

```json
{
  "metrics": {
    "authResults": [ { "method": "dmarc", "result": "fail", "authservId": "…", "trusted": true } ],
    "alignmentFacts": { "spfAligned": true, "anyDkimAligned": false },
    "heuristicFacts": { "randomFromDomainLabel": true, "randomFromLocalPart": false }
  },
  "signals": [
    { "key": "auth.dmarc.fail",  "layer": 1, "delta": 15 },
    { "key": "composite.authAlignedRandomDomain", "layer": 4, "delta": 40 }
  ],
  "score": 55,
  "classification": "review",
  "evidence": {
    "fromDomain": "example.com",
    "authservId": "mail.receiver.example"
  },
  "explanations": [
    "DMARC fail from trusted authentication server",
    "Auth-aligned sender with random-looking domain label"
  ]
}
```

In this shape:

- `metrics[]` contains the raw parsed facts from headers (language-agnostic).
- `signals[]` contains the scored events emitted by L1–L4 rules.
- `evidence` contains the key identity fields used in rule evaluation.
- `explanations[]` contains human-readable summaries of the fired rules,
  suitable for display without knowledge of the internal key namespace.

`scoreReasons` in the current add-on is approximately `signals[]` with
display metadata merged in. Display metadata (labels, tooltips) lives in the
adapter or UI layer rather than the core so that a non-Thunderbird adapter can
substitute its own localisation.

---

## Zone Boundary Maintenance

These constraints keep the zones clean without changing scoring behaviour.

1. **Audit `browser.*` call sites in `src/core/`.**  
   Any call to a Thunderbird API found in zone 1 or 2 modules is a boundary
   violation; move it to zone 3. Currently `src/core/` appears clean; make this
   a lint rule or CI check.

2. **Pass POJOs across the adapter boundary.**  
   `background.js` should destructure everything it needs from the
   WebExtension `MessageHeader` object before calling `scoring.js`. This makes
   the zone 2 API a plain function that could be unit-tested with
   `{ from, headers, accountDomain }` literals.

3. **Centralise score defaults in zone 2.**  
   `DEFAULT_*` constants currently live in zone-2 modules: `scoring.js`,
   `compositeRules.js`, `heuristics.js` (Layer 3 caps and scores), and
   `whitelist.js` (mitigation deltas). Ensure none leak into zone 3 or 4.
   This keeps the scoring policy substitutable independently of the adapter.

4. **Name the boundary in code comments.**  
   Add a one-line zone comment (e.g. `// Zone 1: pure metrics`) at the top of
   each file in `src/core/`. Future contributors will understand the constraint
   without reading this document.

5. **Write a unit test that imports a zone 1 module with no globals.**  
   Running `import { computeLexicalMetrics } from '../src/core/lexicalMetrics.js'`
   in a plain Node test (no browser polyfill) verifies that zone 1 remains free
   of Thunderbird dependencies. A failing import immediately flags a regression.

---

## `mail-auth-signal` Integration Boundary

The add-on depends on the [`mail-auth-signal`][mas] npm package (`^0.4.0`) for
core `Authentication-Results` parsing and metric extraction. The package is
vendored into `src/vendor/mail-auth-signal.esm.js` at build time and is licensed
under the Apache License 2.0 (see `src/vendor/mail-auth-signal.LICENSE`).

### What lives in `mail-auth-signal`

`mail-auth-signal` is the single source of truth for parsing
`Authentication-Results` headers and extracting per-message metrics and
composite signals. The package exports several entry points, but the add-on now
consumes only two of them, both through `src/modules/mailAuthSignalAdapter.js`:

| Package export used | Responsibility |
|---------------------|----------------|
| `analyzeMessage` | Full per-message extraction: parsed auth results, From/Message-ID domain extraction, `senderIdentity` (with the add-on's injected PSL resolver), and composite signals |
| `defaultCompositeRules` | Built-in composite rule set (`unauthenticatedFromSpoof`, `authenticatedDisplayNameSpoof`, `alignedAuthenticationConfirmed`, `publicMailboxSpoofingCandidate`, `unsecuredDeepSubdomainCandidate`) run by `analyzeMessage`. The add-on replaces the upstream `publicMailboxSpoofingCandidate` rule with its own override (broader Yahoo domain catalog, infrastructure-mismatch gate) in `mailAuthSignalAdapter.js`. |

The package's other parsing helpers (`parseAuthenticationResults`,
`normalizeHeaders`, `extractDomainFromMailbox`, `extractDomainFromMessageId`)
are reachable but **not** wired into the add-on: `analyzeMessage` already
performs that work internally, and the add-on keeps its own RFC 5322-strict
identity parsing (`src/core/messageIdentity.js`) for the fields it scores on.

### The adapter — the only integration seam

`src/modules/mailAuthSignalAdapter.js` is the one place the package is touched.
After the issue #307 audit it exposes exactly three functions, all consumed by
`src/background/background.js`:

| Adapter export | Responsibility |
|----------------|----------------|
| `analyzeMailAuthSignals` | Strip RFC 7601 version tokens, inject the add-on's `getRegistrableDomain` resolver, and call `analyzeMessage` → `{ metrics, signals }` |
| `adaptAuthResults` | Reshape `metrics.authenticationResults` (`methods` → `results`) into the add-on's `parsedAuthResults` form consumed by `scoreMessage()` and the alignment helpers |
| `adaptCompositeSignals` | Translate `composite.*` signals into the add-on's `scoreReasons`, applying the PSL-aware suppression gates that the package's exact-domain matching cannot express |

### What stays in the add-on

The add-on retains logic that is specific to its Thunderbird integration or that
is a richer heuristic than the package currently offers. These run on the
package's parsed output rather than duplicating its parsing:

| Module | Reason retained |
|--------|----------------|
| `src/core/alignment.js` | PSL-aware Layer 2 SPF/DKIM/DMARC alignment over `parsedAuthResults`. Subdomain-aware (e.g. `news.example.com` aligns with `example.com`); the package's alignment is exact-domain only, so the local version is authoritative |
| `src/core/messageIdentity.js` | From / Sender / Reply-To / Return-Path / Message-ID extraction with strict RFC 5322 angle-bracket semantics and Thunderbird header-map convention |
| `src/core/compositeRules.js` | Layer 4 composite scoring, incl. `computeMessageIdMetrics` (`messageIdIsIcann`, `messageIdMismatchWithUnalignedAuth`) which has no `senderIdentity` equivalent |
| `src/core/displayNameMetrics.js` | Brand inference (Jaro-Winkler, trigram Jaccard) and display-name log observability. `mail-auth-signal` `senderIdentity` now provides `displayName.containsEmail`, `displayName.embeddedDomains`, and whitespace metrics; the add-on layer adds the richer brand-inference / Jaro-Jaccard policy and `TOP_DOMAINS` matching |
| `src/core/domainParts.js` | The tldts-backed PSL resolver owner. The resolver is injected into `analyzeMessage` via `getRegistrableDomain`. `mail-auth-signal` also exposes `computeDomainParts` for internal use; the local module is required to provide the resolver |
| `src/core/heuristics.js` / `lexicalMetrics.js` / `bigramNaturalness.js` | Layer 3 random-looking domain-label / local-part checks. `lexicalMetrics.js` is supplemental — it provides fields not in `mail-auth-signal` and merges its output with `computeLexicalHeuristics` into the combined `lexicalMetrics` field |
| `src/core/headerMetrics.js` | Identity-header raw observability fields for the decision log |
| `src/core/scoring.js` | Full L1–L5 orchestration and the add-on's `scoreReasons` output shape |
| `src/core/trust.js` | Authserv-id trust checks (incl. `matchType:'domain'` subdomain trust) that drive add-on-level trust decisions |
| Scoring settings, custom formulas, whitelist / address-book policy, notifications, logging, folder actions, storage migrations | Add-on product features, out of scope for the core library |

### Audit result (issue #307)

After the alignment, sender-identity, and composite migrations, the remaining
`src/core` detection modules were audited against `mail-auth-signal`. Each is still
imported by production code and provides a heuristic richer than, or not present
in, the package (see the table above) — with one exception now resolved:
`src/core/jaroWinkler.js` was removed in issue #333 because `mail-auth-signal`
v0.4.0 ships `computeJaro` and `computeJaroWinkler` with identical output (same
algorithm, 4-decimal rounding). `displayNameMetrics.js` now imports
`computeJaroWinkler` from the vendor bundle directly.

The dead duplicated code that *was* removed lived in the adapter: six exported
functions added during the migrations as candidate replacements but never wired
into `background.js`, because the richer local paths were kept instead:

| Removed adapter export | Why it was dead |
|------------------------|-----------------|
| `normalizeMessageHeaders`, `extractMailboxDomain`, `extractMsgIdDomain` | Thin pass-throughs to package helpers; production uses `analyzeMessage` + local identity parsing |
| `parseAuthResultsHeader`, `parseAllAuthResultHeaders` | Duplicated parsing already done by `analyzeMailAuthSignals` + `adaptAuthResults` |
| `adaptPassAlignmentSummary` | Vendor-exact-match alignment superseded by the richer PSL-aware `computePassAlignmentSummary`, which `background.js` uses |

No user-visible scores changed: `background.js` already used only the three
retained adapter functions, so the deletions are pure dead-code removal. The
exported decision-log shape is unchanged.

### Follow-up: rules not yet upstreamed

The following Layer 1–4 rule areas remain local and are candidates for
upstreaming to `mail-auth-signal` in future issues. Each is a *richer* heuristic
than the package offers today, so per the audit constraints it must not be
deleted until equivalent core support exists:

- Layer 2 PSL-aware alignment (`alignment.js`) — subdomain-aware SPF/DKIM/DMARC alignment
- Layer 3 heuristic checks (`heuristics.js`) — random-looking domain-label and local-part detection
- Layer 4 composite rules (`compositeRules.js`) — cross-signal composite scoring and Message-ID metrics

Create a follow-up issue for each area when upstreaming work begins so that
the parity checklist can be tracked independently.

[mas]: https://github.com/m2dw/mail-auth-signal

---

## Non-Goals (for This Document)

- Do not split into a new repository now.
- Do not port to another language now.
- Do not change scoring behaviour.

---

## Signal-First Extraction Policy

### Core direction

`mail-auth-signal` is the authoritative reusable detection engine.
The Thunderbird add-on should not keep reusable mail-authentication detection logic long-term.

**Add-on owns** (permanent):

- Thunderbird browser APIs and adapter code
- Settings, storage, and storage migrations
- Score weights, thresholds, and custom formula support
- Review/Junk folder-move actions
- Authserv-id trust UI and storage
- Whitelist/address-book policy
- Notifications, popup UI, decision log, export, options UI

**`mail-auth-signal` owns** (migration targets — currently local or partially local):

| Local module | Migration status |
|---|---|
| `src/core/domainParts.js` — PSL/tldts resolver and domain parts | tracked in [mail-auth-signal-ai#61] |
| `src/core/alignment.js` — PSL-aware SPF/DKIM/DMARC alignment | tracked in [mail-auth-signal-ai#62] |
| `src/core/messageIdentity.js` — From / Sender / Reply-To / Return-Path / Message-ID extraction | tracked in [mail-auth-signal-ai#63] |
| `src/core/displayNameMetrics.js` — display-name and brand-domain inference | tracked in [mail-auth-signal-ai#64] |
| `src/core/compositeRules.js` — L4 composite signals | tracked in [mail-auth-signal-ai#65] |
| `src/core/heuristics.js` / `lexicalMetrics.js` / `bigramNaturalness.js` — L3 lexical/domain heuristics | tracked in [mail-auth-signal-ai#66] |
| ~~`src/core/jaroWinkler.js`~~ — Jaro-Winkler string similarity | **removed** in [#333]: `mail-auth-signal` now exports `computeJaro` and `computeJaroWinkler`; `displayNameMetrics.js` imports from the vendor bundle directly |

### Current migration issue map

- [mail-auth-signal-ai#61](https://github.com/m2dw/mail-auth-signal-ai/issues/61) — Bundle tldts-backed PSL resolver by default
- [mail-auth-signal-ai#62](https://github.com/m2dw/mail-auth-signal-ai/issues/62) — Move PSL-aware authentication alignment into mail-auth-signal
- [mail-auth-signal-ai#63](https://github.com/m2dw/mail-auth-signal-ai/issues/63) — Make message identity extraction authoritative in mail-auth-signal
- [mail-auth-signal-ai#64](https://github.com/m2dw/mail-auth-signal-ai/issues/64) — Move display-name brand inference into mail-auth-signal
- [mail-auth-signal-ai#65](https://github.com/m2dw/mail-auth-signal-ai/issues/65) — Move reusable L4 composite rule signals into mail-auth-signal
- [mail-auth-signal-ai#66](https://github.com/m2dw/mail-auth-signal-ai/issues/66) — Complete Layer 3 lexical and heuristic parity with the add-on
- [thunderbird-auth-results-filter-ai#333](https://github.com/m2dw/thunderbird-auth-results-filter-ai/issues/333) — Remove add-on-local detection engine after mail-auth-signal migration

### Guardrail for future contributors and agents

> When adding new reusable detection facts or heuristics, prefer implementing them in `mail-auth-signal` first. The add-on may add score policy, UI, logging, or Thunderbird actions, but should avoid becoming the source of truth for reusable detection logic.

If an urgent detection fix must land in the add-on first, create a follow-up issue immediately to move the reusable part into `mail-auth-signal`. Do not leave the logic in the add-on without a tracked migration ticket.

This policy exists because context compaction and agent memory loss have previously caused contributors to assume core extraction was complete when important pieces (PSL ownership, PSL-aware alignment, identity extraction, display-name inference, L4 composite rules, L3 heuristics) were still local. Writing the policy here makes it durable across agent sessions.

[mail-auth-signal-ai#61]: https://github.com/m2dw/mail-auth-signal-ai/issues/61
[mail-auth-signal-ai#62]: https://github.com/m2dw/mail-auth-signal-ai/issues/62
[mail-auth-signal-ai#63]: https://github.com/m2dw/mail-auth-signal-ai/issues/63
[mail-auth-signal-ai#64]: https://github.com/m2dw/mail-auth-signal-ai/issues/64
[mail-auth-signal-ai#65]: https://github.com/m2dw/mail-auth-signal-ai/issues/65
[mail-auth-signal-ai#66]: https://github.com/m2dw/mail-auth-signal-ai/issues/66
[thunderbird-auth-results-filter-ai#333]: https://github.com/m2dw/thunderbird-auth-results-filter-ai/issues/333
