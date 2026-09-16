import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { formatRootHelpCommands } from '../src/utils/display-utils.js';

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

test('interactive root help aligns descriptions to its longest command', () => {
  const descriptions = ['Short description', 'Long description'];
  const lines = formatRootHelpCommands([
    '    preview, p  Short description',
    '    form0 connector install <name-or-path>  Long description',
  ]);
  assert.deepEqual(
    lines.map((line, index) => line.indexOf(descriptions[index])),
    [44, 44]
  );
});
