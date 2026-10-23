import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPreviewSessionManager } from '../src/server/preview-events/editor.js';
import {
  validatePreviewStorageOptions,
  restorePreviewRecord,
} from '../src/server/preview-events/storage.js';
import { createFilePreviewStorage } from '../src/server/preview-events/file-storage.js';
import { serializePreviewRecord } from '../src/server/express-server.js';
import { field, repeatable } from './fixtures/preview-event-fields.js';
const schema = {
  form: {
    name: 'Invoice',
    repeatable_recalculation: 'confirm',
    elements: [
      field('NumericField', 'tax', { format: 'float' }),
      field('CalculatedField', 'grand', { calculate: "REPEATABLESUM($lines, 'total')" }),
      repeatable('lines', [
        field('NumericField', 'amount'),
        field('CalculatedField', 'total', { calculate: '$amount * (1 + $tax)' }),
      ]),
    ],
  },
};
const initial = () => ({
  values: { tax: 0.2, grand: 330 },
  repeatable: {
    lines: [
      { id: 0, values: { amount: 100, total: 110 }, attachment: { media_id: 'kept' } },
      { id: 'B', values: { amount: 200, total: 220 } },
    ],
  },
});

for (const security of [undefined, { mode: 'safe' }])
  for (const lifecycle of [false, true])
    test(`CLI retains exact totals, persists pending status and rejects client-granted permissions; lifecycle=${lifecycle}, security=${security?.mode || 'trusted'}`, async () => {
      let stored = null,
        fail = false,
        calls = 0;
      const storageAdapter = {
        load: async () => stored,
        save: async (_identity, value) => {
          calls++;
          if (fail) throw new Error('storage failed');
          stored = structuredClone(value);
        },
      };
      const manager = createPreviewSessionManager({
        getSchema: () => schema,
        serializeRecord: (schema, state, options) =>
          serializePreviewRecord(schema, state, { ...options, fieldKeyMode: 'data-name' }, true),
        submissionOptions: { allowRetain: true },
        storageAdapter,
        evaluationOptions: { security },
      });
      try {
        const source = initial(),
          original = structuredClone(source);
        const opened = await manager.create({
          state: source,
          configuration: { lifecycle, recordKind: 'existing' },
          recordIdentity: 0,
        });
        let sequence = 0;
        const command = (data) =>
          manager.command({ sessionId: opened.sessionId, sequence: ++sequence, ...data });
        assert.equal(opened.state.values.grand, 330);
        const review = await command({ action: 'prepare', intent: 'submit' });
        assert.equal(review.status, 'requires_decision');
        assert.equal(review.payload, null);
        const page = await command({
          action: 'changes',
          preparationId: review.preparationId,
          limit: 1,
        });
        assert.equal(page.changes.length, 1);
        assert.match(page.changes[0].label, /Invoice.*grand/);
        const retained = await command({
          action: 'prepare',
          intent: 'submit',
          decision: { reviewId: review.reviewId, action: 'retain' },
        });
        assert.equal(retained.payload.form_values.grand, 330);
        assert.equal(retained.payload.id, 0);
        assert.equal(retained.meta.freshness.status, 'pending');
        assert.equal(
          (await command({ action: 'acknowledge', preparationId: retained.preparationId }))
            .issues[0].code,
          'persistence_required'
        );
        fail = true;
        await assert.rejects(
          manager.persist({ sessionId: opened.sessionId, preparationId: retained.preparationId }),
          /storage failed/
        );
        assert.equal(stored, null);
        fail = false;
        assert.equal(
          (
            await manager.persist({
              sessionId: opened.sessionId,
              preparationId: retained.preparationId,
            })
          ).freshness.status,
          'pending'
        );
        assert.equal(calls, 2);
        assert.equal(stored.record.form_values.lines[0].id, 0);
        const reopened = await manager.create({
          recordIdentity: 0,
          configuration: { lifecycle, recordKind: 'existing' },
        });
        assert.equal(reopened.state.values.grand, 330);
        assert.deepEqual(
          reopened.state.repeatable.lines.map((row) => row.values.total),
          [110, 220]
        );
        assert.deepEqual(source, original);
      } finally {
        manager.disposeAll();
      }
      const unprivileged = createPreviewSessionManager({
        getSchema: () => schema,
        serializeRecord: (_schema, state) => state,
      });
      try {
        const started = await unprivileged.create({
          state: initial(),
          configuration: { lifecycle, recordKind: 'new' },
          submissionOptions: { allowRetain: true },
        });
        const review = await unprivileged.command({
          sessionId: started.sessionId,
          sequence: 1,
          action: 'prepare',
          intent: 'submit',
        });
        assert.equal(review.choices.includes('retain'), false);
      } finally {
        unprivileged.disposeAll();
      }
    });

test('CLI storage configuration and atomic adapter preserve companion data and identity zero', async () => {
  assert.throws(
    () => validatePreviewStorageOptions({ submissionOptions: { allowRetain: true } }),
    /storageAdapter/
  );
  assert.throws(() => validatePreviewStorageOptions({ storageAdapter: { save() {} } }), /load/);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'form0-record-storage-'));
  try {
    const adapter = createFilePreviewStorage(dir);
    assert.equal(await adapter.load(0), null);
    const data = {
      record: { id: 0, form_values: { tax: 0, lines: [] } },
      freshness: { version: 1, status: 'pending' },
    };
    await adapter.save(0, data);
    assert.deepEqual(await adapter.load(0), data);
    assert.equal(restorePreviewRecord(schema, data.record).values.tax, 0);
    await assert.rejects(adapter.save('../', { record: { bad: 1n }, freshness: null }));
    assert.deepEqual(await adapter.load(0), data);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI cancellation before queued preparation releases the proposal without applying it', async () => {
  const manager = createPreviewSessionManager({
    getSchema: () => schema,
    serializeRecord: (_schema, state) => state,
  });
  try {
    const start = await manager.create({
      state: initial(),
      configuration: { lifecycle: false, recordKind: 'new' },
    });
    manager.cancel({ sessionId: start.sessionId, requestId: 'cancel-before-start' });
    const result = await manager.command({
      sessionId: start.sessionId,
      sequence: 1,
      action: 'prepare',
      intent: 'submit',
      requestId: 'cancel-before-start',
    });
    assert.equal(result.status, 'cancelled');
    assert.equal(result.payload, null);
    assert.deepEqual(
      result.state.repeatable.lines.map((row) => row.values.total),
      [110, 220]
    );
  } finally {
    manager.disposeAll();
  }
});

test('CLI HTTP preview accepts large records and returns shared selected values without duplicate closed state', async () => {
  const http = await import('node:http');
  const { createApp } = await import('../src/server/express-server.js');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'form0-large-preview-'));
  const largeSchema = structuredClone(schema);
  delete largeSchema.form.repeatable_recalculation;
  const server = http.createServer(
    createApp(
      () => largeSchema,
      () => 'large-fixture',
      directory
    )
  );
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (route, data) => {
      const response = await fetch(base + route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const state = {
      values: { tax: 0.2 },
      repeatable: {
        lines: Array.from({ length: 2000 }, (_, id) => ({
          id,
          values: { amount: 100, total: 110 },
          retained_metadata: 'x'.repeat(128),
        })),
      },
    };
    const opened = await post('/api/preview-session', {
      state,
      configuration: { lifecycle: false, recordKind: 'existing' },
    });
    assert.equal(opened.state.values.grand, 220000);
    assert.equal(opened.committedState, undefined);
    const prepared = await post('/api/preview-events', {
      sessionId: opened.sessionId,
      sequence: 1,
      action: 'prepare',
      intent: 'submit',
    });
    assert.equal(prepared.payload.form_values.grand, 240000);
    assert.equal(prepared.meta.repeatable.lines[0].id, 0);
    assert.equal(prepared.meta.repeatable.lines[0].retained_metadata, 'x'.repeat(128));
    assert.equal(prepared.state.repeatable.lines.length, 2000);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
