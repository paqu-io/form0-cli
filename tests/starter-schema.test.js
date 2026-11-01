import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import * as tar from 'tar';
import { createFormEngine, validateSchema, flattenFields } from 'form0-core';
import { defaultFormTemplate } from '../src/form0-forms/form-schema-template.js';
import { initForInteractive } from '../src/commands/init.js';
import { setLocale } from '../src/utils/i18n.js';

function createEngine(initialValues = {}, instancePath = []) {
  const engine = createFormEngine({
    schema: defaultFormTemplate,
    initialValues,
    eventScope: { instancePath },
  });
  engine.eval();
  return engine;
}
const row = (repeatableKey) => ({ repeatableKey, instanceId: 'row-1', index: 0, identity: 'id' });
function dispatch(engine, type, field) {
  const result = engine.triggerDetailed(type, field);
  assert.deepEqual(result.issues, []);
  return result;
}

test('standard inspection covers self-contained field types and evaluates without diagnostics', () => {
  validateSchema(defaultFormTemplate.form);
  const types = new Set(
    flattenFields(defaultFormTemplate.form.elements).map((field) => field.type)
  );
  for (const type of [
    'TextField',
    'NumericField',
    'SingleChoiceField',
    'MultiChoiceField',
    'BooleanField',
    'DateField',
    'TimeField',
    'CalculatedField',
    'LabelField',
    'SignatureField',
    'PhotoField',
    'VideoField',
    'Section',
    'RepeatableSection',
    'BuildingPlanSection',
  ])
    assert.ok(types.has(type), type);
  assert.equal(defaultFormTemplate.form.status_field.type, 'StatusField');
  assert.equal(defaultFormTemplate.form.title_field.type, 'TitleField');
  assert.deepEqual(createEngine().getDiagnostics(), []);
  assert.deepEqual(dispatch(createEngine(), 'load-record').operations, []);
});

test('standard estimates, contact-copy event, urgency, and reversible read-only rule work', () => {
  const engine = createEngine({
    building_ref: 'BLD-001',
    building_length_m: 12,
    building_width_m: 8,
    allowance_per_m2: 25,
    assessor: 'Alex Morgan',
    copy_assessor: 'yes',
    overall_condition: 'urgent',
  });
  assert.equal(engine.getState().values.footprint_m2, 96);
  assert.equal(engine.getState().values.planning_allowance, 2400);
  assert.equal(engine.getState().values.follow_up_priority, 'Urgent follow-up');
  assert.equal(engine.getState().visible.urgent_details, true);
  assert.equal(engine.getState().required.urgent_details, true);
  assert.equal(dispatch(engine, 'change', 'overall_condition').operations[0].operation, 'ALERT');
  const operation = dispatch(engine, 'change', 'copy_assessor').operations[0];
  engine.setValue(operation.params.fieldDataName, operation.params.valueToSet);
  assert.equal(engine.getState().values.follow_up_contact, 'Alex Morgan');
  engine.setValue('lock_review_notes', 'yes');
  assert.equal(engine.getState().read_only.review_notes, true);
  engine.setValue('lock_review_notes', 'no');
  assert.equal(engine.getState().read_only.review_notes, false);
  assert.deepEqual(engine.getDiagnostics(), []);
});

test('standard record and nested-row validation recover when values are corrected', () => {
  const engine = createEngine({ inspection_on: '2026-01-10', follow_up_on: '2026-01-09' });
  assert.equal(dispatch(engine, 'validate-record').validationIssues.length, 1);
  engine.setValue('follow_up_on', '2026-01-11');
  assert.deepEqual(dispatch(engine, 'validate-record').validationIssues, []);
  const finding = createEngine({ finding_priority: 'urgent', next_action: '' }, [
    row('inspection_areas'),
    row('findings'),
  ]);
  assert.equal(dispatch(finding, 'validate-repeatable', 'findings').validationIssues.length, 1);
  finding.setValue('next_action', 'Schedule the repair.');
  assert.deepEqual(dispatch(finding, 'validate-repeatable', 'findings').validationIssues, []);
  const item = createEngine({ work_quantity: 2.5, work_unit_cost: 40 }, [row('maintenance_items')]);
  assert.equal(item.getState().values.work_estimate, 100);
  assert.deepEqual(item.getDiagnostics(), []);
});

test('archived starter bytes still match their recorded hashes', async () => {
  const root = new URL('../archive/starter-schemas/2026-10-31/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root)));
  for (const file of manifest.files) {
    const bytes = await readFile(new URL(file.path, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
  }
});

test('standard scaffolding includes the new schema, current core version, and supporting image', async () => {
  setLocale('en');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'form0-standard-starter-'));
  try {
    await initForInteractive(dir);
    const schema = JSON.parse(await readFile(path.join(dir, 'form.schema.json')));
    assert.equal(schema.form.name, defaultFormTemplate.form.name);
    validateSchema(schema.form);
    const manifest = JSON.parse(await readFile(path.join(dir, 'package.json')));
    const cliManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
    assert.equal(manifest.dependencies['form0-core'], cliManifest.dependencies['form0-core']);
    assert.match(await readFile(path.join(dir, 'test.js'), 'utf8'), /building_ref: 'BLD-001'/);
    const image = await readFile(path.join(dir, 'supporting-images/evidence-photo-guide.png'));
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('local and downloaded app templates omit the archive while retaining active schemas', async () => {
  setLocale('en');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'form0-app-starter-'));
  const source = path.join(dir, 'form0-web-tmpl-react-vite');
  const originalFetch = globalThis.fetch;
  try {
    await mkdir(path.join(source, 'archive/starter-schemas'), { recursive: true });
    await mkdir(path.join(source, 'src/forms/nature-observation'), { recursive: true });
    await writeFile(
      path.join(source, 'package.json'),
      JSON.stringify({ name: 'form0-web-tmpl-react-vite' })
    );
    await writeFile(path.join(source, 'src/forms/nature-observation/schema.json'), '{}');
    await writeFile(path.join(source, 'archive/starter-schemas/legacy.json'), '{}');
    const local = path.join(dir, 'local-project');
    await initForInteractive(local, {
      source: 'local',
      templateRoot: source,
      packageManager: 'npm',
      readlineInterface: { question: (_prompt, answer) => answer('') },
    });
    await access(path.join(local, 'src/forms/nature-observation/schema.json'));
    await assert.rejects(access(path.join(local, 'archive')), { code: 'ENOENT' });
    const archive = await tar.c({ gzip: true, cwd: dir }, [path.basename(source)]).concat();
    globalThis.fetch = async () => new Response(archive, { status: 200 });
    const remote = path.join(dir, 'remote-project');
    const answers = ['2', '1'];
    await initForInteractive(remote, {
      source: 'remote',
      packageManager: 'npm',
      readlineInterface: { question: (_prompt, answer) => answer(answers.shift() ?? '') },
    });
    await access(path.join(remote, 'src/forms/nature-observation/schema.json'));
    await assert.rejects(access(path.join(remote, 'archive')), { code: 'ENOENT' });
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});
