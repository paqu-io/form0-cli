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
    this.watcher = null;
    this.isWatching = false;
    this.watchOptions = {};
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
      console.log(colors.error(t('interactive.noSchemaLoaded')));
      return;
    }

    // Parse watch options and values from args
    const options = {
      autoRun: args.includes('--auto-run') || args.includes('-r'),
      autoValidate: args.includes('--auto-validate') || args.includes('-v')
    };

    // Look for --values flag
    const valuesIndex = args.findIndex(arg => arg === '--values');
    if (valuesIndex !== -1 && valuesIndex + 1 < args.length) {
      // Get all arguments after --values (to handle JSON objects with spaces)
      const valuesArgs = args.slice(valuesIndex + 1);
      // Remove any other flags that might come after
      const nextFlagIndex = valuesArgs.findIndex(arg => arg.startsWith('--'));
      const valuesInput = nextFlagIndex !== -1 
        ? valuesArgs.slice(0, nextFlagIndex).join(' ')
        : valuesArgs.join(' ');
      
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
    
    console.log(colors.info(t('fileWatcher.watchingChanges', { path: path.basename(currentSchemaPath) })));
    
    if (options.autoRun) {
      console.log(colors.warning(t('fileWatcher.autoRunEnabled')));
    }
    
    if (options.autoValidate) {
      console.log(colors.warning(t('fileWatcher.autoValidateEnabled')));
    }
    
    console.log(colors.textSecondary(t('fileWatcher.pressCtrlC') + '\n'));
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
    console.log(colors.header(`\n${t('fileWatcher.fileChanged', { timestamp, filename: path.basename(filePath) })}`));
    
    try {
      // Try to reload schema
      await this.schemaManager.reloadSchema();
      
      // Reset engine since schema changed
      this.engineRunner.resetEngine();
      
      console.log(colors.success(t('fileWatcher.schemaReloaded')));
      
      // Show basic info about the schema
      const currentSchema = this.schemaManager.getCurrentSchema();
      const formName = currentSchema.form?.name || t('commands.preview.unnamed');
      const elementCount = countElements(currentSchema.form?.elements || []);
      console.log(colors.info(tn('fileWatcher.formInfo', elementCount, { name: formName, count: elementCount })));
      
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