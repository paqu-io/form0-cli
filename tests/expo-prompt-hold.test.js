import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import fs from 'fs-extra';
import { ShellCore } from '../src/commands/interactive/shell-core.js';
import { ServerManager } from '../src/commands/interactive/managers/server-manager.js';

function shellWithSpies() {
  const shell = new ShellCore(null, null, null);
  const prompts = [];
  shell.rl = { setPrompt() {}, prompt: () => prompts.push('prompt') };
  return { shell, prompts };
}

test('a held prompt is not drawn until the next Enter', async () => {
  const { shell, prompts } = shellWithSpies();
  shell.commandHandler = {
    handleCommand: async (command) => {
      if (command === 'serve --app') shell.holdPrompt();
    },
  };

  await shell.handleLine('serve --app');
  shell.refreshPrompt();
  shell.prompt();
  assert.deepEqual(prompts, [], 'nothing may draw the prompt over the QR code');
  assert.equal(shell.isPromptHeld(), true);

  await shell.handleLine('');
  assert.deepEqual(prompts, ['prompt']);
  assert.equal(shell.isPromptHeld(), false);

  // Other commands keep prompting right away.
  await shell.handleLine('status');
  assert.deepEqual(prompts, ['prompt', 'prompt']);
});

test('releasing a held prompt lets refreshes draw it again', () => {
  const { shell, prompts } = shellWithSpies();
  shell.holdPrompt();
  shell.refreshPrompt();
  shell.releasePrompt();
  shell.refreshPrompt();
  assert.deepEqual(prompts, ['prompt']);
});

async function expoProject() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-expo-hold-'));
  await fs.writeFile(
    path.join(dir, 'form0.config.js'),
    "export default { devServer: { type: 'app', provider: 'expo' } };\n"
  );
  return dir;
}

function managerFor(dir, shellCore) {
  return new ServerManager(
    {
      getCurrentSchemaPath: () => path.join(dir, 'form.schema.json'),
      getCurrentSchema: () => null,
    },
    { isCurrentlyWatching: () => false, startWatchingInServerMode() {} },
    new EventEmitter(),
    shellCore
  );
}

function heldPromptStub() {
  let held = false;
  return {
    holdPrompt: () => (held = true),
    releasePrompt: () => (held = false),
    isPromptHeld: () => held,
    refreshPrompt() {},
  };
}

test('interactive serve --app for Expo holds the prompt, says so, and flags the preview', async () => {
  const dir = await expoProject();
  const shellCore = heldPromptStub();
  const manager = managerFor(dir, shellCore);
  manager.startAppServer = async () => {
    manager.appServerProcess = { pid: 1 };
  };
  const lines = [];
  const log = console.log;
  console.log = (line = '') => lines.push(stripVTControlCharacters(String(line)));
  try {
    await manager.startDevAndAppServers(['--port', '0']);
  } finally {
    console.log = log;
  }
  try {
    assert.equal(shellCore.isPromptHeld(), true, 'the app is running, so the prompt stays held');
    const banner = lines.join('\n').trim().split('\n');
    assert.match(banner.at(-2), /Expo's QR code appears below\. Press Enter to return/);
    assert.match(banner.at(-1), /Use "serve stop" or Ctrl\+C to stop both servers\./);

    const { port } = manager.devServer.getStatus();
    const response = await fetch(`http://localhost:${port}/api/schema`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).expoApp, true);
  } finally {
    manager.appServerProcess = null;
    await manager.stopDevServer();
    await fs.remove(dir);
  }
});

test('the prompt is released when the Expo app does not start', async () => {
  const dir = await expoProject();
  const shellCore = heldPromptStub();
  const manager = managerFor(dir, shellCore);
  manager.startAppServer = async () => {};
  manager.startDevServer = async () => {
    manager.devServer = { getStatus: () => ({ running: true }) };
  };
  try {
    await manager.startDevAndAppServers([]);
    assert.equal(shellCore.isPromptHeld(), false);
  } finally {
    await fs.remove(dir);
  }
});

test('the preview is not flagged as an Expo app by default', async () => {
  const { Form0Server } = await import('../src/commands/serve.js');
  const server = new Form0Server(null, { port: 0 });
  await server.start();
  try {
    const response = await fetch(`http://localhost:${server.port}/api/schema`);
    assert.equal((await response.json()).expoApp, false);
  } finally {
    await server.stop();
  }
});
