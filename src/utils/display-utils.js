import path from 'path';
import { colors } from './theme.js';
import { t, tn } from './i18n.js';
import { getServerModeHelpEntries } from '../commands/interactive/command-catalog.js';

const ROOT_HELP_COMMAND_KEYS = [
  'initCommand',
  'loadCommand',
  'reloadCommand',
  'validateCommand',
  'previewCommand',
  'schemaImportCommand',
  'schemaExportCommand',
  'schemaConvertCommand',
  'schemaNewCommand',
  'schemaDeleteCommand',
  'schemaEditCommand',
  'aiCommand',
  'schemaKeysCommand',
  'runCommand',
  'testCommand',
  'watchCommand',
  'watchStopCommand',
  'valuesCommand',
  'fieldsCommand',
  'serveCommand',
  'serveStopCommand',
  'serveStatusCommand',
  'connectorCommand',
  'connectorInstallCommand',
  'connectorListCommand',
  'connectorStatusCommand',
  'connectorLoadCommand',
  'connectorTestCommand',
  'reformLoginCommand',
  'reformLogoutCommand',
  'reformWhoamiCommand',
  'reformOrgsListCommand',
  'reformScopeShowCommand',
  'reformScopeUseCommand',
  'reformSyncPullCommand',
  'reformSyncStatusCommand',
  'reformSyncPruneCommand',
  'statusCommand',
  'themeCommand',
  'localeCommand',
  'clearValuesCommand',
  'clearCommand',
  'helpCommand',
  'exitCommand',
];

function parseHelpCommand(value) {
  const match = String(value).match(/^(\s*)(.*?\S)\s{2,}(\S.*)$/);
  return match ? { indent: match[1], command: match[2], description: match[3] } : null;
}

export function formatRootHelpCommands(entries) {
  const parsed = entries.map(parseHelpCommand);
  const width = Math.max(0, ...parsed.filter(Boolean).map(({ command }) => command.length));
  return parsed.map((entry, index) =>
    entry
      ? `${entry.indent}${entry.command.padEnd(width + 2)}${entry.description}`
      : String(entries[index])
  );
}

/**
 * Display the welcome banner with ASCII art
 */
export function showWelcomeBanner() {
  console.log(
    colors.brandBold(`
  ░·· ··░   ███████╗ ██████╗ ██████╗ ███╗   ███╗ ██████╗   ░·· ··░
  ░·· ··░   ██╔════╝██╔═══██╗██╔══██╗████╗ ████║██╔═████╗  ░·· ··░
  ░·· ··░   █████╗  ██║   ██║██████╔╝██╔████╔██║██║██╔██║  ░·· ··░
  ░·· ··░   ██╔══╝  ██║   ██║██╔══██╗██║╚██╔╝██║████╔╝██║  ░·· ··░
  ░·· ··░   ██║     ╚██████╔╝██║  ██║██║ ╚═╝ ██║╚██████╔╝  ░·· ··░
  ░·· ··░   ╚═╝      ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝ ╚═════╝   ░·· ··░
    `)
  );
  console.log(colors.brand(t('help.title')));
  console.log(colors.brand(t('help.subtitle') + '\n'));
}

/**
 * Display the help text with all available commands
 */
export function showHelp({ serverMode = false } = {}) {
  console.log(colors.header('\n' + t('help.availableCommands') + '\n'));
  if (serverMode) {
    console.log(colors.textSecondary(t('interactive.serverMode.activeHelpNote')));
    console.log();
    for (const entry of getServerModeHelpEntries()) {
      console.log(colors.text(t(`interactive.serverMode.${entry.translationKey}`)));
    }
    console.log();
    return;
  }
  const formattedCommands = formatRootHelpCommands(
    ROOT_HELP_COMMAND_KEYS.map((key) => t(`help.${key}`))
  );
  const alignedCommands = new Map(
    ROOT_HELP_COMMAND_KEYS.map((key, index) => [key, formattedCommands[index]])
  );
  const command = (key) => alignedCommands.get(key);
  console.log(colors.textSecondary(t('help.notation')));
  console.log();
  console.log(colors.accent1(t('help.schemaManagement')));
  console.log(colors.text(command('initCommand')));
  console.log(colors.text(command('loadCommand')));
  console.log(colors.text(command('reloadCommand')));
  console.log(colors.text(command('validateCommand')));
  console.log(colors.text(command('previewCommand')));
  console.log(colors.text(command('schemaImportCommand')));
  console.log(colors.text(command('schemaExportCommand')));
  console.log(colors.text(command('schemaConvertCommand')));
  console.log(colors.textSecondary(t('help.schemaConvertOptions')));
  console.log(colors.text(command('schemaNewCommand')));
  console.log(colors.text(command('schemaDeleteCommand')));
  console.log(colors.text(command('schemaEditCommand')));
  console.log(colors.text(command('aiCommand')));
  console.log(colors.text(command('schemaKeysCommand')));
  console.log();
  console.log(colors.accent1(t('help.engineOperations')));
  console.log(colors.text(command('runCommand')));
  console.log(colors.textSecondary(t('help.runOptions')));
  console.log(colors.text(command('testCommand')));
  console.log(colors.text(command('watchCommand')));
  console.log(colors.textSecondary(t('help.watchOptions')));
  console.log(colors.text(command('watchStopCommand')));
  console.log(colors.text(command('valuesCommand')));
  console.log(colors.text(command('fieldsCommand')));
  console.log();
  console.log(colors.accent1(t('help.development')));
  console.log(colors.text(command('serveCommand')));
  console.log(colors.textSecondary(t('help.serveOptions')));
  console.log(colors.text(command('serveStopCommand')));
  console.log(colors.text(command('serveStatusCommand')));
  console.log();
  console.log(colors.accent1(t('help.dataConnectivity')));
  console.log(colors.text(command('connectorCommand')));
  console.log(colors.text(command('connectorInstallCommand')));
  console.log(colors.text(command('connectorListCommand')));
  console.log(colors.text(command('connectorStatusCommand')));
  console.log(colors.text(command('connectorLoadCommand')));
  console.log(colors.text(command('connectorTestCommand')));
  console.log(colors.textSecondary(t('help.connectorHelpCommand')));
  console.log();
  console.log(colors.accent1(t('help.reformSection')));
  console.log(colors.text(command('reformLoginCommand')));
  console.log(colors.text(command('reformLogoutCommand')));
  console.log(colors.text(command('reformWhoamiCommand')));
  console.log(colors.text(command('reformOrgsListCommand')));
  console.log(colors.text(command('reformScopeShowCommand')));
  console.log(colors.text(command('reformScopeUseCommand')));
  console.log(colors.text(command('reformSyncPullCommand')));
  console.log(colors.text(command('reformSyncStatusCommand')));
  console.log(colors.text(command('reformSyncPruneCommand')));
  console.log();
  console.log(colors.accent1(t('help.sessionManagement')));
  console.log(colors.text(command('statusCommand')));
  console.log(colors.text(command('themeCommand')));
  console.log(colors.text(command('localeCommand')));
  console.log(colors.text(command('clearValuesCommand')));
  console.log(colors.text(command('clearCommand')));
  console.log(colors.text(command('helpCommand')));
  console.log(colors.text(command('exitCommand')));
  console.log();
  console.log(colors.textMuted(t('help.navigation')));
  console.log(colors.textMuted(t('common.examples')));
  console.log(colors.textMuted(t('help.exampleRun1')));
  console.log(colors.textMuted(t('help.exampleRun2')));
  console.log(colors.textMuted(t('help.exampleWatch1')));
  console.log(colors.textMuted(t('help.exampleWatch2')));
  console.log();
}

/**
 * Display session status information
 */
export function showStatus(sessionInfo) {
  const {
    currentSchemaPath,
    currentSchema,
    engine,
    isWatching,
    watchOptions,
    lastValues,
    devServer,
  } = sessionInfo;

  console.log(colors.header('\n' + t('status.sessionStatus')));
  console.log(
    colors.textSecondary(t('status.directory')),
    colors.value(path.basename(process.cwd()))
  );
  console.log(
    colors.textSecondary(t('status.schema')),
    currentSchemaPath ? colors.success(currentSchemaPath) : colors.error(t('status.noneLoaded'))
  );
  console.log(
    colors.textSecondary(t('status.form')),
    currentSchema?.form?.name
      ? colors.success(currentSchema.form.name)
      : colors.error(t('status.notApplicable'))
  );

  // Show engine status differently based on dev server context
  if (devServer && devServer.running) {
    console.log(
      colors.textSecondary(t('status.engine')),
      colors.textMuted(t('status.handledByServer'))
    );
  } else {
    console.log(
      colors.textSecondary(t('status.engine')),
      engine ? colors.success(t('status.ready')) : colors.warning(t('status.notInitialized'))
    );
  }

  console.log(
    colors.textSecondary(t('status.watching')),
    isWatching ? colors.success(t('status.active')) : colors.error(t('status.stopped'))
  );

  if (isWatching) {
    const options = [];
    if (watchOptions.autoRun) options.push('auto-run');
    if (watchOptions.autoValidate) options.push('auto-validate');
    if (options.length > 0) {
      console.log(colors.textSecondary(t('status.options')), colors.warning(options.join(', ')));
    }
  }

  const valuesCount = Object.keys(lastValues).length;
  console.log(
    colors.textSecondary(t('status.testValues')),
    valuesCount > 0
      ? colors.success(tn('status.fieldsStored', valuesCount, { count: valuesCount }))
      : colors.error(t('status.none'))
  );

  // Show development server status
  if (devServer) {
    console.log(
      colors.textSecondary(t('status.devServer')),
      devServer.running
        ? colors.success(`http://${devServer.host}:${devServer.port}`)
        : colors.error(t('status.stopped'))
    );
  } else {
    console.log(colors.textSecondary(t('status.devServer')), colors.error(t('status.notStarted')));
  }

  console.log();
}

/**
 * Display stored test values
 */
export function showValues(lastValues) {
  console.log(colors.header('\n' + t('values.storedTestValues')));

  if (Object.keys(lastValues).length === 0) {
    console.log(colors.textSecondary(t('values.noValuesStored')));
    console.log(colors.textMuted(t('values.useRunToStore') + '\n'));
    return;
  }

  console.log(JSON.stringify(lastValues, null, 2));
  console.log();
}

/**
 * Display valid field names from schema
 */
export function showValidFields(validFields, hasSchema) {
  console.log(colors.header('\n' + t('fields.validFieldNames')));

  if (!hasSchema) {
    console.log(colors.error(t('fields.noSchemaLoaded')));
    console.log(colors.textMuted(t('fields.useLoadFirst') + '\n'));
    return;
  }

  if (validFields.length === 0) {
    console.log(colors.textSecondary(t('fields.noFieldsFound')));
  } else {
    console.log(colors.textSecondary(`  ${validFields.join(', ')}`));
  }

  console.log();
}

/**
 * Print form fields in a tree structure
 */
export function printFields(elements, indentOrOptions = '', maybeOptions = {}) {
  const hasIndent = typeof indentOrOptions === 'string';
  const indent = hasIndent ? indentOrOptions : '';
  const options = hasIndent ? maybeOptions : indentOrOptions || {};
  const counter = options.counter || { value: 0 };
  const lines = [];
  appendFieldPreviewLines(elements, lines, indent, options, counter);
  for (const line of lines) console.log(line);
}

function appendFieldPreviewLines(elements, lines, indent, options, counter) {
  elements.forEach((element, index) => {
    const isLast = index === elements.length - 1;
    const connector = isLast ? '└─' : '├─';
    const childIndent = indent + (isLast ? '  ' : '│ ');
    counter.value += 1;
    const idPrefix = options.showIds ? `${counter.value} | ` : '';
    const typeColor =
      {
        Section: colors.fieldSection,
        RepeatableSection: colors.fieldSection,
        BuildingPlanSection: colors.fieldSection,
        TextField: colors.fieldText,
        NumericField: colors.fieldNumeric,
        CalculatedField: colors.fieldCalculated,
        SingleChoiceField: colors.fieldChoice,
        MultiChoiceField: colors.fieldChoice,
        BooleanField: colors.fieldChoice,
        DateField: colors.fieldDate,
        TimeField: colors.fieldTime,
        LabelField: colors.fieldLabel,
        SignatureField: colors.fieldSignature,
        PhotoField: colors.fieldMedia,
      }[element.type] || colors.fieldDefault;
    const label = element.label || element.data_name || t('commands.preview.unlabeled');
    const dataNameDisplay = element.data_name ? colors.textMuted(` [${element.data_name}]`) : '';
    const keyDisplay = element.key ? colors.textMuted(` (key: ${element.key})`) : '';
    lines.push(
      `${indent}${connector} ${idPrefix}${typeColor(element.type)} ${colors.label(label)}${dataNameDisplay}${keyDisplay}`
    );
    if (
      ['Section', 'RepeatableSection', 'BuildingPlanSection'].includes(element.type) &&
      Array.isArray(element.elements)
    ) {
      appendFieldPreviewLines(element.elements, lines, childIndent, options, counter);
    }
  });
}

/** Return the friendly schema preview as terminal-formatted lines. */
export function formatSchemaPreviewLines(schema, options = {}) {
  const form = schema.form;
  const lines = [
    colors.header(
      t('commands.preview.formTitle', { name: form.name || t('commands.preview.unnamed') })
    ),
  ];
  if (form.description) lines.push(colors.textSecondary(`   ${form.description}`));
  lines.push('');
  appendFieldPreviewLines(form.elements || [], lines, '', options, { value: 0 });
  return lines;
}

/**
 * Display schema preview
 */
export function showSchemaPreview(schema, options = {}) {
  console.log('');
  for (const line of formatSchemaPreviewLines(schema, options)) console.log(line);
  console.log();
}

/**
 * Format current timestamp for file change notifications
 */
export function formatTimestamp() {
  return new Date().toLocaleTimeString();
}
