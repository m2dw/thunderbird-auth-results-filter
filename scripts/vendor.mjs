/**
 * Copy third-party runtime dependencies into src/vendor/ so they can be
 * packaged into the extension XPI without a bundler.
 *
 * Run automatically via `npm install` (postinstall hook) and before
 * `npm run package`. Can also be run manually: `node scripts/vendor.mjs`.
 */

import { copyFile, mkdir, rm } from 'fs/promises';
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

// mail-auth-signal@0.5.3 publishes dist/browser/mail-auth-signal.esm.js as an
// unmodified, browser-compatible ESM artifact (m2dw/mail-auth-signal#93) — it
// inlines its "tldts" dependency, unlike dist/index.js (the "import"
// condition), which imports "tldts" as a bare specifier and cannot resolve
// without a bundler. It no longer needs the import-rewrite patch earlier
// releases required. Copy it byte-for-byte, matching every other vendored
// file.
await copyFile(
  resolve(root, 'node_modules/mail-auth-signal/dist/browser/mail-auth-signal.esm.js'),
  resolve(vendorDir, 'mail-auth-signal.esm.js'),
);

console.log('Vendored: src/vendor/mail-auth-signal.esm.js');
