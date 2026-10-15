import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AIManager } from '../src/commands/interactive/managers/ai-manager.js';

test('AI remains available by default and disabled entry creates no session', async (t) => {
  const original = process.env.FORM0_AI_DISABLED;
  t.after(() => {
    if (original === undefined) delete process.env.FORM0_AI_DISABLED;
    else process.env.FORM0_AI_DISABLED = original;
  });
  const output = [];
  const manager = new AIManager(
    { getCurrentSchema: () => null, getCurrentSchemaPath: () => null },
    {},
    {},
    {},
    {},
    {
      presentation: { write: (message) => output.push(message) },
    }
  );
  let created = 0;
  manager.createWorkspace = () => {
    created += 1;
    throw new Error('default AI entry reached');
  };
  process.env.FORM0_AI_DISABLED = '1';
  await manager.enter();
  assert.equal(created, 0);
  assert.equal(manager.isActive(), false);
  assert.equal(manager.agent, null);
  assert.match(output.join('\n'), /Download your workspace and run form0 locally/);
  assert.doesNotMatch(output.join('\n'), /\/login|No models available/);

  for (const value of [undefined, '0']) {
    if (value === undefined) delete process.env.FORM0_AI_DISABLED;
    else process.env.FORM0_AI_DISABLED = value;
    await assert.rejects(manager.enter(), /default AI entry reached/);
  }
});

for (const args of [[], ['ai']]) {
  test(`disabled ${args.length ? 'direct' : 'interactive'} AI entry returns to the normal CLI without authentication files`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'form0-disabled-ai-'));
    const home = join(directory, 'home');
    const preload = fileURLToPath(new URL('./fixtures/diagnostics-test-home.mjs', import.meta.url));
    const executable = fileURLToPath(new URL('../bin/form0.js', import.meta.url));
    const child = spawn(process.execPath, ['--import', preload, executable, ...args], {
      cwd: directory,
      env: {
        ...process.env,
        FORM0_AI_DISABLED: '1',
        FORM0_DIAGNOSTICS_TEST_HOME: home,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let exiting = false;
    const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
    const collect = (data) => {
      output += data;
      if (output.includes('run form0 locally') && !exiting) {
        exiting = true;
        child.stdin.end('exit\n');
      } else if (
        !args.length &&
        output.includes('form0>') &&
        !output.includes('run form0 locally')
      ) {
        child.stdin.write('ai\n');
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    try {
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
      assert.equal(code, 0, output);
      assert.match(output, /AI authoring is disabled/);
      assert.doesNotMatch(output, /form0\(ai\)>|No models available|Select an AI provider/);
      const entries = await readdir(join(home, '.form0-cli'));
      assert.ok(!entries.includes('ai'), 'disabled entry must not create AI storage');
    } finally {
      clearTimeout(timeout);
      child.kill();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
