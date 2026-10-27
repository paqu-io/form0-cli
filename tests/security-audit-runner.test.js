import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { auditProject, parseAuditArguments } from '../scripts/audit-dependencies.mjs';
import { readAuditGraph } from '../scripts/audit-policy.mjs';
import { parse as parseYAML } from 'yaml';

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
  const manifest = { name: 'form0-cli', version: '0.8.2', dependencies: { [pi]: '1.0.4' } };
  const lock = { version: '0.8.2', packages: { '': manifest } };
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

test('validation is explicit; missing or unknown command arguments cannot widen release checks', () => {
  assert.equal(parseAuditArguments([]), 'release');
  assert.equal(parseAuditArguments(['--validation']), 'validation');
  for (const args of [
    ['--ci'],
    ['--validation', '--validation'],
    ['--validation', '--other'],
    ['--now', '2026-10-27'],
  ])
    assert.throws(() => parseAuditArguments(args), /Usage:/);
});

test('installed 0.8.1 metadata permits validation only, including when CI environment flags are present', async (t) => {
  const root = await fixture(t);
  for (const version of ['0.8.0', '0.8.1', '0.8.2', '0.8.3']) {
    for (const file of ['package.json', 'package-lock.json']) {
      const location = path.join(root, file);
      const data = JSON.parse(await readFile(location, 'utf8'));
      data.version = version;
      if (file === 'package-lock.json') data.packages[''].version = version;
      await writeFile(location, JSON.stringify(data));
    }
    const options = {
      projectRoot: root,
      policy,
      now,
      run: child,
      env: { CI: 'true', GITHUB_ACTIONS: 'true', npm_lifecycle_event: 'ci:check' },
    };
    assert.equal(auditProject(options).ok, version === '0.8.2', `default ${version}`);
    assert.equal(
      auditProject({ ...options, purpose: 'release' }).ok,
      version === '0.8.2',
      `release ${version}`
    );
    assert.equal(
      auditProject({ ...options, purpose: 'validation' }).ok,
      ['0.8.1', '0.8.2'].includes(version),
      `validation ${version}`
    );
  }
});

test('CI runs validation checks while publication still runs the strict release gate before npm publish', async () => {
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const ci = parseYAML(await readFile(new URL('.github/workflows/ci.yml', root), 'utf8'));
  const publish = parseYAML(await readFile(new URL('.github/workflows/publish.yml', root), 'utf8'));
  assert.equal(manifest.scripts['security:audit:prod'], 'node scripts/audit-dependencies.mjs');
  assert.equal(
    manifest.scripts['security:audit:validation'],
    'node scripts/audit-dependencies.mjs --validation'
  );
  assert.equal(
    manifest.scripts['ci:check'],
    'npm run check && npm run security:audit:validation && npm run package:check'
  );
  assert.equal(
    manifest.scripts['release:check'],
    'npm run check && npm run security:audit:prod && npm run package:check'
  );
  assert.ok(ci.jobs.quality.steps.some((step) => step.run === 'npm run ci:check'));
  const steps = publish.jobs.publish.steps;
  const releaseCheck = steps.findIndex((step) => step.run === 'npm run release:check');
  const publication = steps.findIndex((step) => step.run?.includes('npm publish'));
  assert.ok(releaseCheck >= 0 && publication > releaseCheck);
  assert.ok(steps.every((step) => !/--validation|ci:check/.test(step.run || '')));
});

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
    for (const purpose of ['release', 'validation']) {
      const result = auditProject({ projectRoot: root, policy, now, purpose, run: () => failure });
      assert.equal(result.ok, false);
      assert.deepEqual(result.accepted, []);
    }
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
