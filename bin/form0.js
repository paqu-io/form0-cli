#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from '../src/commands/init.js';
import { validateCommand } from '../src/commands/validate.js';
import { previewCommand } from '../src/commands/preview.js';
import { runCommand } from '../src/commands/run.js';

const program = new Command();

program.name('form0').description('CLI tools for form0-powered forms').version('0.1.0');

program
  .command('init')
  .argument('[dir]', 'Directory to create', 'my-form')
  .description('Initialize a new form0 schema project')
  .action(initCommand);

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

program.parse();
