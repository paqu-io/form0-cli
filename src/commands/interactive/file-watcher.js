import path from 'path';
import chalk from 'chalk';
import chokidar from 'chokidar';
import { WATCHER_CONFIG } from '../../utils/constants.js';
import { formatTimestamp } from '../../utils/display-utils.js';
import { countElements } from '../../utils/schema-utils.js';

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
      console.log(chalk.red('❌ No schema loaded. Use "load <path>" to load a schema first.'));
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
        console.log(chalk.green('✅ Values loaded for auto-run'));
      } catch (err) {
        console.log(chalk.red(`❌ Failed to load values: ${err.message}`));
        console.log(chalk.gray(`   Attempted to parse: "${valuesInput}"`));
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
      console.error(chalk.red(`❌ Watcher error: ${error.message}`));
    });

    this.isWatching = true;
    
    console.log(chalk.cyan(`👀 Watching ${path.basename(currentSchemaPath)} for changes...`));
    
    if (options.autoRun) {
      console.log(chalk.yellow('🔄 Auto-run enabled - engine will execute on changes'));
    }
    
    if (options.autoValidate) {
      console.log(chalk.yellow('✅ Auto-validate enabled - schema will be validated on changes'));
    }
    
    console.log(chalk.gray('Type "watch stop" to stop watching\n'));
  }

  /**
   * Stop watching files
   */
  stopWatching() {
    if (!this.isWatching) {
      console.log(chalk.yellow('⚠️  Not currently watching any files.'));
      return;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    this.isWatching = false;
    this.watchOptions = {};
    
    console.log(chalk.green('✅ Stopped watching files'));
  }

  /**
   * Handle file change events
   */
  async handleFileChange(filePath) {
    const timestamp = formatTimestamp();
    console.log(chalk.blue.bold(`\n🔄 [${timestamp}] File changed: ${path.basename(filePath)}`));
    
    try {
      // Try to reload schema
      await this.schemaManager.reloadSchema();
      
      // Reset engine since schema changed
      this.engineRunner.resetEngine();
      
      console.log(chalk.green('✅ Schema reloaded successfully'));
      
      // Show basic info about the schema
      const currentSchema = this.schemaManager.getCurrentSchema();
      const formName = currentSchema.form?.name || 'Unnamed Form';
      const elementCount = countElements(currentSchema.form?.elements || []);
      console.log(chalk.cyan(`📋 Form: "${formName}" (${elementCount} elements)`));
      
      // Auto-validate if enabled
      if (this.watchOptions.autoValidate) {
        this.schemaManager.validateCurrentSchema();
      }
      
      // Auto-run if enabled
      if (this.watchOptions.autoRun) {
        const lastValues = this.engineRunner.getLastValues();
        if (Object.keys(lastValues).length > 0) {
          console.log(chalk.gray('Running engine with stored values...'));
        }
        await this.engineRunner.runEngine([]);
      }
      
    } catch (err) {
      console.error(chalk.red(`❌ Failed to reload schema: ${err.message}`));
      console.log(chalk.yellow('⚠️  Keeping previous schema loaded'));
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