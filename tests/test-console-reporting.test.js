import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify, stripVTControlCharacters } from 'node:util';
import { testArguments } from './fixtures/runner-command.js';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const probe = 'tests/fixtures/console-output-probe.mjs';

async function runReport(files, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.NODE_TEST_CONTEXT;
  const args = [...testArguments, '--test-reporter=./tests/fixtures/output-reporter.js', ...files];
  const options = { cwd: root, env, timeout: 30000, maxBuffer: 1024 * 1024 };
  try {
    const result = await execute(process.execPath, args, options);
    return { code: 0, report: JSON.parse(result.stdout) };
  } catch (error) {
    if (typeof error.code !== 'number') throw error;
    return { code: error.code, report: JSON.parse(error.stdout) };
  }
}

test('shared setup keeps console output off raw stdout across test files and module lifetime', async () => {
  const { code, report } = await runReport([
    'tests/preview-events.test.js',
    'tests/consumer-compatibility.test.js',
    probe,
  ]);
  assert.equal(code, 0, JSON.stringify(report.failed));
  assert.deepEqual(report.failed, []);
  assert.equal(report.passed.length, 35, 'all 28 preview, 6 catalog and 1 probe cases must run');
  assert.deepEqual(report.stdout, [], 'console output must not share the binary report stream');
  const messages = stripVTControlCharacters(report.stderr.join('\n'));
  assert.match(messages, /🔧 \[EVENT HANDLER\] Registered:/);
  for (const label of [
    'console fixture import',
    'console fixture exit',
    'log formatted',
    'info',
    'debug',
    'dir',
    'table',
    'group',
    'grouped log',
    'count',
    'timer',
  ]) {
    assert.ok(messages.includes('🦙 ' + label), `preserve ${label} output`);
  }
});

test('shared console setup preserves assertion failures and nonzero test exits', async () => {
  const { code, report } = await runReport([probe], { FORM0_TEST_CONSOLE_FAIL: '1' });
  assert.equal(code, 1);
  assert.equal(report.passed.length, 0);
  assert.equal(report.failed.length, 1);
  assert.equal(report.failed[0].message, 'expected console fixture failure');
  assert.deepEqual(report.stdout, []);
});
