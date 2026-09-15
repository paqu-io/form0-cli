import path from 'node:path';
import { clearLine, cursorTo } from 'node:readline';
import fs from 'fs-extra';
import { colors } from '../../../utils/theme.js';
import { confirmOverwrite } from '../../schema.js';
import { AISchemaWorkspace, createEmptyFormSchema } from '../../../ai/schema-workspace.js';
import { Form0PiSession } from '../../../ai/pi-session.js';

const AI_HELP_COMMANDS = [
  ['/status', 'Show the current AI authoring status'],
  ['/providers', 'List providers and authentication methods'],
  ['/models <provider>', 'List model identifiers for one provider'],
  ['/login <provider> <api_key|oauth>', 'Authenticate with a provider'],
  ['/model <provider>/<model>', 'Select the active model'],
  ['/privacy', 'Explain the effective schema policy'],
  ['/preview, /diff', 'Inspect the pending proposal'],
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

function authenticationPromptAbortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('Authentication prompt cancelled');
  error.name = 'AbortError';
  return error;
}

function yes(value) {
  return /^(y|yes)$/i.test(value.trim());
}

export class AIManager {
  constructor(schemaManager, engineRunner, serverManager, readline, shell, options = {}) {
    this.schemaManager = schemaManager;
    this.engineRunner = engineRunner;
    this.serverManager = serverManager;
    this.readline = readline;
    this.shell = shell;
    this.sessionFactory = options.sessionFactory || ((input) => new Form0PiSession(input));
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
    await this.agent.initialize();
    this.busy = false;
    this.queuedRequests = [];
    this.cancelRequested = false;
    this.active = true;
    this.shell.setAIMode(true);
    console.log(colors.header('\n[PREVIEW] form0 AI authoring'));
    console.log(
      colors.textSecondary('The complete form schema is supplied to the selected model.')
    );
    console.log(colors.textSecondary('Type a request, or /help for AI commands.'));
    const fallback = this.agent.takeModelFallbackMessage?.();
    if (fallback) console.log(colors.warning(`[AI] ${fallback}`));
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

  async ask(question, { signal } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(authenticationPromptAbortError(signal));
        return;
      }
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        callback(value);
      };
      const onAbort = () => {
        this.readline.output?.write('\n');
        finish(reject, authenticationPromptAbortError(signal));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      const callback = (answer) => finish(resolve, answer);
      if (signal) this.readline.question(colors.text(question), { signal }, callback);
      else this.readline.question(colors.text(question), callback);
    });
  }

  async askSecret(question, { signal } = {}) {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      return this.ask(question, { signal });
    }
    signal?.throwIfAborted();
    this.readline.pause();
    process.stdout.write(colors.text(question));
    return new Promise((resolve, reject) => {
      let value = '';
      let settled = false;
      const wasRaw = process.stdin.isRaw;
      process.stdin.setRawMode(true);
      process.stdin.resume();
      const finish = (error) => {
        if (settled) return;
        settled = true;
        process.stdin.off('data', onData);
        signal?.removeEventListener('abort', onAbort);
        process.stdin.setRawMode(Boolean(wasRaw));
        this.readline.resume();
        process.stdout.write('\n');
        if (error) reject(error);
        else resolve(value);
      };
      const onAbort = () => finish(authenticationPromptAbortError(signal));
      const onData = (data) => {
        const input = data.toString('utf8');
        if (input === '\u0003') return finish(new Error('Authentication cancelled'));
        if (input === '\r' || input === '\n') return finish();
        if (input === '\u007f') value = value.slice(0, -1);
        else value += input;
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      process.stdin.on('data', onData);
    });
  }

  authInteraction() {
    return {
      prompt: async (prompt) => {
        if (prompt.type === 'select') {
          console.log(prompt.options.map((option) => `  ${option.id}: ${option.label}`).join('\n'));
        }
        const message = formatAuthPrompt(prompt.message || prompt.label);
        const options = { signal: prompt.signal };
        return prompt.type === 'secret'
          ? this.askSecret(message, options)
          : this.ask(message, options);
      },
      notify: (event) => {
        const message = event.message || event.url || JSON.stringify(event);
        console.log(colors.textSecondary(message));
      },
    };
  }

  showHelp() {
    console.log(colors.header('\nAI authoring commands'));
    for (const line of formatAIHelpLines()) console.log(colors.text(line));
  }

  showPrivacy() {
    const policy = this.agent.getCloudPolicy();
    console.log(colors.header('\nEffective AI privacy policy'));
    console.log(`  Complete schema sent: yes`);
    console.log(`  Cloud providers: ${policy.allowCloud ? 'allowed' : 'blocked'}`);
    console.log(
      `  Explicit consent: ${policy.requiresConsent ? 'required' : 'covered by provider selection'}`
    );
    for (const blocker of [...policy.cloudBlockers, ...policy.consentReasons]) {
      console.log(
        colors.textSecondary(`  - ${blocker.scope}${blocker.key ? ` (${blocker.key})` : ''}`)
      );
    }
    console.log(
      colors.textSecondary('Credentials and sessions: ~/.form0-cli/ai (user-only permissions)')
    );
  }

  showStatus() {
    console.log(colors.header('\nAI authoring status'));
    const status = {
      ...this.agent.getStatus(),
      activity: this.busy ? 'processing' : 'idle',
      queuedRequestCount: this.queuedRequests.length,
    };
    for (const line of formatAIStatusLines(status)) console.log(colors.text(line));
  }

  queueRequest(request) {
    this.queuedRequests.push(request);
    console.log(colors.textSecondary(`Queued follow-up (${this.queuedRequests.length} pending).`));
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
        const model = this.agent.model;
        const modelReference = model ? ` with ${model.provider}/${model.id}` : '';
        console.log(colors.textSecondary(`[AI] Thinking${modelReference}…`));
        this.shell.prompt?.();
        const response = await this.agent.prompt(request);
        this.clearPromptLine();
        if (this.cancelRequested) {
          console.log(colors.warning('[AI] Request cancelled; queued follow-ups cleared.'));
          return;
        }
        if (response) console.log(colors.text(response));
        request = this.queuedRequests.shift();
      }
      if (this.workspace.getPendingProposal()) {
        console.log(
          colors.accent1(
            '\nProposal ready: /preview, /diff, /apply, /discard, or ask for a revision.'
          )
        );
      }
    } catch (error) {
      this.clearPromptLine();
      this.queuedRequests = [];
      if (this.cancelRequested) {
        console.log(colors.warning('[AI] Request cancelled; queued follow-ups cleared.'));
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
      console.log(colors.textSecondary('No AI request is currently processing.'));
      return;
    }
    this.cancelRequested = true;
    this.queuedRequests = [];
    console.log(colors.warning('[AI] Cancelling request…'));
    void this.agent.abort().catch((error) => {
      this.cancelRequested = false;
      this.clearPromptLine();
      console.log(colors.error(`❌ Could not cancel AI request: ${error.message}`));
      this.shell.prompt?.();
    });
  }

  async ensureCloudConsent() {
    if (!this.agent.isCloudProvider()) return true;
    const policy = this.agent.getCloudPolicy();
    if (!policy.allowCloud) throw new Error('Cloud AI is disabled by this form schema');
    const provider = this.agent.model?.provider;
    if (!policy.requiresConsent || this.cloudConsentProvider === provider) return true;
    const answer = await this.ask(
      `Send the complete schema to ${provider} for this session? (y/N): `
    );
    if (!yes(answer)) return false;
    this.cloudConsentProvider = provider;
    return true;
  }

  async apply(args) {
    if (!this.workspace.getPendingProposal()) throw new Error('There is no pending AI proposal');
    const wasUnsaved = !this.workspace.schemaPath;
    let target = args[0] || this.workspace.schemaPath;
    if (!target)
      target = (await this.ask('Schema path [form.schema.json]: ')) || 'form.schema.json';
    target = path.resolve(target);
    if (!this.workspace.schemaPath && (await fs.pathExists(target))) {
      const allowed = await confirmOverwrite(target, { readlineInterface: this.readline });
      if (!allowed) return;
    }
    await this.workspace.apply({ schemaPath: target });
    if (wasUnsaved) await this.agent.adoptSchemaPath();
    console.log(colors.success(`Applied AI proposal to ${target}`));
  }

  async handleCommand(input) {
    const [rawCommand, ...args] = input.trim().split(/\s+/);
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
        for (const provider of providers) {
          const auth = provider.auth?.configured
            ? 'configured'
            : provider.authTypes.join('/') || 'ambient';
          console.log(`${provider.id}: ${provider.models.length} model(s), ${auth}`);
        }
        break;
      }
      case 'models': {
        if (!args[0]) throw new Error('Usage: /models <provider>');
        const provider = (await this.agent.listProviders()).find((entry) => entry.id === args[0]);
        if (!provider) throw new Error(`Unknown provider: ${args[0]}`);
        console.log(provider.models.join('\n') || 'No models currently known.');
        break;
      }
      case 'login':
        if (!args[0] || !args[1]) throw new Error('Usage: /login <provider> <api_key|oauth>');
        await this.agent.login(args[0], args[1], this.authInteraction());
        console.log(colors.success(`Authenticated ${args[0]}. Select a model with /model.`));
        break;
      case 'model': {
        if (!args[0]) {
          const model = this.agent.model;
          console.log(
            model
              ? colors.text(`Current model: ${model.provider}/${model.id}`)
              : colors.warning(
                  'No model selected. Use /models <provider>, then /model <provider>/<model>.'
                )
          );
          break;
        }
        const previous = this.agent.model?.provider;
        const model = await this.agent.selectModel(args[0]);
        if (model.provider !== previous) this.cloudConsentProvider = null;
        console.log(colors.success(`Selected ${model.provider}/${model.id}`));
        break;
      }
      case 'preview':
        console.log(JSON.stringify(this.workspace.getCurrentSchema(), null, 2));
        break;
      case 'diff': {
        const proposal = this.workspace.getPendingProposal();
        if (!proposal) throw new Error('There is no pending AI proposal');
        console.log(
          JSON.stringify(
            {
              semantic: proposal.semanticDiff,
              json: proposal.jsonDiff,
              operations: proposal.operations,
            },
            null,
            2
          )
        );
        break;
      }
      case 'apply':
        await this.apply(args);
        break;
      case 'discard':
        await this.workspace.discard();
        console.log(colors.success('Discarded AI proposal.'));
        break;
      case 'undo':
        await this.workspace.undo();
        await this.workspace.preview();
        console.log(colors.warning('Undo staged; inspect it and use /apply to confirm.'));
        break;
      case 'new':
        await this.agent.newConversation();
        console.log(colors.success('Started a new conversation.'));
        break;
      case 'clear':
        await this.agent.newConversation({ clearStored: true });
        console.log(colors.success('Removed stored conversation history.'));
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
