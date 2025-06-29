import path from 'path';
import { colors } from './theme.js';

/**
 * Display the welcome banner with ASCII art
 */
export function showWelcomeBanner() {
  console.log(colors.brandBold(`
  ███████╗ ██████╗ ██████╗ ███╗   ███╗ ██████╗ 
  ██╔════╝██╔═══██╗██╔══██╗████╗ ████║██╔═████╗
  █████╗  ██║   ██║██████╔╝██╔████╔██║██║██╔██║
  ██╔══╝  ██║   ██║██╔══██╗██║╚██╔╝██║████╔╝██║
  ██║     ╚██████╔╝██║  ██║██║ ╚═╝ ██║╚██████╔╝
  ╚═╝      ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝ ╚═════╝ 
    `));
  console.log(colors.brand('                    Interactive CLI Environment'));
  console.log(colors.brand('                    Made with 🦙 by paqu.io\n'));
}

/**
 * Display the help text with all available commands
 */
export function showHelp() {
  console.log(colors.header('\n📚 Available Commands:\n'));
  console.log(colors.textSecondary('  Notation: <required> [optional]'));
  console.log();
  console.log(colors.accent1('  Schema Management:'));
  console.log(colors.text('    init [dir]           Initialize new form0 project (default: current dir)'));
  console.log(colors.text('    load <file>, l       Load a form schema file'));
  console.log(colors.text('    reload, rld          Reload current schema file'));
  console.log(colors.text('    validate, v          Validate current schema'));
  console.log(colors.text('    preview, p           Show form structure'));
  console.log();
  console.log(colors.accent1('  Engine Operations:'));
  console.log(colors.text('    run [options], r     Execute form engine with optional values'));
  console.log(colors.textSecondary('      options: --values <input>'));
  console.log(colors.text('    test [dir], t        Run test.js file in directory (default: current dir)'));
  console.log(colors.text('    watch [options], w   Watch schema file for changes'));
  console.log(colors.textSecondary('      options: --auto-run, --auto-validate, --values <input>'));
  console.log(colors.text('    watch stop           Stop watching current schema'));
  console.log(colors.text('    values               Show stored test values'));
  console.log(colors.text('    fields, f            Show valid field names from schema'));
  console.log();
  console.log(colors.accent1('  Session Management:'));
  console.log(colors.text('    status, s            Show session status'));
  console.log(colors.text('    theme [name]         View or change theme (dark, light)'));
  console.log(colors.text('    locale [name]        View or change locale (auto, en, es, fr, it)'));
  console.log(colors.text('    clear values         Clear stored values'));
  console.log(colors.text('    clear, cls           Clear screen'));
  console.log(colors.text('    help, h              Show this help'));
  console.log(colors.text('    exit, quit, q        Exit interactive mode'));
  console.log();
  console.log(colors.textMuted('  Navigation: Use ↑/↓ arrows for command history, Tab for completion'));
  console.log(colors.textMuted('  Examples:'));
  console.log(colors.textMuted('    run --values {"first_name": "Alice", "age": 25}'));
  console.log(colors.textMuted('    run --values values.json  (uses values from file)'));
  console.log(colors.textMuted('    watch --auto-run  (uses stored values)'));
  console.log(colors.textMuted('    watch --auto-run --values {"first_name": "Bob", "age": 30}'));
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
    lastValues
  } = sessionInfo;

  console.log(colors.header('\n📊 Session Status:'));
  console.log(colors.textSecondary('  Directory:'), colors.value(path.basename(process.cwd())));
  console.log(colors.textSecondary('  Schema:'), currentSchemaPath ? colors.success(currentSchemaPath) : colors.error('None loaded'));
  console.log(colors.textSecondary('  Form:'), currentSchema?.form?.name ? colors.success(currentSchema.form.name) : colors.error('N/A'));
  console.log(colors.textSecondary('  Engine:'), engine ? colors.success('Ready') : colors.warning('Not initialized'));
  console.log(colors.textSecondary('  Watching:'), isWatching ? colors.success('Active') : colors.error('Stopped'));
  
  if (isWatching) {
    const options = [];
    if (watchOptions.autoRun) options.push('auto-run');
    if (watchOptions.autoValidate) options.push('auto-validate');
    if (options.length > 0) {
      console.log(colors.textSecondary('  Options:'), colors.warning(options.join(', ')));
    }
  }
  
  const valuesCount = Object.keys(lastValues).length;
  console.log(colors.textSecondary('  Test Values:'), valuesCount > 0 ? colors.success(`${valuesCount} fields stored`) : colors.error('None'));
  
  console.log();
}

/**
 * Display stored test values
 */
export function showValues(lastValues) {
  console.log(colors.header('\n💾 Stored Test Values:'));
  
  if (Object.keys(lastValues).length === 0) {
    console.log(colors.textSecondary('  No values currently stored'));
    console.log(colors.textMuted('  Use "run --values <values>" to store values\n'));
    return;
  }

  console.log(JSON.stringify(lastValues, null, 2));
  console.log();
}

/**
 * Display valid field names from schema
 */
export function showValidFields(validFields, hasSchema) {
  console.log(colors.header('\n📋 Valid Field Names:'));
  
  if (!hasSchema) {
    console.log(colors.error('  No schema loaded'));
    console.log(colors.textMuted('  Use "load <file>" to load a schema first\n'));
    return;
  }
  
  if (validFields.length === 0) {
    console.log(colors.textSecondary('  No fields found in schema'));
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
    
    const label = element.label || element.data_name || 'Unlabeled';
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
  console.log(colors.header(`\n📋 Form: ${form.name || 'Unnamed'}`));
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