import fs from 'fs-extra';
import path from 'path';
import { colors } from '../utils/theme.js';
import { createFormEngine } from 'form0-core';
import { ensureChoiceValuesForSchema } from '../utils/ensure-choice-values.js';
import { filterValidValues } from '../utils/value-validation.js';
import yaml from 'yaml';
import { t } from '../utils/i18n.js';
import {
  createTerminalDiagnosticReporter,
  printRunOutcome,
} from '../utils/calculation-reporting.js';

export async function runCommand(schemaPath, options = {}) {
  try {
    const data = await fs.readJson(schemaPath);

    // Process SingleChoiceField choices before engine creation
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

    const reporter = createTerminalDiagnosticReporter();
    let completedDiagnostics = [];
    const engine = createFormEngine({
      schema: data,
      initialValues,
      diagnostics: { console: false },
      onDiagnostics: (snapshot) => {
        completedDiagnostics = snapshot;
      },
    });

    engine.eval();
    console.log(colors.header(t('common.engineState') + '\n'));
    console.log(JSON.stringify(engine.getState(), null, 2));
    const diagnostics = engine.getDiagnostics();
    reporter.report(completedDiagnostics, {
      explicit: true,
      enabled: options.diagnostics !== false,
    });
    const success = printRunOutcome(diagnostics);
    if (!success) process.exitCode = 1;
    return { state: engine.getState(), diagnostics, success };
  } catch (err) {
    console.error(colors.error(t('common.failedToRunEngine', { message: err.message })));
    process.exitCode = 1;
    return { success: false };
  }
}
