import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFormEngine } from 'form0-core';
import {
  createDiagnosticReporter,
  createPreviewDiagnosticController,
  combineDiagnostics,
  formatDiagnostic,
  formatDiagnosticCounts,
} from '../src/server/static/calculation-diagnostics.js';
import { collectCalculationIssues } from '../src/utils/calculation-checks.js';
import {
  schemaWithCalculation,
  failureExpression,
  intermediateSchema,
} from './fixtures/diagnostics-schema.mjs';

test('real evaluation snapshots include initial, identical, recovery, and recurrence', () => {
  const events = [];
  const reporter = createDiagnosticReporter({ emit: (event) => events.push(event) });
  const notifications = [];
  const engine = createFormEngine({
    schema: schemaWithCalculation(failureExpression),
    initialValues: { input: 0 },
    diagnostics: { console: false },
    onDiagnostics(snapshot) {
      notifications.push(snapshot);
      reporter.report(snapshot);
    },
  });
  assert.deepEqual(engine.getDiagnostics(), []);
  engine.eval();
  assert.equal(reporter.getDiagnostics()[0].code, 'runtime_exception');
  const firstCount = events.length;
  engine.eval();
  assert.equal(events.length, firstCount);
  assert.equal(notifications.length, 2);
  const copy = reporter.getDiagnostics();
  copy[0].message = 'changed';
  copy[0].context.parentPath.push('fake');
  assert.notEqual(reporter.getDiagnostics()[0].message, 'changed');
  assert.deepEqual(reporter.getDiagnostics()[0].context.parentPath, []);
  engine.getState().values.input = 4;
  engine.eval();
  assert.deepEqual(reporter.getDiagnostics(), []);
  assert.equal(events.at(-1).kind, 'resolved');
  engine.getState().values.input = 0;
  engine.eval();
  assert.equal(events.filter((event) => event.kind === 'diagnostic').length, 2);
  assert.equal(notifications.length, 4);
});

test('suppression keeps snapshots and outcomes; explicit reports repeat', () => {
  const events = [];
  const reporter = createDiagnosticReporter({ emit: (event) => events.push(event) });
  const engine = createFormEngine({
    schema: schemaWithCalculation(failureExpression),
    initialValues: { input: 0 },
    diagnostics: { console: false },
  });
  engine.eval();
  assert.equal(reporter.report(engine.getDiagnostics(), { enabled: false }).errors, 1);
  assert.equal(reporter.getDiagnostics().length, 1);
  assert.equal(events.length, 0);
  reporter.report(engine.getDiagnostics(), { explicit: true });
  reporter.report(engine.getDiagnostics(), { explicit: true });
  assert.equal(events.filter((event) => event.kind === 'diagnostic').length, 2);
  reporter.reset();
  assert.deepEqual(reporter.getDiagnostics(), []);
});

test('an intermediate-pass error remains in the evaluation snapshot after values stabilize', () => {
  const reporter = createDiagnosticReporter();
  const engine = createFormEngine({
    schema: intermediateSchema(),
    diagnostics: { console: false },
    onDiagnostics: (snapshot) => reporter.report(snapshot),
  });
  engine.eval();
  assert.equal(engine.getState().values.target, 23);
  assert.equal(
    reporter.getDiagnostics().some((item) => item.code === 'runtime_exception'),
    true
  );
  engine.eval();
  assert.equal(
    reporter.getDiagnostics().some((item) => item.code === 'runtime_exception'),
    false
  );
});

test('reporting and core observer failures cannot interrupt calculations', async () => {
  for (const emit of [
    () => {
      throw new Error('sink');
    },
    async () => {
      throw new Error('sink');
    },
  ]) {
    const reporter = createDiagnosticReporter({ emit });
    const engine = createFormEngine({
      schema: schemaWithCalculation(failureExpression),
      initialValues: { input: 0 },
      diagnostics: { console: false },
      onDiagnostics: (snapshot) => reporter.report(snapshot),
    });
    engine.eval();
    assert.equal(engine.getState().values.result, null);
    assert.equal(engine.getDiagnostics().length, 1);
  }
  for (const onDiagnostics of [
    () => {
      throw new Error('observer');
    },
    async () => {
      throw new Error('observer');
    },
  ]) {
    const engine = createFormEngine({
      schema: schemaWithCalculation('$input * 2'),
      diagnostics: { console: false },
      onDiagnostics,
    });
    engine.eval();
    assert.equal(engine.getState().values.result, 6);
    assert.deepEqual(engine.getDiagnostics(), []);
  }
  await new Promise((resolve) => setImmediate(resolve));
});

test('static and runtime multiline findings coalesce while preserving both codes', () => {
  const schema = schemaWithCalculation('IF(\ntrue,\n"a",\n"b"\n)');
  const engine = createFormEngine({ schema, diagnostics: { console: false } });
  engine.eval();
  const entries = combineDiagnostics(collectCalculationIssues(schema), engine.getDiagnostics());
  assert.equal(entries.length, 1);
  assert.equal(entries[0].diagnostic.code, 'missing_result');
  assert.deepEqual(entries[0].origins, [
    { source: 'runtime', code: 'missing_result' },
    { source: 'analysis', code: 'noncanonical_multiline_result' },
  ]);
  const distinct = { ...engine.getDiagnostics()[0], code: 'other_failure', severity: 'error' };
  assert.equal(combineDiagnostics([], [...engine.getDiagnostics(), distinct]).length, 2);
  assert.deepEqual(collectCalculationIssues(schemaWithCalculation('return $input * 2;\n')), []);
});

test('readable diagnostic blocks retain core details, row paths, and localized severity totals', async () => {
  const engine = createFormEngine({
    schema: intermediateSchema(),
    diagnostics: { console: false },
  });
  engine.eval();
  const diagnostics = engine.getDiagnostics();
  const error = diagnostics.find((item) => item.severity === 'error');
  for (const locale of ['en', 'es', 'fr', 'it']) {
    const data = JSON.parse(
      await readFile(new URL('../src/locales/' + locale + '.json', import.meta.url))
    );
    const translate = (key, params = {}) =>
      data.client[key].replace(/\{(\w+)\}/g, (_, name) => params[name]);
    const summary = formatDiagnosticCounts(diagnostics, translate);
    assert.ok(summary.includes(translate('diagnostics.oneError', { count: 1 })));
    assert.ok(summary.includes(translate('diagnostics.warnings', { count: 2 })));
    const events = [];
    createDiagnosticReporter({ translate, emit: (event) => events.push(event) }).report(
      diagnostics
    );
    assert.equal(events.filter((event) => event.kind === 'diagnostic').length, diagnostics.length);
    assert.equal(events[0].text, translate('diagnostics.heading', { summary }));
    const lines = formatDiagnostic(combineDiagnostics([], [error])[0], translate);
    assert.ok(lines[0].includes(error.message));
    assert.equal(lines[1].split(error.code).length - 1, 1);
    assert.ok(lines[1].startsWith('  '));
    assert.equal(lines[1].includes(translate('diagnostics.phase') + ':'), false);
    const dependency = diagnostics.find((item) => item.code === 'dynamic_dependencies');
    const dependencyLines = formatDiagnostic(combineDiagnostics([], [dependency])[0], translate);
    assert.ok(dependencyLines[1].includes(translate('diagnostics.phase') + ': dependency'));
    assert.equal(
      dependencyLines[2],
      '  ' + translate('diagnostics.suggestion') + ': ' + dependency.suggestion
    );
    const rowError = {
      ...error,
      context: {
        instancePath: [
          { repeatableKey: 'rows', instanceId: 'row-a', index: 0 },
          { repeatableKey: 'children', instanceId: null, index: 1 },
        ],
      },
    };
    assert.ok(
      formatDiagnostic(combineDiagnostics([], [rowError])[0], translate)[0].includes(
        'rows[row-a] / children[' + translate('diagnostics.position', { index: 2 }) + '] / target'
      )
    );
    assert.doesNotMatch(events.map((event) => event.text).join('\n'), /\{\w+\}|\(s\)/);
  }
});

test('comparison preserves row identity across reordering and retains distinct rows', () => {
  const events = [];
  const reporter = createDiagnosticReporter({ emit: (event) => events.push(event) });
  const item = {
    code: 'runtime_exception',
    severity: 'error',
    fieldName: 'total',
    phase: 'runtime',
    message: 'failed',
    context: { instancePath: [{ repeatableKey: 'rows', instanceId: 'a', index: 0 }] },
  };
  reporter.report([item]);
  const count = events.length;
  reporter.report([
    { ...item, context: { instancePath: [{ repeatableKey: 'rows', instanceId: 'a', index: 1 }] } },
  ]);
  assert.equal(events.length, count);
  reporter.report([
    item,
    { ...item, context: { instancePath: [{ repeatableKey: 'rows', instanceId: 'b', index: 1 }] } },
  ]);
  assert.equal(events.filter((event) => event.kind === 'diagnostic').length, 2);
});

test('preview accepts current responses, clears recovery, and discards older generations/intents', () => {
  const events = [];
  const reporter = createDiagnosticReporter({ emit: (event) => events.push(event) });
  const controller = createPreviewDiagnosticController(reporter);
  const engine = createFormEngine({
    schema: schemaWithCalculation(failureExpression),
    initialValues: { input: 0 },
    diagnostics: { console: false },
  });
  engine.eval();
  const old = controller.beginEvaluation();
  const current = controller.beginEvaluation();
  assert.equal(controller.accept(current, { diagnostics: [] }), true);
  assert.equal(controller.accept(old, { diagnostics: engine.getDiagnostics() }), false);
  assert.deepEqual(reporter.getDiagnostics(), []);
  const oldSchema = controller.beginEvaluation();
  controller.invalidate();
  assert.equal(controller.accept(oldSchema, { diagnostics: engine.getDiagnostics() }), false);
  controller.setConsole(false);
  assert.equal(
    controller.accept(controller.beginEvaluation(), { diagnostics: engine.getDiagnostics() }),
    true
  );
  assert.equal(reporter.getDiagnostics().length, 1);
  assert.equal(events.length, 0);
  controller.setConsole(true);
  assert.equal(reporter.getDiagnostics().length, 1);
  controller.accept(controller.beginEvaluation(), { diagnostics: engine.getDiagnostics() });
  assert.equal(events.filter((event) => event.kind === 'diagnostic').length, 1);
});

test('initialization collects quietly and the effective initial evaluation reports findings', () => {
  const events = [];
  const reporter = createDiagnosticReporter({ emit: (event) => events.push(event) });
  const controller = createPreviewDiagnosticController(reporter);
  const item = {
    code: 'runtime_exception',
    severity: 'error',
    fieldName: 'result',
    phase: 'runtime',
    message: 'failure',
  };
  controller.setInitializing(true);
  controller.accept(controller.beginEvaluation(), { diagnostics: [item] });
  assert.equal(events.length, 0);
  controller.setInitializing(false);
  controller.accept(controller.beginEvaluation(), { diagnostics: [item] });
  assert.equal(events.filter((event) => event.kind === 'diagnostic').length, 1);
});

test('new diagnostic translations match across all four CLI/browser locales', async () => {
  let expected;
  for (const locale of ['en', 'es', 'fr', 'it']) {
    const data = JSON.parse(
      await readFile(new URL('../src/locales/' + locale + '.json', import.meta.url), 'utf8')
    );
    expected ??= Object.keys(data.diagnostics).sort();
    assert.deepEqual(Object.keys(data.diagnostics).sort(), expected);
    for (const [key, value] of Object.entries(data.diagnostics)) {
      assert.equal(data.client['diagnostics.' + key], value);
    }
  }
});
