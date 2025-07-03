import path from 'path';
import chalk from 'chalk';
import chokidar from 'chokidar';
import { WATCHER_CONFIG } from '../../utils/constants.js';
import { formatTimestamp } from '../../utils/display-utils.js';
import { countElements } from '../../utils/schema-utils.js';
import { t, tn } from '../../utils/i18n.js';
import { colors } from '../../utils/theme.js';

/**
 * Manages file watching functionality for schema changes
 */
export class FileWatcher {
  constructor(schemaManager, engineRunner, shellCore = null) {
    this.schemaManager = schemaManager;
    this.engineRunner = engineRunner;
    this.shellCore = shellCore;
    this.serverManager = null; // Will be set by ShellCore after initialization
    this.watcher = null;
    this.isWatching = false;
    this.watchOptions = {};
  }

  /**
   * Set the server manager reference (called by ShellCore after initialization)
   */
  setServerManager(serverManager) {
    this.serverManager = serverManager;
  }

  /**
   * Check if currently watching files
   */
  isCurrentlyWatching() {
    return this.isWatching;
  }

  /**
   * Get current watch options
   */
  getWatchOptions() {
    return this.watchOptions;
  }

  /**
   * Handle watch command with options
   */
  async handleWatchCommand(args) {
    // Handle stop command
    if (args[0] === 'stop') {
      this.stopWatching();
      return;
    }

    const currentSchemaPath = this.schemaManager.getCurrentSchemaPath();
    if (!currentSchemaPath) {
      console.log(colors.error(t('common.noSchemaLoaded')));
      return;
    }

    // Parse watch options and values from args
    const options = {
      autoRun: args.includes('--auto-run') || args.includes('-r'),
      autoValidate: args.includes('--auto-validate') || args.includes('-v'),
    };

    // Look for --values flag
    const valuesIndex = args.findIndex((arg) => arg === '--values');
    if (valuesIndex !== -1 && valuesIndex + 1 < args.length) {
      // Get all arguments after --values (to handle JSON objects with spaces)
      const valuesArgs = args.slice(valuesIndex + 1);
      // Remove any other flags that might come after
      const nextFlagIndex = valuesArgs.findIndex((arg) => arg.startsWith('--'));
      const valuesInput =
        nextFlagIndex !== -1 ? valuesArgs.slice(0, nextFlagIndex).join(' ') : valuesArgs.join(' ');

      try {
        await this.engineRunner.parseAndStoreValues(valuesInput);
        console.log(colors.success(t('fileWatcher.valuesLoaded')));
      } catch (err) {
        console.log(colors.error(t('common.failedToLoadValues', { message: err.message })));
        console.log(colors.textSecondary(t('common.attemptedToParse', { input: valuesInput })));
        return;
      }
    }

    if (this.isWatching) {
      // Stop current watcher
      this.stopWatching();
    }

    // Auto-load test values if available and auto-run is enabled
    if (options.autoRun && Object.keys(this.engineRunner.getLastValues()).length === 0) {
      await this.engineRunner.tryAutoLoadTestValues();
    }

    // Start watching
    this.startWatching(options);
  }

  /**
   * Start watching the current schema file
   */
  startWatching(options = {}) {
    const currentSchemaPath = this.schemaManager.getCurrentSchemaPath();
    if (!currentSchemaPath) {
      throw new Error('No schema path to watch');
    }

    this.watchOptions = options;

    this.watcher = chokidar.watch(currentSchemaPath, WATCHER_CONFIG);

    this.watcher.on('change', async (filePath) => {
      await this.handleFileChange(filePath);
    });

    this.watcher.on('error', (error) => {
      console.error(colors.error(t('fileWatcher.watcherError', { message: error.message })));
    });

    this.isWatching = true;

    console.log(
      colors.accent1(t('common.watchingChanges', { path: path.basename(currentSchemaPath) }))
    );

    if (options.autoRun) {
      console.log(colors.warning(t('common.autoRunEnabled')));
    }

    if (options.autoValidate) {
      console.log(colors.warning(t('common.autoValidateEnabled')));
    }

    console.log(colors.textSecondary('Use "watch stop" to stop watching\n'));
  }

  /**
   * Start watching in server mode (silently, without Ctrl+C messages)
   */
  startWatchingInServerMode(schemaPath) {
    this.watchOptions = { autoValidate: false, autoRun: false };

    this.watcher = chokidar.watch(schemaPath, WATCHER_CONFIG);

    this.watcher.on('change', async (filePath) => {
      await this.handleFileChange(filePath);
    });

    this.watcher.on('error', (error) => {
      console.error(colors.error(t('fileWatcher.watcherError', { message: error.message })));
    });

    this.isWatching = true;
    // No console.log messages for silent server mode watching
  }

  /**
   * Stop watching files
   */
  stopWatching() {
    if (!this.isWatching) {
      console.log(colors.warning(t('fileWatcher.notWatching')));
      return;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    this.isWatching = false;
    this.watchOptions = {};

    console.log(colors.success(t('fileWatcher.stoppedWatching')));
  }

  /**
   * Handle file change events
   */
  async handleFileChange(filePath) {
    const timestamp = formatTimestamp();
    console.log(
      colors.header(
        `\n${t('common.fileChanged', { timestamp, filename: path.basename(filePath) })}`
      )
    );

    try {
      // Try to reload schema
      await this.schemaManager.reloadSchema();

      // Reset engine since schema changed
      this.engineRunner.resetEngine();

      console.log(colors.success(t('common.schemaReloaded')));

      // Update development server if running
      if (this.serverManager) {
        this.serverManager.updateDevServerSchema();
      }

      // Show basic info about the schema
      const currentSchema = this.schemaManager.getCurrentSchema();
      const formName = currentSchema.form?.name || t('commands.preview.unnamed');
      const elementCount = countElements(currentSchema.form?.elements || []);
      console.log(
        colors.info(tn('common.formInfo', elementCount, { name: formName, count: elementCount }))
      );

      // Auto-validate if enabled
      if (this.watchOptions.autoValidate) {
        this.schemaManager.validateCurrentSchema();
      }

      // Auto-run if enabled
      if (this.watchOptions.autoRun) {
        const lastValues = this.engineRunner.getLastValues();
        if (Object.keys(lastValues).length > 0) {
          console.log(colors.textSecondary(t('fileWatcher.runningWithStoredValues')));
        }
        await this.engineRunner.runEngine([]);
      }
    } catch (err) {
      console.error(colors.error(t('common.failedToReload', { message: err.message })));
      console.log(colors.warning(t('common.keepingPrevious')));
    }

    // Show prompt again
    console.log(); // Add spacing
    if (this.shellCore) {
      this.shellCore.prompt();
    }
  }

  /**
   * Cleanup watcher on exit
   */
  cleanup() {
    if (this.isWatching) {
      this.stopWatching();
    }
  }
}
