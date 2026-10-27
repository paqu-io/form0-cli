import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters as withoutColors } from 'node:util';
import { EngineRunner } from '../src/commands/interactive/runners/engine-runner.js';
import { runCommand } from '../src/commands/run.js';
import { validateCommand } from '../src/commands/validate.js';
import { SchemaManager } from '../src/commands/interactive/managers/schema-manager.js';
import { Form0Watcher } from '../src/commands/watch.js';
import { FileWatcher } from '../src/commands/interactive/file-watcher.js';
import {
  field,
  schemaWithCalculation,
  failureExpression,
  intermediateSchema,
} from './fixtures/diagnostics-schema.mjs';

const cli = fileURLToPath(new URL('../bin/form0.js', import.meta.url));
const preload = fileURLToPath(new URL('./fixtures/diagnostics-test-home.mjs', import.meta.url));

test('standalone commands retain state output and apply error/warning/suppression exit policy', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'form0-diag-command-'));
  const schemaPath = path.join(dir, 'schema.json');
  const run = (command, args = [], environment = 'production') => {
    const result = spawnSync(
      process.execPath,
      ['--import', preload, cli, command, schemaPath, ...args],
      {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          FORM0_DIAGNOSTICS_TEST_HOME: dir,
          NODE_ENV: environment,
          LANG: 'en_US.UTF-8',
        },
      }
    );
    // Preserve the raw stdout payload; only diagnostic assertions compare visible text.
    return {
      ...result,
      stderr: typeof result.stderr === 'string' ? withoutColors(result.stderr) : result.stderr,
    };
  };
  try {
    await writeFile(schemaPath, JSON.stringify(schemaWithCalculation(failureExpression)));
    for (const environment of ['development', 'production']) {
      const failed = run('run', ['--values', '{"input":0}'], environment);
      assert.equal(failed.status, 1, failed.stderr);
      assert.match(failed.stdout, /"result": null/);
      assert.match(failed.stderr, /runtime_exception/);
      assert.doesNotMatch(failed.stdout, /runtime_exception/);
      assert.match(failed.stderr, /Calculation diagnostics: 1 error\n\nError in result:/);
      assert.match(failed.stderr, /  Code: runtime_exception \| Source: runtime/);
      assert.doesNotMatch(failed.stderr, /error\(s\)|runtime:runtime_exception/);
      const quiet = run('run', ['--values', '{"input":0}', '--no-diagnostics'], environment);
      assert.equal(quiet.status, 1);
      assert.match(quiet.stdout, /"result": null/);
      assert.doesNotMatch(quiet.stderr, /runtime_exception/);
    }
    const healthy = run('run', ['--values', '{"input":4}']);
    assert.equal(healthy.status, 0, healthy.stderr);
    assert.match(healthy.stdout, /"result": 3/);

    await writeFile(schemaPath, JSON.stringify(schemaWithCalculation('IF(\ntrue,\n"a",\n"b"\n)')));
    assert.equal(run('run').status, 0);
    const warning = run('validate');
    assert.equal(warning.status, 0);
    assert.match(warning.stderr, /noncanonical_multiline_result/);
    await writeFile(schemaPath, JSON.stringify(schemaWithCalculation('NOT_A_BUILTIN($input)')));
    const invalid = run('validate');
    assert.equal(invalid.status, 1, invalid.stderr);
    assert.match(invalid.stdout, /Schema structure is valid/);
    assert.match(invalid.stderr, /unknown_builtin/);
    const quietAnalysis = run('validate', ['--no-diagnostics']);
    assert.equal(quietAnalysis.status, 1);
    assert.doesNotMatch(quietAnalysis.stderr, /unknown_builtin/);
    await writeFile(schemaPath, JSON.stringify(schemaWithCalculation('return $input * 2;\n')));
    assert.equal(run('validate').status, 0);
    await writeFile(schemaPath, JSON.stringify(intermediateSchema()));
    const intermediate = run('run');
    assert.equal(intermediate.status, 1, intermediate.stderr);
    assert.match(intermediate.stdout, /"target": 23/);
    assert.match(intermediate.stderr, /runtime_exception/);
    assert.match(intermediate.stderr, /Calculation diagnostics: 1 error and 2 warnings/);
    assert.match(
      intermediate.stderr,
      /Calculation evaluation completed with 1 error and 2 warnings/
    );
    await writeFile(schemaPath, '{"form":null}');
    assert.equal(run('validate').status, 1);
    assert.equal(run('run').status, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('explicit terminal reports follow state or structure and retain stream separation', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'form0-diag-order-'));
  const schemaPath = path.join(dir, 'schema.json');
  const original = { log: console.log, error: console.error };
  const previousExit = process.exitCode;
  const messages = [];
  console.log = (text) => messages.push({ stream: 'stdout', text: withoutColors(text) });
  console.error = (text) => messages.push({ stream: 'stderr', text: withoutColors(text) });
  try {
    await writeFile(schemaPath, JSON.stringify(schemaWithCalculation(failureExpression)));
    await runCommand(schemaPath, { values: '{"input":0}' });
    const stateIndex = messages.findIndex((item) => item.text.includes('"result": null'));
    const findingIndex = messages.findIndex((item) =>
      item.text.includes('Code: runtime_exception')
    );
    assert.ok(stateIndex >= 0 && findingIndex > stateIndex);
    assert.equal(messages[stateIndex].stream, 'stdout');
    assert.equal(messages[findingIndex].stream, 'stderr');
    messages.length = 0;
    await writeFile(schemaPath, JSON.stringify(schemaWithCalculation('NOT_A_BUILTIN($input)')));
    await validateCommand(schemaPath);
    assert.equal(messages[0].text, 'Schema structure is valid.');
    assert.ok(messages.findIndex((item) => item.text.includes('Code: unknown_builtin')) > 0);
  } finally {
    Object.assign(console, original);
    process.exitCode = previousExit;
    await rm(dir, { recursive: true, force: true });
  }
});

test('field validation errors alone do not determine a standalone run failure', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'form0-diag-value-'));
  try {
    const schema = schemaWithCalculation('$input * 2');
    schema.form.elements.push(
      field('NumericField', 'invalid_default', { default_value: 2, min: 4 })
    );
    // Supply an invalid live value without an invalid schema default.
    schema.form.elements.at(-1).default_value = null;
    const schemaPath = path.join(dir, 'schema.json');
    await writeFile(schemaPath, JSON.stringify(schema));
    const child = spawnSync(
      process.execPath,
      ['--import', preload, cli, 'run', schemaPath, '--values', '{"invalid_default":2}'],
      {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, FORM0_DIAGNOSTICS_TEST_HOME: dir },
      }
    );
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /Must be at least 4/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('interactive evaluation and validation report failure without setting process exit status', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'form0-diag-interactive-'));
  const original = { log: console.log, error: console.error };
  const messages = [];
  console.log = () => {};
  console.error = (value) => messages.push(withoutColors(value));
  const previousExit = process.exitCode;
  try {
    const schemaPath = path.join(dir, 'schema.json');
    await writeFile(schemaPath, JSON.stringify(schemaWithCalculation(failureExpression)));
    const manager = new SchemaManager();
    await manager.loadSchema(schemaPath, { diagnostics: false });
    const runner = new EngineRunner(manager);
    assert.equal((await runner.runEngine(['--values', '{"input":0}'])).success, false);
    messages.length = 0;
    assert.equal(
      (await runner.runEngine(['--values', '{"input":0}'], { continuous: true })).success,
      false
    );
    assert.deepEqual(messages, []);
    assert.equal(
      (await runner.runEngine(['--no-diagnostics', '--values', '{"input":0}'])).success,
      false
    );
    assert.ok(
      messages.some((line) => line.includes('Calculation evaluation completed with 1 error'))
    );
    assert.ok(messages.every((line) => !line.includes('runtime_exception')));
    assert.equal(
      (await runner.runEngine(['--no-diagnostics', '--values', '{"input":4}'])).success,
      true
    );
    assert.equal(runner.getEngine().getState().values.result, 3);
    await writeFile(schemaPath, JSON.stringify(schemaWithCalculation('NOT_A_BUILTIN($input)')));
    assert.equal(await manager.validateCurrentSchema({ diagnostics: false }), false);
    assert.equal(process.exitCode, previousExit);
  } finally {
    Object.assign(console, original);
    await rm(dir, { recursive: true, force: true });
  }
});

test('both watch workflows coordinate auto-validation and auto-run once per revision', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'form0-diag-watch-'));
  const schemaPath = path.join(dir, 'schema.json');
  const original = { log: console.log, error: console.error };
  const messages = [];
  console.log = () => {};
  console.error = (value) => messages.push(withoutColors(value));
  const previousExit = process.exitCode;
  try {
    const warningSchema = schemaWithCalculation('IF(\ntrue,\n"a",\n"b"\n)');
    await writeFile(schemaPath, JSON.stringify(warningSchema));
    const standalone = new Form0Watcher(schemaPath, { autoRun: true, autoValidate: true });
    await standalone.loadSchema();
    standalone.validateCurrentSchema();
    await standalone.runEngine();
    assert.equal(messages.filter((line) => line.includes('Code: missing_result')).length, 1);
    assert.equal(
      messages.filter((line) =>
        line.includes('Source: runtime, analysis (noncanonical_multiline_result)')
      ).length,
      1
    );
    messages.length = 0;
    const manager = new SchemaManager();
    await manager.loadSchema(schemaPath, { diagnostics: false });
    const runner = new EngineRunner(manager);
    const watcher = new FileWatcher(manager, runner);
    watcher.watchOptions = { autoRun: true, autoValidate: true, diagnostics: true };
    await watcher.handleFileChange(schemaPath);
    assert.equal(messages.filter((line) => line.includes('Code: missing_result')).length, 1);
    await writeFile(schemaPath, JSON.stringify(schemaWithCalculation('return $input * 2;\n')));
    await watcher.handleFileChange(schemaPath);
    assert.deepEqual(runner.getEngine().getDiagnostics(), []);
    assert.equal(process.exitCode, previousExit);
  } finally {
    Object.assign(console, original);
    await rm(dir, { recursive: true, force: true });
  }
});
