# Vendored third-party code

Auth Results Filter is packaged without a bundler: the third-party runtime
dependencies below are copied verbatim into `vendor/` at build time (see
`scripts/vendor.mjs`) and loaded directly as ES modules. This file declares
the minified third-party files bundled in the XPI, in the packaged-path /
Version / URL block format described in the
[Thunderbird vendoring guide](https://webextension-api.thunderbird.net/en/mv3/guides/vendoring.html).

Each vendored file below is copied byte-for-byte from the corresponding npm
package's published build output — no banners, import rewrites, or other
modifications are applied. Full license text and attribution notices for
these libraries are collected in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). Build provenance (which
`node_modules/` path each file is copied from) is documented in
`scripts/vendor.mjs`, not here, so it cannot be mistaken for a packaged path.

`vendor/mail-auth-signal.esm.js` (mail-auth-signal 0.6.1, Apache-2.0) is also
bundled but intentionally not declared here: it is readable, non-minified code
shipped as-is in the XPI, as agreed with the Thunderbird Add-ons reviewer. It
remains a pinned runtime dependency in `package.json` and `package-lock.json`.

The authored source in this XPI, including `vendor/mail-auth-signal.esm.js`,
is not minified and is reviewable directly. Submissions are XPI-only; no
separate source archive is needed or uploaded.

vendor/jsep.esm.min.js:
 - Version: 1.4.0
 - URL: https://cdn.jsdelivr.net/npm/jsep@1.4.0/dist/jsep.min.js

vendor/tldts.esm.min.js:
 - Version: 7.4.0
 - URL: https://cdn.jsdelivr.net/npm/tldts@7.4.0/dist/index.esm.min.js
