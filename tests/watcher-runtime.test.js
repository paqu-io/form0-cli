import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { FileWatcher } from '../src/commands/interactive/file-watcher.js';
import { Form0Server } from '../src/commands/serve.js';
import { Form0Watcher } from '../src/commands/watch.js';

function waitForEvent(emitter, eventName, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for watcher ${eventName}`)),
      timeoutMs
    );
    emitter.once(eventName, (...args) => {
      clearTimeout(timeout);
      resolve(args);
    });
    emitter.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function deferredChange() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function writeAndWait(schemaPath, changed, revision) {
  await writeFile(schemaPath, JSON.stringify({ revision }));
  let timeout;
  try {
    await Promise.race([
      changed.promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Timed out waiting for file change')), 5_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

test('standalone, serve, and interactive watchers observe explicit paths and close cleanly', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'form0-cli-watcher-'));
  const schemaPath = path.join(tempDir, 'form.schema.json');
  await writeFile(schemaPath, '{}');

  const originalConsole = {
    log: console.log,
    error: console.error,
  };
  console.log = () => {};
  console.error = () => {};

  try {
    const standaloneChanged = deferredChange();
    const standalone = new Form0Watcher(schemaPath);
    standalone.handleFileChange = async () => standaloneChanged.resolve();
    standalone.startWatching();
    await waitForEvent(standalone.watcher, 'ready');
    await writeAndWait(schemaPath, standaloneChanged, 1);
    const standaloneHandle = standalone.watcher;
    standalone.stop();
    await standaloneHandle.close();
    assert.equal(standalone.isWatching, false);

    const serverChanged = deferredChange();
    const server = new Form0Server(schemaPath);
    server.handleSchemaChange = async () => serverChanged.resolve();
    server.startWatching();
    await waitForEvent(server.watcher, 'ready');
    await writeAndWait(schemaPath, serverChanged, 2);
    await server.stop();
    assert.equal(server.watcher, null);

    const interactiveChanged = deferredChange();
    const interactive = new FileWatcher(
      {
        getCurrentSchemaPath: () => schemaPath,
        reloadSchema: async () => interactiveChanged.resolve(),
        getCurrentSchema: () => ({ form: { name: 'Watcher test', elements: [] } }),
      },
      {
        resetEngine: () => {},
        getLastValues: () => ({}),
      }
    );
    interactive.startWatching();
    await waitForEvent(interactive.watcher, 'ready');
    await writeAndWait(schemaPath, interactiveChanged, 3);
    const interactiveHandle = interactive.watcher;
    interactive.stopWatching();
    await interactiveHandle.close();
    assert.equal(interactive.isWatching, false);
  } finally {
    Object.assign(console, originalConsole);
    await rm(tempDir, { recursive: true, force: true });
  }
});
