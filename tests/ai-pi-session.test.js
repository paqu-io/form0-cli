import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
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
