import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPreviewEventUI } from '../src/server/static/preview-event-ui.js';
import { normalizeEventOptions } from '../src/server/preview-events/session-dispatcher.js';

function configuration(preference) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => preference },
  });
  try {
    return createPreviewEventUI({}).configuration;
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
}

test('a fresh CLI browser preview enables lifecycle without changing the headless default', () => {
  assert.deepEqual(configuration(null), {
    lifecycle: true,
    recordKind: 'new',
    readonly: false,
    fieldInteractions: ['focus', 'blur', 'click'],
  });
  assert.equal(normalizeEventOptions().lifecycle, false);
  assert.deepEqual(normalizeEventOptions().fieldInteractions, ['focus', 'blur', 'click']);
  assert.deepEqual(normalizeEventOptions({ fieldInteractions: [] }).fieldInteractions, []);
});

test('explicit stored opt-outs and existing/read-only classifications remain respected', () => {
  const preference = {
    lifecycle: false,
    recordKind: 'existing',
    readonly: true,
    fieldInteractions: ['focus', 'unsupported'],
  };
  assert.deepEqual(configuration(JSON.stringify(preference)), {
    ...preference,
    fieldInteractions: ['focus'],
  });
});

test('missing or malformed preferences use the current browser defaults', () => {
  for (const value of ['{invalid', '{}', 'null'])
    assert.equal(configuration(value).lifecycle, true);
});

test('preview feedback and settings keys retain four-locale and parameter parity', async () => {
  let expected;
  for (const locale of ['en', 'es', 'fr', 'it']) {
    const { client } = JSON.parse(
      await readFile(new URL('../src/locales/' + locale + '.json', import.meta.url), 'utf8')
    );
    const keys = Object.keys(client)
      .filter((key) => key.startsWith('previewEvents.'))
      .sort();
    expected ||= keys;
    assert.deepEqual(keys, expected, locale);
    for (const key of keys) assert.ok(client[key].trim(), locale + ':' + key);
    assert.match(client['previewEvents.parentHint'], /\{parent\}/);
  }
});
