import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import fs from 'fs-extra';
import {
  parseInteractiveFormioConvertArgs,
  runFormioConvertCommand,
} from '../src/commands/formio-convert.js';
import { CommandHandler } from '../src/commands/interactive/command-handler.js';
import { showHelp } from '../src/utils/display-utils.js';
import { setLocale } from '../src/utils/i18n.js';

async function testFileWorkflow() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-formio-command-'));
  const sourcePath = path.join(directory, 'source.json');
  const outputPath = path.join(directory, 'target.json');
  const reportPath = path.join(directory, 'report.json');
  await fs.writeJson(sourcePath, {
    title: 'Command test',
    components: [{ type: 'textfield', key: 'name', label: 'Name', input: true }],
  });

  const dryRun = await runFormioConvertCommand(sourcePath, {
    output: outputPath,
    dryRun: true,
    force: true,
  });
  assert.equal(dryRun.success, true);
  assert.equal(await fs.pathExists(outputPath), false);

  const result = await runFormioConvertCommand(sourcePath, {
    output: outputPath,
    report: reportPath,
    force: true,
  });
  assert.equal(result.success, true);
  assert.equal(await fs.pathExists(outputPath), true);
  assert.equal(await fs.pathExists(reportPath), true);

  const blockedSource = path.join(directory, 'blocked.json');
  const blockedOutput = path.join(directory, 'blocked-output.json');
  await fs.writeJson(blockedSource, {
    components: [{ type: 'address', key: 'address', label: 'Address', input: true }],
  });
  const blocked = await runFormioConvertCommand(blockedSource, {
    output: blockedOutput,
    force: true,
  });
  assert.equal(blocked.blocked, true);
  assert.equal(await fs.pathExists(blockedOutput), false);

  const cliSuccess = spawnSync(
    process.execPath,
    ['bin/form0.js', 'schema', 'convert', 'formio', sourcePath, '--dry-run', '--force'],
    { cwd: path.resolve('.'), encoding: 'utf8' }
  );
  assert.equal(cliSuccess.status, 0, cliSuccess.stderr);
  const cliBlocked = spawnSync(
    process.execPath,
    ['bin/form0.js', 'schema', 'convert', 'formio', blockedSource, '--dry-run', '--force'],
    { cwd: path.resolve('.'), encoding: 'utf8' }
  );
  assert.equal(cliBlocked.status, 1, cliBlocked.stderr);
  await fs.remove(directory);
}

function testInteractiveArgumentParser() {
  const parsed = parseInteractiveFormioConvertArgs([
    'formio',
    'source.json',
    '--output',
    'target.json',
    '--report',
    'report.json',
    '--allow-lossy',
    '--dry-run',
    '--force',
  ]);
  assert.equal(parsed.provider, 'formio');
  assert.equal(parsed.sourcePath, 'source.json');
  assert.equal(parsed.options.output, 'target.json');
  assert.equal(parsed.options.report, 'report.json');
  assert.equal(parsed.options.allowLossy, true);
  assert.equal(parsed.options.dryRun, true);
  assert.equal(parsed.options.force, true);
}

function testInteractiveHelpShowsConversionOptions() {
  setLocale('en');
  const output = [];
  const originalLog = console.log;
  console.log = (...args) => output.push(args.join(' '));
  try {
    showHelp();
  } finally {
    console.log = originalLog;
  }
  const help = output.join('\n');
  assert.match(help, /--report <json>/);
  assert.match(help, /--dry-run/);
  assert.match(help, /--allow-lossy/);
}

async function testInteractiveAutoLoad() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-formio-interactive-'));
  const sourcePath = path.join(directory, 'source.json');
  const outputPath = path.join(directory, 'target.json');
  await fs.writeJson(sourcePath, {
    components: [{ type: 'textfield', key: 'name', label: 'Name', input: true }],
  });

  const calls = [];
  const schemaManager = {
    loadSchema: async (value) => calls.push(['load', value]),
    getCurrentSchemaPath: () => null,
  };
  const engineRunner = { resetEngine: () => calls.push(['reset']) };
  const fileWatcher = { isCurrentlyWatching: () => false };
  const serverManager = {
    isServerRunning: () => false,
    updateDevServerSchema: () => calls.push(['server']),
  };
  const handler = new CommandHandler(schemaManager, engineRunner, fileWatcher, serverManager, {
    question() {},
  });
  await handler.handleCommand(`schema convert formio ${sourcePath} --output ${outputPath} --force`);
  assert.deepEqual(calls, [['load', outputPath], ['reset'], ['server']]);
  await fs.remove(directory);
}

await testFileWorkflow();
testInteractiveArgumentParser();
testInteractiveHelpShowsConversionOptions();
await testInteractiveAutoLoad();
console.log('Form.io conversion command tests passed.');
