import readline from 'readline';
import { READLINE_CONFIG } from '../../utils/constants.js';
import { showWelcomeBanner } from '../../utils/display-utils.js';
import { completer } from '../../utils/completion-utils.js';
import { loadConfig } from '../../utils/config.js';
import { colors } from '../../utils/theme.js';
import { t } from '../../utils/i18n.js';
import { ServerManager } from './managers/server-manager.js';
import { CommandHandler } from './command-handler.js';
import { resolveProjectConfig } from '../../utils/project-config.js';
import { SchemaEditor } from './managers/schema-editor.js';

/**
 * Manages the interactive shell core functionality
 */
export class ShellCore {
  constructor(schemaManager, engineRunner, fileWatcher) {
    this.schemaManager = schemaManager;
    this.engineRunner = engineRunner;
    this.fileWatcher = fileWatcher;
    this.rl = null;
    this.serverManager = null;
    this.commandHandler = null;
    this.schemaEditor = null;
    this.schemaMode = false;
  }

  /**
   * Initialize the readline interface and managers
   */
  initializeReadline() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: colors.brand('form0> '),
      completer: completer, // Enable tab completion
      history: [], // Enable command history (↑/↓ arrows)
      historySize: READLINE_CONFIG.historySize,
    });
    this.schemaManager.setReadlineInterface(this.rl);

    // Initialize managers
    this.serverManager = new ServerManager(
      this.schemaManager,
      this.fileWatcher,
      this.rl,
      this
    );
    this.schemaEditor = new SchemaEditor(
      this.schemaManager,
      this.engineRunner,
      this.serverManager,
      this.rl,
      this
    );
    // Pass shell reference to command handler for readline coordination
    this.commandHandler = new CommandHandler(
      this.schemaManager,
      this.engineRunner,
      this.fileWatcher,
      this.serverManager,
      this.rl,
      this, // Pass shell reference for readline coordination
      this.schemaEditor
    );

    // Set circular dependency for file watcher to access server manager
    this.fileWatcher.setServerManager(this.serverManager);

    // Set up initial SIGINT handler for readline
    this.rl.on('SIGINT', () => {
      if (this.serverManager.isServerRunning()) {
        // This should not happen since we override it in server mode
        return;
      }
      this.cleanup();
      console.log(colors.brandBold('\n' + t('interactive.goodbye')));
      process.exit(0);
    });
  }

  /**
   * Start the interactive shell
   */
  async start() {
    // Load configuration first
    await loadConfig();

    this.initializeReadline();

    showWelcomeBanner();
    console.log(colors.brandBold(t('interactive.welcome')));
    console.log(colors.textSecondary(t('interactive.typeHelp') + '\n'));

    // Smart initialization: Auto-load schema or offer to initialize
    const { config } = await resolveProjectConfig(process.cwd());
    const devServerCommand =
      config?.devServer && typeof config.devServer.command === 'string'
        ? config.devServer.command.trim()
        : '';
    const isAppProject = devServerCommand.length > 0;
    const schemaPromptOnStart =
      config?.cli && typeof config.cli.schemaPromptOnStart === 'boolean'
        ? config.cli.schemaPromptOnStart
        : true;

    if (!isAppProject && schemaPromptOnStart) {
      await this.schemaManager.smartInit();
    } else if (!isAppProject && !schemaPromptOnStart) {
      await this.schemaManager.smartInit({ allowPrompt: false });
    }

    this.rl.prompt();

    this.rl.on('line', async (input) => {
      const trimmed = input.trim();
      if (trimmed) {
        await this.commandHandler.handleCommand(trimmed);
      }
      // Always show appropriate prompt
      this.rl.prompt();
    });

    this.rl.on('close', () => {
      this.cleanup();
      console.log(colors.brandBold('\n' + t('interactive.goodbye')));
      process.exit(0);
    });
  }

  /**
   * Prompt the user (used by file watcher for re-prompting)
   */
  prompt() {
    if (this.rl) {
      this.refreshPrompt();
    }
  }

  setSchemaMode(enabled) {
    this.schemaMode = Boolean(enabled);
    this.refreshPrompt(false);
  }

  isSchemaMode() {
    return this.schemaMode;
  }

  getPromptString() {
    const parts = [];
    if (this.serverManager && this.serverManager.isServerRunning()) {
      parts.push('server');
    }
    if (this.schemaMode) {
      parts.push('schema');
    }

    if (parts.length === 0) {
      return colors.brand('form0> ');
    }

    return (
      colors.brand('form0') +
      colors.textSecondary(`(${parts.join(',')})`) +
      colors.brand('> ')
    );
  }

  refreshPrompt(showPrompt = true) {
    if (!this.rl) {
      return;
    }
    this.rl.setPrompt(this.getPromptString());
    if (showPrompt) {
      this.rl.prompt(true);
    }
  }

  /**
   * Cleanup resources on exit
   */
  cleanup() {
    if (this.serverManager) {
      this.serverManager.cleanup();
    }

    this.fileWatcher.cleanup();
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}
