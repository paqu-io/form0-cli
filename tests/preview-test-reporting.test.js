import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));

test('preview event registration logs use test diagnostics without raw Unicode stdout', async () => {
  const env = { ...process.env };
  // An independent runner must not inherit this test worker's reporter protocol.
  delete env.NODE_TEST_CONTEXT;
  const { stdout } = await execute(
    process.execPath,
    [
      '--test',
      '--test-reporter=./tests/fixtures/preview-test-reporter.js',
      'tests/preview-events.test.js',
    ],
    { cwd: root, env, timeout: 30000, maxBuffer: 1024 * 1024 }
  );
  const report = JSON.parse(stdout);
  assert.deepEqual(report.failed, []);
  assert.equal(report.passed.length, 23, 'all preview event assertions must still run');
  assert.ok(
    report.diagnostics.some((message) => message.includes('🔧 [EVENT HANDLER] Registered:')),
    'preserve Unicode registration messages through the structured reporter'
  );
  assert.equal(
    report.stdout.some((message) => message.includes('[EVENT HANDLER]')),
    false,
    'registration output must not share the raw child-process report stream'
  );
});
