#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from '../src/commands/init.js';
import { validateCommand } from '../src/commands/validate.js';

const program = new Command();

program
  .name('form0')
  .description('CLI tools for form0-powered forms')
  .version('0.1.0');

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

program.parse();