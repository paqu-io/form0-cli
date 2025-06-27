import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { validateSchema } from 'form0-core';
import { initCommand } from '../init.js';
import { COMMON_SCHEMA_PATHS } from '../../utils/constants.js';
import { findExistingSchema } from '../../utils/schema-utils.js';
import { showSchemaPreview } from '../../utils/display-utils.js';

/**
 * Manages schema loading, validation, and initialization
 */
export class SchemaManager {
  constructor() {
    this.currentSchema = null;
    this.currentSchemaPath = null;
  }

  /**
   * Get the current schema
   */
  getCurrentSchema() {
    return this.currentSchema;
  }

  /**
   * Get the current schema path
   */
  getCurrentSchemaPath() {
    return this.currentSchemaPath;
  }

  /**
   * Check if a schema is currently loaded
   */
  hasSchema() {
    return this.currentSchema !== null;
  }

  /**
   * Smart initialization: Auto-load schema or offer to initialize
   */
  async smartInit() {
    // Try to auto-load existing schema
    const existingSchema = await findExistingSchema();
    if (existingSchema) {
      try {
        await this.loadSchema(existingSchema);
        console.log(chalk.green(`✅ Auto-loaded schema: ${existingSchema}\n`));
        return true;
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
    
    return false;
  }

  /**
   * Load a schema from file
   */
  async loadSchema(schemaPath) {
    const data = await fs.readJson(schemaPath);
    validateSchema(data.form);
    this.currentSchema = data;
    this.currentSchemaPath = schemaPath;
    return data;
  }

  /**
   * Reload the current schema
   */
  async reloadSchema() {
    if (!this.currentSchemaPath) {
      throw new Error('No schema path to reload');
    }
    return await this.loadSchema(this.currentSchemaPath);
  }

  /**
   * Validate the current schema
   */
  validateCurrentSchema() {
    if (!this.currentSchema) {
      console.log(chalk.red('❌ No schema loaded'));
      return false;
    }

    try {
      validateSchema(this.currentSchema.form);
      console.log(chalk.green('✅ Schema is valid'));
      return true;
    } catch (err) {
      console.log(chalk.red(`❌ Schema validation failed: ${err.message}`));
      return false;
    }
  }

  /**
   * Preview the current schema structure
   */
  previewSchema() {
    if (!this.currentSchema) {
      console.log(chalk.red('❌ No schema loaded'));
      return;
    }

    showSchemaPreview(this.currentSchema);
  }

  /**
   * Handle init command
   */
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

  /**
   * Reset schema state (useful for testing or cleanup)
   */
  reset() {
    this.currentSchema = null;
    this.currentSchemaPath = null;
  }
} 