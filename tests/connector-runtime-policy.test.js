import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConnectorManager } from '../src/commands/interactive/managers/connector-manager.js';

test('connector commands stay available by default and stop early when disabled', async (t) => {
  const original = process.env.FORM0_CONNECTORS_DISABLED;
  t.after(() => {
    if (original === undefined) delete process.env.FORM0_CONNECTORS_DISABLED;
    else process.env.FORM0_CONNECTORS_DISABLED = original;
  });
  const log = t.mock.method(console, 'log', () => {});
  const manager = new ConnectorManager();
  manager.handleListCommand = async () => {
    throw new Error('default connector entry reached');
  };

  process.env.FORM0_CONNECTORS_DISABLED = '1';
  await manager.handleCommand(['list']);
  const output = log.mock.calls.map((call) => call.arguments.join(' ')).join('\n');
  assert.match(output, /Database connectors are not available in this environment/);
  assert.match(output, /run form0 locally/);

  for (const value of [undefined, '0']) {
    if (value === undefined) delete process.env.FORM0_CONNECTORS_DISABLED;
    else process.env.FORM0_CONNECTORS_DISABLED = value;
    await assert.rejects(manager.handleCommand(['list']), /default connector entry reached/);
  }
});

test('disabled form0 connector install changes nothing and points to a local install', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'form0-disabled-connectors-'));
  const home = join(directory, 'home');
  const preload = fileURLToPath(new URL('./fixtures/diagnostics-test-home.mjs', import.meta.url));
  const executable = fileURLToPath(new URL('../bin/form0.js', import.meta.url));
  const child = spawn(
    process.execPath,
    ['--import', preload, executable, 'connector', 'install', 'form0-connector-pg'],
    {
      cwd: directory,
      env: {
        ...process.env,
        FORM0_CONNECTORS_DISABLED: '1',
        FORM0_DIAGNOSTICS_TEST_HOME: home,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let output = '';
  child.stdout.on('data', (data) => (output += data));
  child.stderr.on('data', (data) => (output += data));
  const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    assert.equal(code, 0, output);
    assert.match(output, /Database connectors are not available in this environment/);
    assert.match(output, /docs\.form0\.dev\/connectors\/overview/);
    const entries = await readdir(directory);
    assert.ok(!entries.includes('node_modules'), 'disabled install must not run npm');
    assert.ok(!entries.includes('package.json'), 'disabled install must not create a manifest');
  } finally {
    clearTimeout(timeout);
    child.kill();
    await rm(directory, { recursive: true, force: true });
  }
});
