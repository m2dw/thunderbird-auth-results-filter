/**
 * Copy third-party runtime dependencies into src/vendor/ so they can be
 * packaged into the extension XPI without a bundler.
 *
 * Run automatically via `npm install` (postinstall hook) and before
 * `npm run package`. Can also be run manually: `node scripts/vendor.mjs`.
 */

import { copyFile, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const vendorDir = resolve(root, 'src/vendor');

// Wipe and recreate src/vendor/ on every run so packaging is deterministic:
// a working tree that previously held generated files (e.g. the old
// mail-auth-signal.LICENSE / mail-auth-signal.NOTICE hidden-file copies)
// cannot leak stale files into the XPI just because they were never
// individually deleted.
await rm(vendorDir, { recursive: true, force: true });
await mkdir(vendorDir, { recursive: true });

await copyFile(
  resolve(root, 'node_modules/tldts/dist/index.esm.min.js'),
  resolve(vendorDir, 'tldts.esm.min.js'),
);

console.log('Vendored: src/vendor/tldts.esm.min.js');

await copyFile(
  resolve(root, 'node_modules/jsep/dist/jsep.min.js'),
  resolve(vendorDir, 'jsep.esm.min.js'),
);

console.log('Vendored: src/vendor/jsep.esm.min.js');

// mail-auth-signal's published ESM build imports the bare specifier "tldts",
// which relies on an import map to resolve. Thunderbird releases 102-107
// predate Firefox's import map support, so that map is silently ignored and
// the module graph fails to load. Import maps are dropped in favor of
// patching this one import to the relative URL of our vendored tldts copy,
// which every ES module engine (including pre-108 Thunderbird) resolves
// natively. This is the only modification made to the upstream file; see
// src/VENDOR.md for the documented patch.
const BARE_TLDTS_IMPORT = 'import { getDomain } from "tldts";';
const RELATIVE_TLDTS_IMPORT = 'import { getDomain } from "./tldts.esm.min.js";';

const mailAuthSignalSource = await readFile(
  resolve(root, 'node_modules/mail-auth-signal/dist/index.js'),
  'utf8',
);
const occurrences = mailAuthSignalSource.split(BARE_TLDTS_IMPORT).length - 1;
if (occurrences !== 1) {
  throw new Error(
    `Expected exactly one occurrence of ${JSON.stringify(BARE_TLDTS_IMPORT)} ` +
    `in node_modules/mail-auth-signal/dist/index.js, found ${occurrences}. ` +
    'The upstream import statement may have changed — update the patch in scripts/vendor.mjs.',
  );
}
await writeFile(
  resolve(vendorDir, 'mail-auth-signal.esm.js'),
  mailAuthSignalSource.replace(BARE_TLDTS_IMPORT, RELATIVE_TLDTS_IMPORT),
);

console.log('Vendored: src/vendor/mail-auth-signal.esm.js (tldts import patched to a relative URL)');
