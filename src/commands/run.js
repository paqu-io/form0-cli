import fs from 'fs-extra';
import path from 'path';
import { colors } from '../utils/theme.js';
import { createFormEngine } from 'form0-core';
import { ensureChoiceValuesForSchema } from '../utils/ensure-choice-values.js';
import { filterValidValues } from '../utils/value-validation.js';
import yaml from 'yaml';
import { t } from '../utils/i18n.js';

export async function runCommand(schemaPath, options) {
  try {
    const data = await fs.readJson(schemaPath);
    
    // Process ChoiceField choices before engine creation
    ensureChoiceValuesForSchema(data.form.elements || []);
    
    const valuesInput = options.values;
    let initialValues = {};

    if (valuesInput) {
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
      initialValues = filterValidValues(initialValues, data);
    }

    const engine = createFormEngine({
      schema: data,
      initialValues,
    });

    engine.eval();
    console.log(colors.header(t('common.engineState') + '\n'));
    console.log(JSON.stringify(engine.getState(), null, 2));
  } catch (err) {
    console.error(colors.error(t('common.failedToRunEngine', { message: err.message })));
    process.exit(1);
  }
}
