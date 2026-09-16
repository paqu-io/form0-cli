import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = path.join(repositoryRoot, 'bin', 'form0.js');

function help(...args) {
  return execFileSync(process.execPath, [executable, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

test('root and connector help make installation discoverable', () => {
  assert.match(help('--help'), /connector\s+Install, configure, and manage form connectors/);
  const connectorHelp = help('connector', '--help');
  assert.match(connectorHelp, /install.*Install a connector package/);
  assert.match(connectorHelp, /reload.*Reload a connector/);
  assert.match(connectorHelp, /uninstall.*Uninstall a connector/);
  assert.match(help('connector', 'install', '--help'), /<name-or-path>/);
});
