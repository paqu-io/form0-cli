import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FIELD_SPECS, getBuiltinDefinitions } from 'form0-core';
import { createApp } from '../src/server/express-server.js';
import {
  builtinFixture,
  fieldFixture,
  attachAuditEvents,
  BUILTIN_CASES,
  SPECIAL_BUILTINS,
  FIELD_CASES,
  fixtureFieldTypes,
} from './fixtures/consumer-compatibility.js';
assert.deepEqual(
  [...BUILTIN_CASES.map(([n]) => n), ...Object.keys(SPECIAL_BUILTINS)].sort(),
  getBuiltinDefinitions()
    .map((x) => x.name)
    .sort()
);
assert.deepEqual(Object.keys(FIELD_CASES).sort(), Object.keys(FIELD_SPECS).sort());
assert.deepEqual(
  fixtureFieldTypes(fieldFixture(FIELD_SPECS).schema),
  Object.keys(FIELD_SPECS).sort(),
  'Every field type must occur in the actual schema'
);
for (const security of [undefined, { mode: 'safe' }])
  for (const kind of ['builtins', 'fields', 'closed-row'])
    test(`CLI catalog ${kind} ${security?.mode || 'trusted'}`, async () => {
      const fixture = attachAuditEvents(
        FIELD_SPECS,
        kind === 'fields' ? fieldFixture(FIELD_SPECS) : builtinFixture(FIELD_SPECS),
        kind === 'fields' ? 'fields' : 'builtins'
      );
      if (kind === 'closed-row') fixture.snapshot.repeatable.rows[0].values.cost = -1;
      const directory = await mkdtemp(path.join(os.tmpdir(), 'form0-catalog-'));
      const app = createApp(
        () => fixture.schema,
        () => 'Catalog fixture',
        directory,
        { diagnostics: false, engineOptions: { security } }
      );
      const server = await new Promise((resolve) => {
        const value = app.listen(0, '127.0.0.1', () => resolve(value));
      });
      const base = `http://127.0.0.1:${server.address().port}`;
      const post = async (url, body) => {
        const response = await fetch(base + url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        assert.equal(response.status, 200);
        return response.json();
      };
      try {
        const initial = await post('/api/preview-session', {
          configuration: { lifecycle: true, recordKind: 'existing' },
          state: fixture.snapshot,
        });
        let sequence = 0;
        const command = (body) =>
          post('/api/preview-events', {
            sessionId: initial.sessionId,
            sequence: ++sequence,
            ...body,
          });
        if (kind === 'closed-row') {
          const submit = await command({ action: 'prepare', intent: 'submit' });
          assert.equal(submit.eligible, false);
          const finding = submit.validationSummary.scopeIssues.find(
            (x) => x.message === 'Row cost is invalid'
          );
          assert.equal(finding.instancePath[0].instanceId, 0);
          assert.equal(finding.fieldName, undefined);
          const draft = await command({ action: 'prepare', intent: 'draft' });
          assert.equal(draft.eligible, true);
          assert.equal(draft.validationSummary.hasErrors, true);
        } else if (kind === 'builtins') {
          for (const [name, , expected] of BUILTIN_CASES)
            assert.deepEqual(initial.state.values['builtin_' + name.toLowerCase()], expected, name);
          for (const trace of ['x', 'xx']) {
            const updated = await command({
              action: 'update',
              values: { amount: 4 },
              fieldKey: 'amount',
            });
            assert.deepEqual(updated.issues, []);
            assert.equal(updated.state.values.event_trace, trace);
            assert.equal(updated.presentations.length, 1);
            const results = JSON.parse(updated.state.values.event_summary);
            for (const [name, , expected] of BUILTIN_CASES.filter(
              ([n]) => !['SETRESULT', 'REPEATABLEVALUES', 'REPEATABLESUM'].includes(n)
            ))
              assert.deepEqual(results[name], expected, name + ' event');
          }
          const invalid = await command({
            action: 'update',
            values: { amount: -1 },
            fieldKey: 'amount',
          });
          assert.deepEqual(invalid.issues, []);
          const checked = await command({ action: 'prepare', intent: 'submit' });
          assert.equal(checked.eligible, false);
          assert.match(JSON.stringify(checked.validationSummary), /Root amount is invalid/);
          const draft = await command({ action: 'prepare', intent: 'draft' });
          assert.equal(draft.eligible, true);
        } else {
          for (const stage of [1, 2, 3]) {
            const updated = await command({
              action: 'update',
              values: { stage },
              fieldKey: 'stage',
            });
            assert.deepEqual(updated.issues, []);
            const expected =
              stage === 1
                ? fixture.changed
                : stage === 2
                  ? fixture.cleared
                  : fixture.snapshot.values;
            for (const [name, value] of Object.entries(expected).filter(
              ([name]) => name !== 'stage'
            ))
              assert.deepEqual(updated.state.values[name], value, name + ' stage ' + stage);
            if (stage === 2) {
              assert.equal(
                (await command({ action: 'prepare', intent: 'submit' })).eligible,
                false
              );
              assert.equal((await command({ action: 'prepare', intent: 'draft' })).eligible, true);
            }
          }
          const saved = await command({ action: 'prepare', intent: 'submit' });
          assert.equal(saved.eligible, true);
          assert.equal(saved.payload.form_values.signature.signature_id, 'sig');
          assert.deepEqual(saved.payload.form_values.links, [{ record_id: '0' }]);
          assert.equal(saved.payload.form_values.rows[0].id, 0);
        }
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        await rm(directory, { recursive: true, force: true });
      }
    });
