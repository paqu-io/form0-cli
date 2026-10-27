import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify, stripVTControlCharacters } from 'node:util';
import { testArguments } from './fixtures/runner-command.js';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const files = [
  'tests/ai-authoring-workflow.test.js',
  'tests/calculation-checks.test.js',
  'tests/diagnostics-commands.test.js',
  'tests/serve-app-order.test.js',
];
const names = [
  'AI commands reject false-success proposals',
  'prints a severity summary',
  'standalone commands retain state output',
  'dev server banners share one shape',
].join('|');

test('terminal text assertions support plain, standard-color and true-color output', async (t) => {
  for (const level of ['0', '1', '3']) {
    await t.test(`FORCE_COLOR=${level}`, async () => {
      const env = { ...process.env, FORCE_COLOR: level };
      delete env.NO_COLOR;
      // Start an independent test runner, not a worker attached to this runner's IPC protocol.
      delete env.NODE_TEST_CONTEXT;
      let output;
      try {
        const result = await execute(
          process.execPath,
          [...testArguments, '--test-reporter=tap', `--test-name-pattern=${names}`, ...files],
          { cwd: root, env, timeout: 30000, maxBuffer: 1024 * 1024 }
        );
        output = stripVTControlCharacters(result.stdout);
      } catch (error) {
        assert.fail(
          `Terminal output assertions failed at color level ${level}:\n` +
            stripVTControlCharacters(`${error.stdout || ''}\n${error.stderr || ''}`)
        );
      }
      // A renamed/missing case must not silently reduce the regression coverage.
      assert.match(output, /^# pass 4$/m);
      assert.match(output, /^# fail 0$/m);
    });
  }
});
