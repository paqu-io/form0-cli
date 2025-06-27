import chokidar from 'chokidar';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { createFormEngine } from 'form0-core';
import { validateSchema } from 'form0-core';
import { filterValidValues } from '../utils/value-validation.js';
import yaml from 'yaml';

class Form0Watcher {
  constructor(schemaPath, options = {}) {
    this.schemaPath = schemaPath;
    this.options = options;
    this.currentSchema = null;
    this.lastValues = {};
    this.watcher = null;
    this.isWatching = false;
    
    // Load initial values if provided
    if (options.values) {
      this.loadInitialValues(options.values);
    }
  }

  async loadInitialValues(valuesInput) {
    try {
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
      
      // Note: We'll validate these values against the schema after it's loaded
      this.lastValues = initialValues;
    } catch (err) {
      console.log(chalk.red(`❌ Failed to load initial values: ${err.message}`));
      console.log(chalk.gray(`   Attempted to parse: "${valuesInput}"`));
    }
  }

  async start() {
    try {
      // Initial load
      await this.loadSchema();
      console.log(chalk.green(`✅ Initial schema loaded: ${this.schemaPath}`));
      
      // Validate and filter initial values against loaded schema
      if (Object.keys(this.lastValues).length > 0) {
        this.lastValues = filterValidValues(this.lastValues, this.currentSchema);
        if (Object.keys(this.lastValues).length > 0) {
          console.log(chalk.green(`✅ Loaded ${Object.keys(this.lastValues).length} valid test values`));
        }
      }
      
      if (this.options.autoValidate) {
        this.validateCurrentSchema();
      }
      
      if (this.options.autoRun) {
        await this.runEngine();
      }

      // Start watching
      this.startWatching();
      
      console.log(chalk.cyan(`👀 Watching ${this.schemaPath} for changes...`));
      console.log(chalk.gray('Press Ctrl+C to stop watching'));
      
      if (this.options.autoRun) {
        console.log(chalk.yellow('🔄 Auto-run enabled - engine will execute on changes'));
      }
      
      if (this.options.autoValidate) {
        console.log(chalk.yellow('✅ Auto-validate enabled - schema will be validated on changes'));
      }

      // Keep process alive
      this.setupExitHandlers();
      
    } catch (err) {
      console.error(chalk.red(`❌ Failed to start watching: ${err.message}`));
      process.exit(1);
    }
  }

  async loadSchema() {
    const data = await fs.readJson(this.schemaPath);
    validateSchema(data.form); // Validate on load
    this.currentSchema = data;
  }

  startWatching() {
    this.watcher = chokidar.watch(this.schemaPath, {
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
  }

  async handleFileChange(filePath) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(chalk.blue(`\n🔄 [${timestamp}] File changed: ${path.basename(filePath)}`));
    
    try {
      // Try to reload schema
      const oldSchema = this.currentSchema;
      await this.loadSchema();
      
      console.log(chalk.green('✅ Schema reloaded successfully'));
      
      // Show basic info about the schema
      const formName = this.currentSchema.form?.name || 'Unnamed Form';
      const elementCount = this.countElements(this.currentSchema.form?.elements || []);
      console.log(chalk.cyan(`📋 Form: "${formName}" (${elementCount} elements)`));
      
      // Auto-validate if enabled
      if (this.options.autoValidate) {
        this.validateCurrentSchema();
      }
      
      // Auto-run if enabled
      if (this.options.autoRun) {
        await this.runEngine();
      }
      
    } catch (err) {
      console.error(chalk.red(`❌ Failed to reload schema: ${err.message}`));
      console.log(chalk.yellow('⚠️  Keeping previous schema loaded'));
    }
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

  validateCurrentSchema() {
    try {
      validateSchema(this.currentSchema.form);
      console.log(chalk.green('✅ Schema validation passed'));
    } catch (err) {
      console.log(chalk.red(`❌ Schema validation failed: ${err.message}`));
    }
  }

  async runEngine() {
    try {
      const engine = createFormEngine({
        schema: this.currentSchema,
        initialValues: this.lastValues
      });
      
      engine.eval();
      const state = engine.getState();
      
      console.log(chalk.blue('🧠 Engine executed:'));
      
      // Show a compact view of the state
      const fields = Object.keys(state).length;
      console.log(chalk.gray(`   ${fields} fields processed`));
      
      // Show any calculated fields
      const calculatedFields = Object.entries(state)
        .filter(([key, value]) => this.isCalculatedField(key))
        .slice(0, 3); // Show first 3 calculated fields
      
      if (calculatedFields.length > 0) {
        console.log(chalk.gray('   Calculated fields:'));
        calculatedFields.forEach(([key, value]) => {
          console.log(chalk.gray(`     ${key}: ${JSON.stringify(value)}`));
        });
        
        if (Object.keys(state).length > calculatedFields.length + 3) {
          console.log(chalk.gray(`     ... and ${Object.keys(state).length - calculatedFields.length} more`));
        }
      }
      
    } catch (err) {
      console.log(chalk.red(`❌ Engine execution failed: ${err.message}`));
    }
  }

  isCalculatedField(fieldKey) {
    // Simple heuristic to identify calculated fields
    // In a real implementation, you'd check the schema
    const elements = this.flattenElements(this.currentSchema.form?.elements || []);
    const field = elements.find(el => el.key === fieldKey);
    return field?.type === 'CalculatedField';
  }

  flattenElements(elements) {
    let flattened = [];
    for (const element of elements) {
      flattened.push(element);
      if (element.type === 'Section' && element.elements) {
        flattened = flattened.concat(this.flattenElements(element.elements));
      }
    }
    return flattened;
  }

  setupExitHandlers() {
    const cleanup = () => {
      if (this.watcher) {
        console.log(chalk.yellow('\n👋 Stopping watcher...'));
        this.watcher.close();
      }
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.isWatching = false;
    }
  }
}

export async function watchCommand(schemaPath, options) {
  // Default to looking for common schema files if no path provided
  if (!schemaPath) {
    const commonPaths = ['form.schema.json', 'schema.json', 'form.json'];
    
    for (const commonPath of commonPaths) {
      if (await fs.pathExists(commonPath)) {
        schemaPath = commonPath;
        break;
      }
    }
    
    if (!schemaPath) {
      console.error(chalk.red('❌ No schema file found. Please specify a path or ensure form.schema.json exists.'));
      process.exit(1);
    }
  }

  // Check if file exists
  if (!await fs.pathExists(schemaPath)) {
    console.error(chalk.red(`❌ Schema file not found: ${schemaPath}`));
    process.exit(1);
  }

  const watcher = new Form0Watcher(schemaPath, {
    autoRun: options.autoRun || options.run,
    autoValidate: options.autoValidate || options.validate,
    values: options.values
  });

  await watcher.start();
} 