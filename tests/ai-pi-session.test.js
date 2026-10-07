import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { AISchemaWorkspace } from '../src/ai/schema-workspace.js';
import { discoverOllamaModels, Form0PiSession, ollamaModelsConfig } from '../src/ai/pi-session.js';

test('Pi login provider and auth identifiers pass through unchanged', async () => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-ai-login-'));
  const calls = [];
  const workspace = new AISchemaWorkspace({
    schema: { form: { name: 'Login test', description: null, elements: [] } },
  });
  const adapter = new Form0PiSession({
    workspace,
    storageRoot,
    modelRuntime: {
      login: async (...args) => {
        calls.push(args.slice(0, 2));
        return { type: args[1] };
      },
    },
  });

  await adapter.login('openai-codex', 'oauth', {});
  await adapter.login('openai', 'api_key', {});

  assert.deepEqual(calls, [
    ['openai-codex', 'oauth'],
    ['openai', 'api_key'],
  ]);
});

test('Pi no-model requests give selection guidance, not a zero-token context error', async (t) => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-ai-no-model-'));
  await fs.writeJson(path.join(storageRoot, 'auth.json'), {});
  await fs.writeJson(path.join(storageRoot, 'models.json'), { providers: {} });
  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(storageRoot, 'auth.json'),
    modelsPath: path.join(storageRoot, 'models.json'),
    modelsStorePath: path.join(storageRoot, 'models-cache.json'),
  });
  const adapter = new Form0PiSession({
    workspace: new AISchemaWorkspace({
      schema: { form: { name: 'No model', description: null, elements: [] } },
    }),
    storageRoot,
    modelRuntime,
  });
  t.after(async () => {
    await adapter.dispose();
    await fs.remove(storageRoot);
  });
  await adapter.initialize();
  await assert.rejects(adapter.prompt('model openai/gpt-5.6-luna'), (error) => {
    assert.match(error.message, /No model is selected/);
    assert.match(error.message, /\/model/);
    assert.match(error.message, /leading \/|start with \//);
    assert.doesNotMatch(error.message, /0-token/);
    return true;
  });
  assert.equal(adapter.model, null);
  await adapter.newConversation();
  assert.equal(adapter.model, null);
});

test('Pi OAuth login supplies a stable, private installation ID only when requested', async (t) => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-ai-device-id-'));
  t.after(() => fs.remove(storageRoot));
  await fs.writeJson(path.join(storageRoot, 'auth.json'), {});
  await fs.writeJson(path.join(storageRoot, 'models.json'), { providers: {} });
  const workspace = new AISchemaWorkspace({
    schema: { form: { name: 'OAuth test', description: null, elements: [] } },
  });
  const createAdapter = async () => {
    const modelRuntime = await ModelRuntime.create({
      authPath: path.join(storageRoot, 'auth.json'),
      modelsPath: path.join(storageRoot, 'models.json'),
      modelsStorePath: path.join(storageRoot, 'models-cache.json'),
    });
    // Substitute only the external provider login; keep SDK settings and sessions real.
    modelRuntime.login = async (_provider, type, _interaction, options) => {
      const deviceId = type === 'oauth' ? options?.getDeviceId?.() : undefined;
      if (type === 'oauth') {
        assert.match(deviceId || '', /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
      }
      return { type, deviceId };
    };
    const adapter = new Form0PiSession({ workspace, storageRoot, modelRuntime });
    t.after(() => adapter.dispose());
    await adapter.initialize();
    return adapter;
  };

  const first = await createAdapter();
  assert.equal(first.settingsManager.getGlobalSettings().deviceId, undefined);
  await first.login('openai', 'api_key', {});
  assert.equal(first.settingsManager.getGlobalSettings().deviceId, undefined);
  const { deviceId } = await first.login('openai', 'oauth', {});
  await first.dispose();

  const resumed = await createAdapter();
  assert.equal((await resumed.login('openai', 'oauth', {})).deviceId, deviceId);
  assert.notEqual(resumed.settingsManager.getGlobalSettings().enableAnalytics, true);
  assert.equal((await fs.stat(path.join(storageRoot, 'settings.json'))).mode & 0o777, 0o600);
});

test('Pi failed OAuth login still flushes and hardens its lazy settings', async (t) => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-ai-login-failure-'));
  await fs.writeJson(path.join(storageRoot, 'auth.json'), {});
  await fs.writeJson(path.join(storageRoot, 'models.json'), { providers: {} });
  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(storageRoot, 'auth.json'),
    modelsPath: path.join(storageRoot, 'models.json'),
    modelsStorePath: path.join(storageRoot, 'models-cache.json'),
  });
  modelRuntime.login = async (_provider, _type, _interaction, options) => {
    options.getDeviceId();
    throw new Error('Provider login cancelled');
  };
  const adapter = new Form0PiSession({
    workspace: new AISchemaWorkspace({
      schema: { form: { name: 'Cancelled login', description: null, elements: [] } },
    }),
    storageRoot,
    modelRuntime,
  });
  t.after(async () => {
    await adapter.dispose();
    await fs.remove(storageRoot);
  });
  await adapter.initialize();
  await assert.rejects(adapter.login('openai', 'oauth', {}), /Provider login cancelled/);
  assert.equal((await fs.stat(path.join(storageRoot, 'settings.json'))).mode & 0o777, 0o600);
});

test('Pi executes only form0 tools, keeps drafts transient, and resumes the conversation', async (t) => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-ai-tool-loop-'));
  const schemaPath = path.join(storageRoot, 'form.schema.json');
  const schema = { form: { name: 'Before SDK proposal', description: null, elements: [] } };
  await fs.writeJson(schemaPath, schema);
  await fs.writeJson(path.join(storageRoot, 'auth.json'), {
    openai: { type: 'api_key', key: 'test-only-key' },
  });
  await fs.writeJson(path.join(storageRoot, 'models.json'), { providers: {} });
  const previews = [];
  const workspace = new AISchemaWorkspace({
    schema,
    schemaPath,
    onPreview: async (draft) => previews.push(draft.form.name),
  });
  const adapter = new Form0PiSession({ workspace, storageRoot });
  let resumed;
  t.after(async () => {
    await adapter.dispose();
    await resumed?.dispose();
    await fs.remove(storageRoot);
  });
  await adapter.initialize();
  const model = adapter.modelRuntime
    .getModels('openai')
    .find((entry) => entry.contextWindow >= 100_000);
  assert.ok(model, 'a bundled OpenAI model must fit the full authoring context');
  await adapter.selectModel(`openai/${model.id}`);

  const executions = [];
  adapter.session.subscribe((event) => {
    if (event.type === 'tool_execution_end') executions.push(event);
  });
  let requests = 0;
  // Fake only the provider stream; the SDK agent loop and tool execution remain real.
  adapter.session.agent.streamFunction = () => {
    const content =
      requests++ === 0
        ? [
            { type: 'toolCall', id: 'context', name: 'form0_authoring_context', arguments: {} },
            {
              type: 'toolCall',
              id: 'proposal',
              name: 'form0_propose_mutations',
              arguments: {
                baseRevision: workspace.getRevision(),
                summary: 'Rename the form for the SDK compatibility check',
                operations: [{ op: 'updateForm', changes: { name: 'Draft from SDK' } }],
              },
            },
            { type: 'toolCall', id: 'forbidden', name: 'read', arguments: { path: schemaPath } },
          ]
        : [{ type: 'text', text: 'Draft staged; approval required.' }];
    const stopReason = requests === 1 ? 'toolUse' : 'stop';
    const message = {
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
    };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'done', reason: stopReason, message });
    return stream;
  };

  assert.equal(await adapter.prompt('Rename the form'), 'Draft staged; approval required.');
  assert.equal(executions.find((event) => event.toolCallId === 'context').isError, false);
  assert.equal(executions.find((event) => event.toolCallId === 'proposal').isError, false);
  assert.equal(executions.find((event) => event.toolCallId === 'forbidden').isError, true);
  assert.equal(workspace.getCurrentSchema().form.name, 'Draft from SDK');
  assert.deepEqual(previews, ['Draft from SDK']);
  assert.equal((await fs.readJson(schemaPath)).form.name, 'Before SDK proposal');
  await workspace.apply();
  assert.equal((await fs.readJson(schemaPath)).form.name, 'Draft from SDK');
  assert.equal((await fs.stat(adapter.session.sessionFile)).mode & 0o777, 0o600);
  await adapter.dispose();

  resumed = new Form0PiSession({ workspace, storageRoot });
  await resumed.initialize();
  assert.equal(resumed.model.id, model.id);
  assert.ok(
    resumed.session.messages.some(
      (message) =>
        message.role === 'assistant' &&
        message.content.some(
          (part) => part.type === 'text' && part.text === 'Draft staged; approval required.'
        )
    )
  );
  assert.deepEqual(resumed.session.getActiveToolNames(), [
    'form0_authoring_context',
    'form0_propose_mutations',
    'form0_docs',
  ]);
});

test('Pi model catalog refresh is provider-scoped and keeps errors non-fatal', async () => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-ai-refresh-'));
  const calls = [];
  const workspace = new AISchemaWorkspace({
    schema: { form: { name: 'Refresh test', description: null, elements: [] } },
  });
  const adapter = new Form0PiSession({
    workspace,
    storageRoot,
    modelRuntime: {
      refresh: async (options) => {
        calls.push(options);
        return {
          aborted: false,
          errors: new Map([['openai', new Error('catalog unavailable')]]),
        };
      },
    },
  });

  const result = await adapter.refreshModels(['openai']);

  assert.deepEqual(calls, [{ providers: ['openai'], allowNetwork: true }]);
  assert.deepEqual(result, {
    aborted: false,
    errors: [{ provider: 'openai', message: 'catalog unavailable' }],
  });
});

test('Pi retries an explicit missing model after refreshing only its provider', async () => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-ai-select-refresh-'));
  const refreshCalls = [];
  let refreshed = false;
  const selected = { provider: 'openai', id: 'new-model' };
  const adapter = new Form0PiSession({
    workspace: new AISchemaWorkspace({
      schema: { form: { name: 'Selection test', description: null, elements: [] } },
    }),
    storageRoot,
    modelRuntime: {
      getModel: () => (refreshed ? selected : undefined),
      refresh: async (options) => {
        refreshCalls.push(options);
        refreshed = true;
        return { aborted: false, errors: new Map() };
      },
    },
  });
  adapter.session = { setModel: async () => {} };

  assert.equal(await adapter.selectModel('openai/new-model'), selected);
  assert.deepEqual(refreshCalls, [{ providers: ['openai'], allowNetwork: true }]);
});

test('AI status reports local Pi authentication without exposing credentials', () => {
  const workspace = new AISchemaWorkspace({
    schema: { form: { name: 'Status test', description: null, elements: [] } },
    schemaPath: '/project/order.json',
  });
  const adapter = new Form0PiSession({
    workspace,
    modelRuntime: {
      getProviders: () => [{ id: 'openai-codex' }, { id: 'openai' }],
      getProviderAuthStatus: (provider) =>
        provider === 'openai-codex'
          ? { configured: true, source: 'stored' }
          : { configured: false },
      isUsingOAuth: (provider) => provider === 'openai-codex',
      isUsingSubscription: (provider) => provider === 'openai-codex',
    },
  });
  adapter.model = { provider: 'openai-codex', id: 'gpt-5.6-luna' };
  adapter.session = { sessionFile: '/private/session.jsonl' };

  assert.deepEqual(adapter.getStatus(), {
    schemaPath: '/project/order.json',
    draft: null,
    selectedModel: { provider: 'openai-codex', id: 'gpt-5.6-luna' },
    authentications: [
      {
        provider: 'openai-codex',
        type: 'oauth',
        source: 'stored',
        label: null,
        subscription: true,
      },
    ],
    cloudPolicy: { allowCloud: true, requiresConsent: false },
    conversation: 'persisted',
  });
});

test('Pi restores the global selected model independently of schema conversations', async () => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-ai-model-'));
  const schemaPath = path.join(storageRoot, 'form.schema.json');
  await fs.writeJson(path.join(storageRoot, 'auth.json'), {
    openai: { type: 'api_key', key: 'test-only-key' },
  });
  await fs.writeJson(path.join(storageRoot, 'models.json'), { providers: {} });
  const createWorkspace = () =>
    new AISchemaWorkspace({
      schema: { form: { name: 'Model restore', description: null, elements: [] } },
      schemaPath,
    });

  const first = new Form0PiSession({ workspace: createWorkspace(), storageRoot });
  await first.initialize();
  const selected = first.modelRuntime
    .getModels('openai')
    .find((model) => model.id !== first.model?.id);
  assert.ok(selected, 'Expected at least two built-in OpenAI models');
  await first.selectModel(`openai/${selected.id}`);
  await first.newConversation();
  assert.equal(first.model?.provider, 'openai');
  assert.equal(first.model?.id, selected.id);
  await first.dispose();

  const resumed = new Form0PiSession({ workspace: createWorkspace(), storageRoot });
  await resumed.initialize();
  assert.equal(resumed.model?.provider, 'openai');
  assert.equal(resumed.model?.id, selected.id);
  assert.equal((await fs.stat(path.join(storageRoot, 'settings.json'))).mode & 0o777, 0o600);
  await resumed.dispose();

  const unsaved = new Form0PiSession({
    workspace: new AISchemaWorkspace({
      schema: { form: { name: 'Unsaved', description: null, elements: [] } },
    }),
    storageRoot,
  });
  await unsaved.initialize();
  assert.equal(unsaved.model?.provider, 'openai');
  assert.equal(unsaved.model?.id, selected.id);
  await unsaved.dispose();
});

test('Pi falls back cleanly when the globally saved model is no longer available', async () => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-ai-model-fallback-'));
  await fs.writeJson(
    path.join(storageRoot, 'models.json'),
    ollamaModelsConfig(['temporary:latest'])
  );
  const createWorkspace = () =>
    new AISchemaWorkspace({
      schema: { form: { name: 'Fallback', description: null, elements: [] } },
    });

  const first = new Form0PiSession({ workspace: createWorkspace(), storageRoot });
  await first.initialize();
  await first.selectModel('ollama/temporary:latest');
  await first.dispose();

  await fs.writeJson(path.join(storageRoot, 'models.json'), { providers: {} });
  await fs.remove(path.join(storageRoot, 'models-cache.json'));
  const resumed = new Form0PiSession({ workspace: createWorkspace(), storageRoot });
  await resumed.initialize();

  assert.notEqual(`${resumed.model?.provider}/${resumed.model?.id}`, 'ollama/temporary:latest');
  assert.equal(resumed.getSavedModelReference(), 'ollama/temporary:latest');
  assert.match(resumed.takeModelFallbackMessage(), /No models available/i);
  await resumed.dispose();
});

test('Pi provider errors are surfaced instead of becoming empty responses', async () => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-ai-error-'));
  const workspace = new AISchemaWorkspace({
    schema: { form: { name: 'Error test', description: null, elements: [] } },
  });
  const adapter = new Form0PiSession({ workspace, storageRoot });
  adapter.model = { provider: 'ollama', id: 'fake', contextWindow: 100_000 };
  adapter.session = {
    messages: [],
    prompt: async () => {
      adapter.session.messages.push({
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'Usage limit reached for this subscription',
      });
    },
    waitForIdle: async () => {},
  };

  await assert.rejects(adapter.prompt('test'), /Usage limit reached/);
});

test('Ollama discovery creates a local-only Pi provider catalog', async () => {
  const models = await discoverOllamaModels(async (url) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/tags');
    return new Response(JSON.stringify({ models: [{ name: 'qwen3:8b' }] }));
  });
  assert.deepEqual(models, ['qwen3:8b']);
  const config = ollamaModelsConfig(models);
  assert.equal(config.providers.ollama.baseUrl, 'http://127.0.0.1:11434/v1');
  assert.deepEqual(config.providers.ollama.models, [{ id: 'qwen3:8b' }]);
});

test('Pi session storage is private and only form0 tools are enabled', async () => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-ai-session-'));
  await fs.writeJson(path.join(storageRoot, 'auth.json'), {});
  const workspace = new AISchemaWorkspace({
    schema: { form: { name: 'Private session', description: null, elements: [] } },
  });
  const adapter = new Form0PiSession({ workspace, storageRoot });
  await adapter.initialize();
  assert.equal((await fs.stat(storageRoot)).mode & 0o777, 0o700);
  assert.deepEqual(adapter.session.getActiveToolNames(), [
    'form0_authoring_context',
    'form0_propose_mutations',
    'form0_docs',
  ]);
  assert.equal((await fs.stat(path.join(storageRoot, 'auth.json'))).mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.dirname(adapter.session.sessionFile))).mode & 0o777, 0o700);
  await adapter.dispose();
});

test('Pi adapter supplies the complete current schema on every request', async () => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-ai-prompt-'));
  const schema = {
    form: {
      name: 'Complete context marker',
      description: null,
      elements: [{ type: 'LabelField', key: 'marker', label: 'Unique marker' }],
    },
  };
  const workspace = new AISchemaWorkspace({ schema });
  const prompts = [];
  const adapter = new Form0PiSession({ workspace, storageRoot });
  adapter.model = { provider: 'ollama', id: 'fake', contextWindow: 100_000 };
  adapter.session = {
    messages: [],
    prompt: async (prompt) => {
      prompts.push(prompt);
      adapter.session.messages.push({
        role: 'assistant',
        content: [{ type: 'text', text: 'Ready' }],
        stopReason: 'stop',
      });
    },
    waitForIdle: async () => {},
  };
  assert.equal(await adapter.prompt('Edit it'), 'Ready');
  assert.match(prompts[0], /Complete context marker/);
  assert.match(prompts[0], /Unique marker/);
  assert.match(prompts[0], /"eventGuidance"/);
  assert.match(prompts[0], /CHOICEVALUE/);
  assert.match(prompts[0], /<user-request>\nEdit it/);
});

test('Pi adapter refuses incomplete context and enforces field cloud policy', () => {
  const unselected = new Form0PiSession({
    workspace: new AISchemaWorkspace({
      schema: { form: { name: 'No model', description: null, elements: [] } },
    }),
  });
  assert.throws(() => unselected.preflight('edit'), /Use \/model <provider>\/<model>/);

  const huge = new AISchemaWorkspace({
    schema: { form: { name: 'x'.repeat(5_000), description: null, elements: [] } },
  });
  const limited = new Form0PiSession({ workspace: huge });
  limited.model = { provider: 'ollama', id: 'tiny', contextWindow: 100 };
  assert.throws(() => limited.preflight('edit'), /complete form/);

  const blocked = new AISchemaWorkspace({
    schema: {
      form: {
        name: 'Private',
        description: null,
        elements: [
          { type: 'LabelField', key: 'private', label: 'Private', ai: { allowCloud: false } },
        ],
      },
    },
  });
  const cloud = new Form0PiSession({ workspace: blocked });
  cloud.model = { provider: 'openai', id: 'fake', contextWindow: 100_000 };
  assert.throws(() => cloud.preflight('edit'), /Cloud AI is disabled/);
});
