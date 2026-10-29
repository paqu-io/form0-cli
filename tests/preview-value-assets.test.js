import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server/express-server.js';

test('preview exposes the shared normalizer and its only dependency as browser modules', async () => {
  const app = createApp(
    () => null,
    () => null,
    process.cwd()
  );
  const server = await new Promise((resolve) => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const asset of ['field-value-normalization.js', 'record-data.js']) {
      const response = await fetch(`${base}/form0-core/${asset}`);
      assert.equal(response.status, 200, asset);
      assert.match(response.headers.get('content-type'), /javascript/);
      assert.match(await response.text(), /export function/);
    }
    assert.equal((await fetch(`${base}/form0-core/index.js`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('core browser modules share a per-client request limit without blocking other preview routes', async () => {
  const app = createApp(
    () => null,
    () => null,
    process.cwd()
  );
  const server = await new Promise((resolve) => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const assets = ['field-value-normalization.js', 'record-data.js'];
  try {
    for (let index = 0; index < 120; index++) {
      const response = await fetch(`${base}/form0-core/${assets[index % assets.length]}`);
      assert.equal(response.status, 200);
      await response.text();
    }
    for (const asset of assets) {
      const response = await fetch(`${base}/form0-core/${asset}`);
      assert.equal(response.status, 429);
      assert.ok(Number(response.headers.get('retry-after')) > 0);
      assert.match(response.headers.get('ratelimit'), /r=0/);
      await response.text();
    }
    assert.equal((await fetch(`${base}/form0-core/index.js`)).status, 404);
    const schema = await fetch(`${base}/api/schema`);
    assert.equal(schema.status, 404);
    assert.equal((await schema.json()).error, 'No schema loaded');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
