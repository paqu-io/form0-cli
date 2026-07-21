import path from 'path';
import fs from 'fs-extra';
import { colors } from '../utils/theme.js';
import { t } from '../utils/i18n.js';
import { convertFormioSchema, defaultFormioOutputPath } from '../utils/formio-schema-converter.js';
import { confirmOverwrite } from './schema.js';

function isRemoteInput(value) {
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value || '');
}

function printConversionReport(report) {
  const { summary } = report;
  console.log(
    colors.info(
      t('commands.formioConvert.summary', {
        outcome: report.outcome,
        converted: summary.converted,
        sourceDataFields: summary.sourceDataFields,
        convertedDataFields: summary.convertedDataFields,
        convertedStructuralElements: summary.convertedStructuralElements,
        blocked: summary.blocked,
        warnings: summary.warnings,
        errors: summary.errors,
        omitted: summary.omitted,
        placeholders: summary.placeholders,
      })
    )
  );

  for (const diagnostic of report.diagnostics) {
    const location = diagnostic.sourcePath ? ` [${diagnostic.sourcePath}]` : '';
    const message = `${diagnostic.code}${location}: ${diagnostic.message}`;
    if (diagnostic.severity === 'error') console.log(colors.error(message));
    else if (diagnostic.severity === 'warning') console.log(colors.warning(message));
    else console.log(colors.textSecondary(message));
  }
}

async function writeJsonWithConfirmation(targetPath, value, options) {
  const confirmed = await confirmOverwrite(targetPath, {
    force: options.force,
    readlineInterface: options.readlineInterface,
  });
  if (!confirmed) return false;
  await fs.ensureDir(path.dirname(path.resolve(targetPath)));
  await fs.writeJson(targetPath, value, { spaces: 2 });
  return true;
}

/**
 * Shared standalone/interactive Form.io conversion workflow.
 */
export async function runFormioConvertCommand(sourcePath, options = {}) {
  if (!sourcePath || isRemoteInput(sourcePath)) {
    throw new Error(t('commands.formioConvert.localFileRequired'));
  }

  const resolvedSource = path.resolve(sourcePath);
  const source = await fs.readJson(resolvedSource);
  const outputPath = options.output || defaultFormioOutputPath(sourcePath);
  const { schema, report } = convertFormioSchema(source, {
    allowLossy: options.allowLossy,
    sourceName: path.basename(sourcePath, path.extname(sourcePath)),
  });
  report.source.path = sourcePath;
  report.target.path = outputPath;

  printConversionReport(report);

  let reportPath = null;
  if (options.report) {
    const written = await writeJsonWithConfirmation(options.report, report, options);
    if (!written) return { cancelled: true, schema, report };
    reportPath = options.report;
    console.log(colors.success(t('commands.formioConvert.reportWritten', { path: reportPath })));
  }

  if (report.outcome === 'blocked') {
    return { success: false, blocked: true, schema, report, reportPath };
  }

  if (options.dryRun) {
    console.log(colors.info(t('commands.formioConvert.dryRunComplete')));
    return { success: true, dryRun: true, schema, report, reportPath };
  }

  const written = await writeJsonWithConfirmation(outputPath, schema, options);
  if (!written) return { cancelled: true, schema, report, reportPath };
  console.log(colors.success(t('commands.formioConvert.schemaWritten', { path: outputPath })));
  return {
    success: true,
    dryRun: false,
    schema,
    report,
    reportPath,
    schemaPath: outputPath,
  };
}

export async function formioConvertCommand(sourcePath, options = {}) {
  try {
    const result = await runFormioConvertCommand(sourcePath, options);
    if (result?.blocked) process.exitCode = 1;
    return result;
  } catch (error) {
    console.error(colors.error(t('commands.formioConvert.failed', { message: error.message })));
    process.exitCode = 1;
    return { success: false, error };
  }
}

export function parseInteractiveFormioConvertArgs(args) {
  const parsed = {
    provider: args[0] || null,
    sourcePath: null,
    options: {
      output: null,
      report: null,
      dryRun: false,
      allowLossy: false,
      force: false,
    },
    error: null,
  };

  const positional = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') parsed.options.dryRun = true;
    else if (arg === '--allow-lossy') parsed.options.allowLossy = true;
    else if (arg === '--force' || arg === '-f') parsed.options.force = true;
    else if (arg === '--output' || arg === '-o' || arg === '--report') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        parsed.error = `${arg} requires a path.`;
        return parsed;
      }
      if (arg === '--report') parsed.options.report = value;
      else parsed.options.output = value;
      index += 1;
    } else if (arg.startsWith('-')) {
      parsed.error = `Unknown option: ${arg}`;
      return parsed;
    } else {
      positional.push(arg);
    }
  }

  parsed.sourcePath = positional[0] || null;
  if (positional.length > 1) parsed.error = 'Only one source path may be provided.';
  return parsed;
}
