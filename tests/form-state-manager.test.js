import test from 'node:test';
import assert from 'node:assert/strict';
import { FormStateManager } from '../src/server/static/form-state-manager.js';

function feedbackManager() {
  const manager = new FormStateManager({});
  manager.clearFieldInstanceError = (container) => (container.error = null);
  manager.showFieldInstanceError = (container, message) => (container.error = message);
  return manager;
}

test('signature presence feedback is immediate, instance-local and follows current required policy', () => {
  const manager = feedbackManager();
  const field = { type: 'SignatureField', data_name: 'signature' };
  const first = {},
    second = {};
  manager.updateFieldValidation(field, first, null, true);
  manager.updateFieldValidation(field, second, null, true);
  manager.updateFieldPresenceFeedback(field, first, { data: 'drawn' });
  assert.equal(first.error, null);
  assert.equal(second.error, 'This field is required');
  manager.updateFieldPresenceFeedback(field, first, null);
  assert.equal(first.error, 'This field is required');
  manager.updateFieldValidation(field, first, null, false);
  manager.updateFieldPresenceFeedback(field, first, null);
  assert.equal(first.error, null);
});

test('presence feedback preserves intrinsic errors until a new authoritative evaluation', () => {
  const manager = feedbackManager();
  const field = { type: 'NumericField', data_name: 'age' };
  const container = {};
  manager.updateFieldValidation(field, container, 12, true, 'Must be at least 16');
  manager.updateFieldPresenceFeedback(field, container, 18);
  assert.equal(container.error, 'Must be at least 16');
  manager.updateFieldValidation(field, container, 18, true);
  manager.updateFieldPresenceFeedback(field, container, 0);
  assert.equal(container.error, null);
  manager.updateFieldPresenceFeedback(field, container, null);
  assert.equal(container.error, 'This field is required');
});

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

test('media clears reset only the targeted preview without replaying control events', () => {
  const manager = new FormStateManager({});
  for (const type of ['PhotoField', 'VideoField', 'SignatureField']) {
    let resets = 0;
    const input = { value: '' };
    const control = { _resetPreview: () => resets++ };
    const container = {
      querySelector: (selector) => (selector.includes('data-field-value') ? input : control),
    };
    const populated = type === 'SignatureField' ? { data: 'drawn' } : [{ media_id: 'keep' }];
    manager.updateFieldValue({ type }, container, populated, true);
    assert.equal(resets, 0);
    manager.updateFieldValue({ type }, container, type === 'SignatureField' ? null : [], true);
    assert.equal(resets, 1);
  }
});
