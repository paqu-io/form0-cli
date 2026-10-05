import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'fs-extra';

const execFileAsync = promisify(execFile);
const helperUrl = pathToFileURL(path.resolve('src/utils/app-dev-server.js')).href;

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilStopped(pid, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (isRunning(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isRunning(pid);
}

async function runCrashingScript(crash) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-crash-'));
  const script = path.join(dir, 'crash.mjs');
  await fs.writeFile(
    script,
    `import { spawn } from 'node:child_process';
import { stopAppDevServerOnCrash } from ${JSON.stringify(helperUrl)};

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
console.log(child.pid);
stopAppDevServerOnCrash(child);
setTimeout(() => { ${crash} }, 200);
`
  );

  try {
    await execFileAsync(process.execPath, [script], { encoding: 'utf8', timeout: 10000 });
    assert.fail('the crashing script should exit with an error');
  } catch (error) {
    return { code: error.code, pid: Number(error.stdout.trim()), stderr: error.stderr };
  } finally {
    await fs.remove(dir);
  }
}

test('an uncaught exception stops the app dev server', async () => {
  const { code, pid, stderr } = await runCrashingScript("throw new Error('boom');");

  assert.equal(code, 1);
  assert.match(stderr, /boom/);
  assert.equal(await waitUntilStopped(pid), true, `app process ${pid} is still running`);
});

test('an unhandled rejection stops the app dev server', async () => {
  const { code, pid, stderr } = await runCrashingScript("Promise.reject(new Error('rejected'));");

  assert.equal(code, 1);
  assert.match(stderr, /rejected/);
  assert.equal(await waitUntilStopped(pid), true, `app process ${pid} is still running`);
});
