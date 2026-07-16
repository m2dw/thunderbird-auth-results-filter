import { ZipArchive } from 'archiver';
import { createWriteStream, readFileSync } from 'fs';
import { mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const srcDir = resolve(root, 'src');
const distDir = resolve(root, 'dist');

// Read version from manifest.json — fail clearly if missing or invalid.
let version;
try {
  const manifest = JSON.parse(readFileSync(resolve(srcDir, 'manifest.json'), 'utf8'));
  version = manifest.version;
  if (!version) throw new Error('"version" field is missing');
} catch (err) {
  console.error(`Error reading src/manifest.json: ${err.message}`);
  process.exit(1);
}

const outFile = resolve(distDir, `auth-results-filter-${version}.xpi`);

await mkdir(distDir, { recursive: true });

const output = createWriteStream(outFile);
const archive = new ZipArchive({ zlib: { level: 9 } });

archive.on('warning', err => {
  if (err.code === 'ENOENT') {
    console.warn('Warning:', err.message);
  } else {
    throw err;
  }
});

archive.on('error', err => { throw err; });

await new Promise((resolve, reject) => {
  output.on('close', resolve);
  output.on('error', reject);
  archive.pipe(output);
  // Package src/ contents at the archive root (no top-level src/ directory).
  archive.directory(srcDir, false);
  archive.finalize();
});

console.log(`Packaged: ${outFile} (${archive.pointer()} bytes)`);
