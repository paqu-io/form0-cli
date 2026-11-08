import test from 'node:test';
import assert from 'node:assert/strict';
import { readBuildingPlanRecord } from 'form0-core';
import { readFileSync } from 'node:fs';
import { createPreviewSessionManager } from '../src/server/preview-events/editor.js';
import { fixture, part } from './fixtures/building-plan-v2.js';

// Former pre-model tests are retained in fixtures/archive; v2 deliberately has no migration.
for (const name of ['preview', 'defaults'])
  for (const mode of ['safe', 'trusted'])
    test(`preview rejects the v1 ${name} development schema clearly (${mode})`, async () => {
      const { schema } = JSON.parse(
        readFileSync(
          new URL(`./fixtures/legacy-building-plan-${name}.json`, import.meta.url),
          'utf8'
        )
      );
      const manager = createPreviewSessionManager({
        getSchema: () => schema,
        serializeRecord: (_schema, state) => state,
        evaluationOptions: { security: { mode } },
      });
      try {
        await assert.rejects(
          manager.create({
            state: { values: {}, repeatable: {} },
            configuration: { lifecycle: false, recordKind: 'existing' },
          }),
          /version 1.*not migrated/i
        );
      } finally {
        manager.disposeAll();
      }
    });
for (const mode of ['safe', 'trusted'])
  test(`readonly v2 preview rejects opening a mutable floor (${mode})`, async () => {
    const f = fixture();
    const manager = createPreviewSessionManager({
      getSchema: () => f.schema,
      serializeRecord: (_schema, state) => state,
      evaluationOptions: { security: { mode } },
    });
    try {
      const started = await manager.create({
        state: f.record,
        configuration: { lifecycle: true, recordKind: 'existing', readonly: true },
      });
      const result = await manager.command({
        sessionId: started.sessionId,
        sequence: 1,
        action: 'open-row',
        instancePath: [
          part(f.nodes.floors.preferredKey, f.record.repeatable[f.nodes.floors.preferredKey][0]),
        ],
        parentScopeId: started.scopes[0].scopeId,
      });
      assert.equal(result.issues[0].code, 'readonly_scope');
      assert.deepEqual(
        readBuildingPlanRecord({ meta: f.meta, record: result.state }),
        readBuildingPlanRecord({ meta: f.meta, record: f.record })
      );
    } finally {
      manager.disposeAll();
    }
  });
