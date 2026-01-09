#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from '../src/commands/init.js';
import { testCommand } from '../src/commands/test.js';
import { validateCommand } from '../src/commands/validate.js';
import { previewCommand } from '../src/commands/preview.js';
import { runCommand } from '../src/commands/run.js';
import { watchCommand } from '../src/commands/watch.js';
import { serveCommand } from '../src/commands/serve.js';
import { interactiveCommand } from '../src/commands/interactive.js';
import { themeCommand } from '../src/commands/theme.js';
import { localeCommand } from '../src/commands/locale.js';
import { connectorCommand } from '../src/commands/connector.js';
import { schemaImportCommand, schemaExportCommand } from '../src/commands/schema.js';
import { loadConfig } from '../src/utils/config.js';

const program = new Command();

program.name('form0').description('CLI tools for form0-powered forms').version('0.0.1-alpha.1');

// Load configuration (theme settings, etc.)
await loadConfig();

// Check if no arguments provided - enter interactive mode
if (process.argv.length === 2) {
  interactiveCommand();
} else {
  // Traditional command mode
  program
    .command('init')
    .argument('[dir]', 'Directory to create', 'my-form')
    .description('Initialize a new form0 schema project')
    .action(initCommand);

  program
    .command('test')
    .argument('[dir]', 'Directory containing test.js file', '.')
    .description('Run the test.js file in the specified directory')
    .action(testCommand);

  program
    .command('validate')
    .argument('<schema>', 'Path to schema JSON file')
    .description('Validate a form schema using form0-core')
    .action(validateCommand);

  program
    .command('preview')
    .argument('<schema>', 'Path to schema JSON file')
    .description('Print a summary of form fields')
    .action(previewCommand);

  program
    .command('run')
    .argument('<schema>', 'Path to schema JSON file')
    .option('--values <input>', 'Initial values (JSON string or path to .json/.yaml/.yml file)')
    .description('Run the form engine and print its state')
    .action(runCommand);

  program
    .command('watch')
    .argument('[schema]', 'Path to schema JSON file (defaults to form.schema.json)')
    .option('--auto-run', 'Automatically run engine when schema changes')
    .option('--auto-validate', 'Automatically validate schema when it changes')
    .option(
      '--values <input>',
      'Initial values for auto-run (JSON string or path to .json/.yaml/.yml file)'
    )
    .description('Watch schema file for changes and reload automatically')
    .action(watchCommand);

  program
    .command('serve')
    .argument('[schema]', 'Path to schema JSON file (defaults to form.schema.json)')
    .option('-p, --port <port>', 'Port to run server on', '3030')
    .option('--host <host>', 'Host to bind server to', 'localhost')
    .option('--app', 'Start the project dev server command from form0.config.js')
    .description('Start development server with live form preview')
    .action(serveCommand);

  const schemaProgram = program
    .command('schema')
    .description('Convert schemas between JSON and CSV formats');

  schemaProgram
    .command('import')
    .argument('<csv>', 'Path to schema CSV file')
    .option('-o, --output <json>', 'Path for generated JSON schema', 'form.schema.json')
    .option('-f, --force', 'Overwrite destination without prompting')
    .description('Convert schema CSV into JSON')
    .action(schemaImportCommand);

  schemaProgram
    .command('export')
    .argument('[csv]', 'Path for generated CSV file (defaults to form.schema.csv)', 'form.schema.csv')
    .option('-i, --input <json>', 'Path to source schema JSON', 'form.schema.json')
    .option('-f, --force', 'Overwrite destination without prompting')
    .description('Export schema JSON to CSV')
    .action((csv, options) => schemaExportCommand(csv, options));

  // Add explicit interactive command for those who want to use it
  program
    .command('interactive')
    .alias('shell')
    .description('Enter interactive form0 environment')
    .action(interactiveCommand);

  // Theme command
  program
    .command('theme')
    .argument('[name]', 'Theme name (dark, light)')
    .description('View or change the current theme')
    .action(themeCommand);

  // Locale command
  program
    .command('locale')
    .argument('[name]', 'Locale option (auto, en, es, fr, it)')
    .description('View or change the current locale/language')
    .action(localeCommand);

  // Connector command
  program
    .command('connector')
    .argument('[action]', 'Action to perform (install, configure, test, status, remove, list)')
    .argument('[name]', 'Connector name (e.g., form0-connector-pg)')
    .description('Manage form connectors for data storage and integration')
    .action(connectorCommand);

  program.parse();
}
