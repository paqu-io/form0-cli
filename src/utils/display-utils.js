import path from 'path';
import { colors } from './theme.js';
import { t, tn } from './i18n.js';

/**
 * Display the welcome banner with ASCII art
 */
export function showWelcomeBanner() {
  console.log(colors.brandBold(`
  ░·· ··░   ███████╗ ██████╗ ██████╗ ███╗   ███╗ ██████╗   ░·· ··░
  ░·· ··░   ██╔════╝██╔═══██╗██╔══██╗████╗ ████║██╔═████╗  ░·· ··░
  ░·· ··░   █████╗  ██║   ██║██████╔╝██╔████╔██║██║██╔██║  ░·· ··░
  ░·· ··░   ██╔══╝  ██║   ██║██╔══██╗██║╚██╔╝██║████╔╝██║  ░·· ··░
  ░·· ··░   ██║     ╚██████╔╝██║  ██║██║ ╚═╝ ██║╚██████╔╝  ░·· ··░
  ░·· ··░   ╚═╝      ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝ ╚═════╝   ░·· ··░
    `));
  console.log(colors.brand(t('help.title')));
  console.log(colors.brand(t('help.subtitle') + '\n'));
}

/**
 * Display the help text with all available commands
 */
export function showHelp() {
  console.log(colors.header('\n' + t('help.availableCommands') + '\n'));
  console.log(colors.textSecondary(t('help.notation')));
  console.log();
  console.log(colors.accent1(t('help.schemaManagement')));
  console.log(colors.text(t('help.initCommand')));
  console.log(colors.text(t('help.loadCommand')));
  console.log(colors.text(t('help.reloadCommand')));
  console.log(colors.text(t('help.validateCommand')));
  console.log(colors.text(t('help.previewCommand')));
  console.log();
  console.log(colors.accent1(t('help.engineOperations')));
  console.log(colors.text(t('help.runCommand')));
  console.log(colors.textSecondary(t('help.runOptions')));
  console.log(colors.text(t('help.testCommand')));
  console.log(colors.text(t('help.watchCommand')));
  console.log(colors.textSecondary(t('help.watchOptions')));
  console.log(colors.text(t('help.watchStopCommand')));
  console.log(colors.text(t('help.valuesCommand')));
  console.log(colors.text(t('help.fieldsCommand')));
  console.log();
  console.log(colors.accent1(t('help.development')));
  console.log(colors.text(t('help.serveCommand')));
  console.log(colors.textSecondary(t('help.serveOptions')));
  console.log(colors.text(t('help.serveStopCommand')));
  console.log(colors.text(t('help.serveStatusCommand')));
  console.log();
  console.log(colors.accent1(t('help.sessionManagement')));
  console.log(colors.text(t('help.statusCommand')));
  console.log(colors.text(t('help.themeCommand')));
  console.log(colors.text(t('help.localeCommand')));
  console.log(colors.text(t('help.clearValuesCommand')));
  console.log(colors.text(t('help.clearCommand')));
  console.log(colors.text(t('help.helpCommand')));
  console.log(colors.text(t('help.exitCommand')));
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
    devServer
  } = sessionInfo;

  console.log(colors.header('\n' + t('status.sessionStatus')));
  console.log(colors.textSecondary(t('status.directory')), colors.value(path.basename(process.cwd())));
  console.log(colors.textSecondary(t('status.schema')), currentSchemaPath ? colors.success(currentSchemaPath) : colors.error(t('status.noneLoaded')));
  console.log(colors.textSecondary(t('status.form')), currentSchema?.form?.name ? colors.success(currentSchema.form.name) : colors.error(t('status.notApplicable')));
  
  // Show engine status differently based on dev server context
  if (devServer && devServer.running) {
    console.log(colors.textSecondary(t('status.engine')), colors.textMuted(t('status.handledByServer')));
  } else {
    console.log(colors.textSecondary(t('status.engine')), engine ? colors.success(t('status.ready')) : colors.warning(t('status.notInitialized')));
  }
  
  console.log(colors.textSecondary(t('status.watching')), isWatching ? colors.success(t('status.active')) : colors.error(t('status.stopped')));
  
  if (isWatching) {
    const options = [];
    if (watchOptions.autoRun) options.push('auto-run');
    if (watchOptions.autoValidate) options.push('auto-validate');
    if (options.length > 0) {
      console.log(colors.textSecondary(t('status.options')), colors.warning(options.join(', ')));
    }
  }
  
  const valuesCount = Object.keys(lastValues).length;
  console.log(colors.textSecondary(t('status.testValues')), valuesCount > 0 ? colors.success(tn('status.fieldsStored', valuesCount, { count: valuesCount })) : colors.error(t('status.none')));
  
  // Show development server status
  if (devServer) {
    console.log(colors.textSecondary(t('status.devServer')), devServer.running ? colors.success(`http://${devServer.host}:${devServer.port}`) : colors.error(t('status.stopped')));
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
export function printFields(elements, indent = '') {
  elements.forEach((element, index) => {
    const isLast = index === elements.length - 1;
    const connector = isLast ? '└─' : '├─';
    const childIndent = indent + (isLast ? '  ' : '│ ');
    
    let typeColor = colors.fieldDefault;
    switch (element.type) {
      case 'Section':
        typeColor = colors.fieldSection;
        break;
      case 'TextField':
        typeColor = colors.fieldText;
        break;
      case 'NumericField':
        typeColor = colors.fieldNumeric;
        break;
      case 'CalculatedField':
        typeColor = colors.fieldCalculated;
        break;
      default:
        typeColor = colors.fieldDefault;
    }
    
    const label = element.label || element.data_name || t('commands.preview.unlabeled');
    const dataNameDisplay = element.data_name ? colors.textMuted(` [${element.data_name}]`) : '';
    const keyDisplay = element.key ? colors.textMuted(` (key: ${element.key})`) : '';
    
    console.log(
      `${indent}${connector} ${typeColor(element.type)} ${colors.label(label)}${dataNameDisplay}${keyDisplay}`
    );
    
    if (element.type === 'Section' && element.elements) {
      printFields(element.elements, childIndent);
    }
  });
}

/**
 * Display schema preview
 */
export function showSchemaPreview(schema) {
  const form = schema.form;
  console.log(colors.header('\n' + t('commands.preview.formTitle', { name: form.name || t('commands.preview.unnamed') })));
  if (form.description) {
    console.log(colors.textSecondary(`   ${form.description}`));
  }
  console.log();
  
  printFields(form.elements || []);
  console.log();
}

/**
 * Format current timestamp for file change notifications
 */
export function formatTimestamp() {
  return new Date().toLocaleTimeString();
} 