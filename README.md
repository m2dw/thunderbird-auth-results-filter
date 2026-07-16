# thunderbird-auth-results-filter

[![CI](https://github.com/m2dw/thunderbird-auth-results-filter/actions/workflows/ci.yml/badge.svg)](https://github.com/m2dw/thunderbird-auth-results-filter/actions/workflows/ci.yml)

A Thunderbird add-on that reads `Authentication-Results` headers and sender identity signals to score suspicious messages and move them to a review folder or Junk.

## What it does

- Reads `Authentication-Results` headers (SPF, DKIM, DMARC) from incoming messages.
- Evaluates results only from `authserv-id` domains you have explicitly trusted.
- Scores messages using authentication results, sender identity alignment, and lexical heuristics.
- Moves uncertain messages (score 50–99) to a per-account review folder ("Auth Review" by default).
- Can optionally move high-risk messages (score 100+) directly to Junk — this is off by default.
- Keeps all mail data and logs local on your device.

## What it does not do

- **Does not replace server-side spam filtering.** It is a client-side scoring layer on top of what your mail server already does.
- **Does not authenticate messages by itself.** It reads `Authentication-Results` headers that your mail server wrote; it does not run SPF, DKIM, or DMARC checks itself.
- **Requires trusted Authentication-Results from your mail server.** If no trusted `authserv-id` is configured, authentication-based scoring is disabled and the add-on contributes zero score from authentication results.
- **Does not send mail contents, logs, or settings to external services.** See [PRIVACY.md](PRIVACY.md) for details.

## Privacy

All scoring, logging, and settings are local. The only optional external contact is an MX DNS lookup in the setup assistant (opt-in, disabled by default), which sends only your account email domain to a user-selected DNS resolver (Google Public DNS or Cloudflare). No message content or headers are ever sent externally. See [PRIVACY.md](PRIVACY.md).

## Permissions

The add-on requests the following permissions from Thunderbird:

| Permission | Why it is needed |
|---|---|
| `accountsRead` | Read your account names and email addresses to derive the receiving account domain per message (used by the own-account-domain spoofing rule and to create per-account review folders). |
| `accountsFolders` | List and create folders in your accounts so the add-on can find or create the "Auth Review" folder for each account. |
| `messagesRead` | Read the full MIME structure of each incoming message locally to score it. Scoring uses only headers (`Authentication-Results`, `From`, `Message-ID`, etc.); the message body is not used for scoring, but the full message is fetched before the notification check runs. A short plain-text body snippet may additionally be included in a post-assessment notification if that optional feature is enabled. Mail data never leaves Thunderbird. |
| `messagesMove` | Move messages to the review folder or Junk after scoring. |
| `messagesUpdate` | (1) Mark high-risk messages as junk (`{ junk: true }`) before moving them to the Junk folder when the "Move high-risk to Junk" setting is enabled. (2) Clear the junk flag on a message before moving it back to Inbox from the review folder (popup quick action). |
| `notifications` | Show an optional post-filter new-mail notification after a message has been assessed (disabled by default). |
| `storage` | Persist settings, trusted `authserv-id` entries, sender domain rules, the manual whitelist, and the decision log locally in Thunderbird's extension storage. |
| DNS host permissions (`dns.google`, `cloudflare-dns.com`, `1.1.1.1`, `1.0.0.1`) | Perform MX record lookups for the setup assistant's "suggest authserv-id" feature. This is opt-in and disabled by default; only your account email domain is sent, not message data. |
| `addressBooks` *(optional)* | Check incoming message senders against your Thunderbird address books as a whitelist mitigation source. This permission is requested only when you explicitly enable "Address Book Whitelist" in settings. |

## Features

- Scores `Authentication-Results` for SPF, DKIM, and DMARC from trusted `authserv-id` entries.
- Ignores untrusted `Authentication-Results` headers for scoring; logs them diagnostically.
- Evaluates sender identity alignment (SPF MAIL FROM, DKIM signing domain, DMARC `header.from`).
- Applies lexical heuristics on the From domain and local part as additional weak signals.
- Uses composite detection rules that require multiple signals to converge before triggering.
- Moves review-threshold messages to a per-account "Auth Review" folder by default.
- Optionally moves high-risk messages directly to Junk (explicit setting, off by default).
- Shows score details for any message in the message display toolbar popup.
- Supports per-domain sender rules, a manual whitelist, and an optional address-book whitelist.
- Rule weights are configurable from the options page.
- Keeps a local decision log (up to 1000 entries) with score recalculation support.

## Score thresholds

| Range | Classification | Default action |
|---|---|---|
| 0–49 | Normal | Leave in inbox |
| 50–99 | Review | Move to Auth Review folder |
| 100+ | High risk | Move to Auth Review folder (or Junk if enabled) |

## Installation

The packaged `.xpi` file under `dist/` can be installed in Thunderbird via
**Add-ons Manager → Install Add-on From File**.

## Development

```bash
npm install       # install dependencies
npm test          # run the test suite
npm run package   # build dist/auth-results-filter-<version>.xpi
```

The package output is named `dist/auth-results-filter-<version>.xpi` where
`<version>` matches the `version` field in `src/manifest.json`. The generated
`.xpi` can be installed in Thunderbird via **Add-ons Manager → Install Add-on
From File**. Unlike a temporary add-on load, this installation persists across
Thunderbird restarts, which is useful for end-to-end testing.

## Release

Releases are cut from the private development repository and published to this
public repository as a squashed source snapshot plus a versioned XPI attached to
a GitHub Release. See [docs/public-release.md](docs/public-release.md) for the
full private-to-public release model and, in particular, the
[reviewer instructions for rebuilding and inspecting the submitted XPI from this
public source](docs/public-release.md#verifying-the-xpi-matches-the-public-source-for-reviewers).

### GitHub Actions CI

Every push to `main` or a `release/**` branch, and every pull request, triggers the CI
workflow (`.github/workflows/ci.yml`). The workflow runs the full test suite and builds
the XPI package. Both must pass before a release branch PR is merged.

The packaged XPI is uploaded as a workflow artifact on every successful CI run. To
download it, open the workflow run on the
[Actions tab](https://github.com/m2dw/thunderbird-auth-results-filter/actions/workflows/ci.yml)
and download `auth-results-filter-xpi` from the Artifacts section.

Before submitting to the Thunderbird Add-ons store, confirm that:

1. The CI badge at the top of this README is green.
2. `npm test` and `npm run package` both pass in the latest CI run on `main`.
3. The downloaded XPI installs and functions correctly in a manual Thunderbird test
   (CI does not cover runtime Thunderbird checks).

### Releases

Releases are published to this repository by the maintainer's release tooling and
tagged `v<version>`, with the packaged XPI attached as a GitHub Release asset.

To reproduce the XPI for a release from this public source:

1. Check out the `v<version>` tag.
2. Run `npm ci`.
3. Run `npm test` and `npm run package`.
4. The build writes `dist/auth-results-filter-<version>.xpi`, matching the asset
   attached to the corresponding GitHub Release.

See [docs/public-release.md](docs/public-release.md) for full verification steps.
## License

This project is licensed under the Mozilla Public License 2.0. See [LICENSE](LICENSE).
