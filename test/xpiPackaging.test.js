/**
 * Regression coverage for the Thunderbird Add-ons vendoring review findings
 * (issue #345): `npm run package` must produce an XPI that declares every
 * bundled third-party file in a reviewer-verifiable VENDOR.md, keeps the
 * rejected hidden license/notice files out of vendor/, and stays
 * deterministic across working trees that previously held stale generated
 * files.
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readZipEntries } from './helpers/zip.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const vendorDir = resolve(root, 'src/vendor');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

function runPackage() {
  execFileSync('npm', ['run', 'package'], { cwd: root, stdio: 'pipe' });
}

function loadXpiEntries() {
  const manifest = JSON.parse(readFileSync(resolve(root, 'src/manifest.json'), 'utf8'));
  const xpiPath = resolve(root, 'dist', `auth-results-filter-${manifest.version}.xpi`);
  return readZipEntries(readFileSync(xpiPath));
}

describe('npm run package — XPI vendoring regression checks', () => {
  let entries;

  beforeAll(() => {
    runPackage();
    entries = loadXpiEntries();
  }, 30000);

  test('VENDOR.md is packaged at the XPI root', () => {
    expect(entries.has('VENDOR.md')).toBe(true);
  });

  test('THIRD_PARTY_LICENSES.md is packaged at the XPI root and referenced by VENDOR.md', () => {
    expect(entries.has('THIRD_PARTY_LICENSES.md')).toBe(true);
    const vendorMd = entries.get('VENDOR.md').toString('utf8');
    expect(vendorMd).toMatch(/THIRD_PARTY_LICENSES\.md/);
  });

  test('the rejected mail-auth-signal hidden LICENSE/NOTICE files are absent', () => {
    expect(entries.has('vendor/mail-auth-signal.LICENSE')).toBe(false);
    expect(entries.has('vendor/mail-auth-signal.NOTICE')).toBe(false);
  });

  test('the three executable vendor files are present', () => {
    expect(entries.has('vendor/jsep.esm.min.js')).toBe(true);
    expect(entries.has('vendor/tldts.esm.min.js')).toBe(true);
    expect(entries.has('vendor/mail-auth-signal.esm.js')).toBe(true);
  });

  test('VENDOR.md declares every packaged vendor path with its Version and URL, in the canonical Thunderbird format', () => {
    const vendorMd = entries.get('VENDOR.md').toString('utf8');
    const declarations = [
      ['jsep', 'vendor/jsep.esm.min.js'],
      ['tldts', 'vendor/tldts.esm.min.js'],
      ['mail-auth-signal', 'vendor/mail-auth-signal.esm.js'],
    ];
    for (const [name, path] of declarations) {
      const version = pkg.dependencies[name];
      // Pins in package.json must be exact versions, not ranges, so the
      // declaration below is unambiguous and reviewer-verifiable.
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      const url = `https://cdn.jsdelivr.net/npm/${name}@${version}/`;
      // The packaged path must be paired directly with its Version and URL
      // (Thunderbird's canonical block format), not with a build-provenance
      // node_modules/ path or a section heading the linter can't associate
      // with the packaged file.
      const block = new RegExp(
        `^${path}:\\n \\- Version: ${version}\\n \\- URL: ${url}`,
        'm',
      );
      expect(vendorMd).toMatch(block);
    }
    expect(vendorMd).not.toMatch(/Packaged from:\s*`?node_modules\//);
  });

  test('every declared vendor path exists in the XPI at exactly that path', () => {
    const vendorMd = entries.get('VENDOR.md').toString('utf8');
    const declaredPaths = [...vendorMd.matchAll(/^(vendor\/\S+):$/gm)].map((m) => m[1]);
    expect(declaredPaths.length).toBeGreaterThan(0);
    for (const path of declaredPaths) {
      expect(entries.has(path)).toBe(true);
    }
  });

  test('vendored JavaScript is copied byte-for-byte from the installed package, with no vendor-side patches', () => {
    const cases = [
      ['vendor/jsep.esm.min.js', 'node_modules/jsep/dist/jsep.min.js'],
      ['vendor/tldts.esm.min.js', 'node_modules/tldts/dist/index.esm.min.js'],
      ['vendor/mail-auth-signal.esm.js', 'node_modules/mail-auth-signal/dist/browser/mail-auth-signal.esm.js'],
    ];
    for (const [archivePath, installedPath] of cases) {
      const fromArchive = entries.get(archivePath);
      const installed = readFileSync(resolve(root, installedPath));
      expect(fromArchive.equals(installed)).toBe(true);
    }
  });
});

describe('npm run package — deterministic vendoring across stale working trees', () => {
  test('re-packaging over a tree with stale mail-auth-signal LICENSE/NOTICE files removes them', () => {
    mkdirSync(vendorDir, { recursive: true });
    writeFileSync(resolve(vendorDir, 'mail-auth-signal.LICENSE'), 'stale license\n');
    writeFileSync(resolve(vendorDir, 'mail-auth-signal.NOTICE'), 'stale notice\n');

    runPackage();

    expect(existsSync(resolve(vendorDir, 'mail-auth-signal.LICENSE'))).toBe(false);
    expect(existsSync(resolve(vendorDir, 'mail-auth-signal.NOTICE'))).toBe(false);

    const entries = loadXpiEntries();
    expect(entries.has('vendor/mail-auth-signal.LICENSE')).toBe(false);
    expect(entries.has('vendor/mail-auth-signal.NOTICE')).toBe(false);
  }, 30000);
});
