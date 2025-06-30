import chalk from 'chalk';
import { createFormEngine } from 'form0-core';
import { getValidDataNames, validateValues, filterValidValues } from '../../utils/value-validation.js';
import { parseValuesInput, findTestValueFile } from '../../utils/schema-utils.js';
import { showValues, showValidFields } from '../../utils/display-utils.js';
import { t, tn } from '../../utils/i18n.js';
import { colors } from '../../utils/theme.js';

/**
 * Manages form engine operations and value handling
 */
export class EngineRunner {
  constructor(schemaManager) {
    this.schemaManager = schemaManager;
    this.engine = null;
    this.lastValues = {}; // Store last used values for auto-run
  }

  /**
   * Get the current engine instance
   */
  getEngine() {
    return this.engine;
  }

  /**
   * Check if engine is ready
   */
  hasEngine() {
    return this.engine !== null;
  }

  /**
   * Get stored test values
   */
  getLastValues() {
    return this.lastValues;
  }

  /**
   * Create a new engine instance
   */
  createEngine(initialValues = {}) {
    const currentSchema = this.schemaManager.getCurrentSchema();
    if (!currentSchema) {
      throw new Error(t('interactive.noSchemaLoaded'));
    }
    
    this.engine = createFormEngine({
      schema: currentSchema,
      initialValues
    });
    return this.engine;
  }

  /**
   * Reset engine when schema changes
   */
  resetEngine() {
    this.engine = null;
  }

  /**
   * Execute the engine with provided arguments
   */
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
      console.log(colors.textSecondary(t('interactive.usingPreviousValues')));
    }

    const engine = this.createEngine(initialValues);
    engine.eval();
    
    console.log(colors.header('\n' + t('common.engineState')));
    console.log(JSON.stringify(engine.getState(), null, 2));
    console.log();
  }

  /**
   * Parse and store values from various input formats
   */
  async parseAndStoreValues(valuesInput) {
    const initialValues = await parseValuesInput(valuesInput);
    
    // Validate and filter values against schema
    const filteredValues = this.filterValidValues(initialValues);
    this.lastValues = { ...filteredValues };
  }

  /**
   * Try to auto-load test values from common files
   */
  async tryAutoLoadTestValues() {
    const testFile = await findTestValueFile();
    if (testFile) {
      try {
        await this.parseAndStoreValues(testFile);
        console.log(colors.success(t('interactive.autoLoadedValues', { filename: testFile })));
      } catch (err) {
        console.log(colors.warning(t('interactive.autoLoadFailed', { filename: testFile, message: err.message })));
      }
    }
  }

  /**
   * Show stored test values
   */
  showValues() {
    showValues(this.lastValues);
  }

  /**
   * Clear stored values
   */
  clearValues() {
    const count = Object.keys(this.lastValues).length;
    this.lastValues = {};
    
    if (count > 0) {
      console.log(colors.success(tn('interactive.clearedValues', count, { count })));
    } else {
      console.log(colors.warning(t('interactive.noValuesStored')));
    }
  }

  /**
   * Show valid field names from current schema
   */
  showValidFields() {
    const currentSchema = this.schemaManager.getCurrentSchema();
    const validFields = currentSchema ? this.getValidDataNames() : [];
    showValidFields(validFields, !!currentSchema);
  }

  // Validation utilities (delegated to shared utilities)
  getValidDataNames() {
    return getValidDataNames(this.schemaManager.getCurrentSchema());
  }

  validateValues(values) {
    return validateValues(values, this.schemaManager.getCurrentSchema());
  }

  filterValidValues(values) {
    return filterValidValues(values, this.schemaManager.getCurrentSchema());
  }
} 