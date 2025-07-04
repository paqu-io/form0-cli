import { testCommand } from '../test.js';
import { themeCommand } from '../theme.js';
import { localeCommand } from '../locale.js';
import { colors } from '../../utils/theme.js';
import { t } from '../../utils/i18n.js';

/**
 * Handles command processing for interactive shell
 */
export class CommandHandler {
  constructor(schemaManager, engineRunner, fileWatcher, serverManager, readline) {
    this.schemaManager = schemaManager;
    this.engineRunner = engineRunner;
    this.fileWatcher = fileWatcher;
    this.serverManager = serverManager;
    this.readline = readline;
  }

  /**
   * Check if command is allowed in server mode
   */
  isCommandAllowedInServerMode(command, args) {
    const allowedCommands = ['serve', 'status', 's', 'preview', 'p', 'validate', 'v', 'help', 'h'];

    if (!allowedCommands.includes(command.toLowerCase())) {
      return { allowed: false, reason: 'command_blocked' };
    }

    // For serve command, only allow stop and status
    if (command.toLowerCase() === 'serve') {
      const [action] = args;
      if (!['stop', 'status'].includes(action)) {
        return { allowed: false, reason: 'serve_action_blocked', action };
      }
    }

    return { allowed: true };
  }

  /**
   * Show server mode restriction message
   */
  showServerModeRestriction(command, reason, action = null) {
    if (reason === 'command_blocked') {
      console.log(colors.warning(t('interactive.serverMode.commandBlocked', { command })));
      console.log(colors.textSecondary(t('interactive.serverMode.availableCommands')));
      console.log(colors.textSecondary(t('interactive.serverMode.serveStop')));
      console.log(colors.textSecondary(t('interactive.serverMode.serveStatus')));
      console.log(colors.textSecondary(t('interactive.serverMode.sessionStatus')));
      console.log(colors.textSecondary(t('interactive.serverMode.preview')));
      console.log(colors.textSecondary(t('interactive.serverMode.validate')));
      console.log(colors.textSecondary(t('interactive.serverMode.help')));
    } else if (reason === 'serve_action_blocked') {
      console.log(colors.warning(t('interactive.serverMode.serveActionBlocked', { action })));
      console.log(colors.textSecondary(t('interactive.serverMode.useServeStop')));
    }
  }

  /**
   * Handle incoming commands
   */
  async handleCommand(input) {
    const [command, ...args] = input.split(' ');

    try {
      // Check server mode restrictions
      if (this.serverManager.isServerRunning()) {
        const { allowed, reason, action } = this.isCommandAllowedInServerMode(command, args);
        if (!allowed) {
          this.showServerModeRestriction(command, reason, action);
          return;
        }
      }

      switch (command.toLowerCase()) {
        case 'help':
        case 'h':
          const { showHelp } = await import('../../utils/display-utils.js');
          showHelp();
          break;

        case 'init':
          await this.schemaManager.handleInitCommand(args);
          break;

        case 'load':
        case 'l':
          await this.handleLoadCommand(args);
          break;

        case 'preview':
        case 'p':
          this.schemaManager.previewSchema();
          break;

        case 'run':
        case 'r':
          await this.engineRunner.runEngine(args);
          break;

        case 'validate':
        case 'v':
          this.schemaManager.validateCurrentSchema();
          break;

        case 'test':
        case 't':
          await this.handleTestCommand(args);
          break;

        case 'status':
        case 's':
          await this.handleStatusCommand();
          break;

        case 'values':
          this.engineRunner.showValues();
          break;

        case 'fields':
        case 'f':
          this.engineRunner.showValidFields();
          break;

        case 'reload':
        case 'rld':
          await this.handleReloadCommand();
          break;

        case 'watch':
        case 'w':
          await this.fileWatcher.handleWatchCommand(args);
          break;

        case 'serve':
          await this.serverManager.handleServeCommand(args);
          break;

        case 'clear':
        case 'cls':
          this.handleClearCommand(args);
          break;

        case 'theme':
          await themeCommand(args[0]);
          break;

        case 'locale':
          await localeCommand(args[0]);
          break;

        case 'exit':
        case 'quit':
        case 'q':
          this.readline.close();
          break;

        default:
          console.log(colors.error(t('interactive.unknownCommand', { command })));
          console.log(colors.textSecondary(t('interactive.typeHelp')));
      }
    } catch (err) {
      console.log(colors.error(t('interactive.error', { message: err.message })));
    }
  }

  /**
   * Handle load command
   */
  async handleLoadCommand(args) {
    if (!args[0]) {
      console.log(colors.error(t('interactive.usageLoad')));
      return;
    }

    await this.schemaManager.loadSchema(args[0]);
    // Reset engine when schema changes
    this.engineRunner.resetEngine();
    // Update development server if running
    this.serverManager.updateDevServerSchema();
    console.log(colors.success(t('common.schemaLoaded', { path: args[0] })));
  }

  /**
   * Handle test command
   */
  async handleTestCommand(args) {
    try {
      const dir = args[0] || '.';
      await testCommand(dir);
    } catch (err) {
      console.log(colors.error(t('interactive.testFailed', { message: err.message })));
    }
  }

  /**
   * Handle status command
   */
  async handleStatusCommand() {
    const sessionInfo = {
      currentSchemaPath: this.schemaManager.getCurrentSchemaPath(),
      currentSchema: this.schemaManager.getCurrentSchema(),
      engine: this.engineRunner.getEngine(),
      isWatching: this.fileWatcher.isCurrentlyWatching(),
      watchOptions: this.fileWatcher.getWatchOptions(),
      lastValues: this.engineRunner.getLastValues(),
      devServer: this.serverManager.getServerStatus(),
    };

    const { showStatus } = await import('../../utils/display-utils.js');
    showStatus(sessionInfo);
  }

  /**
   * Handle reload command
   */
  async handleReloadCommand() {
    try {
      await this.schemaManager.reloadSchema();
      // Reset engine when schema changes
      this.engineRunner.resetEngine();
      // Update development server if running
      this.serverManager.updateDevServerSchema();
      console.log(
        colors.success(
          t('interactive.reloadedSchema', {
            path: this.schemaManager.getCurrentSchemaPath(),
          })
        )
      );
    } catch (err) {
      console.log(colors.error(`❌ ${err.message}`));
    }
  }

  /**
   * Handle clear command
   */
  handleClearCommand(args) {
    if (args[0] === 'values') {
      this.engineRunner.clearValues();
    } else {
      console.clear();
    }
  }
}
