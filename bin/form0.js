#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'node:module';
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
import {
  reformLoginCommand,
  reformLogoutCommand,
  reformOrgsListCommand,
  reformScopeShowCommand,
  reformScopeUseCommand,
  reformSyncPruneCommand,
  reformSyncPullCommand,
  reformSyncStatusCommand,
  reformWhoamiCommand,
} from '../src/commands/reform.js';
import {
  schemaImportCommand,
  schemaExportCommand,
  schemaNewCommand,
  schemaDeleteCommand,
} from '../src/commands/schema.js';
import { formioConvertCommand } from '../src/commands/formio-convert.js';
import { loadConfig } from '../src/utils/config.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const program = new Command();

program.name('form0').description('CLI tools for form0-powered forms').version(version);

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
    .option('--source <source>', 'Template source (remote|local)')
    .option('--local', 'Use local templates (equivalent to --source local)')
    .option('--template-root <path>', 'Local template root path')
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
    .option('--public-url <url>', 'Override the public app URL used by structured Expo dev servers')
    .description('Start development server with live form preview')
    .action(serveCommand);

  const schemaProgram = program
    .command('schema')
    .description('Create, convert, and manage form schemas');

  schemaProgram
    .command('import')
    .argument('<csv>', 'Path to schema CSV file')
    .option('-o, --output <json>', 'Path for generated JSON schema', 'form.schema.json')
    .option('-f, --force', 'Overwrite destination without prompting')
    .description('Convert schema CSV into JSON')
    .action(schemaImportCommand);

  schemaProgram
    .command('export')
    .argument(
      '[csv]',
      'Path for generated CSV file (defaults to form.schema.csv)',
      'form.schema.csv'
    )
    .option('-i, --input <json>', 'Path to source schema JSON', 'form.schema.json')
    .option('-f, --force', 'Overwrite destination without prompting')
    .description('Export schema JSON to CSV')
    .action((csv, options) => schemaExportCommand(csv, options));

  const schemaConvertProgram = schemaProgram
    .command('convert')
    .description('Convert external form schemas into form0 schemas');

  schemaConvertProgram
    .command('formio')
    .argument('<source>', 'Path to an exported Form.io form JSON file')
    .option('-o, --output <json>', 'Path for the generated form0 schema')
    .option('--report <json>', 'Write a machine-readable conversion report')
    .option('--dry-run', 'Analyze conversion without writing or loading a schema')
    .option('--allow-lossy', 'Permit documented omissions and calculation placeholders')
    .option('-f, --force', 'Overwrite destinations without prompting')
    .description('Convert an exported Form.io form schema into a form0 schema')
    .action((source, options) => formioConvertCommand(source, options));

  schemaProgram
    .command('new')
    .description('Create a new schema')
    .action(() => schemaNewCommand());

  schemaProgram
    .command('delete')
    .argument('[schema]', 'Schema file name or form id')
    .description('Delete a schema')
    .action((schema) => schemaDeleteCommand(schema));

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

  const reformProgram = program
    .command('reform')
    .description('Authenticate with Reform and sync forms into the current project');

  reformProgram
    .command('login')
    .option('--auth-url <url>', 'Override the Reform auth base URL')
    .option('--api-url <url>', 'Override the Reform API base URL')
    .description('Log in to Reform using the browser device flow')
    .action((options) => reformLoginCommand(options));

  reformProgram
    .command('logout')
    .description('Log out from Reform and clear local credentials')
    .action(reformLogoutCommand);

  reformProgram
    .command('whoami')
    .description('Show the current Reform account and selected scope')
    .action(reformWhoamiCommand);

  const reformOrgsProgram = reformProgram
    .command('orgs')
    .description('List accessible Reform organizations');

  reformOrgsProgram
    .command('list')
    .description('List accessible main organizations and sub-organizations')
    .action(reformOrgsListCommand);

  const reformScopeProgram = reformProgram
    .command('scope')
    .description('View or change the saved Reform organization scope');

  reformScopeProgram
    .command('show')
    .description('Show the saved Reform scope')
    .action(reformScopeShowCommand);

  reformScopeProgram
    .command('use')
    .option('--main <id>', 'Main organization id')
    .option('--sub <id>', 'Sub-organization id')
    .description('Save the Reform scope used for sync operations')
    .action((options) => reformScopeUseCommand(options));

  const reformSyncProgram = reformProgram
    .command('sync')
    .description('Pull synced forms from Reform and manage synced files');

  reformSyncProgram
    .command('pull')
    .option('--force', 'Overwrite locally modified synced forms')
    .description('Pull active forms from Reform into the current project')
    .action((options) => reformSyncPullCommand(options));

  reformSyncProgram
    .command('status')
    .description('Show the local Reform sync manifest and file status')
    .action(reformSyncStatusCommand);

  reformSyncProgram
    .command('prune')
    .option('--dry-run', 'Show what would be pruned without deleting files')
    .option('--force', 'Prune even if synced files were modified locally')
    .description('Remove local forms that were confirmed deleted in Reform')
    .action((options) => reformSyncPruneCommand(options));

  program.parse();
}
