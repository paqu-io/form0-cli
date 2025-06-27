import chalk from 'chalk';
import path from 'path';
import { BRAND_COLOR } from './constants.js';

/**
 * Display the welcome banner with ASCII art
 */
export function showWelcomeBanner() {
  console.log(chalk.hex(BRAND_COLOR).bold(`
  ███████╗ ██████╗ ██████╗ ███╗   ███╗ ██████╗ 
  ██╔════╝██╔═══██╗██╔══██╗████╗ ████║██╔═████╗
  █████╗  ██║   ██║██████╔╝██╔████╔██║██║██╔██║
  ██╔══╝  ██║   ██║██╔══██╗██║╚██╔╝██║████╔╝██║
  ██║     ╚██████╔╝██║  ██║██║ ╚═╝ ██║╚██████╔╝
  ╚═╝      ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝ ╚═════╝ 
    `));
  console.log(chalk.hex(BRAND_COLOR)('                    Interactive CLI Environment'));
  console.log(chalk.hex(BRAND_COLOR)('                    Made with 🦙 by paqu.io\n'));
}

/**
 * Display the help text with all available commands
 */
export function showHelp() {
  console.log(chalk.blue.bold('\n📚 Available Commands:\n'));
  console.log(chalk.gray('  Notation: <required> [optional]'));
  console.log();
  console.log(chalk.cyan('  Schema Management:'));
  console.log('    init [dir]           Initialize new form0 project (default: current dir)');
  console.log('    load <file>, l       Load a form schema file');
  console.log('    reload, rld          Reload current schema file');
  console.log('    validate, v          Validate current schema');
  console.log('    preview, p           Show form structure');
  console.log();
  console.log(chalk.cyan('  Engine Operations:'));
  console.log('    run [options], r     Execute form engine with optional values');
  console.log(chalk.gray('      options: --values <input>'));
  console.log('    test [dir], t        Run test.js file in directory (default: current)');
  console.log('    watch [options], w   Watch schema file for changes');
  console.log(chalk.gray('      options: --auto-run, --auto-validate, --values <input>'));
  console.log('    watch stop           Stop watching current schema');
  console.log('    values               Show stored test values');
  console.log('    fields, f            Show valid field names from schema');
  console.log();
  console.log(chalk.cyan('  Session Management:'));
  console.log('    status, s            Show session status');
  console.log('    theme [name]         View or change theme (dark, light)');
  console.log('    clear values         Clear stored values');
  console.log('    clear, cls           Clear screen');
  console.log('    help, h              Show this help');
  console.log('    exit, quit, q        Exit interactive mode');
  console.log();
  console.log(chalk.gray('  Navigation: Use ↑/↓ arrows for command history, Tab for completion'));
  console.log(chalk.gray('  Examples:'));
  console.log(chalk.gray('    run --values {"first_name": "Alice", "age": 25}'));
  console.log(chalk.gray('    run --values values.json  (uses values from file)'));
  console.log(chalk.gray('    watch --auto-run  (uses stored values)'));
  console.log(chalk.gray('    watch --auto-run --values {"first_name": "Bob", "age": 30}'));
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

  console.log(chalk.blue.bold('\n📊 Session Status:'));
  console.log(chalk.gray('  Directory:'), chalk.cyan(path.basename(process.cwd())));
  console.log(chalk.gray('  Schema:'), currentSchemaPath ? chalk.green(currentSchemaPath) : chalk.red('None loaded'));
  console.log(chalk.gray('  Form:'), currentSchema?.form?.name ? chalk.green(currentSchema.form.name) : chalk.red('N/A'));
  console.log(chalk.gray('  Engine:'), engine ? chalk.green('Ready') : chalk.yellow('Not initialized'));
  console.log(chalk.gray('  Watching:'), isWatching ? chalk.green('Active') : chalk.red('Stopped'));
  
  if (isWatching) {
    const options = [];
    if (watchOptions.autoRun) options.push('auto-run');
    if (watchOptions.autoValidate) options.push('auto-validate');
    if (options.length > 0) {
      console.log(chalk.gray('  Options:'), chalk.yellow(options.join(', ')));
    }
  }
  
  const valuesCount = Object.keys(lastValues).length;
  console.log(chalk.gray('  Test Values:'), valuesCount > 0 ? chalk.green(`${valuesCount} fields stored`) : chalk.red('None'));
  
  console.log();
}

/**
 * Display stored test values
 */
export function showValues(lastValues) {
  console.log(chalk.blue.bold('\n💾 Stored Test Values:'));
  
  if (Object.keys(lastValues).length === 0) {
    console.log(chalk.gray('  No values currently stored'));
    console.log(chalk.gray('  Use "run --values <values>" to store values\n'));
    return;
  }

  console.log(JSON.stringify(lastValues, null, 2));
  console.log();
}

/**
 * Display valid field names from schema
 */
export function showValidFields(validFields, hasSchema) {
  console.log(chalk.blue.bold('\n📋 Valid Field Names:'));
  
  if (!hasSchema) {
    console.log(chalk.red('  No schema loaded'));
    console.log(chalk.gray('  Use "load <file>" to load a schema first\n'));
    return;
  }
  
  if (validFields.length === 0) {
    console.log(chalk.gray('  No fields found in schema'));
  } else {
    console.log(chalk.gray(`  ${validFields.join(', ')}`));
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
    
    let typeColor = chalk.white;
    switch (element.type) {
      case 'Section':
        typeColor = chalk.magenta;
        break;
      case 'TextField':
        typeColor = chalk.green;
        break;
      case 'NumericField':
        typeColor = chalk.blue;
        break;
      case 'CalculatedField':
        typeColor = chalk.yellow;
        break;
      default:
        typeColor = chalk.cyan;
    }
    
    const label = element.label || element.data_name || 'Unlabeled';
    const dataNameDisplay = element.data_name ? chalk.gray(` [${element.data_name}]`) : '';
    const keyDisplay = element.key ? chalk.gray(` (key: ${element.key})`) : '';
    
    console.log(
      `${indent}${connector} ${typeColor(element.type)} ${chalk.bold(label)}${dataNameDisplay}${keyDisplay}`
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
  console.log(chalk.blue.bold(`\n📋 Form: ${form.name || 'Unnamed'}`));
  if (form.description) {
    console.log(chalk.gray(`   ${form.description}`));
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