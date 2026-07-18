# Public release workflow

Development happens in the **private** repository
`m2dw/thunderbird-auth-results-filter-ai`. Releases are published to the
**public** repository `m2dw/thunderbird-auth-results-filter`, which is the source
that Thunderbird Add-ons reviewers and OSS users see.

The public repo must **not** receive the private development history. Each
release publishes a clean, squashed public state plus the versioned XPI artifact
attached to a GitHub Release.

> **Note for public-repo readers:** the release tooling
> (`scripts/release-public.mjs`) and the `npm run release:public` command
> described below live **only in the private `…-ai` repository** and are not
> part of this public tree. The sections up to
> [Verifying the XPI matches the public source](#verifying-the-xpi-matches-the-public-source-for-reviewers)
> document the maintainer-only release process; the verification section at the
> end is what reviewers and OSS users need.

This is implemented by `scripts/release-public.mjs` in the private repo and
exposed there as:

```sh
npm run release:public -- [options]
```

## What the script does (private maintainers only)

1. Verifies the source `origin` remote is exactly `m2dw/thunderbird-auth-results-filter-ai`.
2. Verifies the public target is exactly `m2dw/thunderbird-auth-results-filter`.
3. Refuses to run if the working tree is dirty, except for documented generated
   artifacts (`dist/`, `src/vendor/`).
4. Verifies version metadata agrees across `package.json` and `src/manifest.json`
   (and `--version` if passed).
5. Runs `npm test` and `npm run package` against the **private working tree**.
6. Confirms the versioned XPI `dist/auth-results-filter-<version>.xpi` was built.
7. Exports only the allowlisted public source tree into a temporary directory.
8. Verifies the export is internally consistent: every retained public npm
   script that references a `scripts/*.mjs` file must have that file present in
   the export. Refuses to continue otherwise.
9. Verifies the **exported public tree itself** (not just the private working
   tree) by running `npm ci`, `npm test` and `npm run package` inside the export
   directory. This is what catches a script silently dropped by
   `sanitizePublicPackageJson()` — the private tree's `package.json` still has
   every script, so testing only the private tree cannot detect it.
10. On publish: clones the public repo, replaces its tracked tree with the export,
    creates a **single squashed commit**, then publishes in a fail-closed order —
    it pushes the tag `v<version>`, creates the GitHub Release with the XPI
    attached, and only then advances public `main`. See "Publish ordering" below.
11. Prints a release summary (source ref/commit, public commit, tag, XPI filename,
    verification results).

## Safety model (fail-closed)

- **Dry run is the default.** Running the script performs every local check and
  builds the export tree in a temp dir but pushes nothing.
- **Pushing requires `--confirm`.** No public push, tag, or release is created
  without it. The script never pushes during ordinary automation runs.
- **Wrong-repo refusal.** It refuses unless the source is exactly the private
  repo and the target is exactly the public repo. The clone's origin is
  re-checked before pushing.
- **No empty commits.** If the public tree already matches the release, it
  refuses rather than creating an empty commit to trigger CI.
- **No force by default.** Force-push (`--force-with-lease` for the branch,
  forced tag) requires both `--allow-force` and `--confirm`.
- **Existing-release preflight.** Before pushing anything, it checks both the
  remote tag and the GitHub Release for `v<version>`. If either already exists it
  refuses, so a stale release cannot fail `gh release create` only after public
  `main` was already advanced. `--allow-force` overrides this and replaces the
  existing release **in place** (it updates the Release notes and re-uploads the
  XPI with `--clobber`) rather than deleting and recreating it. The existing
  Release is never removed, so a forced run cannot leave the force-pushed tag
  pointing at a deleted/half-built Release.
- **Publish ordering (`main` advances last).** The release artifacts are created
  before `main` moves. The script pushes the tag (which uploads the release
  commit object), then creates or updates the GitHub Release with the XPI, and
  only then advances public `main`. If creating the release/XPI fails on a fresh
  release, the just-pushed tag is rolled back so no dangling tag is left behind
  and `main` is untouched. On a forced rerun the script first backs up the
  existing remote tag's target; if updating the Release/XPI then fails, it
  restores the tag to that backed-up target so the tag can never point at the new
  commit while the Release asset is still the old XPI, and `main` is untouched.
  If the final `main` push fails, the tag, Release
  and XPI remain a consistent published set — `main` is simply not advanced yet
  and can be fast-forwarded by re-running the release or manually. The public
  repo is never advanced to a release commit that lacks its corresponding tag and
  XPI asset.
- **Dirty-tree refusal.** Only `dist/` and `src/vendor/` may be dirty (they are
  generated). Any other change blocks the release unless `--allow-dirty` is set.

## Options (private maintainers only)

| Flag | Meaning |
| --- | --- |
| `--version <x.y.z>` | Expected version; must match `package.json` and `manifest.json`. Defaults to the manifest version. |
| `--source-ref <ref>` | Private ref to release. Default `HEAD`. Must resolve to the currently checked-out commit, because tests, packaging and the export all read the working tree; check the ref out first. |
| `--public-remote <url>` | Public repo git URL. Default `git@github.com:m2dw/thunderbird-auth-results-filter.git`. |
| `--dry-run` | Force dry run (default). |
| `--confirm` | Explicit maintainer confirmation to actually publish. |
| `--allow-force` | Permit force-pushing the branch/tag. Requires `--confirm`. |
| `--allow-dirty` | Permit a dirty tree outside generated-artifact paths. |
| `--keep-export` | Keep the temporary export directory for inspection. |

## Typical usage (private maintainers only)

Dry run (safe, default — inspect what would be exported):

```sh
npm run release:public
```

Publish a release (explicit maintainer action):

```sh
npm run release:public -- --confirm
```

## Public/private content boundary

The export uses an **allowlist**: anything not explicitly listed is never
exported, so newly added private files cannot leak by default. The lists live in
`scripts/release-public.mjs` (`PUBLIC_INCLUDE` / `PUBLIC_EXCLUDE`).

The export is also restricted to **git-tracked files** (`git ls-files`), not a
raw filesystem walk. Git-ignored local files under an allowlisted path — e.g. a
`*.zip` artifact under `assets/` or a globally ignored debug file under `src/` —
are never copied. This matters because `git status --porcelain` does not report
ignored files, so the dirty-tree preflight cannot catch them; restricting to the
tracked tree keeps such local artifacts from crossing the public/private
boundary into a release.

`npm run package`, however, archives the raw `src/` directory, so an ignored
file under `src/` (outside the regenerated `src/vendor/`) would land in the XPI
even though it is absent from the exported public source. To keep the attached
XPI matching the public tag, the script fails closed before packaging if any
such ignored file exists under `src/`.

**Exported to the public repo:**

- `src/` — extension source (excluding `src/vendor/`, which is regenerated).
- `test/` — tests for the public source (excluding the private release-tooling
  tests and tests that read private `.github/workflows/app-*.yml` files, which
  are not exported and would otherwise fail in the public tree/CI).
- `assets/` — icon source artwork used by `scripts/generate-icons.mjs`.
- `scripts/vendor.mjs`, `scripts/generate-icons.mjs`, `scripts/package-xpi.mjs`,
  `scripts/test.mjs` — the scripts needed to reproduce `npm test` and the XPI.
- `docs/architecture-extraction-boundary.md`, `docs/release-readiness.md`,
  `docs/store-listing.md`, `docs/public-release.md`.
- `.github/workflows/ci.yml` — public CI (test + package).
- `package.json`, `package-lock.json`, `.gitignore`. `package.json` is sanitized
  on export to drop npm scripts that invoke non-exported private scripts.
- `README.md`, `LICENSE`, `PRIVACY.md`, `SECURITY.md`. `README.md` is sanitized on
  export to replace the private "Local release flow" section (which documents the
  non-exported `npm run prepare-release` command) with public reproduce-from-source
  instructions.
- Vendored dependency license/notice files travel inside `src/vendor/` only in
  the packaged XPI; they are regenerated from `node_modules` by `npm run package`.

**Kept private (never exported):**

- `.n8n-artifacts/`, `prompts/`, `reviews/`, `memory/`, `cache/` — AI/automation
  workflow material.
- `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, `SPEC.md` — internal development docs.
- `.claude/` and `.github/workflows/app-*.yml` — private automation.
- `scripts/release-public.mjs`, `scripts/prepare-release.mjs` and their tests —
  private release tooling.
- `dist/`, `node_modules/`, `.DS_Store` and any local debug/log artifacts.

To change the boundary, edit `PUBLIC_INCLUDE` / `PUBLIC_EXCLUDE` and the lists
above together.

## Why a GitHub Release asset (not committed XPI)

The XPI is attached to the public **GitHub Release**, not committed into the
public repo. Committing built binaries bloats history, invites stale/source-
mismatched artifacts, and is awkward for OSS review. A Release asset is versioned,
immutable per tag, and clearly tied to `v<version>`. If a committed artifact is
ever required instead, document that tradeoff and add the target path to the
allowlist.

## CI/CD

- **Tests before release run against both trees.** `npm run release:public`
  runs `npm test` and `npm run package` against the private working tree, then
  again — `npm ci`, `npm test`, `npm run package` — against the exported public
  tree in a temporary directory. Testing only the private tree is not
  sufficient: `sanitizePublicPackageJson()` can drop an npm script during
  export (e.g. because its target file isn't in `PUBLIC_INCLUDE`) without that
  ever affecting the private tree's own `package.json` or `npm test` run. The
  script also fails closed if any retained public npm script references a
  `scripts/*.mjs` file that the export doesn't actually contain.
- **The public repo also runs CI.** `.github/workflows/ci.yml` runs `npm test`
  and `npm run package` on pushes to `main`/`release/**` and on PRs, and uploads
  the XPI as a build artifact. This lets the published tag/branch be verified
  independently.
- **Release artifacts are stored as public GitHub Release assets.**
- The release script does **not** depend on a README badge updating.

## Verifying the XPI matches the public source (for reviewers)

You can rebuild the XPI **contents** from the public source at the release tag:

```sh
git clone https://github.com/m2dw/thunderbird-auth-results-filter.git
cd thunderbird-auth-results-filter
git checkout v<version>
npm ci          # vendors third-party deps into src/vendor/
npm test
npm run package # produces dist/auth-results-filter-<version>.xpi
```

Verify by comparing **contents**, not file hashes. The packaging step writes ZIP
metadata (timestamps, ordering) from the working tree, so it is not yet
byte-for-byte deterministic: two `npm run package` runs from the same checkout
can produce different XPI hashes even when the archived files are identical.
Comparing the rebuilt asset's checksum against the release asset is therefore
expected to differ and is not a valid check.

Instead, the XPI is a ZIP of `src/` contents at the archive root; `unzip -l` both
the rebuilt XPI and the asset attached to the GitHub Release for `v<version>` and
compare the entry lists, then extract and diff the files (or at least the
embedded `src/manifest.json`). The `version` in `src/manifest.json`, the tag
`v<version>`, and the attached `auth-results-filter-<version>.xpi` all correspond
to the same release.
