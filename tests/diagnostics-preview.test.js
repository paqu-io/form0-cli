import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../src/server/express-server.js';
import { createWebSocketServer } from '../src/server/websocket.js';
import { FormStateManager } from '../src/server/static/form-state-manager.js';
import {
  createDiagnosticReporter,
  createPreviewDiagnosticController,
} from '../src/server/static/calculation-diagnostics.js';
import {
  schemaWithCalculation,
  failureExpression,
  nestedSchema,
  nestedInput,
} from './fixtures/diagnostics-schema.mjs';

async function withServer(schema, callback, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'form0-diag-http-'));
  const server = http.createServer(
    createApp(
      () => schema,
      () => 'Diagnostics test',
      dir,
      options
    )
  );
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const evaluate = async (body) => {
    const response = await fetch(base + '/api/engine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, state: await response.json() };
  };
  try {
    await callback({ base, evaluate, server });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

test('preview returns completed calculation failures, identical snapshots, and empty recovery with HTTP 200', async () => {
  await withServer(schemaWithCalculation(failureExpression), async ({ evaluate, base }) => {
    const initial = await (await fetch(base + '/api/default-values')).json();
    assert.deepEqual(initial.diagnostics, []);
    const failed = await evaluate({ values: { input: 0 } });
    assert.equal(failed.status, 200);
    assert.equal(failed.state.values.result, null);
    assert.equal(failed.state.diagnostics[0].code, 'runtime_exception');
    assert.deepEqual(failed.state.diagnostics[0].context.instancePath, []);
    assert.deepEqual(failed.state.errors, {});
    assert.deepEqual(failed.state.warnings, []);
    const repeated = await evaluate({ values: { input: 0 } });
    assert.deepEqual(repeated.state.diagnostics, failed.state.diagnostics);
    const recovered = await evaluate({ values: { input: 4 } });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.state.values.result, 3);
    assert.deepEqual(recovered.state.diagnostics, []);
  });
});

test('default-value diagnostics and reporting preference are published without disabling collection', async () => {
  await withServer(
    schemaWithCalculation('(() => { throw new Error("setup"); })()'),
    async ({ base, evaluate }) => {
      const schema = await (await fetch(base + '/api/schema')).json();
      assert.equal(schema.diagnosticsConsole, false);
      const defaults = await (await fetch(base + '/api/default-values')).json();
      assert.equal(defaults.diagnostics[0].message, 'setup');
      const result = await evaluate({});
      assert.equal(result.state.diagnostics.length, 1);
      assert.equal(result.status, 200);
    },
    { diagnostics: false }
  );
});

test('nested diagnostics belong to actual rows, with IDs and explicit positional fallback', async () => {
  await withServer(nestedSchema(), async ({ evaluate }) => {
    const result = await evaluate(nestedInput);
    assert.equal(result.status, 200);
    const rowFailure = result.state.diagnostics.find((item) => item.fieldName === 'row_total');
    const childFailure = result.state.diagnostics.find((item) => item.fieldName === 'child_total');
    assert.equal(result.state.diagnostics.length, 2);
    assert.deepEqual(rowFailure.context.instancePath, [
      {
        repeatableKey: 'rows',
        instanceId: 'row-b',
        index: 1,
        identity: 'id',
      },
    ]);
    assert.deepEqual(childFailure.context.instancePath, [
      { repeatableKey: 'rows', instanceId: 'row-b', index: 1, identity: 'id' },
      { repeatableKey: 'children', instanceId: null, index: 0, identity: 'position' },
    ]);
    assert.equal(result.state.repeatable.rows[1].id, 'row-b');
    assert.equal(result.state.repeatable.rows[1].repeatable.children[0].id, null);
    assert.equal('diagnostics' in result.state.repeatable.rows[1], false);
    assert.equal('diagnostics' in result.state.values, false);
    const clean = await evaluate({
      values: { input: 4 },
      repeatable: {
        rows: [
          {
            id: 'clean',
            values: { amount: 2 },
            repeatable: {
              children: [{ id: 'child', values: { quantity: 2 }, repeatable: {} }],
            },
          },
        ],
      },
    });
    assert.deepEqual(clean.state.diagnostics, []);
  });
});

test('root/nested states, operations, and evaluation counts match the captured original handler', async () => {
  const baseline = JSON.parse(
    await readFile(new URL('./fixtures/diagnostics-preservation.json', import.meta.url), 'utf8')
  );
  const counts = {};
  globalThis.__form0DiagCount = (name) => {
    counts[name] = (counts[name] || 0) + 1;
  };
  try {
    await withServer(nestedSchema({ counted: true }), async ({ evaluate }) => {
      const result = await evaluate(nestedInput);
      const { diagnostics, warnings, ...state } = result.state;
      assert.equal(result.status, baseline.status);
      assert.deepEqual(state, baseline.state);
      assert.deepEqual(counts, baseline.counts);
      assert.equal(diagnostics.length, 2);
      assert.deepEqual(warnings, []);
    });
  } finally {
    delete globalThis.__form0DiagCount;
  }
});

test('event warnings remain separate and cannot leak into a later request', async () => {
  const schema = nestedSchema();
  schema.form.events.code = 'ON("change", "input", function () { ALERT("Test", $row_total); });';
  await withServer(schema, async ({ evaluate }) => {
    const event = await evaluate({ values: { input: 4 }, eventType: 'change', fieldKey: 'input' });
    assert.equal(event.status, 200);
    assert.ok(event.state.warnings.some((item) => item.context?.type === 'event'));
    assert.deepEqual(event.state.diagnostics, []);
    const next = await evaluate({ values: { input: 4 } });
    assert.deepEqual(next.state.warnings, []);
    assert.deepEqual(next.state.diagnostics, []);
  });
});

test('adding diagnostics does not affect structured-record generation', async () => {
  await withServer(nestedSchema(), async ({ evaluate, base }) => {
    const result = await evaluate(nestedInput);
    async function record(state) {
      const response = await fetch(base + '/api/create-record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state,
          options: {
            mainRecordId: 'main',
            changeset_id: 'change',
            created_at_client: '2026-10-12T10:00:00Z',
            updated_at_client: '2026-10-12T10:00:00Z',
            childRecordIds: { rows: ['row-a', 'row-b'], children: ['child-a', 'child-b'] },
          },
        }),
      });
      assert.equal(response.status, 200);
      return (await response.json()).record;
    }
    const { diagnostics, ...state } = result.state;
    const withDiagnostics = await record(result.state);
    const withoutDiagnostics = await record(state);
    assert.equal(JSON.stringify(withDiagnostics).includes('diagnostics'), false);
    // Each record request allocates fresh child UUIDs; compare all other metadata and values.
    function withoutGeneratedIds(recordValue) {
      if (Array.isArray(recordValue)) return recordValue.map(withoutGeneratedIds);
      if (!recordValue || typeof recordValue !== 'object') return recordValue;
      return Object.fromEntries(
        Object.entries(recordValue)
          .filter(([key]) => key !== 'id' && key !== 'record_id')
          .map(([key, value]) => [key, withoutGeneratedIds(value)])
      );
    }
    assert.deepEqual(withoutGeneratedIds(withDiagnostics), withoutGeneratedIds(withoutDiagnostics));
  });
});

test('WebSocket initialization and reload publish the same reporting preference', async () => {
  await withServer(schemaWithCalculation('$input * 2'), async ({ server }) => {
    const socketServer = createWebSocketServer(
      server,
      () => schemaWithCalculation('$input * 2'),
      () => 'test',
      { diagnostics: false }
    );
    const socket = new WebSocket('ws://127.0.0.1:' + server.address().port);
    try {
      const initial = await new Promise((resolve, reject) => {
        socket.once('message', (data) => resolve(JSON.parse(data.toString())));
        socket.once('error', reject);
      });
      assert.equal(initial.diagnosticsConsole, false);
      const update = new Promise((resolve) =>
        socket.once('message', (data) => resolve(JSON.parse(data.toString())))
      );
      socketServer.broadcastSchemaUpdate(schemaWithCalculation('$input * 3'), 'changed');
      assert.equal((await update).diagnosticsConsole, false);
    } finally {
      socket.terminate();
      await new Promise((resolve) => socketServer.wss.close(resolve));
    }
  });
});

test('ordinary browser state updates use the shared reporter and ignore superseded requests', async () => {
  const reporter = createDiagnosticReporter();
  const controller = createPreviewDiagnosticController(reporter);
  const manager = new FormStateManager({}, { diagnostics: controller });
  manager.getCurrentFormState = () => ({ values: {}, repeatable: {} });
  const applied = [];
  manager.applyFormState = (state) => applied.push(state);
  const originalFetch = globalThis.fetch;
  let resolveOld;
  const pending = new Promise((resolve) => {
    resolveOld = resolve;
  });
  let calls = 0;
  globalThis.fetch = async () =>
    ++calls === 1
      ? pending
      : { ok: true, json: async () => ({ diagnostics: [], values: { healthy: true } }) };
  try {
    const old = manager.updateFormState();
    await manager.updateFormState();
    resolveOld({ ok: true, json: async () => ({ diagnostics: [{ code: 'old_error' }] }) });
    await old;
    assert.equal(calls, 2);
    assert.deepEqual(reporter.getDiagnostics(), []);
    assert.equal(applied.length, 1);
    assert.deepEqual(applied[0].values, { healthy: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
