/**
 * Verify the packaged extension icons.
 *
 * The icon artwork is intentionally checked in as PNG assets derived from the
 * maintainer-selected reference image. This script does not redraw or resize
 * the icon; it only validates that the files required by manifest.json exist
 * with the expected dimensions before packaging.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const iconDir = resolve(root, 'src', 'icons');

const SIZES = [16, 32, 48, 64, 128];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngDimensions(path) {
  const data = readFileSync(path);
  if (data.length < 24 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${path} is not a valid PNG file`);
  }
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}

for (const size of SIZES) {
  const path = resolve(iconDir, `icon-${size}.png`);
  const { width, height } = readPngDimensions(path);
  if (width !== size || height !== size) {
    throw new Error(`${path} is ${width}x${height}, expected ${size}x${size}`);
  }
  console.log(`Verified icon-${size}.png (${width}x${height})`);
}
