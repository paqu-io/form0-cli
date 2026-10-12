import { colors } from './theme.js';
import { t } from './i18n.js';
import {
  createDiagnosticReporter,
  formatDiagnosticCounts,
  summarizeDiagnostics,
} from '../server/static/calculation-diagnostics.js';

export function createTerminalDiagnosticReporter(log = console.error) {
  return createDiagnosticReporter({
    translate: t,
    emit({ text, severity, kind }) {
      const color =
        severity === 'error' ? colors.error : kind === 'resolved' ? colors.success : colors.warning;
      if (kind === 'heading') return log('\n' + colors.header(text) + '\n');
      return log(color(text) + '\n');
    },
  });
}

export function printSchemaStructureStatus() {
  console.log(t('diagnostics.structureValid'));
}

export function printCalculationStatus(issues) {
  const { errors, warnings } = summarizeDiagnostics(issues);
  const summary = formatDiagnosticCounts(issues, t);
  if (errors) console.error(colors.error(t('diagnostics.analysisErrors', { summary })));
  else if (warnings) console.log(colors.warning(t('diagnostics.analysisWarnings', { summary })));
  else console.log(colors.success(t('diagnostics.analysisValid')));
  return errors === 0;
}

export function printRunOutcome(diagnostics) {
  const { errors, warnings } = summarizeDiagnostics(diagnostics);
  if (errors || warnings) {
    const color = errors ? colors.error : colors.warning;
    console.error(
      color(t('diagnostics.runFindings', { summary: formatDiagnosticCounts(diagnostics, t) }))
    );
  }
  return errors === 0;
}

export function diagnosticsEnabled(args = [], options = {}) {
  return options.diagnostics !== false && !args.includes('--no-diagnostics');
}
