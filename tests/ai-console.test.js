import test from 'node:test';
import assert from 'node:assert/strict';
import { AIManager } from '../src/commands/interactive/managers/ai-manager.js';
import { formatPromptMessage } from '../src/ai/console.js';

test('plain prompts do not duplicate punctuation', () => {
  assert.equal(
    formatPromptMessage('Discard the unapplied proposal and exit AI mode? (y/N)'),
    'Discard the unapplied proposal and exit AI mode? (y/N) '
  );
  assert.equal(formatPromptMessage('Schema path'), 'Schema path: ');
});

function createPresentation({ selections = [], promptValue = '' } = {}) {
  const events = { output: [], prompts: [] };
  return {
    events,
    write(value) {
      events.output.push(String(value));
    },
    writeLines(lines) {
      events.output.push(...lines.map(String));
    },
    async select() {
      return selections.shift() ?? null;
    },
    async prompt(options) {
      events.prompts.push(options);
      return promptValue;
    },
  };
}

test('/login uses provider and method selection and keeps API keys out of output', async () => {
  const secret = 'test-only-secret';
  const presentation = createPresentation({
    selections: ['openai', 'api_key'],
    promptValue: secret,
  });
  const manager = new AIManager({}, {}, {}, {}, {}, { presentation });
  const refreshCalls = [];
  manager.agent = {
    listProviders: async () => [
      {
        id: 'openai',
        name: 'OpenAI',
        authTypes: ['api_key'],
        auth: { configured: false },
        models: ['example'],
      },
    ],
    login: async (_provider, _type, interaction) => {
      assert.equal(await interaction.prompt({ type: 'secret', message: 'API key' }), secret);
    },
    refreshModels: async (providers) => {
      refreshCalls.push(providers);
      return { aborted: false, errors: [] };
    },
  };

  await manager.handleCommand('/login');

  assert.equal(presentation.events.prompts[0].type, 'secret');
  assert.equal(
    presentation.events.output.some((line) => line.includes(secret)),
    false
  );
  assert.equal(
    presentation.events.output.includes('Authenticated openai. Select a model with /model.'),
    true
  );
  assert.deepEqual(refreshCalls, [['openai']]);
});

test('/models preserves cached models and warns when live catalog refresh fails', async () => {
  const presentation = createPresentation();
  const manager = new AIManager({}, {}, {}, {}, {}, { presentation });
  const refreshCalls = [];
  manager.agent = {
    listProviders: async () => [
      {
        id: 'openai',
        name: 'OpenAI',
        authTypes: ['api_key'],
        auth: { configured: true },
        models: ['cached-model'],
      },
    ],
    refreshModels: async (providers) => {
      refreshCalls.push(providers);
      return {
        aborted: false,
        errors: [{ provider: 'openai', message: 'catalog unavailable' }],
      };
    },
  };

  await manager.handleCommand('/models openai');

  assert.deepEqual(refreshCalls, [['openai']]);
  assert.ok(
    presentation.events.output.includes(
      'Could not refresh openai models; showing cached models: catalog unavailable'
    )
  );
  assert.ok(presentation.events.output.includes('cached-model'));
});

test('AI lifecycle initializes the session without taking over shell input', async (context) => {
  context.mock.method(console, 'log', () => {});
  const presentation = createPresentation();
  const shellStates = [];
  const manager = new AIManager(
    {
      getCurrentSchema: () => ({ form: { name: 'Lifecycle', description: null, elements: [] } }),
      getCurrentSchemaPath: () => null,
    },
    {},
    { previewSchema: async () => {} },
    {},
    { setAIMode: (value) => shellStates.push(value) },
    {
      presentation,
      sessionFactory: () => ({
        initialize: async () => {},
        dispose: async () => {},
      }),
    }
  );

  await manager.enter();
  await manager.exit();

  assert.deepEqual(shellStates, [true, false]);
  assert.equal(
    presentation.events.output.some((line) => line.includes('Enter AI authoring mode')),
    true
  );
});

test('preview and diff commands render working, cumulative, and pending state', async () => {
  const presentation = createPresentation();
  const manager = new AIManager({}, {}, {}, {}, {}, { presentation });
  manager.workspace = {
    getCurrentSchema: () => ({
      form: {
        name: 'Working draft',
        description: null,
        elements: [{ type: 'TextField', key: 'name', data_name: 'name', label: 'Name' }],
      },
    }),
    getCumulativeDiff: () => [{ path: '$.form.name', before: 'Before', after: 'Working draft' }],
    getPendingDiff: () => [{ path: '$.form.description', before: null, after: 'Pending' }],
  };

  await manager.handleCommand('/preview');
  await manager.handleCommand('/json');
  await manager.handleCommand('/diff');
  await manager.handleCommand('/diff --pending');

  assert.equal(
    presentation.events.output.some((line) => line.includes('Working draft')),
    true
  );
  assert.equal(
    presentation.events.output.some((line) => line.includes('"form"')),
    true
  );
  assert.equal(
    presentation.events.output.some((line) => line.includes('Cumulative changes')),
    true
  );
  assert.equal(
    presentation.events.output.some((line) => line.includes('Pending changes')),
    true
  );
});
