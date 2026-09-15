import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { AISchemaWorkspace } from '../src/ai/schema-workspace.js';

const schema = { form: { name: 'Before', description: null, elements: [] } };

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
  assert.equal((await fs.readJson(schemaPath)).form.name, 'Before');
  await workspace.preview();
  assert.deepEqual(messages, ['draft']);
  await workspace.apply();
  assert.equal((await fs.readJson(schemaPath)).form.name, 'After');
  assert.equal((await fs.stat(schemaPath)).mode & 0o777, 0o644);
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
