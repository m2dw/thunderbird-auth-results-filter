# Vendored third-party code

Auth Results Filter is packaged without a bundler: the third-party runtime
dependencies below are copied verbatim into `vendor/` at build time (see
`scripts/vendor.mjs`) and loaded directly as ES modules. This file declares
every executable third-party file bundled in the XPI, per
https://webextension-api.thunderbird.net/en/mv3/guides/vendoring.html.

Each vendored file is copied byte-for-byte from the corresponding npm
package's published build output — no banners or other modifications are
applied, with one documented exception (`vendor/mail-auth-signal.esm.js`,
below). Full license text and attribution notices for these libraries are
collected in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

The authored source in this XPI is not minified and is reviewable directly;
no separate source archive is provided.

## vendor/jsep.esm.min.js

- Upstream project: jsep (https://github.com/EricSmekens/jsep)
- Version: 1.4.0
- License: MIT
- Source URL: https://cdn.jsdelivr.net/npm/jsep@1.4.0/dist/jsep.min.js
- Packaged from: `node_modules/jsep/dist/jsep.min.js`

## vendor/tldts.esm.min.js

- Upstream project: tldts (https://github.com/remusao/tldts)
- Version: 7.4.0
- License: MIT (bundled Public Suffix List data: MPL-2.0)
- Source URL: https://cdn.jsdelivr.net/npm/tldts@7.4.0/dist/index.esm.min.js
- Packaged from: `node_modules/tldts/dist/index.esm.min.js`

## vendor/mail-auth-signal.esm.js

- Upstream project: mail-auth-signal (https://github.com/m2dw/mail-auth-signal)
- Version: 0.5.2
- License: Apache-2.0
- Source URL: https://cdn.jsdelivr.net/npm/mail-auth-signal@0.5.2/dist/index.js
- Packaged from: `node_modules/mail-auth-signal/dist/index.js`, with one
  documented one-line patch (see below)

Upstream `mail-auth-signal` imports the bare specifier `tldts`, which requires
a browser import map to resolve. `strict_min_version` in `manifest.json` is
102.0, and Thunderbird 102-107 predate Firefox's import map support, so that
map is silently ignored on those releases and the background/options module
graph fails to load. Rather than raise the minimum supported version,
`scripts/vendor.mjs` patches the single import line so it resolves natively,
with no import map required, on every supported Thunderbird release:

```diff
-import { getDomain } from "tldts";
+import { getDomain } from "./tldts.esm.min.js";
```

This is the only modification made to the upstream file. `scripts/vendor.mjs`
asserts the original line is present verbatim before patching, so a future
`mail-auth-signal` upgrade that changes this import will fail vendoring loudly
instead of silently shipping an unpatched, broken file.
