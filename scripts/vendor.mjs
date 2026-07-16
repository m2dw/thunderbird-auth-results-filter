/**
 * Copy third-party runtime dependencies into src/vendor/ so they can be
 * packaged into the extension XPI without a bundler.
 *
 * Run automatically via `npm install` (postinstall hook) and before
 * `npm run package`. Can also be run manually: `node scripts/vendor.mjs`.
 */

import { copyFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

await mkdir(resolve(root, 'src/vendor'), { recursive: true });

await copyFile(
  resolve(root, 'node_modules/tldts/dist/index.esm.min.js'),
  resolve(root, 'src/vendor/tldts.esm.min.js'),
);

console.log('Vendored: src/vendor/tldts.esm.min.js');

await copyFile(
  resolve(root, 'node_modules/jsep/dist/jsep.min.js'),
  resolve(root, 'src/vendor/jsep.esm.min.js'),
);

console.log('Vendored: src/vendor/jsep.esm.min.js');

await copyFile(
  resolve(root, 'node_modules/mail-auth-signal/dist/index.js'),
  resolve(root, 'src/vendor/mail-auth-signal.esm.js'),
);

console.log('Vendored: src/vendor/mail-auth-signal.esm.js');

await copyFile(
  resolve(root, 'node_modules/mail-auth-signal/LICENSE'),
  resolve(root, 'src/vendor/mail-auth-signal.LICENSE'),
);

console.log('Vendored: src/vendor/mail-auth-signal.LICENSE');

await copyFile(
  resolve(root, 'node_modules/mail-auth-signal/NOTICE'),
  resolve(root, 'src/vendor/mail-auth-signal.NOTICE'),
);

console.log('Vendored: src/vendor/mail-auth-signal.NOTICE');
