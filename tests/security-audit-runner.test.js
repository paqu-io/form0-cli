import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { auditProject } from '../scripts/audit-dependencies.mjs';
import { readAuditGraph } from '../scripts/audit-policy.mjs';

const policy = JSON.parse(
  await readFile(new URL('../scripts/security-exceptions.json', import.meta.url), 'utf8')
);
const report = JSON.parse(
  await readFile(new URL('./fixtures/pi-audit-report.json', import.meta.url), 'utf8')
);
const now = Date.parse('2026-10-27T12:00:00Z');
const pi = '@earendil-works/pi-coding-agent';
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'form0-audit-policy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = { name: 'form0-cli', version: '0.8.0', dependencies: { [pi]: '1.0.4' } };
  const lock = { version: '0.8.0', packages: { '': manifest } };
  for (const [name, pkg] of Object.entries(policy.exceptions[0].packages)) {
    const folder = path.join(root, pkg.path);
    await mkdir(folder, { recursive: true });
    const installed = {
      name,
      version: pkg.version,
      main: 'index.js',
      ...(name === pi ? { dependencies: { undici: '8.10.2' } } : {}),
    };
    await writeFile(path.join(folder, 'package.json'), JSON.stringify(installed));
    await writeFile(path.join(folder, 'index.js'), '');
    lock.packages[pkg.path] = installed;
  }
  await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
  await writeFile(path.join(root, 'package-lock.json'), JSON.stringify(lock));
  return root;
}
const child = () => ({ status: 1, stdout: JSON.stringify(report) });
test('runner invokes a production npm audit and verifies real dependency resolution', async (t) => {
  const root = await fixture(t);
  let called = 0;
  const result = auditProject({
    projectRoot: root,
    policy,
    now,
    env: { npm_execpath: '/test/npm-cli.js' },
    run(command, args, options) {
      called++;
      assert.equal(command, process.execPath);
      assert.deepEqual(args, [
        '/test/npm-cli.js',
        'audit',
        '--omit=dev',
        '--omit=peer',
        '--audit-level=high',
        '--json',
      ]);
      assert.equal(options.cwd, root);
      assert.equal(options.shell, false);
      return child();
    },
  });
  assert.equal(called, 1);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.accepted.length, 2);
});
test('network/command/timeout/JSON failures cannot be converted into accepted risk', async (t) => {
  const root = await fixture(t);
  for (const failure of [
    { status: 1, error: { code: 'NETWORK' }, stdout: JSON.stringify(report) },
    { status: null, signal: 'SIGTERM', stdout: JSON.stringify(report) },
    { status: 2, stdout: JSON.stringify(report) },
    { status: 1, stdout: 'invalid JSON' },
    { status: 1, stdout: JSON.stringify({ error: { code: 'REGISTRY' } }) },
  ]) {
    const result = auditProject({ projectRoot: root, policy, now, run: () => failure });
    assert.equal(result.ok, false);
    assert.deepEqual(result.accepted, []);
  }
});
test('Node package resolution accepts Pi import-only exports without loading its code', async (t) => {
  const root = await fixture(t);
  const folder = path.join(root, policy.exceptions[0].packages[pi].path);
  const manifest = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'));
  manifest.exports = { '.': { import: './index.js' } };
  await writeFile(path.join(folder, 'package.json'), JSON.stringify(manifest));
  await writeFile(path.join(folder, 'index.js'), 'throw new Error("must never execute");');
  assert.equal(auditProject({ projectRoot: root, policy, now, run: child }).ok, true);
});
test('correct package metadata cannot hide a dependency symlink outside the project', async (t) => {
  const root = await fixture(t);
  const foreign = await mkdtemp(path.join(os.tmpdir(), 'form0-audit-foreign-'));
  t.after(() => rm(foreign, { recursive: true, force: true }));
  const entry = policy.exceptions[0].packages.undici;
  const folder = path.join(root, entry.path);
  await writeFile(
    path.join(foreign, 'package.json'),
    await readFile(path.join(folder, 'package.json'))
  );
  await rm(folder, { recursive: true });
  await symlink(foreign, folder, 'junction');
  assert.throws(() => readAuditGraph(root, policy, now), /outside the project/);
  assert.equal(auditProject({ projectRoot: root, policy, now, run: child }).ok, false);
});
test('a dependency version drift is rejected even when the audit report is unchanged', async (t) => {
  const root = await fixture(t);
  const entry = policy.exceptions[0].packages.undici;
  await writeFile(
    path.join(root, entry.path, 'package.json'),
    JSON.stringify({ name: 'undici', version: '8.12.3', main: 'index.js' })
  );
  const result = auditProject({ projectRoot: root, policy, now, run: child });
  assert.equal(result.ok, false);
  assert.deepEqual(result.accepted, []);
});
