import path from 'node:path';
import { clearLine, cursorTo } from 'node:readline';
import fs from 'fs-extra';
import { colors } from '../../../utils/theme.js';
import { confirmOverwrite } from '../../schema.js';
import { formatSchemaPreviewLines } from '../../../utils/display-utils.js';
import { PlainAIConsole } from '../../../ai/console.js';
import { formatSchemaDiffLines } from '../../../ai/diff-format.js';
import { AISchemaWorkspace, createEmptyFormSchema } from '../../../ai/schema-workspace.js';
import { Form0PiSession } from '../../../ai/pi-session.js';

const AI_HELP_COMMANDS = [
  ['/status', 'Show the current AI authoring status'],
  ['/providers', 'List providers and authentication methods'],
  ['/models <provider>', 'List model identifiers for one provider'],
  ['/login [provider] [method]', 'Authenticate with a provider'],
  ['/model [provider/model]', 'Pick or explicitly select the active model'],
  ['/privacy', 'Explain the effective schema policy'],
  ['/preview, p, preview', 'Preview the working form'],
  ['/json', 'Show the working schema as JSON'],
  ['/diff [--pending]', 'Show cumulative or pending changes'],
  ['/apply [schema-path]', 'Atomically save the approved batch'],
  ['/discard, /undo', 'Discard a draft or stage the last saved version'],
  ['/new, /clear', 'Start a conversation or delete its stored history'],
  ['/cancel', 'Cancel processing and clear queued follow-ups'],
  ['/exit', 'Return to the form0 shell'],
];

const COMMANDS_ALLOWED_WHILE_BUSY = new Set(['help', 'status', 'privacy', 'cancel']);

function formatAIHelpLines(commands = AI_HELP_COMMANDS) {
  const commandWidth = Math.max(...commands.map(([command]) => command.length));
  return commands.map(
    ([command, description]) => `  ${command.padEnd(commandWidth + 2)}${description}`
  );
}

function formatAuthPrompt(message) {
  const label = String(message || 'Value').trimEnd();
  return /[:?!]$/.test(label) ? `${label} ` : `${label}: `;
}

function formatAIStatusLines(status) {
  const model = status.selectedModel;
  const cloudPolicy = !status.cloudPolicy.allowCloud
    ? 'blocked'
    : status.cloudPolicy.requiresConsent
      ? 'allowed (explicit consent required)'
      : 'allowed';
  const facts = [
    ['Schema', status.schemaPath || 'unsaved'],
    ['Draft', status.draft ? `pending (${status.draft.operationCount} operation(s))` : 'none'],
    ['Provider', model?.provider || 'not selected'],
    ['Model', model?.id || 'not selected'],
    ['Cloud policy', cloudPolicy],
    ['Conversation', status.conversation],
    ['Activity', status.activity],
    ['Queued follow-ups', status.queuedRequestCount],
  ];
  const labelWidth = Math.max(...facts.map(([label]) => label.length));
  const lines = facts.map(([label, value]) => `  ${`${label}:`.padEnd(labelWidth + 3)}${value}`);
  if (status.authentications.length === 0) {
    lines.push(`  ${'Authentication:'.padEnd(labelWidth + 3)}none configured`);
    return lines;
  }
  lines.push('  Authentication:');
  const providerWidth = Math.max(...status.authentications.map(({ provider }) => provider.length));
  for (const authentication of status.authentications) {
    const details = [
      authentication.source,
      authentication.label,
      authentication.subscription ? 'subscription' : null,
    ].filter(Boolean);
    const selected = authentication.provider === model?.provider ? ' [selected]' : '';
    lines.push(
      `    ${authentication.provider.padEnd(providerWidth + 2)}${authentication.type} (${details.join(', ')})${selected}`
    );
  }
  return lines;
}

function yes(value) {
  return /^(y|yes)$/i.test(String(value || '').trim());
}

export class AIManager {
  constructor(schemaManager, engineRunner, serverManager, readline, shell, options = {}) {
    this.schemaManager = schemaManager;
    this.engineRunner = engineRunner;
    this.serverManager = serverManager;
    this.readline = readline;
    this.shell = shell;
    this.sessionFactory = options.sessionFactory || ((input) => new Form0PiSession(input));
    this.presentation = options.presentation || new PlainAIConsole({ readline });
    this.active = false;
    this.workspace = null;
    this.agent = null;
    this.cloudConsentProvider = null;
    this.busy = false;
    this.queuedRequests = [];
    this.cancelRequested = false;
  }

  isActive() {
    return this.active;
  }

  write(message, tone) {
    this.presentation.write(message, tone ? { tone } : undefined);
  }

  writeLines(lines) {
    this.presentation.writeLines(lines);
  }

  async enter() {
    if (this.active) return;
    this.workspace = new AISchemaWorkspace({
      schema: this.schemaManager.getCurrentSchema() || createEmptyFormSchema(),
      schemaPath: this.schemaManager.getCurrentSchemaPath(),
      onPreview: async (schema, meta) => this.serverManager.previewSchema(schema, meta),
      onCommit: async (_schema, schemaPath) => {
        await this.schemaManager.loadSchema(schemaPath);
        this.engineRunner.resetEngine();
        this.serverManager.updateDevServerSchema();
      },
    });
    this.agent = this.sessionFactory({ workspace: this.workspace });
    try {
      await this.agent.initialize();
      this.active = true;
      this.shell.setAIMode(true);
      this.write('[PREVIEW] form0 AI authoring', 'header');
      this.write('The complete form schema is supplied to the selected model.', 'muted');
      this.write('Type a request, or /help for AI commands.', 'muted');
      const fallback = this.agent.takeModelFallbackMessage?.();
      if (fallback) this.write(`[AI] ${fallback}`, 'warning');
    } catch (error) {
      await this.agent?.dispose?.();
      this.active = false;
      this.shell.setAIMode(false);
      throw error;
    }
  }

  async exit() {
    if (this.workspace) await this.workspace.discard();
    await this.agent?.dispose();
    this.busy = false;
    this.queuedRequests = [];
    this.cancelRequested = false;
    this.active = false;
    this.shell.setAIMode(false);
    console.log(colors.success('Exited AI authoring mode.'));
  }

  async dispose() {
    await this.agent?.dispose();
    this.busy = false;
    this.queuedRequests = [];
    this.active = false;
  }

  isBusy() {
    return this.busy;
  }

  clearPromptLine() {
    if (!this.readline?.terminal || !this.readline.output) return;
    clearLine(this.readline.output, 0);
    cursorTo(this.readline.output, 0);
  }

  async ask(message, { signal, type = 'text', options = [] } = {}) {
    return this.presentation.prompt({ message: formatAuthPrompt(message), signal, type, options });
  }

  authInteraction() {
    return {
      prompt: async (prompt) =>
        this.ask(prompt.message || prompt.label, {
          signal: prompt.signal,
          type: prompt.type === 'manual_code' ? 'text' : prompt.type,
          options: prompt.options,
        }),
      notify: (event) => {
        const message = event.message || event.url || JSON.stringify(event);
        this.write(message, 'muted');
      },
    };
  }

  showHelp() {
    this.write('AI authoring commands', 'header');
    this.writeLines(formatAIHelpLines().map((line) => colors.text(line)));
  }

  showPrivacy() {
    const policy = this.agent.getCloudPolicy();
    const lines = [
      '  Complete schema sent: yes',
      `  Cloud providers: ${policy.allowCloud ? 'allowed' : 'blocked'}`,
      `  Explicit consent: ${policy.requiresConsent ? 'required' : 'covered by provider selection'}`,
      ...[...policy.cloudBlockers, ...policy.consentReasons].map(
        (blocker) => `  - ${blocker.scope}${blocker.key ? ` (${blocker.key})` : ''}`
      ),
      '  Credentials and sessions: ~/.form0-cli/ai (user-only permissions)',
    ];
    this.write('Effective AI privacy policy', 'header');
    this.writeLines(lines);
  }

  showStatus() {
    this.write('AI authoring status', 'header');
    this.writeLines(
      formatAIStatusLines({
        ...this.agent.getStatus(),
        activity: this.busy ? 'processing' : 'idle',
        queuedRequestCount: this.queuedRequests.length,
      }).map((line) => colors.text(line))
    );
  }

  queueRequest(request) {
    this.queuedRequests.push(request);
    this.write(`Queued follow-up (${this.queuedRequests.length} pending).`, 'muted');
  }

  async processRequestQueue(initialRequest) {
    this.busy = true;
    this.cancelRequested = false;
    this.shell.setAIBusy(true);
    let request = initialRequest;
    try {
      while (request) {
        if (!(await this.ensureCloudConsent())) {
          this.queuedRequests = [];
          return;
        }
        this.write(`› ${request}`, 'accent');
        const model = this.agent.model;
        const modelReference = model ? ` with ${model.provider}/${model.id}` : '';
        this.write(`[AI] Thinking${modelReference}…`, 'muted');
        this.shell.prompt?.();
        const response = await this.agent.prompt(request);
        this.clearPromptLine();
        if (this.cancelRequested) {
          this.write('[AI] Request cancelled; queued follow-ups cleared.', 'warning');
          return;
        }
        if (response) this.write(response);
        request = this.queuedRequests.shift();
      }
      if (this.workspace.getPendingProposal()) {
        this.write(
          'Proposal ready: /preview, /diff, /apply, /discard, or ask for a revision.',
          'accent'
        );
      }
    } catch (error) {
      this.clearPromptLine();
      this.queuedRequests = [];
      if (this.cancelRequested) {
        this.write('[AI] Request cancelled; queued follow-ups cleared.', 'warning');
        return;
      }
      throw error;
    } finally {
      this.busy = false;
      this.cancelRequested = false;
      this.shell.setAIBusy(false);
    }
  }

  cancelProcessing() {
    if (!this.busy) {
      this.write('No AI request is currently processing.', 'muted');
      return;
    }
    this.cancelRequested = true;
    this.queuedRequests = [];
    this.write('[AI] Cancelling request…', 'warning');
    void this.agent.abort().catch((error) => {
      this.cancelRequested = false;
      this.write(`❌ Could not cancel AI request: ${error.message}`, 'error');
    });
  }

  async ensureCloudConsent() {
    if (!this.agent.isCloudProvider()) return true;
    const policy = this.agent.getCloudPolicy();
    if (!policy.allowCloud) throw new Error('Cloud AI is disabled by this form schema');
    const provider = this.agent.model?.provider;
    if (!policy.requiresConsent || this.cloudConsentProvider === provider) return true;
    const answer = await this.ask(
      `Send the complete schema to ${provider} for this session? (y/N)`
    );
    if (!yes(answer)) return false;
    this.cloudConsentProvider = provider;
    return true;
  }

  async apply(args) {
    if (!this.workspace.getPendingProposal()) throw new Error('There is no pending AI proposal');
    const wasUnsaved = !this.workspace.schemaPath;
    let target = args[0] || this.workspace.schemaPath;
    if (!target) target = (await this.ask('Schema path [form.schema.json]')) || 'form.schema.json';
    target = path.resolve(target);
    if (!this.workspace.schemaPath && (await fs.pathExists(target))) {
      const allowed = await confirmOverwrite(target, { readlineInterface: this.readline });
      if (!allowed) return;
    }
    await this.workspace.apply({ schemaPath: target });
    if (wasUnsaved) await this.agent.adoptSchemaPath();
    this.write(`Applied AI proposal to ${target}`, 'success');
  }

  async selectModelInteractive() {
    const providers = await this.agent.listProviders();
    const current = this.agent.model ? `${this.agent.model.provider}/${this.agent.model.id}` : null;
    const items = providers.flatMap((provider) =>
      provider.models.map((model) => {
        const value = `${provider.id}/${model}`;
        const availability = provider.auth?.configured
          ? provider.auth.source || 'authenticated'
          : provider.authTypes.length > 0
            ? `login: ${provider.authTypes.join('/')}`
            : 'ambient authentication';
        return {
          value,
          label: `${value}${value === current ? ' (current)' : ''}`,
          description: `${provider.name} · ${availability}`,
        };
      })
    );
    const saved = this.agent.getSavedModelReference?.();
    if (saved && !items.some((item) => item.value === saved)) {
      items.unshift({
        value: saved,
        label: `${saved} (saved, unavailable)`,
        description: 'Authenticate the provider or restore its model configuration',
      });
    }
    if (items.length === 0) throw new Error('No models are currently available');
    const reference = await this.presentation.select({ title: 'Select a model', items });
    if (!reference) return null;
    return this.selectModel(reference);
  }

  async loginInteractive(providerId, authType) {
    const providers = await this.agent.listProviders();
    let provider = providers.find((entry) => entry.id === providerId);
    if (providerId && !provider) throw new Error(`Unknown provider: ${providerId}`);
    if (!provider) {
      const loginProviders = providers.filter((entry) => entry.authTypes.length > 0);
      if (loginProviders.length === 0) throw new Error('No providers offer interactive login');
      const selectedProvider = await this.presentation.select({
        title: 'Select an AI provider',
        items: loginProviders.map((entry) => ({
          value: entry.id,
          label: entry.name,
          description: entry.auth?.configured ? 'configured' : entry.authTypes.join(' / '),
        })),
      });
      if (!selectedProvider) return null;
      provider = providers.find((entry) => entry.id === selectedProvider);
    }
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    if (authType && !provider.authTypes.includes(authType)) {
      throw new Error(
        `Unsupported authentication method for ${provider.id}: ${authType} (use ${provider.authTypes.join(' or ')})`
      );
    }
    if (!authType) {
      authType = await this.presentation.select({
        title: `Authenticate with ${provider.name}`,
        items: provider.authTypes.map((type) => ({
          value: type,
          label: type === 'api_key' ? 'API key' : type,
          description: type === 'api_key' ? 'Stored privately and never echoed' : undefined,
        })),
      });
    }
    if (!authType) return null;
    await this.agent.login(provider.id, authType, this.authInteraction());
    this.write(`Authenticated ${provider.id}. Select a model with /model.`, 'success');
    return provider.id;
  }

  async selectModel(reference) {
    const previous = this.agent.model?.provider;
    const model = await this.agent.selectModel(reference);
    if (model.provider !== previous) this.cloudConsentProvider = null;
    this.write(`Selected ${model.provider}/${model.id}`, 'success');
    return model;
  }

  async handleCommand(input) {
    const normalized = input.trim();
    if (normalized === 'p' || normalized === 'preview') return this.handleCommand('/preview');
    const [rawCommand, ...args] = normalized.split(/\s+/);
    const command = rawCommand.startsWith('/') ? rawCommand.slice(1).toLowerCase() : null;
    if (!command) {
      if (this.busy) this.queueRequest(input);
      else await this.processRequestQueue(input);
      return;
    }
    if (this.busy && !COMMANDS_ALLOWED_WHILE_BUSY.has(command)) {
      throw new Error(
        `AI is processing. Wait for it to finish or use /cancel; ${rawCommand} is unavailable while busy.`
      );
    }
    switch (command) {
      case 'help':
        this.showHelp();
        break;
      case 'status':
        this.showStatus();
        break;
      case 'privacy':
        this.showPrivacy();
        break;
      case 'providers': {
        const providers = await this.agent.listProviders();
        this.writeLines(
          providers.map((provider) => {
            const auth = provider.auth?.configured
              ? 'configured'
              : provider.authTypes.join('/') || 'ambient';
            return `${provider.id}: ${provider.models.length} model(s), ${auth}`;
          })
        );
        break;
      }
      case 'models': {
        if (!args[0]) throw new Error('Usage: /models <provider>');
        const provider = (await this.agent.listProviders()).find((entry) => entry.id === args[0]);
        if (!provider) throw new Error(`Unknown provider: ${args[0]}`);
        this.writeLines(
          provider.models.length > 0 ? provider.models : ['No models currently known.']
        );
        break;
      }
      case 'login':
        await this.loginInteractive(args[0], args[1]);
        break;
      case 'model':
        if (args[0]) await this.selectModel(args[0]);
        else await this.selectModelInteractive();
        break;
      case 'preview':
        this.writeLines(formatSchemaPreviewLines(this.workspace.getCurrentSchema()));
        break;
      case 'json':
        this.writeLines(JSON.stringify(this.workspace.getCurrentSchema(), null, 2).split('\n'));
        break;
      case 'diff': {
        if (args.length > 0 && (args.length !== 1 || args[0] !== '--pending')) {
          throw new Error('Usage: /diff [--pending]');
        }
        const pendingOnly = args[0] === '--pending';
        this.writeLines(
          formatSchemaDiffLines(
            pendingOnly ? this.workspace.getPendingDiff() : this.workspace.getCumulativeDiff(),
            pendingOnly ? 'Pending' : 'Cumulative'
          )
        );
        break;
      }
      case 'apply':
        await this.apply(args);
        break;
      case 'discard':
        await this.workspace.discard();
        this.write('Discarded AI proposal.', 'success');
        break;
      case 'undo':
        await this.workspace.undo();
        await this.workspace.preview();
        this.write('Undo staged; inspect it and use /apply to confirm.', 'warning');
        break;
      case 'new':
        await this.agent.newConversation();
        this.write('Started a new conversation.', 'success');
        break;
      case 'clear':
        await this.agent.newConversation({ clearStored: true });
        this.write('Removed stored conversation history.', 'success');
        break;
      case 'cancel':
        this.cancelProcessing();
        break;
      case 'exit':
      case 'quit':
      case 'q':
        await this.exit();
        break;
      default:
        throw new Error(`Unknown AI command: /${command}`);
    }
  }
}

export { AI_HELP_COMMANDS, formatAIHelpLines, formatAIStatusLines, formatAuthPrompt };
