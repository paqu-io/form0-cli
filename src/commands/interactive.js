import readline from 'readline';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { createFormEngine } from 'form0-core';
import { validateSchema } from 'form0-core';
import { getValidDataNames, validateValues, filterValidValues } from '../utils/value-validation.js';
import { initCommand } from './init.js';
import chokidar from 'chokidar';
import yaml from 'yaml';

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
      prompt: chalk.hex('#DB3700')('form0> '),
      completer: this.completer.bind(this), // Enable tab completion
      history: [], // Enable command history (↑/↓ arrows)
      historySize: 100 // Remember last 100 commands
    });
  }

  // Tab completion function
  completer(line) {
    const commands = [
      'help', 'h', 'load', 'l', 'preview', 'p', 'run', 'r', 
      'validate', 'v', 'watch', 'w', 'status', 's', 'values',
      'reload', 'rld', 'clear', 'cls', 'exit', 'quit', 'q',
      'init', 'fields', 'f'
    ];
    
    const watchOptions = ['--auto-run', '--auto-validate', '--values', 'stop'];
    const clearOptions = ['values'];
    //const singleCommands = ['clear-values'];
    const runOptions = ['--values'];
    
    const args = line.split(' ');
    const command = args[0];
    
    if (args.length === 1) {
      // Complete main commands
      const hits = commands.filter(cmd => cmd.startsWith(line));
      return [hits.length ? hits : [], line];
    }
    
    if (command === 'watch' && args.length >= 2) {
      // Complete watch options
      const lastArg = args[args.length - 1];
      const hits = watchOptions.filter(opt => opt.startsWith(lastArg));
      return [hits, lastArg];
    }
    
    if (command === 'clear' && args.length === 2) {
      // Complete clear options
      const hits = clearOptions.filter(opt => opt.startsWith(args[1]));
      return [hits, args[1]];
    }
    
    if (command === 'run' && args.length >= 2) {
      // Complete run options
      const lastArg = args[args.length - 1];
      const hits = runOptions.filter(opt => opt.startsWith(lastArg));
      return [hits, lastArg];
    }
    
    return [[], line];
  }

  async start() {
    this.showWelcomeBanner();
    console.log(chalk.hex('#DB3700').bold('🚀 Welcome to form0 interactive environment'));
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

  showWelcomeBanner() {
    console.log(chalk.hex('#DB3700').bold(`
  ███████╗ ██████╗ ██████╗ ███╗   ███╗ ██████╗ 
  ██╔════╝██╔═══██╗██╔══██╗████╗ ████║██╔═████╗
  █████╗  ██║   ██║██████╔╝██╔████╔██║██║██╔██║
  ██╔══╝  ██║   ██║██╔══██╗██║╚██╔╝██║████╔╝██║
  ██║     ╚██████╔╝██║  ██║██║ ╚═╝ ██║╚██████╔╝
  ╚═╝      ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝ ╚═════╝ 
    `));
    console.log(chalk.hex('#DB3700')('                    Interactive CLI Environment'));
    console.log(chalk.hex('#DB3700')('                    Made with 🦙 by paqu.io\n'));
  }

  async smartInit() {
    const commonPaths = ['form.schema.json', 'schema.json', 'form.json'];
    
    // Try to auto-load existing schema
    for (const schemaPath of commonPaths) {
      if (await fs.pathExists(schemaPath)) {
        try {
          await this.loadSchema(schemaPath);
          console.log(chalk.green(`✅ Auto-loaded schema: ${schemaPath}\n`));
          return;
        } catch (err) {
          console.log(chalk.yellow(`⚠️  Found ${schemaPath} but failed to load: ${err.message}\n`));
        }
      }
    }
    
    // No valid schema found, offer to initialize
    console.log(chalk.yellow(`🔍 No form schema found in current directory (${path.basename(process.cwd())}).`));
    console.log(chalk.gray('   Looking for: form.schema.json, schema.json, or form.json\n'));
    
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
          this.showHelp();
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
      const commonPaths = ['form.schema.json', 'schema.json', 'form.json'];
      const existingSchema = commonPaths.find(p => fs.pathExistsSync(p));
      
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

  showHelp() {
    console.log(chalk.blue.bold('\n📚 Available Commands:\n'));
    console.log(chalk.gray('  Notation: <required> [optional]'));
    console.log();
    console.log(chalk.cyan('  Schema Management:'));
    console.log('    init [dir]           Initialize new form0 project (default: current dir)');
    console.log('    load <file>, l       Load a form schema file');
    console.log('    reload, rld          Reload current schema file');
    console.log('    validate, v          Validate current schema');
    console.log('    preview, p           Show form structure');
    console.log();
    console.log(chalk.cyan('  Engine Operations:'));
    console.log('    run [options], r     Execute form engine with optional values');
    console.log(chalk.gray('      options: --values <input>'));
    console.log('    watch [options], w   Watch schema file for changes');
    console.log(chalk.gray('      options: --auto-run, --auto-validate, --values <input>'));
    console.log('    watch stop           Stop watching current schema');
    console.log('    values               Show stored test values');
    console.log('    fields, f            Show valid field names from schema');
    console.log();
    console.log(chalk.cyan('  Session Management:'));
    console.log('    status, s            Show session status');
    console.log('    clear values         Clear stored values');
    console.log('    clear, cls           Clear screen');
    console.log('    help, h              Show this help');
    console.log('    exit, quit, q        Exit interactive mode');
    console.log();
    console.log(chalk.gray('  Navigation: Use ↑/↓ arrows for command history, Tab for completion'));
    console.log(chalk.gray('  Examples:'));
    console.log(chalk.gray('    run --values {"first_name": "Alice", "age": 25}'));
    console.log(chalk.gray('    run --values values.json  (uses values from file)'));
    console.log(chalk.gray('    watch --auto-run  (uses stored values)'));
    console.log(chalk.gray('    watch --auto-run --values {"first_name": "Bob", "age": 30}'));
    console.log();
  }

  previewSchema() {
    if (!this.currentSchema) {
      console.log(chalk.red('❌ No schema loaded'));
      return;
    }

    const form = this.currentSchema.form;
    console.log(chalk.blue.bold(`\n📋 Form: ${form.name || 'Unnamed'}`));
    if (form.description) {
      console.log(chalk.gray(`   ${form.description}`));
    }
    console.log();
    
    this.printFields(form.elements || []);
    console.log();
  }

  printFields(elements, indent = '') {
    elements.forEach((element, index) => {
      const isLast = index === elements.length - 1;
      const connector = isLast ? '└─' : '├─';
      const childIndent = indent + (isLast ? '  ' : '│ ');
      
      let typeColor = chalk.white;
      switch (element.type) {
        case 'Section':
          typeColor = chalk.magenta;
          break;
        case 'TextField':
          typeColor = chalk.green;
          break;
        case 'NumericField':
          typeColor = chalk.blue;
          break;
        case 'CalculatedField':
          typeColor = chalk.yellow;
          break;
        default:
          typeColor = chalk.cyan;
      }
      
          const label = element.label || element.data_name || 'Unlabeled';
    const dataNameDisplay = element.data_name ? chalk.gray(` [${element.data_name}]`) : '';
    const keyDisplay = element.key ? chalk.gray(` (key: ${element.key})`) : '';
    
    console.log(
      `${indent}${connector} ${typeColor(element.type)} ${chalk.bold(label)}${dataNameDisplay}${keyDisplay}`
    );
      
      if (element.type === 'Section' && element.elements) {
        this.printFields(element.elements, childIndent);
      }
    });
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
      
      const ext = path.extname(valuesInput).toLowerCase();
      
      if (ext === '.yaml' || ext === '.yml') {
        const yamlText = await fs.readFile(valuesInput, 'utf8');
        initialValues = yaml.parse(yamlText);
      } else if (ext === '.json') {
        initialValues = await fs.readJson(valuesInput);
      } else {
        // Treat as inline JSON string
        initialValues = JSON.parse(valuesInput);
      }
      
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
    console.log(chalk.blue.bold('\n📊 Session Status:'));
    console.log(chalk.gray('  Directory:'), chalk.cyan(path.basename(process.cwd())));
    console.log(chalk.gray('  Schema:'), this.currentSchemaPath ? chalk.green(this.currentSchemaPath) : chalk.red('None loaded'));
    console.log(chalk.gray('  Form:'), this.currentSchema?.form?.name ? chalk.green(this.currentSchema.form.name) : chalk.red('N/A'));
    console.log(chalk.gray('  Engine:'), this.engine ? chalk.green('Ready') : chalk.yellow('Not initialized'));
    console.log(chalk.gray('  Watching:'), this.isWatching ? chalk.green('Active') : chalk.red('Stopped'));
    
    if (this.isWatching) {
      const options = [];
      if (this.watchOptions.autoRun) options.push('auto-run');
      if (this.watchOptions.autoValidate) options.push('auto-validate');
      if (options.length > 0) {
        console.log(chalk.gray('  Options:'), chalk.yellow(options.join(', ')));
      }
    }
    
    const valuesCount = Object.keys(this.lastValues).length;
    console.log(chalk.gray('  Test Values:'), valuesCount > 0 ? chalk.green(`${valuesCount} fields stored`) : chalk.red('None'));
    
    console.log();
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
    let initialValues = {};
    const ext = path.extname(valuesInput).toLowerCase();
    
    if (ext === '.yaml' || ext === '.yml') {
      const yamlText = await fs.readFile(valuesInput, 'utf8');
      initialValues = yaml.parse(yamlText);
    } else if (ext === '.json') {
      initialValues = await fs.readJson(valuesInput);
    } else {
      // Treat as inline JSON string
      initialValues = JSON.parse(valuesInput);
    }
    
    // Validate and filter values against schema
    const filteredValues = this.filterValidValues(initialValues);
    this.lastValues = { ...filteredValues };
  }

  async tryAutoLoadTestValues() {
    const commonTestFiles = [
      'test-values.json',
      'test.values.json', 
      'values.json',
      'sample-data.json',
      'test-data.json'
    ];

    for (const testFile of commonTestFiles) {
      if (await fs.pathExists(testFile)) {
        try {
          await this.parseAndStoreValues(testFile);
          console.log(chalk.green(`✅ Auto-loaded test values from: ${testFile}`));
          return;
        } catch (err) {
          console.log(chalk.yellow(`⚠️  Found ${testFile} but failed to load: ${err.message}`));
        }
      }
    }
  }

  startWatching(options = {}) {

    this.watchOptions = options;
    
    this.watcher = chokidar.watch(this.currentSchemaPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500, // Wait 500ms after last change
        pollInterval: 100
      }
    });

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
    const timestamp = new Date().toLocaleTimeString();
    console.log(chalk.blue.bold(`\n🔄 [${timestamp}] File changed: ${path.basename(filePath)}`));
    
    try {
      // Try to reload schema
      await this.loadSchema(this.currentSchemaPath);
      
      console.log(chalk.green('✅ Schema reloaded successfully'));
      
      // Show basic info about the schema
      const formName = this.currentSchema.form?.name || 'Unnamed Form';
      const elementCount = this.countElements(this.currentSchema.form?.elements || []);
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

  countElements(elements) {
    let count = 0;
    for (const element of elements) {
      count++;
      if (element.type === 'Section' && element.elements) {
        count += this.countElements(element.elements);
      }
    }
    return count;
  }

  showValues() {
    console.log(chalk.blue.bold('\n💾 Stored Test Values:'));
    
    if (Object.keys(this.lastValues).length === 0) {
      console.log(chalk.gray('  No values currently stored'));
      console.log(chalk.gray('  Use "run --values <values>" to store values\n'));
      return;
    }

    console.log(JSON.stringify(this.lastValues, null, 2));
    console.log();
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
    console.log(chalk.blue.bold('\n📋 Valid Field Names:'));
    
    if (!this.currentSchema) {
      console.log(chalk.red('  No schema loaded'));
      console.log(chalk.gray('  Use "load <file>" to load a schema first\n'));
      return;
    }
    
    const validFields = this.getValidDataNames();
    if (validFields.length === 0) {
      console.log(chalk.gray('  No fields found in schema'));
    } else {
      console.log(chalk.gray(`  ${validFields.join(', ')}`));
    }
    
    console.log();
  }
}

export async function interactiveCommand() {
  const interactive = new Form0Interactive();
  await interactive.start();
}