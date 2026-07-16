# Release Readiness Checklist

This checklist tracks work required before publishing to the Thunderbird Add-on store.
Check items off as they are confirmed ready. Link issues where further work is tracked.

---

## Default UX

- [ ] First screen (Options → Setup) is understandable without reading documentation.
- [ ] Diagnostics panel (raw decision log details, heuristic metrics) is hidden or collapsed by default.
- [ ] When no trusted authserv-id is configured, the add-on shows a clear explanation that Authentication-Results scoring is inactive and guides the user to setup.
- [ ] When no Authentication-Results header is present in a message, the popup explains why no score is shown rather than showing a blank or zero.
- [ ] Score reasons use plain-language labels; raw score keys (e.g. `composite.spfAlignedDkimUnalignedRandomLocal`) are not the only thing shown to users.

## Performance

- [ ] Options page does not re-render or recalculate the full decision log by default on open; log rendering is paginated or on-demand.
- [ ] Receive-time scoring (background script) completes without blocking message delivery; processing is bounded even for messages with many Authentication-Results headers.
- [ ] Notifications are paced; bulk delivery of many messages does not produce a notification flood.
- [ ] Storage growth is bounded: decision log capped at 1000 entries, candidate list capped at 50 entries (confirmed in SPEC.md).

## Safety

- [ ] Junk folder movement is opt-in (`settings.moveHighRiskToJunk`, default `false`); confirmed in SPEC.md and tested in practice.
- [ ] No authserv-id or domain is trusted automatically; trust requires explicit user action (confirmed architecture; verify no regression).
- [ ] No message data (headers, body, metadata, logs, settings) is transmitted to external services; confirmed in PRIVACY.md.
- [ ] DNS/MX lookup for setup hints is opt-in and disabled by default; confirmed in PRIVACY.md; verify UI default.
- [ ] Address-book whitelist is opt-in and disabled by default (`settings.addressBookWhitelistEnabled`, default `false`).
- [ ] DNS resolver is restricted to the fixed permitted set (Google Public DNS, Cloudflare); no user-supplied arbitrary resolver accepted.

## Transparency

- [ ] Each score reason in the popup and log shows a human-readable label alongside the score key and delta.
- [ ] Mitigation reasons (negative-delta rules) are visible in score reason lists so users can tell why a suspicious message stayed below the review threshold.
- [ ] Users can tell why a message was left in the inbox (Normal): the popup shows "No score details available" or a full score breakdown with reasons.
- [ ] The score tuning UI explains what each threshold means (0–49 Normal, 50–99 Review, 100+ High risk).
- [ ] Log recalculation preview (original vs. current score) is working and clearly labeled.

## Store Assets and Documentation

- [ ] README updated for a target audience of end users, not developers; development instructions moved to a separate section or file.
- [ ] PRIVACY.md is accurate and covers all stored data fields and the two opt-in external-service cases (DNS, address book).
- [ ] Permission rationale documented: explain why each permission in `manifest.json` is required, either in README or a dedicated docs file.
- [ ] Known limitations documented (e.g. registrable-domain trust not yet enabled by default, scoring tuned from limited real-world data, ARC/forwarding guard absent).
- [ ] Screenshots prepared: Options setup screen, popup scoring details, review folder in Thunderbird.
- [ ] Store description written (summary, what it does, what it does not do).

## Packaging

- [ ] Release/version-bump process is documented in `docs/public-release.md` (private-to-public export, and the reviewer reproduce-from-source flow). The maintainer version-bump command (`npm run prepare-release -- <version>`) lives in the private development repo only and is not part of the public tree.
- [ ] `npm test` passes on a clean checkout.
- [ ] `npm run package` produces a valid XPI without errors or warnings.
- [ ] CI badge in README is green on `main` (confirms `npm test` and `npm run package` pass in GitHub Actions).
- [ ] XPI artifact is available for download from the [CI workflow run](https://github.com/m2dw/thunderbird-auth-results-filter/actions/workflows/ci.yml) on `main`.
- [ ] XPI installs cleanly in the minimum supported Thunderbird version (Thunderbird 102).
- [ ] XPI installs cleanly in a current Thunderbird release.
- [ ] Add-on survives a Thunderbird restart without losing settings (confirmed via persistent XPI install).
- [ ] No Thunderbird Experiment APIs are used (confirmed in AGENTS.md constraint).

---

## Notes

- Items in the Safety section are hard constraints from `AGENTS.md`; they must not regress.
- The score tuning and log recalculation are described in `SPEC.md` under Score Tuning UI and Score Defaults Migration Policy.
- PRIVACY.md is the authoritative reference for external data access; keep it updated whenever stored fields or permissions change.

---

## First-Release QA Results — v0.5.5

**Date:** 2026-06-16  
**Tested by:** automated CI (npm test / npm run package) and maintainer manual session  
**Platform:** macOS 24.6.0 (Darwin), Node.js (see package.json engines)

### Automated checks

| Check | Result | Notes |
|---|---|---|
| `npm test` on clean checkout | **PASS** | 35 suites, 1747 tests, 0 failures |
| `npm run package` on clean checkout | **PASS** | `dist/auth-results-filter-0.5.5.xpi` produced, 181 285 bytes, no errors or warnings |

### Manual Thunderbird checks

| Check | Result | Notes |
|---|---|---|
| Install packaged XPI in current Thunderbird release | **NOT TESTED** | Requires local Thunderbird install; record result when performed |
| Install packaged XPI in Thunderbird 102 | **NOT TESTED** | Thunderbird 102 not available in this environment; omission recorded honestly per issue non-goals |
| Settings survive Thunderbird restart | **NOT TESTED** | Depends on XPI install above |
| Trusted authserv-id setup works end-to-end | **NOT TESTED** | Depends on XPI install above |
| Review-folder movement triggers correctly | **NOT TESTED** | Depends on XPI install above |
| Optional Junk movement works only when enabled | **NOT TESTED** | Default `moveHighRiskToJunk: false` confirmed in source; runtime test pending |
| Message display action popup opens and scrolls long details | **NOT TESTED** | Depends on XPI install above |
| Add-on notifications behave acceptably when enabled | **NOT TESTED** | Notification pacing logic covered by unit tests (`notificationScheduler.test.js`, `notificationPolicy.test.js`); runtime test pending |
| Diagnostics / log export works | **NOT TESTED** | Log export logic covered by `logExport.test.js`; runtime test pending |
| No unexpected external network access except opt-in DNS MX lookup | **NOT TESTED** | Architecture confirmed in `PRIVACY.md` and `AGENTS.md`; runtime network capture not performed |

### What is covered by unit tests (as a proxy for manual checks)

- Notification pacing: `test/notificationScheduler.test.js`, `test/notificationPolicy.test.js`
- Log export format: `test/logExport.test.js`
- MX lookup opt-in only: `test/mxLookup.test.js`
- Junk-move default off: confirmed in `test/scoring.test.js` and settings defaults
- Candidate / log bounds (50 / 1000): `test/candidates.test.js`, `test/storage.test.js`

### Remaining gaps before store submission

1. Manual XPI install on a current Thunderbird release (Windows or macOS).
2. End-to-end authserv-id trust setup and Review-folder movement smoke test.
3. Runtime confirmation that `moveHighRiskToJunk` default is `false` in the packaged XPI.
4. Network capture or proxy log confirming no unexpected outbound connections during normal operation.
5. Thunderbird 102 install — record as "not tested" in the store listing if still unavailable.
