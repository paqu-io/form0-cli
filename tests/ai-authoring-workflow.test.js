import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { Form0PiSession } from '../src/ai/pi-session.js';
import { AIManager } from '../src/commands/interactive/managers/ai-manager.js';
import { SchemaManager } from '../src/commands/interactive/managers/schema-manager.js';
import { ServerManager } from '../src/commands/interactive/managers/server-manager.js';
import { EngineRunner } from '../src/commands/interactive/runners/engine-runner.js';
import { FileWatcher } from '../src/commands/interactive/file-watcher.js';
import { ShellCore } from '../src/commands/interactive/shell-core.js';

test('AI commands reject false-success proposals and preserve preview/apply/undo', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-ai-workflow-'));
  const schemaPath = path.join(directory, 'form.schema.json');
  const baseline = { form: { name: 'Manual baseline', description: null, elements: [] } };
  await fs.writeJson(schemaPath, baseline);
  await fs.writeJson(path.join(directory, 'auth.json'), {
    openai: { type: 'api_key', key: 'test-only-key' },
  });
  await fs.writeJson(path.join(directory, 'models.json'), { providers: {} });
  const output = [];
  const schemaManager = new SchemaManager();
  await schemaManager.loadSchema(schemaPath);
  const engineRunner = new EngineRunner(schemaManager);
  const watcher = new FileWatcher(schemaManager, engineRunner);
  const shell = new ShellCore(schemaManager, engineRunner, watcher);
  const server = new ServerManager(schemaManager, watcher, null, shell);
  const manager = new AIManager(schemaManager, engineRunner, server, null, shell, {
    sessionFactory: (input) => new Form0PiSession({ ...input, storageRoot: directory }),
    presentation: {
      write: (message) => output.push(message),
      writeLines: (lines) => output.push(...lines),
    },
  });
  t.after(async () => {
    await manager.dispose();
    await fs.remove(directory);
  });
  await manager.enter();
  const model = manager.agent.modelRuntime
    .getModels('openai')
    .find((entry) => entry.contextWindow >= 100_000);
  assert.ok(model);
  await manager.handleCommand(`/model openai/${model.id}`);
  const executions = [];
  manager.agent.session.subscribe((event) => {
    if (event.type === 'tool_execution_end') executions.push(event);
  });
  async function propose(operations, reply = 'The form-name change was staged successfully.') {
    output.length = 0;
    let firstResponse = true;
    // Replace only the external provider stream, not the SDK loop or form0 collaborators.
    manager.agent.session.agent.streamFunction = () => {
      const stopReason = firstResponse ? 'toolUse' : 'stop';
      const content = firstResponse
        ? [
            {
              type: 'toolCall',
              id: 'proposal',
              name: 'form0_propose_mutations',
              arguments: {
                baseRevision: manager.workspace.getRevision(),
                summary: 'Rename the form',
                operations,
              },
            },
          ]
        : [{ type: 'text', text: reply }];
      firstResponse = false;
      const stream = createAssistantMessageEventStream();
      stream.push({
        type: 'done',
        reason: stopReason,
        message: {
          role: 'assistant',
          content,
          api: model.api,
          provider: model.provider,
          model: model.id,
          stopReason,
          timestamp: Date.now(),
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        },
      });
      return stream;
    };
    await manager.handleCommand('Rename this form. Make only that form-name change.');
  }

  for (const operation of [
    { op: 'updateForm', patch: { name: 'Ignored rename' } },
    { op: 'updateForm', changes: { name: 'Manual baseline' } },
  ]) {
    await propose([operation]);
    assert.equal(executions.at(-1).isError, true);
    assert.ok(output.includes('No pending schema changes. Nothing to apply.'));
    assert.ok(!output.some((line) => line.startsWith('Proposal ready:')));
    await manager.handleCommand('/preview');
    assert.ok(output.some((line) => line.includes('Manual baseline')));
    await manager.handleCommand('/diff');
    assert.ok(output.includes('No Cumulative changes.'));
    await assert.rejects(manager.handleCommand('/apply'), /no pending AI proposal/);
    await assert.rejects(manager.handleCommand('/undo'), /no applied AI batch to undo/);
    assert.deepEqual(await fs.readJson(schemaPath), baseline);
  }

  await propose([{ op: 'updateForm', changes: { name: 'Proposed rename' } }]);
  assert.equal(executions.at(-1).isError, false);
  assert.ok(output.some((line) => line.startsWith('Proposal ready:')));
  await manager.handleCommand('/preview');
  assert.ok(output.some((line) => line.includes('Proposed rename')));
  await manager.handleCommand('/diff --pending');
  assert.ok(output.some((line) => line.includes('Proposed rename')));
  assert.deepEqual(await fs.readJson(schemaPath), baseline);
  await manager.handleCommand('/apply');
  assert.equal((await fs.readJson(schemaPath)).form.name, 'Proposed rename');
  assert.equal(schemaManager.getCurrentSchema().form.name, 'Proposed rename');
  await manager.handleCommand('/undo');
  assert.equal(manager.workspace.getCurrentSchema().form.name, 'Manual baseline');
  assert.equal((await fs.readJson(schemaPath)).form.name, 'Proposed rename');
  await manager.handleCommand('/apply');
  assert.deepEqual(await fs.readJson(schemaPath), baseline);

  await propose([{ op: 'updateForm', changes: { name: 'Transient draft' } }]);
  await propose([{ op: 'updateForm', changes: { name: 'Manual baseline' } }]);
  assert.equal(executions.at(-1).isError, false);
  assert.ok(output.includes('No pending schema changes. Nothing to apply.'));
  await assert.rejects(manager.handleCommand('/apply'), /no pending AI proposal/);
  assert.deepEqual(await fs.readJson(schemaPath), baseline);
});
