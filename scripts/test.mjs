/**
 * Runs the unit Jest project, then the packaging Jest project.
 *
 * Any extra arguments (e.g. `npm test -- --runTestsByPath test/foo.test.js`)
 * are forwarded to the unit run only, since focused-test arguments target
 * specific unit test files and the packaging project's testMatch would
 * otherwise reject them. When extra arguments are given, the packaging run
 * is skipped so the requested focused run isn't followed by an unrelated
 * failure.
 *
 * If the extra arguments target the packaging suite itself (e.g.
 * `npm test -- --runTestsByPath test/xpiPackaging.test.js`), they are routed
 * to the packaging project instead, since the unit project's
 * testPathIgnorePatterns explicitly excludes that file and would otherwise
 * report "no tests found" before the packaging project ever runs.
 */

import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const jestBin = resolve(root, 'node_modules/.bin/jest');
const extraArgs = process.argv.slice(2);
const targetsPackaging = extraArgs.some((arg) => arg.includes('xpiPackaging.test.js'));

function runJest(project, args) {
  const result = spawnSync(
    process.execPath,
    ['--experimental-vm-modules', jestBin, '--selectProjects', project, ...args],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

if (targetsPackaging) {
  process.exit(runJest('packaging', extraArgs));
}

const unitStatus = runJest('unit', extraArgs);
if (unitStatus !== 0) {
  process.exit(unitStatus);
}

if (extraArgs.length > 0) {
  process.exit(0);
}

process.exit(runJest('packaging', ['--runInBand']));
