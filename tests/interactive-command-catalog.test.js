import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  getInteractiveCommandNames,
  getServerModeAvailability,
  getServerModeHelpEntries,
  parseInteractiveInput,
} from '../src/commands/interactive/command-catalog.js';
import { completer } from '../src/utils/completion-utils.js';
import { showHelp } from '../src/utils/display-utils.js';
import { setLocale } from '../src/utils/i18n.js';

test('interactive command catalog owns parsing, aliases, and server availability', () => {
  assert.deepEqual(parseInteractiveInput('  serve   --app  '), {
    command: 'serve',
    args: ['--app'],
    normalized: 'serve   --app',
  });
  assert.ok(getInteractiveCommandNames().includes('connector'));
  assert.ok(getInteractiveCommandNames().includes('conn'));
  assert.ok(getInteractiveCommandNames().includes('test'));
  assert.equal(getServerModeAvailability('validate').allowed, true);
  assert.equal(getServerModeAvailability('serve', ['update']).allowed, true);
  assert.equal(getServerModeAvailability('serve', []).allowed, false);
  assert.equal(getServerModeAvailability('run').allowed, false);
  // serve --app can start without a schema; load picks one while it runs.
  assert.equal(getServerModeAvailability('load').allowed, true);
});

test('interactive completion follows the command catalog', () => {
  assert.ok(completer('con')[0].includes('connector'));
  assert.ok(completer('t')[0].includes('test'));
  assert.ok(completer('serve --a')[0].includes('--app'));
  assert.ok(completer('serve --p')[0].includes('--public-url'));
  assert.ok(completer('conn st')[0].includes('status'));
});

test('server-mode help reuses the main help lines, aligned, with help last', async () => {
  const keys = getServerModeHelpEntries();
  assert.equal(keys.at(-1), 'help.helpCommand');
  for (const locale of ['en', 'es', 'fr', 'it']) {
    const messages = JSON.parse(
      await readFile(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8')
    );
    for (const key of [...keys, 'interactive.serverMode.helpHeader']) {
      const value = key.split('.').reduce((node, part) => node?.[part], messages);
      assert.equal(typeof value, 'string', `${locale}: ${key}`);
    }
  }

  setLocale('en');
  const lines = [];
  const log = console.log;
  console.log = (line = '') => lines.push(String(line).replace(/\u001b\[[0-9;]*m/g, ''));
  try {
    showHelp({ serverMode: true });
  } finally {
    console.log = log;
  }
  const output = lines.join('\n');
  assert.match(output, /Available Commands · development server running/);
  assert.doesNotMatch(output, /•|--no-diagnostics/);
  const commands = lines.filter((line) => /^ {4}\S/.test(line));
  assert.equal(commands.length, keys.length);
  const columns = new Set(commands.map((line) => line.search(/\S+(?: \S+)*$/)));
  assert.equal(columns.size, 1, 'descriptions start in one column');
});
