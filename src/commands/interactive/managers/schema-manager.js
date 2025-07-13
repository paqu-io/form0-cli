import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { validateSchema } from 'form0-core';
import { ensureChoiceValuesForSchema } from '../../../utils/ensure-choice-values.js';
import { initForInteractive } from '../../init.js';
import { COMMON_SCHEMA_PATHS } from '../../../utils/constants.js';
import { findExistingSchema } from '../../../utils/schema-utils.js';
import { showSchemaPreview } from '../../../utils/display-utils.js';
import { t } from '../../../utils/i18n.js';
import { colors } from '../../../utils/theme.js';

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
        console.log(
          colors.success(t('interactive.autoLoadedSchema', { path: existingSchema }) + '\n')
        );
        return true;
      } catch (err) {
        console.log(
          colors.warning(
            t('interactive.foundButFailedToLoad', { path: existingSchema, message: err.message }) +
              '\n'
          )
        );
        console.log(colors.accent1(t('interactive.wouldYouLikeToInit')));
        console.log(chalk.gray(t('interactive.typeInit')));
        console.log(chalk.gray(t('interactive.typeLoad')));
        console.log(chalk.gray(t('interactive.continueWithOther') + '\n'));
        return false;
      }
    }

    // No valid schema found, offer to initialize
    console.log(
      colors.warning(t('interactive.noSchemaFound', { dir: path.basename(process.cwd()) }))
    );
    console.log(
      chalk.gray(t('interactive.lookingFor', { files: COMMON_SCHEMA_PATHS.join(', ') }) + '\n')
    );

    console.log(colors.accent1(t('interactive.wouldYouLikeToInit')));
    console.log(chalk.gray(t('interactive.typeInit')));
    console.log(chalk.gray(t('interactive.typeLoad')));
    console.log(chalk.gray(t('interactive.continueWithOther') + '\n'));

    return false;
  }

  /**
   * Load a schema from file
   */
  async loadSchema(schemaPath) {
    const data = await fs.readJson(schemaPath);
    
    // Process SingleChoiceField choices before validation
    ensureChoiceValuesForSchema(data.form.elements || []);
    
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
   * Validate the current schema (always reloads from file first)
   */
  async validateCurrentSchema() {
    if (!this.currentSchemaPath) {
      console.log(colors.error(t('common.noSchemaLoaded')));
      return false;
    }

    try {
      // Always reload from file before validating to ensure we're validating the current file state
      await this.reloadSchema();
      
      validateSchema(this.currentSchema.form);
      console.log(colors.success(t('common.schemaIsValid')));
      return true;
    } catch (err) {
      console.log(colors.error(t('commands.validate.validationFailed', { message: err.message })));
      return false;
    }
  }

  /**
   * Preview the current schema structure
   */
  previewSchema() {
    if (!this.currentSchema) {
      console.log(colors.error(t('common.noSchemaLoaded')));
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
      const existingSchema = COMMON_SCHEMA_PATHS.find((p) => fs.pathExistsSync(p));

      if (existingSchema) {
        console.log(colors.warning(t('interactive.foundExistingSchema', { path: existingSchema })));
        console.log(chalk.gray(t('interactive.useLoadOrSpecify')));
        return;
      }

      console.log(
        colors.accent1(t('interactive.initializingInCurrent', { dir: path.basename(process.cwd()) }))
      );
    } else {
      console.log(colors.accent1(t('interactive.initializingIn', { dir })));
    }

    try {
      await initForInteractive(dir);

      // Auto-load the newly created schema if initialized in current directory
      if (dir === '.') {
        await this.loadSchema('form.schema.json');
        console.log(colors.success(t('interactive.autoLoadedNewSchema')));
      }
    } catch (err) {
      console.log(colors.error(t('interactive.failedToInitialize', { message: err.message })));
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
