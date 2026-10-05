import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'fs-extra';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = path.join(repositoryRoot, 'bin', 'form0.js');

async function createAppProject() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-serve-app-'));
  // The app dev server exits on its own, which also stops the CLI server.
  await fs.writeFile(
    path.join(projectDir, 'form0.config.js'),
    'export default { devServer: { command: \'node -e "setTimeout(() => {}, 1500)"\' } };\n'
  );
  return projectDir;
}

async function runServe(projectDir, ...args) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [executable, 'serve', '--app', '--port', '0', ...args],
      { cwd: projectDir, encoding: 'utf8', timeout: 20000 }
    );
    return { code: 0, output: stdout + stderr };
  } catch (error) {
    return { code: error.code, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

test('serve --app starts without form.schema.json in an app project', async () => {
  const projectDir = await createAppProject();
  try {
    const { code, output } = await runServe(projectDir);

    assert.equal(code, 0, output);
    assert.doesNotMatch(output, /ENOENT/);
    assert.match(output, /No schema loaded/);
    assert.match(output, /App dev server started/);
  } finally {
    await fs.remove(projectDir);
  }
});

test('serve --app still fails for an explicit schema path that does not exist', async () => {
  const projectDir = await createAppProject();
  try {
    const { code, output } = await runServe(projectDir, 'missing.schema.json');

    assert.notEqual(code, 0);
    assert.match(output, /ENOENT.*missing\.schema\.json/);
  } finally {
    await fs.remove(projectDir);
  }
});
