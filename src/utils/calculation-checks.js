import { analyzeCalculationExpression, flattenFields } from 'form0-core';
import { createTerminalDiagnosticReporter } from './calculation-reporting.js';

const analysisCache = new Map();

/**
 * Run the form0-core calculation analyzer on every CalculatedField in a schema.
 * These are the same checks the reform calculation editor shows while typing.
 * @param {{ form: { elements?: Array<Object> } }} schema
 * @returns {Array<{ dataName: string, severity: string, code: string, message: string }>}
 */
export function collectCalculationIssues(schema) {
  const revision = JSON.stringify(schema?.form || {});
  if (analysisCache.has(revision)) {
    return JSON.parse(JSON.stringify(analysisCache.get(revision)));
  }
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

  analysisCache.set(revision, issues);
  if (analysisCache.size > 8) analysisCache.delete(analysisCache.keys().next().value);
  return JSON.parse(JSON.stringify(issues));
}

/**
 * Print calculation issues without failing schema validation.
 * @param {{ form: { elements?: Array<Object> } }} schema
 * @param {(line: string) => void} [log]
 * @returns {number} The number of issues printed
 */
export function printCalculationIssues(schema, log = console.error) {
  const issues = collectCalculationIssues(schema);
  if (issues.length === 0) return 0;

  createTerminalDiagnosticReporter(log).report([], { staticIssues: issues, explicit: true });
  return issues.length;
}
