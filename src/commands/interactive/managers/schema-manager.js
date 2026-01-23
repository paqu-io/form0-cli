import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { validateSchema } from 'form0-core';
import { ensureChoiceValuesForSchema } from '../../../utils/ensure-choice-values.js';
import { initForInteractive } from '../../init.js';
import { COMMON_SCHEMA_PATTERNS } from '../../../utils/constants.js';
import { discoverSchemas, formatSchemaCandidate } from '../../../utils/schema-utils.js';
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
    this.readlineInterface = null;
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
   * Clear the current schema state
   */
  clearSchema() {
    this.currentSchema = null;
    this.currentSchemaPath = null;
  }

  /**
   * Set readline interface for interactive prompts
   */
  setReadlineInterface(readlineInterface) {
    this.readlineInterface = readlineInterface;
  }

  async askQuestion(prompt) {
    if (!this.readlineInterface) {
      return null;
    }
    return new Promise((resolve) => {
      this.readlineInterface.question(prompt, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  async promptSchemaSelection(candidates) {
    if (!this.readlineInterface) {
      return null;
    }

    console.log(colors.accent1(t('interactive.schemaPickerTitle')));
    candidates.forEach((candidate, index) => {
      console.log(colors.textSecondary(`  ${index + 1}) ${formatSchemaCandidate(candidate)}`));
    });

    while (true) {
      const answer = await this.askQuestion(
        colors.text(t('interactive.schemaPickerPrompt', { count: candidates.length }))
      );

      if (!answer) {
        console.log(colors.warning(t('interactive.schemaPickerCancelled')));
        return null;
      }

      const selectedIndex = Number.parseInt(answer, 10);
      if (
        Number.isInteger(selectedIndex) &&
        selectedIndex >= 1 &&
        selectedIndex <= candidates.length
      ) {
        return candidates[selectedIndex - 1];
      }

      console.log(colors.warning(t('interactive.schemaPickerInvalid', { count: candidates.length })));
    }
  }

  async resolveLoadTarget(args) {
    const input = args[0];

    if (!input) {
      const { candidates } = await discoverSchemas();
      if (candidates.length === 0) {
        console.log(colors.error(t('interactive.noSchemaFilesFound')));
        console.log(colors.textSecondary(t('interactive.typeLoad')));
        return null;
      }

      if (candidates.length === 1) {
        return candidates[0];
      }

      return await this.promptSchemaSelection(candidates);
    }

    if (this.isPathInput(input)) {
      return { path: input, displayPath: input };
    }

    const { candidates } = await discoverSchemas();
    const matches = candidates.filter((candidate) => candidate.formName === input);

    if (matches.length === 1) {
      return matches[0];
    }

    if (matches.length > 1) {
      return await this.promptSchemaSelection(matches);
    }

    if (await fs.pathExists(input)) {
      return { path: input, displayPath: input };
    }

    console.log(colors.error(t('interactive.formSchemaNotFound', { name: input })));
    console.log(colors.textSecondary(t('interactive.typeLoad')));
    return null;
  }

  isPathInput(input) {
    if (!input) {
      return false;
    }
    if (path.isAbsolute(input)) {
      return true;
    }
    if (input.startsWith('./') || input.startsWith('../')) {
      return true;
    }
    if (input.includes('/') || input.includes('\\')) {
      return true;
    }
    const lower = input.toLowerCase();
    if (lower.endsWith('.json') || lower.endsWith('.yml') || lower.endsWith('.yaml')) {
      return true;
    }
    return false;
  }

  /**
   * Smart initialization: Auto-load schema or offer to initialize
   */
  async smartInit(options = {}) {
    const { allowPrompt = true } = options;
    const { candidates, formsDir } = await discoverSchemas();

    if (candidates.length === 1) {
      const [candidate] = candidates;
      try {
        await this.loadSchema(candidate.path);
        console.log(
          colors.success(
            t('interactive.autoLoadedSchema', { path: candidate.displayPath }) + '\n'
          )
        );
        return true;
      } catch (err) {
        console.log(
          colors.warning(
            t('interactive.foundButFailedToLoad', {
              path: candidate.displayPath,
              message: err.message,
            }) + '\n'
          )
        );
        console.log(colors.accent1(t('interactive.wouldYouLikeToInit')));
        console.log(chalk.gray(t('interactive.typeInit')));
        console.log(chalk.gray(t('interactive.typeLoad')));
        console.log(chalk.gray(t('interactive.continueWithOther') + '\n'));
        return false;
      }
    }

    if (candidates.length > 1) {
      if (!allowPrompt) {
        console.log(colors.textSecondary(t('interactive.typeLoad')));
        console.log(chalk.gray(t('interactive.continueWithOther') + '\n'));
        return false;
      }

      const selected = await this.promptSchemaSelection(candidates);
      if (selected) {
        try {
          await this.loadSchema(selected.path);
          console.log(
            colors.success(
              t('interactive.autoLoadedSchema', { path: selected.displayPath }) + '\n'
            )
          );
          return true;
        } catch (err) {
          console.log(
            colors.warning(
              t('interactive.foundButFailedToLoad', {
                path: selected.displayPath,
                message: err.message,
              }) + '\n'
            )
          );
        }
      }

      console.log(chalk.gray(t('interactive.typeLoad')));
      console.log(chalk.gray(t('interactive.continueWithOther') + '\n'));
      return false;
    }

    // No valid schema found, offer to initialize
    console.log(
      colors.warning(t('interactive.noSchemaFound', { dir: path.basename(process.cwd()) }))
    );
    const searchTargets = [...COMMON_SCHEMA_PATTERNS];
    if (formsDir) {
      const formsRelative = path.relative(process.cwd(), formsDir) || formsDir;
      const formPatterns = COMMON_SCHEMA_PATTERNS.map((pattern) =>
        path.join(formsRelative, '*', pattern)
      );
      searchTargets.push(...formPatterns);
    }
    console.log(chalk.gray(t('interactive.lookingFor', { files: searchTargets.join(', ') }) + '\n'));

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

    showSchemaPreview(this.currentSchema, { showIds: true });
  }

  /**
   * Handle init command
   */
  async handleInitCommand(args) {
    const { dir, ignoredFlags } = this.parseInitArgs(args);

    if (ignoredFlags.length > 0) {
      console.log(
        colors.warning(
          t('interactive.localInitFlagsIgnored', { flags: ignoredFlags.join(' ') })
        )
      );
    }

    if (dir === '.') {
      // Check if current directory already has a schema
      const { candidates } = await discoverSchemas();
      const rootCandidates = candidates.filter((candidate) => candidate.source === 'root');

      if (rootCandidates.length > 0) {
        if (candidates.length > 1) {
          console.log(
            colors.warning(
              t('interactive.foundExistingSchemas', { count: candidates.length })
            )
          );
        } else {
          console.log(
            colors.warning(
              t('interactive.foundExistingSchema', { path: rootCandidates[0].displayPath })
            )
          );
        }
        console.log(chalk.gray(t('interactive.useLoadOrSpecify')));
        return;
      }

      console.log(
        colors.accent1(
          t('interactive.initializingInCurrent', { dir: path.basename(process.cwd()) })
        )
      );
    } else {
      console.log(colors.accent1(t('interactive.initializingIn', { dir })));
    }

    try {
      await initForInteractive(dir, { readlineInterface: this.readlineInterface });

      // Auto-load the newly created schema if initialized in current directory
      if (dir === '.') {
        await this.loadSchema('form.schema.json');
        console.log(colors.success(t('interactive.autoLoadedNewSchema')));
      }
    } catch (err) {
      console.log(colors.error(t('interactive.failedToInitialize', { message: err.message })));
    }
  }

  parseInitArgs(args = []) {
    const ignoredFlags = [];
    const skipValues = new Set();

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (!token) {
        continue;
      }

      if (token === '--local') {
        ignoredFlags.push(token);
        continue;
      }

      if (token === '--source' || token === '--template-root') {
        ignoredFlags.push(token);
        skipValues.add(i + 1);
        continue;
      }

      if (token.startsWith('--source=') || token.startsWith('--template-root=')) {
        ignoredFlags.push(token);
      }
    }

    let dir = null;
    for (let i = 0; i < args.length; i += 1) {
      if (skipValues.has(i)) {
        continue;
      }
      const token = args[i];
      if (!token || token.startsWith('-')) {
        continue;
      }
      dir = token;
      break;
    }

    if (dir && ignoredFlags.length > 0) {
      const lower = dir.toLowerCase();
      const looksLikePath = dir.startsWith('.') || dir.includes('/') || dir.includes('\\');
      if ((lower === 'source' || lower === 'local') && !looksLikePath) {
        dir = null;
      }
    }

    return { dir: dir || '.', ignoredFlags };
  }

  /**
   * Reset schema state (useful for testing or cleanup)
   */
  reset() {
    this.currentSchema = null;
    this.currentSchemaPath = null;
  }
}
