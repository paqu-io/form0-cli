import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { AISchemaWorkspace } from '../src/ai/schema-workspace.js';

const schema = { form: { name: 'Before', description: null, elements: [] } };

test('unchanged proposals cannot be staged, saved, or recorded as undo history', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-ai-no-op-'));
  t.after(() => fs.remove(directory));
  const schemaPath = path.join(directory, 'form.schema.json');
  await fs.writeJson(schemaPath, schema);
  const original = await fs.readFile(schemaPath, 'utf8');
  const workspace = new AISchemaWorkspace({ schema, schemaPath });
  const result = workspace.stage({
    baseRevision: workspace.getRevision(),
    operations: [{ op: 'updateForm', changes: { name: 'Before' } }],
  });
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code, 'no_schema_changes');
  assert.equal(workspace.getPendingProposal(), null);
  await assert.rejects(workspace.apply(), /no pending AI proposal/i);
  await assert.rejects(workspace.undo(), /no applied AI batch/i);
  assert.equal(await fs.readFile(schemaPath, 'utf8'), original);
});

test('AI workspace previews without writing and applies atomically after approval', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-ai-workspace-'));
  const schemaPath = path.join(directory, 'form.schema.json');
  await fs.writeJson(schemaPath, schema);
  const messages = [];
  const workspace = new AISchemaWorkspace({
    schema,
    schemaPath,
    onPreview: async (_draft, meta) => messages.push(meta.state),
  });
  const staged = workspace.stage({
    baseRevision: workspace.getRevision(),
    summary: 'Rename the form',
    operations: [{ op: 'updateForm', changes: { name: 'After' } }],
  });
  assert.equal(staged.valid, true);
  assert.equal(workspace.validateCurrent().valid, true);
  assert.equal((await fs.readJson(schemaPath)).form.name, 'Before');
  await workspace.preview();
  await workspace.publishCurrent();
  assert.deepEqual(messages, ['draft', 'draft']);
  await workspace.apply();
  assert.equal((await fs.readJson(schemaPath)).form.name, 'After');
  assert.equal((await fs.stat(schemaPath)).mode & 0o777, 0o644);
});

test('a no-op revision preserves an existing draft, while reverting it leaves nothing to save', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-ai-draft-revision-'));
  t.after(() => fs.remove(directory));
  const schemaPath = path.join(directory, 'form.schema.json');
  await fs.writeJson(schemaPath, schema);
  const workspace = new AISchemaWorkspace({ schema, schemaPath });
  workspace.stage({
    baseRevision: workspace.getRevision(),
    operations: [{ op: 'updateForm', changes: { name: 'Draft' } }],
  });
  const previous = workspace.getPendingProposal();
  const unchanged = workspace.stage({
    baseRevision: workspace.getRevision(),
    operations: [{ op: 'updateForm', changes: { name: 'Draft' } }],
  });
  assert.equal(unchanged.valid, false);
  assert.deepEqual(workspace.getPendingProposal(), previous);

  const reverted = workspace.stage({
    baseRevision: workspace.getRevision(),
    operations: [{ op: 'updateForm', changes: { name: 'Before' } }],
  });
  assert.equal(reverted.valid, true);
  assert.equal(reverted.staged, false);
  assert.equal(workspace.getPendingProposal(), null);
  assert.equal(workspace.getCurrentSchema().form.name, 'Before');
  await assert.rejects(workspace.apply(), /no pending AI proposal/i);
  await assert.rejects(workspace.undo(), /no applied AI batch/i);
  assert.equal((await fs.readJson(schemaPath)).form.name, 'Before');
});

test('AI workspace rejects apply after an external edit and supports discard and undo', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-ai-conflict-'));
  const schemaPath = path.join(directory, 'form.schema.json');
  await fs.writeJson(schemaPath, schema);
  const workspace = new AISchemaWorkspace({ schema, schemaPath });
  workspace.stage({
    baseRevision: workspace.getRevision(),
    operations: [{ op: 'updateForm', changes: { name: 'Draft' } }],
  });
  await fs.writeJson(schemaPath, { form: { ...schema.form, name: 'External' } });
  await assert.rejects(() => workspace.apply(), /changed after this proposal/);
  await workspace.discard();
  assert.equal(workspace.getPendingProposal(), null);
});

test('AI workspace keeps cumulative history across applies and isolates pending changes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-ai-cumulative-'));
  const schemaPath = path.join(directory, 'form.schema.json');
  await fs.writeJson(schemaPath, schema);
  const workspace = new AISchemaWorkspace({ schema, schemaPath });

  workspace.stage({
    baseRevision: workspace.getRevision(),
    operations: [{ op: 'updateForm', changes: { name: 'Applied once' } }],
  });
  assert.equal(workspace.getCumulativeDiff().length, 1);
  await workspace.apply();
  assert.equal(workspace.getPendingDiff().length, 0);
  assert.equal(workspace.getCumulativeDiff()[0].after, 'Applied once');

  workspace.stage({
    baseRevision: workspace.getRevision(),
    operations: [{ op: 'updateForm', changes: { description: 'Pending second change' } }],
  });
  assert.equal(workspace.getPendingDiff().length, 1);
  assert.equal(workspace.getCumulativeDiff().length, 2);
  await workspace.discard();
  assert.equal(workspace.getPendingDiff().length, 0);
  assert.equal(workspace.getCumulativeDiff().length, 1);

  await workspace.undo();
  assert.equal(workspace.getPendingDiff()[0].after, 'Before');
});
