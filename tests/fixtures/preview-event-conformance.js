import { createFormEngine } from 'form0-core';
import {
  createEventSession,
  completeEventOperations,
  copyEventData,
  mergeCustomValidation,
} from '../../src/server/preview-events/session-dispatcher.js';
import { field, repeatable } from './preview-event-fields.js';

export const eventSchema = (code = '') => ({
  form: {
    name: 'Portable events',
    events: { code: code.replaceAll('; ON(', ';\nON(') },
    elements: [
      field('NumericField', 'input', { default_value: 4, min: 4 }),
      field('TextField', 'trace', { default_value: '' }),
      field('CalculatedField', 'result', { calculate: '$input * 2' }),
      repeatable('rows', [
        field('NumericField', 'amount', { default_value: 2 }),
        repeatable('children', [field('NumericField', 'quantity', { default_value: 3 })]),
      ]),
    ],
  },
});

export function eventFixture({
  code = '',
  path = [],
  scopeId = 'fixture-root',
  delegate,
  initialValues = { input: 4, trace: '' },
  intentState,
} = {}) {
  let alive = true;
  let evaluations = 0;
  let findings = [];
  const session = createEventSession({ lifecycle: true, recordKind: 'existing' });
  const controller = session.start();
  const engine = createFormEngine({
    schema: eventSchema(code),
    initialValues,
    eventScope: { instancePath: path, scopeId },
    diagnostics: { console: false },
    onDiagnostics: () => evaluations++,
  });
  engine.eval();
  const read = () => copyEventData(engine.getState());
  const validate = (state) => {
    const issues = Object.entries(state.errors)
      .filter(([name]) =>
        path.length ? name === 'amount' || name === 'quantity' : name === 'input'
      )
      .map(([fieldName, message]) => ({ fieldName, message }));
    return {
      hasErrors: issues.length > 0,
      generalErrors: issues,
      requiredFieldErrors: [],
      orderedIssues: issues,
    };
  };
  const handle = session.register({
    scopeId,
    instancePath: path,
    fieldKey: path.length ? path.at(-1).repeatableKey : undefined,
    adapter: {
      isCurrent: () => alive,
      canEdit: () => true,
      settle: async () => {},
      read,
      validate,
      dataSignature: () => JSON.stringify(engine.getState().values),
      trigger: (...args) => engine.triggerDetailed(...args),
      async process(operations, meta, isCurrent) {
        await completeEventOperations(operations, meta, {
          delegate,
          isCurrent,
          applyDefault: (selected) => {
            let changed = false;
            for (const op of selected)
              if (op.operation === 'SETVALUE') {
                const { fieldDataName, valueToSet } = op.params;
                if (engine.getState().values[fieldDataName] !== valueToSet) {
                  engine.getState().values[fieldDataName] = valueToSet;
                  changed = true;
                }
              }
            if (changed) engine.eval();
          },
        });
      },
      serialize: (state, intent, summary) => {
        intentState?.(intent, summary);
        return {
          payload: path.length
            ? { id: path.at(-1).instanceId, values: state.values }
            : intent === 'draft'
              ? { raw_values: state.values }
              : { form_values: state.values },
        };
      },
      onValidation: (next) => (findings = next),
    },
  });
  return {
    session,
    controller,
    engine,
    handle,
    get evaluations() {
      return evaluations;
    },
    get findings() {
      return findings;
    },
    dispose: () => (alive = false),
  };
}

export function eventConformance(test, assert) {
  test('validation blocks submit, permits invalid root drafts and replaces custom findings without evaluations', async () => {
    const fixture = eventFixture({
      code: "ON('validate-record', e => { if ($input < 6) INVALID('Reach six.'); });",
      initialValues: { input: 0 },
    });
    const blocked = await fixture.controller.prepareSave({ intent: 'submit' });
    assert.equal(blocked.eligible, false);
    assert.equal(blocked.validationSummary.generalErrors.length, 2);
    assert.equal(fixture.engine.getState().errors.input, 'Must be at least 4');
    assert.deepEqual(fixture.engine.getDiagnostics(), []);
    assert.equal(fixture.evaluations, 1);
    const draft = await fixture.controller.prepareSave({ intent: 'draft' });
    assert.equal(draft.eligible, true);
    assert.equal(draft.validationSummary.hasErrors, true);
    assert.equal(draft.payload.raw_values.input, 0);
    fixture.engine.getState().values.input = 6;
    fixture.engine.eval();
    fixture.handle.dataChanged();
    assert.deepEqual(fixture.findings, []);
    const corrected = await fixture.controller.prepareSave({ intent: 'submit' });
    assert.equal(corrected.eligible, true);
    assert.equal(corrected.validationSummary.hasErrors, false);
  });
  test('one pre-save invocation, conditional second validation and fresh payload', async () => {
    const fixture = eventFixture({
      code: "ON('validate-record', e => { if ($input < 4) INVALID('Four.'); }); ON('save-record', e => { SETVALUE('input', $input + 1); SETVALUE('trace', $trace + 'save;'); });",
    });
    const prepared = await fixture.controller.prepareSave({ intent: 'submit' });
    assert.equal(prepared.eligible, true);
    assert.equal(prepared.payload.form_values.input, 5);
    assert.equal(prepared.payload.form_values.result, 10);
    assert.equal(prepared.payload.form_values.trace, 'save;');
    assert.equal(fixture.evaluations, 2);
    const bad = eventFixture({ code: "ON('save-record', e => SETVALUE('input', 0));" });
    const failed = await bad.controller.prepareSave({ intent: 'submit' });
    assert.equal(failed.eligible, false);
    assert.equal(failed.payload, null);
    assert.equal(bad.engine.getState().values.input, 0);
  });
  test('delegated promises, unreturned defaults and lifetime-bound fallbacks finish before serialization', async () => {
    let savedFallback;
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const fixture = eventFixture({
      code: "ON('save-record', e => SETVALUE('input', 8));",
      delegate: async (ops, meta, fallback) => {
        savedFallback = fallback;
        await gate;
        fallback(ops);
      },
    });
    const preparing = fixture.controller.prepareSave({ intent: 'submit' });
    await Promise.resolve();
    await Promise.resolve();
    const duplicate = await fixture.controller.prepareSave({ intent: 'submit' });
    assert.equal(duplicate.issues[0].code, 'save_in_progress');
    release();
    assert.equal((await preparing).payload.form_values.input, 8);
    await assert.rejects(savedFallback([]), /ended/);
  });
  test('execution and delegation failures prevent even draft payload delivery', async () => {
    for (const code of [
      "ON('validate-record', () => SETVALUE('input', 5));",
      "ON('validate-record', async () => INVALID('Late.'));",
      "ON('save-record', () => { throw new Error('Stop.'); });",
    ]) {
      const fixture = eventFixture({ code });
      const result = await fixture.controller.prepareSave({ intent: 'draft' });
      assert.equal(result.eligible, false);
      assert.equal(result.payload, null);
      assert.ok(result.issues.length);
    }
    const fixture = eventFixture({
      code: "ON('save-record', () => SETVALUE('input', 5));",
      delegate: () => Promise.reject(new Error('Delegate failed.')),
    });
    const result = await fixture.controller.prepareSave({ intent: 'draft' });
    assert.equal(result.eligible, false);
    assert.equal(result.issues[0].code, 'event_execution_failed');
  });
  test('nested ancestor reads, local-only writes, cancellation isolation and preserved IDs', async () => {
    const path = [
      { repeatableKey: 'rows', instanceId: 'row-A', index: 1, identity: 'id' },
      { repeatableKey: 'children', instanceId: 0, index: 0, identity: 'id' },
    ];
    const fixture = eventFixture({
      path,
      scopeId: 'child',
      initialValues: { input: 4, amount: 2, quantity: 3 },
      code: "ON('save-repeatable', 'children', e => SETVALUE('quantity', $input + $amount + $quantity)); ON('cancel-repeatable', 'children', e => SETVALUE('amount', 99));",
    });
    const prepared = await fixture.controller.prepareSave({ intent: 'submit', scopeId: 'child' });
    assert.equal(prepared.payload.id, 0);
    assert.equal(prepared.payload.values.quantity, 9);
    const cancel = await fixture.controller.dispatch({
      type: 'cancel-repeatable',
      fieldKey: 'children',
      scopeId: 'child',
    });
    assert.equal(cancel.status, 'failed');
    assert.equal(fixture.engine.getState().values.amount, 2);
    assert.equal(
      (await fixture.controller.prepareSave({ intent: 'draft', scopeId: 'child' })).issues[0].code,
      'unsupported_intent'
    );
  });
  test('positional scope guard, obsolete controllers, forced retirement and defensive results', async () => {
    const path = [{ repeatableKey: 'rows', instanceId: null, index: 0, identity: 'position' }];
    const fixture = eventFixture({
      path,
      scopeId: 'position',
      code: "ON('validate-repeatable', 'rows', () => INVALID('Scoped.'));",
    });
    assert.equal(
      (
        await fixture.controller.dispatch({
          type: 'validate-repeatable',
          fieldKey: 'rows',
          instancePath: path,
        })
      ).issues[0].code,
      'invalid_target'
    );
    const first = await fixture.controller.dispatch({
      type: 'validate-repeatable',
      fieldKey: 'rows',
      instancePath: path,
      scopeId: 'position',
    });
    first.validationIssues[0].instancePath[0].index = 99;
    assert.equal(fixture.findings[0].instancePath[0].index, 0);
    fixture.handle.retire();
    assert.equal(
      (
        await fixture.controller.dispatch({
          type: 'load-repeatable',
          fieldKey: 'rows',
          scopeId: 'position',
        })
      ).status,
      'failed'
    );
    fixture.session.end();
    fixture.session.start();
    assert.equal(
      (await fixture.controller.dispatch({ type: 'load-record' })).issues[0].code,
      'stale_generation'
    );
  });
  test('calculation failures alone never block saving or enter validation', async () => {
    const fixture = eventFixture();
    // Use a genuine throwing calculation, independently of built-in field validity.
    const scope = createFormEngine({
      schema: {
        form: {
          elements: [
            field('CalculatedField', 'result', { calculate: "throw new Error('Calculation.');\n" }),
          ],
        },
      },
      diagnostics: { console: false },
    });
    scope.eval();
    assert.equal(scope.getDiagnostics()[0].severity, 'error');
    assert.deepEqual(scope.getState().errors, {});
    assert.equal((await fixture.controller.prepareSave({ intent: 'submit' })).eligible, true);
    assert.deepEqual(mergeCustomValidation({ hasErrors: false }, []).generalErrors, []);
  });
  test('nonportable requests fail clearly before dispatch', async () => {
    const fixture = eventFixture();
    const result = await fixture.controller.dispatch({
      type: 'change',
      fieldKey: 'input',
      metadata: { callback: () => {} },
    });
    assert.equal(result.issues[0].code, 'invalid_request');
    for (const request of [
      null,
      42,
      [],
      { scopeId: true },
      { instancePath: null },
      { metadata: [] },
    ]) {
      assert.equal((await fixture.controller.dispatch(request)).issues[0].code, 'invalid_request');
      assert.equal(
        (await fixture.controller.prepareSave(request)).issues[0].code,
        'invalid_request'
      );
    }
    assert.equal(fixture.evaluations, 1);
  });
}
