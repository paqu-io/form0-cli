import path from 'path';
import { testCommand } from '../test.js';
import { themeCommand } from '../theme.js';
import { localeCommand } from '../locale.js';
import { colors } from '../../utils/theme.js';
import { t } from '../../utils/i18n.js';
import { importSchemaFromCsvFile, exportSchemaToCsvFile } from '../../utils/schema-csv.js';
import {
  confirmOverwrite,
  resolveDefaultSchemaPath,
  schemaNewCommand,
  schemaDeleteCommand,
} from '../schema.js';
import fs from 'fs-extra';
import { ensureMissingKeysForSchema } from '../../utils/ensure-missing-keys.js';

/**
 * Handles command processing for interactive shell
 */
export class CommandHandler {
  constructor(
    schemaManager,
    engineRunner,
    fileWatcher,
    serverManager,
    readline,
    shell = null,
    schemaEditor = null
  ) {
    this.schemaManager = schemaManager;
    this.engineRunner = engineRunner;
    this.fileWatcher = fileWatcher;
    this.serverManager = serverManager;
    this.readline = readline;
    this.shell = shell; // Reference to shell for readline coordination
    this.schemaEditor = schemaEditor;
  }

  /**
   * Check if command is allowed in server mode
   */
  isCommandAllowedInServerMode(command, args) {
    const allowedCommands = [
      'serve',
      'status',
      's',
      'preview',
      'p',
      'validate',
      'v',
      'help',
      'h',
      'connector',
      'conn',
      'c',
      'schema',
    ];

    if (!allowedCommands.includes(command.toLowerCase())) {
      return { allowed: false, reason: 'command_blocked' };
    }

    // For serve command, only allow stop/status or app start while server mode is active
    if (command.toLowerCase() === 'serve') {
      const [action] = args;
      const wantsApp = args.includes('--app') || args.includes('app');
      const allowedActions = ['stop', 'status', 'app', '--app'];

      if (action === 'start' && wantsApp) {
        return { allowed: true };
      }

      if (!allowedActions.includes(action)) {
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
      console.log(colors.textSecondary(t('interactive.serverMode.connectorCommands')));
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
      if (this.schemaEditor && this.schemaEditor.isActive()) {
        await this.schemaEditor.handleCommand(input);
        return;
      }

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
          await this.schemaManager.validateCurrentSchema();
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

        case 'connector':
        case 'conn':
        case 'c':
          await this.handleConnectorCommand(args);
          break;

        case 'schema':
          await this.handleSchemaCommand(args);
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
   * Handle connector commands
   */
  async handleConnectorCommand(args) {
    const { ConnectorManager } = await import('./managers/connector-manager.js');
    // Pass the shell reference to the connector manager for readline coordination
    const connectorManager = new ConnectorManager(this.shell);
    await connectorManager.handleCommand(args);
  }

  async handleSchemaCommand(args) {
    const [action, ...rest] = args;

    if (!action) {
      console.log(colors.error(t('interactive.schemaUsage')));
      return;
    }

    if (action === 'edit') {
      if (this.schemaEditor) {
        this.schemaEditor.enter();
      }
      return;
    }

    if (action === 'keys') {
      await this.handleSchemaKeys();
      return;
    }

    if (action === 'new') {
      const result = await schemaNewCommand({ readlineInterface: this.readline });
      if (!result || result.cancelled || !result.schemaPath) {
        return;
      }

      await this.schemaManager.loadSchema(result.schemaPath);
      this.engineRunner.resetEngine();
      this.serverManager.updateDevServerSchema();
      console.log(colors.success(t('interactive.autoLoadedNewSchema')));
      return;
    }

    if (action === 'delete') {
      const [target] = rest;
      const result = await schemaDeleteCommand(target, { readlineInterface: this.readline });
      if (!result || result.cancelled) {
        return;
      }

      const currentSchemaPath = this.schemaManager.getCurrentSchemaPath();
      if (currentSchemaPath) {
        const resolvedCurrent = path.resolve(currentSchemaPath);
        const deletedSchemaPath = result.schemaPath
          ? path.resolve(result.schemaPath)
          : null;
        const deletedDir = result.formDir ? path.resolve(result.formDir) : null;
        const isDeletedCurrent =
          (deletedSchemaPath && resolvedCurrent === deletedSchemaPath) ||
          (deletedDir && resolvedCurrent.startsWith(deletedDir + path.sep));

        if (isDeletedCurrent) {
          if (this.fileWatcher.isCurrentlyWatching()) {
            this.fileWatcher.stopWatching();
          }
          this.schemaManager.clearSchema();
          this.engineRunner.resetEngine();
          console.log(colors.warning(t('interactive.schemaDeletedCurrent')));
        }
      }
      return;
    }

    const { positional, force } = this.parseSchemaFlags(rest);

    if (action === 'import') {
      const [csvPath, outputArg] = positional;
      if (!csvPath) {
        console.log(colors.error(t('interactive.schemaUsageImport')));
        return;
      }

      const outputPath = outputArg || resolveDefaultSchemaPath(csvPath);

      try {
        const confirmed = await confirmOverwrite(outputPath, {
          force,
          readlineInterface: this.readline,
        });

        if (!confirmed) {
          return;
        }

        const { schemaPath } = await importSchemaFromCsvFile(csvPath, { outputPath });
        console.log(colors.success(t('interactive.schemaImportSuccess', { json: schemaPath })));

        await this.schemaManager.loadSchema(schemaPath);
        this.engineRunner.resetEngine();
        this.serverManager.updateDevServerSchema();
      } catch (err) {
        console.log(colors.error(t('interactive.error', { message: err.message })));
      }
      return;
    }

    if (action === 'export') {
      const [csvArg, inputArg] = positional;
      const csvPath = csvArg || 'form.schema.csv';
      const sourceSchema =
        inputArg ||
        this.schemaManager.getCurrentSchemaPath() ||
        'form.schema.json';

      try {
        const resolvedSource = path.resolve(sourceSchema);
        const resolvedTarget = path.resolve(csvPath);
        console.log(colors.info(t('commands.schema.exportPreview', { json: resolvedSource, csv: resolvedTarget })));

        const confirmed = await confirmOverwrite(csvPath, {
          force,
          readlineInterface: this.readline,
        });

        if (!confirmed) {
          return;
        }

        const { csvPath: producedPath } = await exportSchemaToCsvFile(sourceSchema, {
          outputPath: csvPath,
        });
        console.log(colors.success(t('interactive.schemaExportSuccess', { csv: producedPath })));
      } catch (err) {
        console.log(colors.error(t('interactive.error', { message: err.message })));
      }
      return;
    }

    console.log(colors.error(t('interactive.unknownCommand', { command: `schema ${action}` })));
  }

  async handleSchemaKeys() {
    const schema = this.schemaManager.getCurrentSchema();
    const schemaPath = this.schemaManager.getCurrentSchemaPath();

    if (!schema || !schemaPath) {
      console.log(colors.error(t('common.noSchemaLoaded')));
      return;
    }

    const elements = schema.form?.elements || [];
    const count = ensureMissingKeysForSchema(elements);

    if (count === 0) {
      console.log(colors.textSecondary(t('interactive.schemaEdit.noKeysNeeded')));
      return;
    }

    await fs.writeJson(schemaPath, schema, { spaces: 2 });
    this.engineRunner.resetEngine();
    this.serverManager.updateDevServerSchema();

    console.log(colors.success(t('interactive.schemaEdit.keysGenerated', { count })));
  }

  parseSchemaFlags(args) {
    const positional = [];
    let force = false;

    for (const arg of args) {
      if (arg === '--force' || arg === '-f') {
        force = true;
      } else {
        positional.push(arg);
      }
    }

    return { positional, force };
  }

  /**
   * Handle load command
   */
  async handleLoadCommand(args) {
    const target = await this.schemaManager.resolveLoadTarget(args);
    if (!target) {
      return;
    }

    await this.schemaManager.loadSchema(target.path);
    // Reset engine when schema changes
    this.engineRunner.resetEngine();
    // Update development server if running
    this.serverManager.updateDevServerSchema();
    console.log(
      colors.success(
        t('common.schemaLoaded', { path: target.displayPath || target.path })
      )
    );
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
