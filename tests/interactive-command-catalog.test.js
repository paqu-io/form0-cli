import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getInteractiveCommandNames,
  getServerModeAvailability,
  parseInteractiveInput,
} from '../src/commands/interactive/command-catalog.js';
import { completer } from '../src/utils/completion-utils.js';

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
});

test('interactive completion follows the command catalog', () => {
  assert.ok(completer('con')[0].includes('connector'));
  assert.ok(completer('t')[0].includes('test'));
  assert.ok(completer('serve --a')[0].includes('--app'));
  assert.ok(completer('serve --p')[0].includes('--public-url'));
  assert.ok(completer('conn st')[0].includes('status'));
});
