import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFormEngine } from 'form0-core';
import { createApp, serializePreviewRecord } from '../src/server/express-server.js';
import { createPreviewEditor } from '../src/server/preview-events/editor.js';
import { eventSchema } from './fixtures/preview-event-conformance.js';
import { field } from './fixtures/preview-event-fields.js';
import { setLocale } from '../src/utils/i18n.js';

const rootValues = { input: 4, trace: '' };
const rowPath = (id, index = 0) => [
  { repeatableKey: 'rows', instanceId: id, index, identity: id == null ? 'position' : 'id' },
];
const fixture = (code) => {
  const schema = eventSchema(code);
  schema.form.elements[0].min = null;
  return schema;
};
async function withPreview(
  schema,
  run,
  configuration = { lifecycle: true, recordKind: 'existing' },
  initialState = { values: rootValues, repeatable: {} }
) {
  let currentSchema = schema;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'form0-preview-events-'));
  const server = http.createServer(
    createApp(
      () => currentSchema,
      () => 'Portable event test',
      dir
    )
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = async (url, body) => {
    const response = await fetch(base + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { http: response.status, ...(await response.json()) };
  };
  try {
    const started = await post('/api/preview-session', { configuration, state: initialState });
    let sequence = 0;
    const command = (body) =>
      post('/api/preview-events', { sessionId: started.sessionId, sequence: ++sequence, ...body });
    await run({
      started,
      command,
      post,
      base,
      replace: (next) => {
        currentSchema = next;
      },
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

test('preview load/new/edit classification follows explicit opt-in and readonly opens load only', async () => {
  const schema = fixture(
    "ON('load-record', function(){ SETVALUE('trace','load'); }); ON('new-record', function(){ SETVALUE('trace',$trace+':new'); }); ON('edit-record', function(){ SETVALUE('trace',$trace+':edit'); });"
  );
  for (const [kind, readonly, expected] of [
    ['new', false, 'load:new'],
    ['existing', false, 'load:edit'],
    ['new', true, 'load'],
  ])
    await withPreview(
      schema,
      async ({ started, command }) => {
        assert.equal(started.http, 200);
        assert.deepEqual(started.issues, []);
        assert.equal(started.state.values.trace, expected);
        if (readonly) {
          const result = await command({ action: 'prepare', intent: 'draft' });
          assert.equal(result.issues[0].code, 'readonly_scope');
          assert.equal(result.payload, null);
        }
      },
      { lifecycle: true, recordKind: kind, readonly }
    );
});

test('custom validation repeats, clears on editable change, blocks submit and permits invalid draft', async () => {
  const schema = fixture(
    "ON('validate-record', function(e){ if($input<4) INVALID('Reach four.'); }); ON('save-record', function(e){ SETVALUE('trace',e.isDraft?'draft':'submit'); });"
  );
  await withPreview(schema, async ({ command }) => {
    await command({ action: 'update', values: { input: 0 }, fieldKey: 'input' });
    for (let i = 0; i < 2; i++) {
      const blocked = await command({ action: 'prepare', intent: 'submit' });
      assert.equal(blocked.eligible, false);
      assert.equal(blocked.payload, null);
      assert.equal(blocked.validationSummary.generalErrors[0].message, 'Reach four.');
      assert.deepEqual(blocked.state.errors, {});
      assert.equal(blocked.state.values.trace, '');
    }
    const draft = await command({ action: 'prepare', intent: 'draft' });
    assert.equal(draft.eligible, true);
    assert.equal(draft.payload.raw_values.input, 0);
    assert.equal(draft.validationSummary.hasErrors, true);
    assert.equal(draft.state.values.trace, 'draft');
    const recovered = await command({ action: 'update', values: { input: 4 }, fieldKey: 'input' });
    assert.deepEqual(recovered.customValidation, []);
    const accepted = await command({ action: 'prepare', intent: 'submit' });
    assert.equal(accepted.eligible, true);
    assert.equal(accepted.payload.form_values.input, 4);
    assert.doesNotMatch(JSON.stringify(accepted.payload), /scopeId|validationIssues|instancePath/);
  });
});

test('row removal rejects readonly sessions and ambiguous IDs without changing accepted rows', async () => {
  for (const [readonly, rows, expected] of [
    [true, [{ id: 'kept', values: { amount: 2 }, repeatable: {} }], 'readonly_scope'],
    [
      false,
      [
        { id: 'duplicate', values: { amount: 2 }, repeatable: {} },
        { id: 'duplicate', values: { amount: 7 }, repeatable: {} },
      ],
      'invalid_target',
    ],
  ]) {
    await withPreview(
      fixture(''),
      async ({ started, command }) => {
        const result = await command({
          action: 'remove-row',
          affectedPath: rowPath(rows[0].id),
        });
        assert.equal(result.issues[0]?.code, expected);
        assert.deepEqual(result.committedState.repeatable, started.committedState.repeatable);
        assert.equal(result.committedState.repeatable.rows.length, rows.length);
      },
      { lifecycle: true, recordKind: 'existing', readonly },
      { values: rootValues, repeatable: { rows } }
    );
  }
});

test('pre-save runs once, revalidates changed values and retains a failed prepared edit for correction', async () => {
  const schema = fixture(
    "ON('validate-record', function(){ if($input<4) INVALID('Reach four.'); }); ON('save-record', function(){ SETVALUE('input',$target); SETVALUE('trace',$trace+'s'); });"
  );
  schema.form.elements.push(field('NumericField', 'target', { default_value: 5 }));
  await withPreview(schema, async ({ command }) => {
    const first = await command({ action: 'prepare', intent: 'submit' });
    assert.equal(first.eligible, true);
    assert.equal(first.payload.form_values.input, 5);
    assert.equal(first.state.values.trace, 's');
    await command({ action: 'update', values: { input: 4, target: 0 } });
    const failed = await command({ action: 'prepare', intent: 'submit' });
    assert.equal(failed.eligible, false);
    assert.equal(failed.state.values.input, 0);
    assert.equal(failed.state.values.trace, 'ss');
    await command({ action: 'update', values: { input: 4, target: 5 } });
    const retry = await command({ action: 'prepare', intent: 'submit' });
    assert.equal(retry.eligible, true);
    assert.equal(retry.state.values.trace, 'sss');
  });
});

test('detailed event failures and calculation errors have separate save outcomes, alerts presented once', async () => {
  const schema = fixture("ON('save-record', function(){ ALERT('ready','Prepared'); });");
  schema.form.elements[2].calculate = "throw new Error('calculation only');\nreturn 1;\n";
  await withPreview(schema, async ({ command }) => {
    const result = await command({ action: 'prepare', intent: 'submit' });
    assert.equal(result.eligible, true);
    assert.equal(result.diagnostics[0].severity, 'error');
    assert.equal(result.presentations.length, 1);
    assert.equal(result.presentations[0].operation, 'ALERT');
    const invalid = await command({
      action: 'dispatch',
      type: 'validate-record',
      metadata: { isDraft: false, eventType: 'change' },
    });
    assert.equal(invalid.status, 'completed');
    assert.deepEqual(invalid.presentations, []);
  });
  await withPreview(
    fixture("ON('save-record', function(){ throw new Error('event failed'); });"),
    async ({ command }) => {
      const result = await command({ action: 'prepare', intent: 'draft' });
      assert.equal(result.eligible, false);
      assert.equal(result.payload, null);
      assert.equal(result.issues[0].code, 'handler_failed');
    }
  );
});

test('nested rows read ancestors/main, write locally, retain ID zero, and cancellation isolates staged data', async () => {
  const schema = fixture(
    "ON('load-repeatable','rows',function(){ SETVALUE('amount',$amount+1); }); ON('save-repeatable','children',function(){ SETVALUE('quantity',$quantity+$amount+$input); }); ON('focus','quantity',function(){ SETVALUE('amount',99); });"
  );
  const initial = {
    values: rootValues,
    repeatable: {
      rows: [
        {
          id: 'row-A',
          values: { amount: 2 },
          repeatable: { children: [{ id: 0, values: { quantity: 3 }, repeatable: {} }] },
        },
        { id: 'row-B', values: { amount: 7 }, repeatable: {} },
      ],
    },
  };
  await withPreview(
    schema,
    async ({ command }) => {
      const opened = await command({ action: 'open-row', instancePath: rowPath('row-A') });
      assert.equal(opened.state.repeatable.rows[0].values.amount, 3);
      const rowScope = opened.scopes.find((scope) => scope.instancePath.length === 1);
      const child = [
        ...rowPath('row-A'),
        { repeatableKey: 'children', instanceId: 0, index: 0, identity: 'id' },
      ];
      const childOpened = await command({ action: 'open-row', instancePath: child });
      const childScope = childOpened.scopes.find((scope) => scope.instancePath.length === 2);
      const rejected = await command({
        action: 'dispatch',
        type: 'focus',
        fieldKey: 'quantity',
        scopeId: childScope.scopeId,
        instancePath: child,
      });
      assert.equal(rejected.issues[0].code, 'write_scope_restricted');
      assert.equal(rejected.state.repeatable.rows[0].values.amount, 3);
      const prepared = await command({
        action: 'prepare',
        intent: 'submit',
        scopeId: childScope.scopeId,
        instancePath: child,
      });
      assert.equal(prepared.payload.id, 0);
      assert.equal(Object.hasOwn(prepared.payload, 'errors'), false);
      assert.equal(Object.hasOwn(prepared.payload, 'read_only'), false);
      assert.equal(prepared.payload.values.quantity, 10);
      const root = await command({ action: 'prepare', intent: 'submit' });
      assert.equal(root.payload.form_values.rows[0].form_values.amount, 2);
      assert.equal(root.payload.form_values.rows[0].form_values.children[0].id, 0);
      await command({
        action: 'cancel',
        scopeId: rowScope.scopeId,
        instancePath: rowPath('row-A'),
      });
      const stale = await command({
        action: 'prepare',
        scopeId: childScope.scopeId,
        instancePath: child,
        intent: 'submit',
      });
      assert.equal(stale.issues[0].code, 'invalid_target');
      assert.equal(stale.state.repeatable.rows[0].values.amount, 2);
    },
    undefined,
    initial
  );
});

test('row acceptance validates once, commits local values and reports owner membership; removal retains sibling targets', async () => {
  const schema = fixture(
    "ON('validate-repeatable','rows',function(){if($amount<1)INVALID('Positive amount.');}); ON('save-repeatable','rows',function(){SETVALUE('amount',$amount+1);}); ON('change','rows',function(e){SETVALUE('trace',e.action);});"
  );
  const initial = {
    values: rootValues,
    repeatable: {
      rows: [
        { id: 'row-A', values: { amount: 2 }, repeatable: {} },
        { id: 'row-B', values: { amount: 7 }, repeatable: {} },
      ],
    },
  };
  await withPreview(
    schema,
    async ({ command }) => {
      const opened = await command({ action: 'open-row', instancePath: rowPath('row-B', 1) });
      const scope = opened.scopes.find((item) => item.instancePath.length);
      await command({
        action: 'update',
        scopeId: scope.scopeId,
        instancePath: rowPath('row-B', 1),
        values: { amount: 0 },
      });
      const blocked = await command({
        action: 'accept-row',
        scopeId: scope.scopeId,
        instancePath: rowPath('row-B', 1),
      });
      assert.equal(blocked.eligible, false);
      await command({ action: 'remove-row', affectedPath: rowPath('row-A') });
      await command({
        action: 'update',
        scopeId: scope.scopeId,
        instancePath: rowPath('row-B', 0),
        values: { amount: 7 },
      });
      const accepted = await command({
        action: 'accept-row',
        scopeId: scope.scopeId,
        instancePath: rowPath('row-B', 0),
      });
      assert.equal(accepted.eligible, true);
      assert.equal(accepted.state.repeatable.rows.length, 1);
      assert.equal(accepted.state.repeatable.rows[0].id, 'row-B');
      assert.equal(accepted.state.repeatable.rows[0].values.amount, 8);
      assert.equal(accepted.state.values.trace, 'edit');
      assert.equal(accepted.retiredScopes.length, 1);
    },
    undefined,
    initial
  );
});

test('positional scopes require observed IDs and deletion cannot retarget an old editor', async () => {
  const initial = {
    values: rootValues,
    repeatable: {
      rows: [
        { values: { amount: 2 }, repeatable: {} },
        { values: { amount: 7 }, repeatable: {} },
      ],
    },
  };
  await withPreview(
    fixture(),
    async ({ command }) => {
      const opened = await command({ action: 'open-row', instancePath: rowPath(null, 1) });
      const scope = opened.scopes.find((item) => item.instancePath.length);
      const rejected = await command({
        action: 'prepare',
        instancePath: rowPath(null, 1),
        intent: 'submit',
      });
      assert.equal(rejected.issues[0].code, 'invalid_target');
      const first = await command({ action: 'open-row', instancePath: rowPath(null, 0) });
      const firstScope = first.scopes.find((item) => item.instancePath[0]?.index === 0);
      await command({
        action: 'remove-row',
        affectedPath: rowPath(null, 0),
        targetScopeId: firstScope.scopeId,
      });
      const stale = await command({
        action: 'prepare',
        instancePath: rowPath(null, 1),
        scopeId: scope.scopeId,
        intent: 'submit',
      });
      assert.equal(stale.issues[0].code, 'invalid_target');
    },
    undefined,
    initial
  );
});

test('schema generations, duplicated requests and malformed configuration do not replay handlers', async () => {
  await withPreview(
    fixture("ON('save-record',function(){SETVALUE('trace',$trace+'s');});"),
    async ({ started, post, command, replace }) => {
      const body = {
        sessionId: started.sessionId,
        sequence: 1,
        action: 'prepare',
        intent: 'submit',
      };
      const first = await post('/api/preview-events', body);
      const repeat = await post('/api/preview-events', body);
      assert.deepEqual(repeat, first);
      assert.equal(first.state.values.trace, 's');
      const outOfOrder = await post('/api/preview-events', { ...body, sequence: 4 });
      assert.equal(outOfOrder.issues[0].code, 'out_of_order');
      replace(fixture());
      const stale = await post('/api/preview-events', { ...body, sequence: 2 });
      assert.equal(stale.issues[0].code, 'stale_generation');
      const malformed = await post('/api/preview-session', {
        configuration: { lifecycle: true },
        state: { values: {} },
      });
      assert.equal(malformed.http, 400);
    }
  );
});

test('pure validation and close notifications add no evaluations; forced disposal emits no lifecycle', async () => {
  let evaluations = 0;
  const seen = [];
  const createEngine = (options) => {
    const engine = createFormEngine({ ...options, helpers: { seen: (value) => seen.push(value) } });
    const evaluate = engine.eval;
    engine.eval = () => {
      evaluations++;
      return evaluate();
    };
    return engine;
  };
  const editor = createPreviewEditor({
    schema: fixture(
      "ON('validate-record',function(){INVALID('Custom.');}); ON('cancel-record',function(){seen('cancel');}); ON('unload-record',function(){seen('unload');});"
    ),
    configuration: { lifecycle: true, recordKind: 'new' },
    initialState: { values: rootValues },
    serializeRecord: () => ({}),
    createEngine,
  });
  await editor.ready;
  const initial = evaluations;
  await editor.command({ action: 'prepare', intent: 'submit' });
  await editor.command({ action: 'prepare', intent: 'submit' });
  assert.equal(evaluations, initial);
  await editor.command({ action: 'cancel' });
  assert.deepEqual(seen, ['cancel', 'unload']);
  assert.equal(evaluations, initial);
  editor.dispose();
  assert.deepEqual(seen, ['cancel', 'unload']);
});

test('managed serialization preserves media references and original row IDs while legacy serialization stays characterized', () => {
  const schema = fixture();
  schema.form.elements.push(field('PhotoField', 'photo', { min_length: null, max_length: null }));
  for (const name of ['supporting_image', 'supporting_image_path', 'supporting_image_display'])
    delete schema.form.elements.at(-1)[name];
  const state = {
    values: {
      input: 4,
      photo: [
        {
          photo_id: 'photo-A',
          media_id: 'photo-A',
          upload_id: 'upload-A',
          filename: 'photo.jpg',
          checksum_sha256: 'digest',
          attached_at_client: '2026-10-12T20:00:00.000Z',
        },
      ],
    },
    repeatable: { rows: [{ id: 'row-A', values: { amount: 2 }, repeatable: {} }] },
  };
  const record = serializePreviewRecord(schema, state, {}, true);
  assert.equal(record.form_values.rows[0].id, 'row-A');
  assert.equal(record.form_values.photo[0].upload_id, 'upload-A');
  assert.equal(record.form_values.photo[0].checksum_sha256, 'digest');
  assert.equal(record.form_values.photo[0].attached_at_client, '2026-10-12T20:00:00.000Z');
  assert.equal(state.repeatable.rows[0].id, 'row-A');
  const legacy = serializePreviewRecord(schema, state);
  assert.notEqual(legacy.form_values.rows[0].id, 'row-A');
});

test('user status changes dispatch once, programmatic status updates reach the final record without another event', async () => {
  const schema = fixture(
    "ON('change-status',function(){SETVALUE('trace',$status);}); ON('save-record',function(){SETVALUE('status','done');});"
  );
  schema.form.status_field = {
    type: 'StatusField',
    key: '@status',
    data_name: 'status',
    label: 'Status',
    enabled: true,
    display: 'default',
    visible: true,
    visible_conditions: null,
    read_only: false,
    read_only_conditions: null,
    default_value: 'pending',
    choices: ['pending', 'active', 'done'].map((value) => ({
      value,
      label: value,
      color: '#888888',
    })),
  };
  await withPreview(schema, async ({ command }) => {
    const changed = await command({
      action: 'update',
      fieldKey: 'status',
      values: { status: 'active' },
    });
    assert.equal(changed.state.values.trace, 'active');
    const result = await command({ action: 'prepare', intent: 'submit' });
    assert.equal(result.payload['@status'], 'done');
    assert.equal(result.state.values.status, 'done');
    assert.equal(result.state.values.trace, 'active');
  });
});

test('preview controls are present in each client locale rather than the CLI-only dictionary', async () => {
  try {
    for (const locale of ['en', 'es', 'fr', 'it']) {
      setLocale(locale);
      await withPreview(fixture(), async ({ base }) => {
        const response = await (await fetch(base + '/api/locale')).json();
        assert.equal(response.locale, locale);
        for (const key of [
          'settings',
          'enable',
          'recordKind',
          'edit',
          'save',
          'cancel',
          'draftPrepared',
          'submitted',
        ])
          assert.equal(
            typeof response.translations['previewEvents.' + key],
            'string',
            locale + ':' + key
          );
      });
    }
  } finally {
    setLocale('en');
  }
});

test('invalid membership paths and missing save intent do not mutate accepted records', async () => {
  const state = {
    values: rootValues,
    repeatable: { rows: [{ id: 'row-A', values: { amount: 2 }, repeatable: {} }] },
  };
  await withPreview(
    fixture(),
    async ({ command }) => {
      const malformed = await command({
        action: 'remove-row',
        affectedPath: [{ repeatableKey: 'rows', index: 0, identity: 'untrusted' }],
      });
      assert.equal(malformed.issues[0].code, 'invalid_target');
      assert.equal(malformed.state.repeatable.rows[0].id, 'row-A');
      const missing = await command({ action: 'prepare' });
      assert.equal(missing.issues[0].code, 'invalid_intent');
      const invalidField = await command({
        action: 'update',
        fieldKey: 'amount',
        values: { input: 0 },
      });
      assert.equal(invalidField.issues[0].code, 'invalid_request');
      assert.equal(invalidField.state.values.input, 4);
    },
    undefined,
    state
  );
});

test('a membership notification failure is reported after row acceptance without undoing its prepared payload', async () => {
  const schema = fixture(
    "ON('save-repeatable','rows',function(){SETVALUE('amount',$amount+1);}); ON('change','rows',function(){throw new Error('notification failed');});"
  );
  await withPreview(
    schema,
    async ({ command }) => {
      const opened = await command({ action: 'open-row', instancePath: rowPath('row-A') });
      const scope = opened.scopes.find((item) => item.instancePath.length);
      const saved = await command({
        action: 'accept-row',
        scopeId: scope.scopeId,
        instancePath: rowPath('row-A'),
      });
      assert.equal(saved.eligible, true);
      assert.equal(saved.payload.values.amount, 3);
      assert.equal(saved.notificationIssues[0].code, 'handler_failed');
      assert.equal(saved.state.repeatable.rows[0].values.amount, 3);
    },
    undefined,
    {
      values: rootValues,
      repeatable: { rows: [{ id: 'row-A', values: { amount: 2 }, repeatable: {} }] },
    }
  );
});

test('close retires calculation findings and cancel restores the initial evaluated values without another evaluation', async () => {
  const schema = fixture();
  schema.form.elements[2].calculate =
    "if($input===0){throw new Error('zero');}\nreturn $input*2;\n";
  await withPreview(schema, async ({ command }) => {
    await command({ action: 'update', values: { input: 0 } });
    const closed = await command({ action: 'cancel' });
    assert.deepEqual(closed.diagnostics, []);
    assert.deepEqual(closed.scopes, []);
    assert.equal(closed.state.values.input, 4);
    assert.equal(closed.state.values.result, 8);
  });
});

test('preparation reads current output-key and timestamp preferences without replaying initialization', async () => {
  const schema = fixture("ON('load-record',function(){SETVALUE('trace',$trace+'l');});");
  schema.form.elements[0].key = 'input_key';
  await withPreview(schema, async ({ command }) => {
    const record = await command({
      action: 'prepare',
      intent: 'submit',
      recordOptions: { fieldKeyMode: 'data-name', created_at_client: '2026-10-12T20:00:00.000Z' },
    });
    assert.equal(record.payload.form_values.input, 4);
    assert.equal(record.payload.form_values.input_key, undefined);
    assert.equal(record.payload.created_at_client, '2026-10-12T20:00:00.000Z');
    assert.equal(record.state.values.trace, 'l');
    const second = await command({
      action: 'prepare',
      intent: 'submit',
      recordOptions: { fieldKeyMode: 'prefer-key', created_at_client: '2026-10-12T20:00:00.000Z' },
    });
    assert.equal(second.payload.form_values.input_key, 4);
    assert.equal(second.state.values.trace, 'l');
  });
});

test('ambiguous existing row IDs and reused new-row IDs are rejected before opening an engine', async () => {
  const initial = {
    values: rootValues,
    repeatable: {
      rows: [
        { id: 'duplicate', values: { amount: 2 }, repeatable: {} },
        { id: 'duplicate', values: { amount: 7 }, repeatable: {} },
      ],
    },
  };
  await withPreview(
    fixture("ON('load-repeatable','rows',function(){SETVALUE('amount',99);});"),
    async ({ command }) => {
      const result = await command({ action: 'open-row', instancePath: rowPath('duplicate', 1) });
      assert.equal(result.issues[0].code, 'invalid_target');
      assert.deepEqual(
        result.state.repeatable.rows.map((row) => row.values.amount),
        [2, 7]
      );
      assert.equal(result.scopes.length, 1);
    },
    undefined,
    initial
  );
  await withPreview(
    fixture(),
    async ({ command }) => {
      const result = await command({
        action: 'open-row',
        recordKind: 'new',
        instancePath: rowPath('row-A'),
        row: { id: 'row-A', values: { amount: 9 }, repeatable: {} },
      });
      assert.equal(result.issues[0].code, 'invalid_target');
      assert.equal(result.state.repeatable.rows[0].values.amount, 2);
    },
    undefined,
    {
      values: rootValues,
      repeatable: { rows: [{ id: 'row-A', values: { amount: 2 }, repeatable: {} }] },
    }
  );
});
