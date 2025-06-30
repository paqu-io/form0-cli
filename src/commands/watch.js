import chokidar from 'chokidar';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { createFormEngine } from 'form0-core';
import { validateSchema } from 'form0-core';
import { filterValidValues } from '../utils/value-validation.js';
import yaml from 'yaml';
import { t, tn } from '../utils/i18n.js';

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
      console.log(chalk.red(t('common.failedToLoadValues', { message: err.message })));
      console.log(chalk.gray(t('common.attemptedToParse', { input: valuesInput })));
    }
  }

  async start() {
    try {
      // Initial load
      await this.loadSchema();
      console.log(chalk.green(t('commands.watch.initialSchemaLoaded', { path: this.schemaPath })));
      
      // Validate and filter initial values against loaded schema
      if (Object.keys(this.lastValues).length > 0) {
        this.lastValues = filterValidValues(this.lastValues, this.currentSchema);
        if (Object.keys(this.lastValues).length > 0) {
          const count = Object.keys(this.lastValues).length;
          console.log(chalk.green(tn('commands.watch.loadedValidValues', count, { count })));
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
      
      console.log(chalk.cyan(t('commands.watch.watchingChanges', { path: this.schemaPath })));
      console.log(chalk.gray(t('commands.watch.pressCtrlC')));
      
      if (this.options.autoRun) {
        console.log(chalk.yellow(t('commands.watch.autoRunEnabled')));
      }
      
      if (this.options.autoValidate) {
        console.log(chalk.yellow(t('commands.watch.autoValidateEnabled')));
      }

      // Keep process alive
      this.setupExitHandlers();
      
    } catch (err) {
      console.error(chalk.red(t('common.failedToStartWatching', { message: err.message })));
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
      console.error(chalk.red(t('commands.watch.watcherError', { message: error.message })));
    });

    this.isWatching = true;
  }

  async handleFileChange(filePath) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(chalk.blue('\n' + t('commands.watch.fileChanged', { timestamp, filename: path.basename(filePath) })));
    
    try {
      // Try to reload schema
      const oldSchema = this.currentSchema;
      await this.loadSchema();
      
      console.log(chalk.green(t('commands.watch.schemaReloaded')));
      
      // Show basic info about the schema
      const formName = this.currentSchema.form?.name || t('commands.preview.unnamed');
      const elementCount = this.countElements(this.currentSchema.form?.elements || []);
      console.log(chalk.cyan(tn('commands.watch.formInfo', elementCount, { name: formName, count: elementCount })));
      
      // Auto-validate if enabled
      if (this.options.autoValidate) {
        this.validateCurrentSchema();
      }
      
      // Auto-run if enabled
      if (this.options.autoRun) {
        await this.runEngine();
      }
      
    } catch (err) {
      console.error(chalk.red(t('common.failedToReload', { message: err.message })));
      console.log(chalk.yellow(t('common.keepingPrevious')));
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
      console.log(chalk.green(t('commands.watch.validationPassed')));
    } catch (err) {
      console.log(chalk.red(t('commands.watch.validationFailed', { message: err.message })));
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
      
      console.log(chalk.blue(t('commands.watch.engineExecuted')));
      
      // Show a compact view of the state
      const fields = Object.keys(state).length;
      console.log(chalk.gray(tn('commands.watch.fieldsProcessed', fields, { count: fields })));
      
      // Show any calculated fields
      const calculatedFields = Object.entries(state)
        .filter(([key, value]) => this.isCalculatedField(key))
        .slice(0, 3); // Show first 3 calculated fields
      
      if (calculatedFields.length > 0) {
        console.log(chalk.gray(t('commands.watch.calculatedFields')));
        calculatedFields.forEach(([key, value]) => {
          console.log(chalk.gray(`     ${key}: ${JSON.stringify(value)}`));
        });
        
        if (Object.keys(state).length > calculatedFields.length + 3) {
          const moreCount = Object.keys(state).length - calculatedFields.length;
          console.log(chalk.gray(tn('commands.watch.andMore', moreCount, { count: moreCount })));
        }
      }
      
    } catch (err) {
      console.log(chalk.red(t('commands.watch.engineExecutionFailed', { message: err.message })));
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
        console.log(chalk.yellow('\n' + t('commands.watch.stoppingWatcher')));
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
      console.error(chalk.red(t('commands.watch.noSchemaFileFound')));
      process.exit(1);
    }
  }

  // Check if file exists
  if (!await fs.pathExists(schemaPath)) {
    console.error(chalk.red(t('commands.watch.schemaFileNotFound', { path: schemaPath })));
    process.exit(1);
  }

  const watcher = new Form0Watcher(schemaPath, {
    autoRun: options.autoRun || options.run,
    autoValidate: options.autoValidate || options.validate,
    values: options.values
  });

  await watcher.start();
} 