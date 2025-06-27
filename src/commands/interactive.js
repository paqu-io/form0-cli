import readline from 'readline';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { createFormEngine } from 'form0-core';
import { validateSchema } from 'form0-core';
import { getValidDataNames, validateValues, filterValidValues } from '../utils/value-validation.js';
import { initCommand } from './init.js';
import chokidar from 'chokidar';
import { 
  BRAND_COLOR, 
  COMMON_SCHEMA_PATHS, 
  WATCHER_CONFIG, 
  READLINE_CONFIG 
} from '../utils/constants.js';
import {
  showWelcomeBanner,
  showHelp,
  showStatus,
  showValues,
  showValidFields,
  showSchemaPreview,
  formatTimestamp
} from '../utils/display-utils.js';
import {
  findExistingSchema,
  parseValuesInput,
  findTestValueFile,
  countElements
} from '../utils/schema-utils.js';
import { completer } from '../utils/completion-utils.js';

class Form0Interactive {
  constructor() {
    this.currentSchema = null;
    this.currentSchemaPath = null;
    this.engine = null;
    this.watcher = null;
    this.isWatching = false;
    this.watchOptions = {};
    this.lastValues = {}; // Store last used values for auto-run
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.hex(BRAND_COLOR)('form0> '),
      completer: completer, // Enable tab completion
      history: [], // Enable command history (↑/↓ arrows)
      historySize: READLINE_CONFIG.historySize
    });
  }



  async start() {
    showWelcomeBanner();
    console.log(chalk.hex(BRAND_COLOR).bold('🚀 Welcome to form0 interactive environment'));
    console.log(chalk.gray('Type "help" for available commands or "exit" to quit\n'));
    
    // Smart initialization: Auto-load schema or offer to initialize
    await this.smartInit();
    
    this.rl.prompt();
    
    this.rl.on('line', async (input) => {
      const trimmed = input.trim();
      if (trimmed) {
        await this.handleCommand(trimmed);
      }
      this.rl.prompt();
    });

    this.rl.on('close', () => {
      if (this.isWatching) {
        this.stopWatching();
      }
      console.log(chalk.yellow('\n👋 Goodbye!'));
      process.exit(0);
    });
  }



  async smartInit() {
    // Try to auto-load existing schema
    const existingSchema = await findExistingSchema();
    if (existingSchema) {
      try {
        await this.loadSchema(existingSchema);
        console.log(chalk.green(`✅ Auto-loaded schema: ${existingSchema}\n`));
        return;
      } catch (err) {
        console.log(chalk.yellow(`⚠️  Found ${existingSchema} but failed to load: ${err.message}\n`));
      }
    }
    
    // No valid schema found, offer to initialize
    console.log(chalk.yellow(`🔍 No form schema found in current directory (${path.basename(process.cwd())}).`));
    console.log(chalk.gray(`   Looking for: ${COMMON_SCHEMA_PATHS.join(', ')}\n`));
    
    console.log(chalk.cyan('💡 Would you like to initialize a new form0 project?'));
    console.log(chalk.gray('   • Type "init" to create a sample schema'));
    console.log(chalk.gray('   • Type "load <path>" to load an existing schema'));
    console.log(chalk.gray('   • Continue with other commands\n'));
  }

  async autoLoadSchema() {
    // This method is now replaced by smartInit()
    // Keeping for backward compatibility if called elsewhere
    await this.smartInit();
  }

  async loadSchema(schemaPath) {
    const data = await fs.readJson(schemaPath);
    validateSchema(data.form);
    this.currentSchema = data;
    this.currentSchemaPath = schemaPath;
    this.engine = null; // Reset engine when schema changes
  }

  createEngine(initialValues = {}) {
    if (!this.currentSchema) {
      throw new Error('No schema loaded. Use "load <path>" to load a schema first.');
    }
    
    this.engine = createFormEngine({
      schema: this.currentSchema,
      initialValues
    });
    return this.engine;
  }

  async handleCommand(input) {
    const [command, ...args] = input.split(' ');
    
    try {
      switch (command.toLowerCase()) {
        case 'help':
        case 'h':
          showHelp();
          break;
        
        case 'init':
          await this.handleInitCommand(args);
          break;
          
        case 'load':
        case 'l':
          if (!args[0]) {
            console.log(chalk.red('❌ Usage: load <schema-file>'));
            return;
          }
          await this.loadSchema(args[0]);
          console.log(chalk.green(`✅ Loaded schema: ${args[0]}`));
          break;
          
        case 'preview':
        case 'p':
          this.previewSchema();
          break;
          
        case 'run':
        case 'r':
          await this.runEngine(args);
          break;
          
        case 'validate':
        case 'v':
          this.validateCurrentSchema();
          break;
          
        case 'status':
        case 's':
          this.showStatus();
          break;
          
        case 'values':
          this.showValues();
          break;
          
        case 'fields':
        case 'f':
          this.showValidFields();
          break;
          
        case 'reload':
        case 'rld':
          if (this.currentSchemaPath) {
            await this.loadSchema(this.currentSchemaPath);
            console.log(chalk.green(`✅ Reloaded schema: ${this.currentSchemaPath}`));
          } else {
            console.log(chalk.red('❌ No schema path to reload'));
          }
          break;
          
        case 'watch':
        case 'w':
          await this.handleWatchCommand(args);
          break;
          
        case 'clear':
        case 'cls':
          if (args[0] === 'values') {
            this.clearValues();
          } else {
            console.clear();
          }
          break;
          
        case 'exit':
        case 'quit':
        case 'q':
          this.rl.close();
          break;
          
        default:
          console.log(chalk.red(`❌ Unknown command: ${command}`));
          console.log(chalk.gray('Type "help" for available commands'));
      }
    } catch (err) {
      console.log(chalk.red(`❌ Error: ${err.message}`));
    }
  }

  async handleInitCommand(args) {
    const dir = args[0] || '.';
    
    if (dir === '.') {
      // Check if current directory already has a schema
      const existingSchema = COMMON_SCHEMA_PATHS.find(p => fs.pathExistsSync(p));
      
      if (existingSchema) {
        console.log(chalk.yellow(`⚠️  Found existing schema: ${existingSchema}`));
        console.log(chalk.gray('   Use "load" to load it or specify a different directory for init'));
        return;
      }
      
      console.log(chalk.cyan(`🚀 Initializing form0 project in current directory (${path.basename(process.cwd())})...`));
    } else {
      console.log(chalk.cyan(`🚀 Initializing form0 project in: ${dir}`));
    }
    
    try {
      await initCommand(dir);
      
      // Auto-load the newly created schema if initialized in current directory
      if (dir === '.') {
        await this.loadSchema('form.schema.json');
        console.log(chalk.green('✅ Auto-loaded the newly created schema'));
      }
    } catch (err) {
      console.log(chalk.red(`❌ Failed to initialize: ${err.message}`));
    }
  }



  previewSchema() {
    if (!this.currentSchema) {
      console.log(chalk.red('❌ No schema loaded'));
      return;
    }

    showSchemaPreview(this.currentSchema);
  }



  // Use shared validation utilities
  getValidDataNames() {
    return getValidDataNames(this.currentSchema);
  }

  validateValues(values) {
    return validateValues(values, this.currentSchema);
  }

  filterValidValues(values) {
    return filterValidValues(values, this.currentSchema);
  }

  async runEngine(args) {
    let initialValues = {};
    
    if (args.length > 0) {
      let valuesInput = '';
      
      // Check if using --values flag (new consistent syntax)
      const valuesIndex = args.findIndex(arg => arg === '--values');
      if (valuesIndex !== -1 && valuesIndex + 1 < args.length) {
        // Get all arguments after --values (to handle JSON objects with spaces)
        const valuesArgs = args.slice(valuesIndex + 1);
        valuesInput = valuesArgs.join(' ');
      } else {
        // Backward compatibility: treat all args as values
        valuesInput = args.join(' ');
      }
      
      initialValues = await parseValuesInput(valuesInput);
      
      // Validate and filter values against schema
      const filteredValues = this.filterValidValues(initialValues);
      
      // Store filtered values for future auto-run use
      this.lastValues = { ...filteredValues };
      initialValues = filteredValues;
    } else if (Object.keys(this.lastValues).length > 0) {
      // Use last values if no new values provided
      initialValues = { ...this.lastValues };
      console.log(chalk.gray('Using previous values for engine execution'));
    }

    const engine = this.createEngine(initialValues);
    engine.eval();
    
    console.log(chalk.blue.bold('\n🧠 Engine State:'));
    console.log(JSON.stringify(engine.getState(), null, 2));
    console.log();
  }

  validateCurrentSchema() {
    if (!this.currentSchema) {
      console.log(chalk.red('❌ No schema loaded'));
      return;
    }

    try {
      validateSchema(this.currentSchema.form);
      console.log(chalk.green('✅ Schema is valid'));
    } catch (err) {
      console.log(chalk.red(`❌ Schema validation failed: ${err.message}`));
    }
  }

  showStatus() {
    const sessionInfo = {
      currentSchemaPath: this.currentSchemaPath,
      currentSchema: this.currentSchema,
      engine: this.engine,
      isWatching: this.isWatching,
      watchOptions: this.watchOptions,
      lastValues: this.lastValues
    };
    showStatus(sessionInfo);
  }

  async handleWatchCommand(args) {
    // Handle stop command
    if (args[0] === 'stop') {
      this.stopWatching();
      return;
    }

    if (!this.currentSchemaPath) {
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
        await this.parseAndStoreValues(valuesInput);
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
    if (options.autoRun && Object.keys(this.lastValues).length === 0) {
      await this.tryAutoLoadTestValues();
    }

    // Start watching
    this.startWatching(options);
  }

  async parseAndStoreValues(valuesInput) {
    const initialValues = await parseValuesInput(valuesInput);
    
    // Validate and filter values against schema
    const filteredValues = this.filterValidValues(initialValues);
    this.lastValues = { ...filteredValues };
  }

  async tryAutoLoadTestValues() {
    const testFile = await findTestValueFile();
    if (testFile) {
      try {
        await this.parseAndStoreValues(testFile);
        console.log(chalk.green(`✅ Auto-loaded test values from: ${testFile}`));
      } catch (err) {
        console.log(chalk.yellow(`⚠️  Found ${testFile} but failed to load: ${err.message}`));
      }
    }
  }

  startWatching(options = {}) {

    this.watchOptions = options;
    
    this.watcher = chokidar.watch(this.currentSchemaPath, WATCHER_CONFIG);

    this.watcher.on('change', async (filePath) => {
      await this.handleFileChange(filePath);
    });

    this.watcher.on('error', (error) => {
      console.error(chalk.red(`❌ Watcher error: ${error.message}`));
    });

    this.isWatching = true;
    
    console.log(chalk.cyan(`👀 Watching ${path.basename(this.currentSchemaPath)} for changes...`));
    
    if (options.autoRun) {
      console.log(chalk.yellow('🔄 Auto-run enabled - engine will execute on changes'));
    }
    
    if (options.autoValidate) {
      console.log(chalk.yellow('✅ Auto-validate enabled - schema will be validated on changes'));
    }
    
    console.log(chalk.gray('Type "watch stop" to stop watching\n'));
  }

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

  async handleFileChange(filePath) {
    const timestamp = formatTimestamp();
    console.log(chalk.blue.bold(`\n🔄 [${timestamp}] File changed: ${path.basename(filePath)}`));
    
    try {
      // Try to reload schema
      await this.loadSchema(this.currentSchemaPath);
      
      console.log(chalk.green('✅ Schema reloaded successfully'));
      
      // Show basic info about the schema
      const formName = this.currentSchema.form?.name || 'Unnamed Form';
      const elementCount = countElements(this.currentSchema.form?.elements || []);
      console.log(chalk.cyan(`📋 Form: "${formName}" (${elementCount} elements)`));
      
      // Auto-validate if enabled
      if (this.watchOptions.autoValidate) {
        this.validateCurrentSchema();
      }
      
      // Auto-run if enabled
      if (this.watchOptions.autoRun) {
        if (Object.keys(this.lastValues).length > 0) {
          console.log(chalk.gray('Running engine with stored values...'));
        }
        await this.runEngine([]);
      }
      
    } catch (err) {
      console.error(chalk.red(`❌ Failed to reload schema: ${err.message}`));
      console.log(chalk.yellow('⚠️  Keeping previous schema loaded'));
    }
    
    // Show prompt again
    console.log(); // Add spacing
    this.rl.prompt();
  }



  showValues() {
    showValues(this.lastValues);
  }

  clearValues() {
    const count = Object.keys(this.lastValues).length;
    this.lastValues = {};
    
    if (count > 0) {
      console.log(chalk.green(`✅ Cleared ${count} stored values`));
    } else {
      console.log(chalk.yellow('⚠️  No values were stored'));
    }
  }

  showValidFields() {
    const validFields = this.currentSchema ? this.getValidDataNames() : [];
    showValidFields(validFields, !!this.currentSchema);
  }
}

export async function interactiveCommand() {
  const interactive = new Form0Interactive();
  await interactive.start();
}