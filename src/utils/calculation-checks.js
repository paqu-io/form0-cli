import { analyzeCalculationExpression, flattenFields } from 'form0-core';
import { colors } from './theme.js';
import { t } from './i18n.js';

/**
 * Run the form0-core calculation analyzer on every CalculatedField in a schema.
 * These are the same checks the reform calculation editor shows while typing.
 * @param {{ form: { elements?: Array<Object> } }} schema
 * @returns {Array<{ dataName: string, severity: string, code: string, message: string }>}
 */
export function collectCalculationIssues(schema) {
  const fields = flattenFields(schema?.form?.elements || []);
  const issues = [];

  for (const field of fields) {
    if (field.type !== 'CalculatedField' || typeof field.calculate !== 'string') continue;

    const analysis = analyzeCalculationExpression({
      expression: field.calculate,
      schema,
      fieldDataName: field.data_name,
    });
    for (const issue of analysis.issues) {
      issues.push({
        dataName: field.data_name,
        severity: issue.severity,
        code: issue.code,
        message: issue.message,
      });
    }
  }

  return issues;
}

/**
 * Print calculation issues without failing schema validation.
 * @param {{ form: { elements?: Array<Object> } }} schema
 * @param {(line: string) => void} [log]
 * @returns {number} The number of issues printed
 */
export function printCalculationIssues(schema, log = console.log) {
  const issues = collectCalculationIssues(schema);
  if (issues.length === 0) return 0;

  log(colors.warning(t('common.calculationIssues', { count: issues.length })));
  for (const issue of issues) {
    const color = issue.severity === 'error' ? colors.error : colors.warning;
    log(color(`   ${issue.dataName}: ${issue.message} (${issue.code})`));
  }
  return issues.length;
}
