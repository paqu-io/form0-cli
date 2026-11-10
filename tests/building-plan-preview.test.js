import test from 'node:test';
import assert from 'node:assert/strict';
import { readBuildingPlanRecord } from 'form0-core';
import { readFileSync } from 'node:fs';
import { createPreviewSessionManager } from '../src/server/preview-events/editor.js';
import { fixture, part } from './fixtures/building-plan-v2.js';

test('closed Floor presentation shows Ground floor requirements and preserves Roof/Land survey exceptions', async () => {
  const f = fixture();
  const fields = f.nodes.floors.fieldsByOriginalDataName;
  for (const kind of ['ground_floor', 'roof', 'land_survey']) {
    const record = structuredClone(f.record);
    record.repeatable[f.nodes.floors.preferredKey][0].values[fields.floor_name.dataName] = {
      choice: [{ value: kind, label: kind }],
      other: [],
    };
    const manager = createPreviewSessionManager({
      getSchema: () => f.schema,
      serializeRecord: (_schema, state) => state,
    });
    try {
      const started = await manager.create({
        state: record,
        configuration: { lifecycle: false, recordKind: 'existing', readonly: true },
      });
      const row = started.state.repeatable[f.nodes.floors.preferredKey][0];
      for (const name of [
        'floor_height',
        'floor_interior_wall_thickness',
        'floor_exterior_wall_thickness',
      ])
        assert.equal(row.required[fields[name].dataName], kind === 'ground_floor');
      assert.equal(row.visible[fields.floor_upper_number.dataName], false);
      assert.equal(row.visible[fields.floor_basement_number.dataName], false);
      assert.equal(row.visible[fields.floor_interior_wall_plaster_thickness.dataName], false);
      assert.deepEqual(
        readBuildingPlanRecord({ meta: f.meta, record: started.state }),
        readBuildingPlanRecord({ meta: f.meta, record })
      );
    } finally {
      manager.disposeAll();
    }
  }
});

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
