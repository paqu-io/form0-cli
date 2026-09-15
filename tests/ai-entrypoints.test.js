import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandHandler } from '../src/commands/interactive/command-handler.js';
import {
  AI_HELP_COMMANDS,
  AIManager,
  formatAIHelpLines,
  formatAIStatusLines,
  formatAuthPrompt,
} from '../src/commands/interactive/managers/ai-manager.js';
import { ShellCore } from '../src/commands/interactive/shell-core.js';

function plain(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

test('shell prompt composes server and AI state', () => {
  const shell = new ShellCore({}, {}, { cleanup() {} });
  shell.serverManager = { isServerRunning: () => true };
  shell.aiMode = true;
  assert.equal(plain(shell.getPromptString()), 'form0(server,ai)> ');
  shell.aiBusy = true;
  assert.equal(plain(shell.getPromptString()), 'form0(server,ai,busy)> ');
});

test('AI entry is allowed with a running server and active mode owns input', async () => {
  const inputs = [];
  const aiManager = {
    isActive: () => true,
    handleCommand: async (input) => inputs.push(input),
  };
  const handler = new CommandHandler(
    {},
    {},
    {},
    { isServerRunning: () => true },
    {},
    null,
    null,
    aiManager
  );
  assert.equal(handler.isCommandAllowedInServerMode('ai', []).allowed, true);
  await handler.handleCommand('Add a total');
  assert.deepEqual(inputs, ['Add a total']);
});

test('AI help descriptions use one aligned column', () => {
  const lines = formatAIHelpLines();
  const descriptionColumns = lines.map((line, index) => line.indexOf(AI_HELP_COMMANDS[index][1]));
  assert.equal(new Set(descriptionColumns).size, 1);
  assert.ok(AI_HELP_COMMANDS.every(([, description]) => description.length > 0));
});

test('authentication prompts do not duplicate trailing punctuation', () => {
  assert.equal(
    formatAuthPrompt('Select OpenAI Codex login method:'),
    'Select OpenAI Codex login method: '
  );
  assert.equal(formatAuthPrompt('API key'), 'API key: ');
  assert.equal(formatAuthPrompt('Continue?'), 'Continue? ');
});

test('browser authentication cancels the pending manual-code prompt', async () => {
  const controller = new AbortController();
  const output = [];
  const manager = new AIManager(
    {},
    {},
    {},
    {
      output: { write: (value) => output.push(value) },
      question: (_question, _options, _callback) => {},
    },
    {}
  );

  const pending = manager.authInteraction().prompt({
    type: 'manual_code',
    message: 'Complete login in your browser, or paste the authorization code here:',
    signal: controller.signal,
  });
  controller.abort();

  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(output, ['\n']);
});

test('AI status identifies the selected model and configured authentication', () => {
  const lines = formatAIStatusLines({
    schemaPath: '/project/order.json',
    draft: { operationCount: 2 },
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
    activity: 'processing',
    queuedRequestCount: 2,
  });

  assert.ok(lines.some((line) => line.includes('Draft:') && line.includes('2 operation(s)')));
  assert.ok(lines.some((line) => line.includes('Provider:') && line.includes('openai-codex')));
  assert.ok(lines.some((line) => line.includes('Model:') && line.includes('gpt-5.6-luna')));
  assert.ok(lines.some((line) => line.includes('Activity:') && line.includes('processing')));
  assert.ok(lines.some((line) => line.includes('Queued follow-ups:') && line.endsWith('2')));
  assert.ok(lines.includes('    openai-codex  oauth (stored, subscription) [selected]'));
});

test('/status and /model without arguments report the current selection', async (context) => {
  const output = [];
  context.mock.method(console, 'log', (value) => output.push(plain(String(value))));
  const manager = new AIManager({}, {}, {}, {}, {});
  manager.agent = {
    model: { provider: 'openai-codex', id: 'gpt-5.6-luna' },
    getStatus: () => ({
      schemaPath: null,
      draft: null,
      selectedModel: { provider: 'openai-codex', id: 'gpt-5.6-luna' },
      authentications: [],
      cloudPolicy: { allowCloud: true, requiresConsent: false },
      conversation: 'persisted',
    }),
  };

  await manager.handleCommand('/status');
  await manager.handleCommand('/model');

  assert.ok(output.some((line) => line.includes('AI authoring status')));
  assert.ok(output.includes('Current model: openai-codex/gpt-5.6-luna'));
});

test('messages submitted while AI is busy run later in FIFO order', async (context) => {
  context.mock.method(console, 'log', () => {});
  let releaseFirst;
  const firstPending = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const prompts = [];
  const busyStates = [];
  const manager = new AIManager(
    {},
    {},
    {},
    { terminal: false },
    {
      setAIBusy: (busy) => busyStates.push(busy),
      prompt: () => {},
    }
  );
  manager.workspace = { getPendingProposal: () => null };
  manager.agent = {
    model: { provider: 'ollama', id: 'local-model' },
    isCloudProvider: () => false,
    prompt: async (request) => {
      prompts.push(request);
      if (request === 'first') await firstPending;
      return `response:${request}`;
    },
  };

  const processing = manager.handleCommand('first');
  await new Promise((resolve) => setImmediate(resolve));
  await manager.handleCommand('second');
  await manager.handleCommand('third');
  assert.deepEqual(prompts, ['first']);
  assert.deepEqual(manager.queuedRequests, ['second', 'third']);

  releaseFirst();
  await processing;

  assert.deepEqual(prompts, ['first', 'second', 'third']);
  assert.deepEqual(busyStates, [true, false]);
  assert.equal(manager.isBusy(), false);
});

test('state-changing AI commands are blocked while processing', async () => {
  const manager = new AIManager({}, {}, {}, {}, {});
  manager.busy = true;
  await assert.rejects(manager.handleCommand('/model openai/example'), /unavailable while busy/);
});

test('/cancel aborts the active request and clears queued follow-ups', async (context) => {
  const output = [];
  context.mock.method(console, 'log', (value) => output.push(plain(String(value))));
  let rejectPrompt;
  const manager = new AIManager(
    {},
    {},
    {},
    { terminal: false },
    { setAIBusy: () => {}, prompt: () => {} }
  );
  manager.workspace = { getPendingProposal: () => null };
  manager.agent = {
    model: { provider: 'ollama', id: 'local-model' },
    isCloudProvider: () => false,
    prompt: () =>
      new Promise((_resolve, reject) => {
        rejectPrompt = reject;
      }),
    abort: async () => rejectPrompt(new Error('aborted')),
  };

  const processing = manager.handleCommand('first');
  await new Promise((resolve) => setImmediate(resolve));
  await manager.handleCommand('queued');
  await manager.handleCommand('/cancel');
  await processing;

  assert.deepEqual(manager.queuedRequests, []);
  assert.equal(manager.isBusy(), false);
  assert.ok(output.includes('[AI] Cancelling request…'));
  assert.ok(output.includes('[AI] Request cancelled; queued follow-ups cleared.'));
  assert.ok(!output.some((line) => line.startsWith('❌')));
});
