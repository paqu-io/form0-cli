import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { FileWatcher } from '../src/commands/interactive/file-watcher.js';
import { ServerManager } from '../src/commands/interactive/managers/server-manager.js';

test('a schema loaded while serving is pushed and watched, also after a schema-less start', () => {
  let current = null;
  const watched = [];
  const manager = new ServerManager(
    {
      getCurrentSchema: () => (current ? { form: { name: current, elements: [] } } : null),
      getCurrentSchemaPath: () => current,
    },
    { startWatchingInServerMode: (schemaPath) => watched.push(schemaPath) },
    null
  );
  const pushed = [];
  manager.devServer = {
    actualSchemaPath: undefined,
    getStatus: () => ({ running: true }),
    setActualSchemaPath(schemaPath) {
      this.actualSchemaPath = schemaPath;
    },
    updateSchema: (schema) => pushed.push(schema.form.name),
  };

  current = 'src/forms/demo/schema.json';
  manager.updateDevServerSchema();
  // Saving the same schema pushes it again without replacing its watcher.
  manager.updateDevServerSchema();
  current = 'src/forms/demo-bis/schema.json';
  manager.updateDevServerSchema();

  assert.deepEqual(watched, ['src/forms/demo/schema.json', 'src/forms/demo-bis/schema.json']);
  assert.deepEqual(pushed, [
    'src/forms/demo/schema.json',
    'src/forms/demo/schema.json',
    'src/forms/demo-bis/schema.json',
  ]);
});

test('the server-mode watcher moves to a newly loaded schema and keeps its options', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'form0-cli-load-watch-'));
  const nextSchema = path.join(tempDir, 'next.schema.json');
  await writeFile(nextSchema, '{}');

  const watcher = new FileWatcher({}, {});
  let previousClosed = false;
  watcher.watcher = { close: () => (previousClosed = true) };
  watcher.isWatching = true;
  watcher.watchOptions = { autoValidate: true, autoRun: false };
  let changed;
  const change = new Promise((resolve) => (changed = resolve));
  watcher.handleFileChange = async (filePath) => changed(filePath);

  watcher.startWatchingInServerMode(nextSchema);
  try {
    assert.equal(previousClosed, true);
    assert.deepEqual(watcher.watchOptions, { autoValidate: true, autoRun: false });
    await once(watcher.watcher, 'ready');
    await writeFile(nextSchema, JSON.stringify({ revision: 1 }));
    let timeout;
    const changedPath = await Promise.race([
      change,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Timed out waiting for file change')), 5_000);
      }),
    ]).finally(() => clearTimeout(timeout));
    assert.equal(changedPath, nextSchema);
  } finally {
    await watcher.watcher.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
