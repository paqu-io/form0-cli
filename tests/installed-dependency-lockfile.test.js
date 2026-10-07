import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('Pi uses the patched brace-expansion version recorded in the root lockfile', () => {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const piRequire = createRequire(import.meta.resolve('@earendil-works/pi-coding-agent'));
  const minimatchRequire = createRequire(piRequire.resolve('minimatch'));
  let directory = path.dirname(minimatchRequire.resolve('brace-expansion'));
  let manifest;

  while (directory !== path.dirname(directory)) {
    try {
      const candidate = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
      if (candidate.name === 'brace-expansion') {
        manifest = candidate;
        break;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    directory = path.dirname(directory);
  }

  assert.ok(manifest, 'the actual Pi/minimatch brace-expansion package must resolve');
  const lock = JSON.parse(readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));
  const lockKey = path.relative(projectRoot, directory).split(path.sep).join('/');
  assert.equal(lock.packages[lockKey]?.version, '5.0.12');
  assert.equal(
    manifest.version,
    lock.packages[lockKey].version,
    "npm must not replace the root lockfile remediation with Pi's published shrinkwrap version"
  );
});
