import test from 'node:test';
import assert from 'node:assert/strict';
import { FormStateManager } from '../src/server/static/form-state-manager.js';

// Only the field-instance DOM surface is supplied. A document-wide lookup is a scope error.
function choiceInstance(kind, values) {
  const input = { value: '' };
  const selected = new Set();
  const options = values.map((value) => ({
    value,
    checked: false,
    style: {},
    classList: {
      add: () => selected.add(value),
      remove: () => selected.delete(value),
    },
  }));
  const updates = [];
  const inner = {
    _setUpdating: (value) => updates.push(value),
    classList: { contains: (name) => name === 'multi-choice-field-checkbox-container' },
    querySelector(selector) {
      if (selector.includes('data-field-value')) return input;
      return options.find(
        (option) => selector === `.boolean-field-option[data-value="${option.value}"]`
      );
    },
    querySelectorAll: () => options,
  };
  return {
    container: {
      querySelector: (selector) =>
        selector ===
        (kind === 'BooleanField'
          ? '.boolean-field-container'
          : '.multi-choice-field-checkbox-container')
          ? inner
          : null,
    },
    input,
    options,
    selected,
    updates,
  };
}

test('managed BooleanField updates use the supplied instance and preserve false and clearing', () => {
  const manager = new FormStateManager({});
  const field = { type: 'BooleanField', data_name: 'answer' };
  const first = choiceInstance(field.type, [true, false]);
  const second = choiceInstance(field.type, [true, false]);
  const yes = { choice: [{ value: true, label: 'Yes' }] };
  const no = { choice: [{ value: false, label: 'No' }] };
  manager.updateFieldValue(field, first.container, yes, true);
  manager.updateFieldValue(field, second.container, no, true);
  assert.deepEqual(JSON.parse(first.input.value), yes);
  assert.deepEqual(JSON.parse(second.input.value), no);
  assert.deepEqual([...first.selected], [true]);
  assert.deepEqual([...second.selected], [false]);
  manager.updateFieldValue(field, second.container, null, true);
  assert.deepEqual(JSON.parse(first.input.value), yes);
  assert.deepEqual(JSON.parse(second.input.value).choice, []);
  assert.equal(second.selected.size, 0);
  assert.deepEqual(second.updates, [true, false, true, false]);
});

test('managed MultiChoiceField updates isolate instances and restore or clear checkbox selections', () => {
  const manager = new FormStateManager({});
  const field = { type: 'MultiChoiceField', data_name: 'answer' };
  const first = choiceInstance(field.type, ['red', 'blue']);
  const second = choiceInstance(field.type, ['red', 'blue']);
  const red = { choices: [{ value: 'red', label: 'Red' }], other: [] };
  const blue = { choices: [{ value: 'blue', label: 'Blue' }], other: [] };
  manager.updateFieldValue(field, first.container, red, true);
  manager.updateFieldValue(field, second.container, blue, true);
  assert.deepEqual(JSON.parse(first.input.value), red);
  assert.deepEqual(JSON.parse(second.input.value), blue);
  assert.deepEqual(
    first.options.map((option) => option.checked),
    [true, false]
  );
  assert.deepEqual(
    second.options.map((option) => option.checked),
    [false, true]
  );
  manager.updateFieldValue(field, second.container, null, true);
  assert.deepEqual(
    first.options.map((option) => option.checked),
    [true, false]
  );
  assert.deepEqual(
    second.options.map((option) => option.checked),
    [false, false]
  );
  assert.deepEqual(JSON.parse(second.input.value).choices, []);
});
