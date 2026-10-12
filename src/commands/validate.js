import fs from 'fs-extra';
import { validateSchema } from 'form0-core';
import { ensureChoiceValuesForSchema } from '../utils/ensure-choice-values.js';
import { t } from '../utils/i18n.js';
import { collectCalculationIssues } from '../utils/calculation-checks.js';
import {
  createTerminalDiagnosticReporter,
  printCalculationStatus,
  printSchemaStructureStatus,
} from '../utils/calculation-reporting.js';

export async function validateCommand(file, options = {}) {
  try {
    const data = await fs.readJson(file);

    // Process SingleChoiceField choices before validation
    ensureChoiceValuesForSchema(data.form.elements || []);

    // Validate form schema with form0-core
    validateSchema(data.form);

    const issues = collectCalculationIssues(data);
    printSchemaStructureStatus();
    createTerminalDiagnosticReporter().report([], {
      staticIssues: issues,
      explicit: true,
      enabled: options.diagnostics !== false,
    });
    const success = printCalculationStatus(issues);
    if (!success) process.exitCode = 1;
    return { issues, success };
  } catch (err) {
    console.error(t('commands.validate.validationFailed', { message: err.message }));
    process.exitCode = 1;
    return { success: false };
  }
}
