import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { Type } from 'typebox';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import * as form0Core from 'form0-core';
import { FORM0_AI_SYSTEM_PROMPT } from './system-prompt.js';
import { Form0DocsClient } from './docs-client.js';
import { schemaSessionKey } from './schema-workspace.js';

const LOCAL_PROVIDERS = new Set(['ollama', 'llama.cpp', 'llamacpp']);
const TOOL_NAMES = ['form0_authoring_context', 'form0_propose_mutations', 'form0_docs'];

function textResult(value, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], isError };
}

function assistantResponse(messages) {
  const message = [...messages].reverse().find((candidate) => candidate.role === 'assistant');
  if (!message) return '';
  if (message.stopReason === 'error') {
    throw new Error(message.errorMessage || 'The selected provider could not complete the request');
  }
  if (!Array.isArray(message.content)) return '';
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

async function discoverOllamaModels(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') return [];
  try {
    const response = await fetchImpl('http://127.0.0.1:11434/api/tags', {
      signal: AbortSignal.timeout(750),
    });
    if (!response.ok) return [];
    const body = await response.json();
    return (Array.isArray(body.models) ? body.models : [])
      .map((model) => model?.name)
      .filter((name) => typeof name === 'string' && name.length > 0);
  } catch {
    return [];
  }
}

function ollamaModelsConfig(modelIds) {
  return {
    providers: {
      ollama: {
        name: 'Ollama (local)',
        baseUrl: 'http://127.0.0.1:11434/v1',
        api: 'openai-completions',
        apiKey: 'ollama',
        models: modelIds.map((id) => ({ id })),
      },
    },
  };
}

export class Form0PiSession {
  constructor({ workspace, docsClient = new Form0DocsClient(), storageRoot, modelRuntime } = {}) {
    if (!workspace) throw new Error('An AI schema workspace is required');
    this.workspace = workspace;
    this.docsClient = docsClient;
    this.storageRoot = storageRoot || path.join(os.homedir(), '.form0-cli', 'ai');
    this.modelRuntime = modelRuntime;
    this.session = null;
    this.model = null;
    this.modelFallbackMessage = null;
    this.sessionKey = schemaSessionKey(workspace.schemaPath);
    this.startFresh = false;
    this.settingsManager = null;
  }

  async initialize() {
    await fs.ensureDir(this.storageRoot, 0o700);
    await fs.chmod(this.storageRoot, 0o700);
    const sessionsRoot = path.join(this.storageRoot, 'sessions', this.sessionKey);
    await fs.ensureDir(sessionsRoot, 0o700);
    await fs.chmod(path.join(this.storageRoot, 'sessions'), 0o700);
    await fs.chmod(sessionsRoot, 0o700);
    const modelsPath = path.join(this.storageRoot, 'models.json');
    if (!(await fs.pathExists(modelsPath))) {
      const ollamaModels = await discoverOllamaModels();
      if (ollamaModels.length > 0) {
        await fs.writeJson(modelsPath, ollamaModelsConfig(ollamaModels), {
          spaces: 2,
          mode: 0o600,
        });
      }
    }
    this.modelRuntime ||= await ModelRuntime.create({
      authPath: path.join(this.storageRoot, 'auth.json'),
      modelsPath,
      modelsStorePath: path.join(this.storageRoot, 'models-cache.json'),
    });
    const settingsManager = SettingsManager.create(process.cwd(), this.storageRoot, {
      projectTrusted: false,
    });
    if (!settingsManager.getGlobalSettings().compaction) {
      settingsManager.setCompactionEnabled(true);
    }
    this.settingsManager = settingsManager;
    const resourceLoader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir: this.storageRoot,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: FORM0_AI_SYSTEM_PROMPT,
    });
    await resourceLoader.reload();
    const startingFresh = this.startFresh;
    const sessionManager = startingFresh
      ? SessionManager.create(process.cwd(), sessionsRoot)
      : SessionManager.continueRecent(process.cwd(), sessionsRoot);
    const sessionFile = sessionManager.getSessionFile();
    if (sessionFile && !(await fs.pathExists(sessionFile))) {
      const handle = await fs.open(sessionFile, 'wx', 0o600);
      await fs.close(handle);
      sessionManager.setSessionFile(sessionFile);
    }
    this.startFresh = false;
    const result = await createAgentSession({
      cwd: process.cwd(),
      agentDir: this.storageRoot,
      modelRuntime: this.modelRuntime,
      model: this.model,
      noTools: 'builtin',
      tools: TOOL_NAMES,
      customTools: this.createTools(),
      resourceLoader,
      sessionManager,
      settingsManager,
    });
    this.session = result.session;
    this.model = result.session.model || null;
    this.modelFallbackMessage = result.modelFallbackMessage?.split('\n')[0] || null;
    if (startingFresh && this.model) await this.session.setModel(this.model);
    await this.refreshStoredContext();
    await this.hardenFiles();
    return this;
  }

  createTools() {
    return [
      {
        name: TOOL_NAMES[0],
        label: 'Inspect form0 authoring context',
        description: 'Return the installed form0 capabilities and complete current draft schema.',
        parameters: Type.Object({}),
        execute: async () =>
          textResult(
            form0Core.getFormAuthoringContext({ schema: this.workspace.getCurrentSchema() })
          ),
      },
      {
        name: TOOL_NAMES[1],
        label: 'Propose form0 mutations',
        description:
          'Validate and stage one coherent semantic mutation batch. Never writes a file.',
        parameters: Type.Object({
          summary: Type.String(),
          baseRevision: Type.String(),
          operations: Type.Array(Type.Object({}, { additionalProperties: true })),
        }),
        execute: async (_id, params) => {
          try {
            const result = this.workspace.stage(params);
            if (result.valid) {
              await this.workspace.preview();
              await this.refreshStoredContext();
            }
            return textResult(result, !result.valid);
          } catch (error) {
            return textResult({ valid: false, error: error.message }, true);
          }
        },
      },
      {
        name: TOOL_NAMES[2],
        label: 'Read form0 documentation',
        description:
          'Search supplementary, untrusted Markdown documentation from docs.form0.dev only.',
        parameters: Type.Object({ query: Type.String() }),
        execute: async (_id, { query }) => {
          try {
            return textResult(await this.docsClient.search(query));
          } catch (error) {
            return textResult({ offline: true, error: error.message }, true);
          }
        },
      },
    ];
  }

  async hardenFiles() {
    for (const name of ['auth.json', 'models.json', 'models-cache.json', 'settings.json']) {
      const file = path.join(this.storageRoot, name);
      if (await fs.pathExists(file)) await fs.chmod(file, 0o600);
    }
    const sessionFile = this.session?.sessionFile;
    if (sessionFile && (await fs.pathExists(sessionFile))) await fs.chmod(sessionFile, 0o600);
  }

  getCloudPolicy() {
    return form0Core.getFormAICloudPolicy(this.workspace.getCurrentSchema());
  }

  isCloudProvider(provider = this.model?.provider) {
    return provider ? !LOCAL_PROVIDERS.has(provider.toLowerCase()) : true;
  }

  async listProviders() {
    return this.modelRuntime.getProviders().map((provider) => ({
      id: provider.id,
      name: provider.name || provider.id,
      authTypes: Object.keys(provider.auth),
      auth: this.modelRuntime.getProviderAuthStatus(provider.id),
      models: this.modelRuntime.getModels(provider.id).map((model) => model.id),
    }));
  }

  async refreshModels(providers) {
    try {
      const result = await this.modelRuntime.refresh({
        ...(providers ? { providers } : {}),
        allowNetwork: true,
      });
      return {
        aborted: result.aborted,
        errors: [...result.errors].map(([provider, error]) => ({
          provider,
          message: error instanceof Error ? error.message : String(error),
        })),
      };
    } catch (error) {
      return {
        aborted: false,
        errors: [
          {
            provider: providers?.length === 1 ? providers[0] : 'provider',
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    } finally {
      await this.hardenFiles();
    }
  }

  getSavedModelReference() {
    const provider = this.settingsManager?.getDefaultProvider();
    const model = this.settingsManager?.getDefaultModel();
    return provider && model ? `${provider}/${model}` : null;
  }

  getStatus() {
    const policy = this.getCloudPolicy();
    const proposal = this.workspace.getPendingProposal();
    const authentications = this.modelRuntime
      .getProviders()
      .map((provider) => {
        const status = this.modelRuntime.getProviderAuthStatus(provider.id);
        if (!status.configured) return null;
        return {
          provider: provider.id,
          type: this.modelRuntime.isUsingOAuth(provider.id) ? 'oauth' : 'api_key',
          source: status.source || 'configured',
          label: status.label || null,
          subscription: this.modelRuntime.isUsingSubscription(provider.id),
        };
      })
      .filter(Boolean);

    return {
      schemaPath: this.workspace.schemaPath,
      draft: proposal ? { operationCount: proposal.operations.length } : null,
      selectedModel: this.model ? { provider: this.model.provider, id: this.model.id } : null,
      authentications,
      cloudPolicy: {
        allowCloud: policy.allowCloud,
        requiresConsent: policy.requiresConsent,
      },
      conversation: this.session?.sessionFile ? 'persisted' : 'in-memory',
    };
  }

  takeModelFallbackMessage() {
    const message = this.modelFallbackMessage;
    this.modelFallbackMessage = null;
    return message;
  }

  async login(provider, type, interaction) {
    const credential = await this.modelRuntime.login(provider, type, interaction);
    await this.hardenFiles();
    return credential;
  }

  async selectModel(reference) {
    const separator = reference.indexOf('/');
    if (separator < 1) throw new Error('Use <provider>/<model>');
    const provider = reference.slice(0, separator);
    const modelId = reference.slice(separator + 1);
    if (this.isCloudProvider(provider) && !this.getCloudPolicy().allowCloud) {
      throw new Error('Cloud AI is disabled by this form schema');
    }
    let model = this.modelRuntime.getModel(provider, modelId);
    if (!model) {
      await this.refreshModels([provider]);
      model = this.modelRuntime.getModel(provider, modelId);
    }
    if (!model) throw new Error(`Unknown model: ${reference}`);
    await this.session.setModel(model, { persist: true });
    await this.settingsManager?.flush();
    await this.hardenFiles();
    this.model = model;
    return model;
  }

  buildPrompt(request) {
    const context = form0Core.getFormAuthoringContext({
      schema: this.workspace.getCurrentSchema(),
    });
    return `<form0-authoring-context authority="installed-core">\n${JSON.stringify(context)}\n</form0-authoring-context>\n<user-request>\n${request}\n</user-request>`;
  }

  async refreshStoredContext() {
    if (!this.session) return;
    const context = form0Core.getFormAuthoringContext({
      schema: this.workspace.getCurrentSchema(),
    });
    await this.session.sendCustomMessage(
      {
        customType: 'form0-authoring-context',
        content: `<form0-authoring-context authority="installed-core">\n${JSON.stringify(context)}\n</form0-authoring-context>`,
        display: false,
      },
      { triggerTurn: false }
    );
  }

  preflight(request) {
    if (!this.model)
      throw new Error(
        'No model is selected. Use /model <provider>/<model>; use /providers and /login first if needed.'
      );
    const prompt = this.buildPrompt(request);
    const estimatedTokens = Math.ceil(prompt.length / 4) + 8192;
    if (estimatedTokens > this.model.contextWindow) {
      throw new Error(
        `The complete form requires about ${estimatedTokens} tokens, above this model's ${this.model.contextWindow}-token context window`
      );
    }
    if (this.isCloudProvider() && !this.getCloudPolicy().allowCloud) {
      throw new Error('Cloud AI is disabled by this form schema; select a local model');
    }
    return prompt;
  }

  async prompt(request) {
    const firstResponseIndex = this.session.messages.length;
    await this.session.prompt(this.preflight(request));
    await this.session.waitForIdle();
    await this.hardenFiles();
    return assistantResponse(this.session.messages.slice(firstResponseIndex));
  }

  async abort() {
    await this.session?.abort();
  }

  async newConversation({ clearStored = false } = {}) {
    this.session?.dispose();
    const sessionDir = path.join(this.storageRoot, 'sessions', this.sessionKey);
    if (clearStored) await fs.emptyDir(sessionDir);
    this.session = null;
    this.startFresh = true;
    await this.initialize();
  }

  async adoptSchemaPath() {
    if (!this.workspace.schemaPath) return;
    const nextKey = schemaSessionKey(this.workspace.schemaPath);
    if (nextKey === this.sessionKey) return;
    const oldDir = path.join(this.storageRoot, 'sessions', this.sessionKey);
    const nextDir = path.join(this.storageRoot, 'sessions', nextKey);
    this.session?.dispose();
    if ((await fs.pathExists(oldDir)) && !(await fs.pathExists(nextDir))) {
      await fs.move(oldDir, nextDir);
    }
    this.session = null;
    this.sessionKey = nextKey;
    this.startFresh = false;
    await this.initialize();
  }

  async dispose() {
    if (this.session?.isStreaming) await this.session.abort();
    this.session?.dispose();
    await this.hardenFiles();
  }
}

export { discoverOllamaModels, LOCAL_PROVIDERS, ollamaModelsConfig, TOOL_NAMES };
