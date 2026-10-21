import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewEventClient } from '../src/server/static/preview-event-client.js';
import {
  createDiagnosticReporter,
  createPreviewDiagnosticController,
} from '../src/server/static/calculation-diagnostics.js';

const initial = {
  sessionId: 'session-A',
  sequence: 0,
  status: 'completed',
  issues: [],
  state: { values: { input: 4 }, repeatable: {} },
  scopes: [{ scopeId: 'root-A', instancePath: [] }],
  diagnostics: [],
  presentations: [],
};
const response = (value) => ({ ok: true, json: async () => value });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};

test('preview client serializes captured edits before preparation and waits for presentation', async () => {
  const accepted = [],
    sent = [];
  const held = deferred();
  let presenting = false;
  const client = createPreviewEventClient({
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      sent.push(body);
      if (url.endsWith('preview-session')) return response(initial);
      if (url.endsWith('preview-dispose')) return response({});
      return response({
        ...initial,
        sequence: body.sequence,
        presentations: body.action === 'prepare' ? [{ operation: 'ALERT' }] : [],
        state: { values: { input: body.values?.input ?? 8 }, repeatable: {} },
      });
    },
    present: async (operations) => {
      if (operations.length) {
        presenting = true;
        await held.promise;
      }
    },
    accept: (result) => accepted.push(result),
  });
  const { controller } = await client.start(
    { lifecycle: true, recordKind: 'new' },
    { values: { input: 4 } }
  );
  const request = { action: 'update', values: { input: 0 } };
  const first = client.request(request);
  request.values.input = 99;
  const second = client.request({ action: 'update', values: { input: 8 } });
  const prepare = controller.prepareSave({ intent: 'submit' });
  await first;
  await second;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(presenting, true);
  assert.equal(accepted.length, 4);
  held.resolve();
  await prepare;
  assert.deepEqual(
    sent.filter((item) => item.sequence).map((item) => item.sequence),
    [1, 2, 3]
  );
  assert.equal(sent[1].values.input, 0);
  assert.equal(accepted.length, 4);
});

test('client rejects duplicate pending saves and exposes independent defensive results', async () => {
  const held = deferred();
  const client = createPreviewEventClient({
    fetch: async (url, options) =>
      url.endsWith('preview-session')
        ? response(initial)
        : url.endsWith('preview-dispose')
          ? response({})
          : (await held.promise,
            response({
              ...initial,
              sequence: JSON.parse(options.body).sequence,
              eligible: true,
              payload: { input: 4 },
            })),
  });
  const { controller } = await client.start({ lifecycle: true, recordKind: 'existing' }, {});
  const saving = controller.prepareSave({ intent: 'submit' });
  const duplicate = await controller.prepareSave({ intent: 'submit' });
  assert.equal(duplicate.issues[0].code, 'save_in_progress');
  held.resolve();
  const completed = await saving;
  completed.state.values.input = 999;
  assert.equal(client.getState().values.input, 4);
});

test('obsolete in-flight responses cannot apply operations, snapshots or payload after disposal/replacement', async () => {
  const held = deferred();
  const accepted = [],
    presentations = [];
  const client = createPreviewEventClient({
    fetch: async (url, options) => {
      if (url.endsWith('preview-session')) return response(initial);
      if (url.endsWith('preview-dispose')) return response({});
      await held.promise;
      return response({
        ...initial,
        sequence: JSON.parse(options.body).sequence,
        presentations: [{ operation: 'ALERT' }],
        payload: { input: 0 },
        eligible: true,
      });
    },
    accept: (item) => accepted.push(item),
    present: (items) => presentations.push(...items),
  });
  const { controller } = await client.start({ lifecycle: true, recordKind: 'new' }, {});
  const pending = controller.prepareSave({ intent: 'submit' });
  await new Promise((resolve) => setImmediate(resolve));
  client.dispose();
  held.resolve();
  const obsolete = await pending;
  assert.equal(obsolete.issues[0].code, 'stale_generation');
  assert.equal(accepted.length, 1);
  assert.equal(presentations.length, 0);
  assert.equal(obsolete.payload, null);
});

test('positional client targets need observed scope and retired targets never redirect to root', async () => {
  const path = [{ repeatableKey: 'rows', instanceId: null, index: 0, identity: 'position' }];
  const client = createPreviewEventClient({
    fetch: async (url, options) =>
      url.endsWith('preview-session')
        ? response({
            ...initial,
            scopes: [...initial.scopes, { scopeId: 'row-A', instancePath: path }],
          })
        : response({ ...initial, sequence: JSON.parse(options.body).sequence }),
  });
  const { controller } = await client.start({ lifecycle: true, recordKind: 'new' }, {});
  const missing = await controller.prepareSave({ intent: 'submit', instancePath: path });
  assert.equal(missing.issues[0].code, 'invalid_target');
  await controller.dispatch({
    type: 'unload-repeatable',
    fieldKey: 'rows',
    scopeId: 'row-A',
    instancePath: path,
  });
  const retired = await controller.prepareSave({
    intent: 'submit',
    scopeId: 'row-A',
    instancePath: path,
  });
  assert.equal(retired.issues[0].code, 'invalid_target');
});

test('throwing/rejected presentation prevents preparation delivery without repeating accepted work', async () => {
  let calls = 0;
  const client = createPreviewEventClient({
    fetch: async (url, options) => {
      if (url.endsWith('preview-session')) return response(initial);
      calls++;
      return response({
        ...initial,
        sequence: JSON.parse(options.body).sequence,
        eligible: true,
        payload: { input: 4 },
        presentations: [{ operation: 'ALERT' }],
      });
    },
    present: async (operations) => {
      if (operations.length) throw new Error('presentation failed');
    },
  });
  const { controller } = await client.start({ lifecycle: true, recordKind: 'new' }, {});
  const result = await controller.prepareSave({ intent: 'submit' });
  assert.equal(result.eligible, false);
  assert.equal(result.payload, null);
  assert.equal(result.issues[0].code, 'preview_request_failed');
  assert.equal(calls, 1);
});

test('scope retirement withdraws diagnostics quietly while subsequent recovery/recurrence still reports', () => {
  const output = [];
  const reporter = createDiagnosticReporter({
    emit: (entry) => output.push(entry),
    translate: (key) => key,
  });
  const preview = createPreviewDiagnosticController(reporter);
  const path = [{ repeatableKey: 'rows', instanceId: 'row-A', index: 0, identity: 'id' }];
  const diagnostic = {
    code: 'runtime_exception',
    severity: 'error',
    message: 'failed',
    fieldName: 'amount',
    phase: 'runtime',
    context: { instancePath: path },
  };
  preview.accept(preview.beginEvaluation(), { diagnostics: [diagnostic] });
  output.length = 0;
  preview.retireScopes([{ scopeId: 'row-A', instancePath: path }]);
  preview.accept(preview.beginEvaluation(), { diagnostics: [] });
  assert.equal(output.length, 0);
  preview.accept(preview.beginEvaluation(), { diagnostics: [diagnostic] });
  assert.equal(
    output.some((entry) => entry.kind === 'diagnostic'),
    true
  );
  output.length = 0;
  preview.accept(preview.beginEvaluation(), { diagnostics: [] });
  assert.equal(
    output.some((entry) => entry.kind === 'resolved'),
    true
  );
});

test('non-JSON metadata is rejected before transport instead of silently dropping functions', async () => {
  let sent = 0;
  const client = createPreviewEventClient({
    fetch: async () => {
      sent++;
      return response(initial);
    },
  });
  const { controller } = await client.start({ lifecycle: true, recordKind: 'new' }, {});
  const result = await controller.dispatch({
    type: 'change',
    fieldKey: 'input',
    metadata: { helper: () => {} },
  });
  assert.equal(result.issues[0].code, 'invalid_request');
  assert.equal(sent, 1);
});

test('a server-expired scope withdraws old findings and preserves the accepted snapshot for explicit reopening', async () => {
  const accepted = [];
  const client = createPreviewEventClient({
    fetch: async (url) =>
      url.endsWith('preview-session')
        ? response(initial)
        : response({
            status: 'failed',
            eligible: false,
            payload: null,
            issues: [{ code: 'stale_generation', message: 'expired' }],
          }),
    accept: (result) => accepted.push(result),
  });
  const { controller } = await client.start({ lifecycle: true, recordKind: 'new' }, {});
  const result = await controller.prepareSave({ intent: 'submit' });
  assert.equal(result.issues[0].code, 'stale_generation');
  assert.equal(client.isActive(), false);
  assert.equal(accepted.at(-1).retiredScopes[0].scopeId, 'root-A');
  assert.equal(client.getCommittedState().values.input, 4);
});

test('controls capture their generation so detached old DOM actions cannot target replacement editors', async () => {
  const client = createPreviewEventClient({
    fetch: async (url) => (url.endsWith('preview-session') ? response(initial) : response({})),
  });
  await client.start({ lifecycle: true, recordKind: 'new' }, {});
  const old = client.bindRequest({ action: 'open-row', instancePath: [] });
  await client.start({ lifecycle: true, recordKind: 'existing' }, {});
  const stale = await old();
  assert.equal(stale.issues[0].code, 'stale_generation');
});

test('record preferences are captured from the current host callback before preparation', async () => {
  let options = { fieldKeyMode: 'prefer-key' };
  const sent = [];
  const client = createPreviewEventClient({
    getRecordOptions: () => options,
    fetch: async (url, init) => {
      if (url.endsWith('preview-session')) return response(initial);
      const body = JSON.parse(init.body);
      sent.push(body);
      return response({ ...initial, sequence: body.sequence });
    },
  });
  const { controller } = await client.start({ lifecycle: true, recordKind: 'new' }, {});
  options = { fieldKeyMode: 'data-name' };
  await controller.prepareSave({ intent: 'submit' });
  assert.equal(sent[0].recordOptions.fieldKeyMode, 'data-name');
});

test('malformed controller targets cannot silently fall back to the root editor', async () => {
  let sent = 0;
  const client = createPreviewEventClient({
    fetch: async () => {
      sent++;
      return response(initial);
    },
  });
  const { controller } = await client.start({ lifecycle: true, recordKind: 'new' }, {});
  for (const request of [
    null,
    [],
    { type: 'change', scopeId: '' },
    { type: 'change', instancePath: '' },
    { type: 'change', metadata: [] },
  ])
    assert.equal((await controller.dispatch(request)).issues[0].code, 'invalid_request');
  assert.equal(sent, 1);
});
