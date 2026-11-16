import test from 'node:test';
import assert from 'node:assert/strict';
import { readBuildingPlanRecord } from 'form0-core';
import { createPreviewSessionManager } from '../src/server/preview-events/editor.js';
import { FormRenderer } from '../src/server/static/form-renderer.js';
import { createSharedBuildingPlanController } from '../src/server/static/building-plan-shared-controller.js';
import { fixture, part } from './fixtures/building-plan-v2.js';

for (const jog of [false, true])
  test(`pending thickness stays separate from the accepted canvas (${jog ? 'jog' : 'rectangle'})`, async () => {
    const f = fixture(),
      manager = createPreviewSessionManager({
        getSchema: () => f.schema,
        serializeRecord: (_schema, state) => state,
      });
    let controller;
    try {
      const started = await manager.create({
        state: f.record,
        configuration: { lifecycle: false, recordKind: 'existing' },
      });
      const path = [
        part(f.nodes.floors.preferredKey, started.state.repeatable[f.nodes.floors.preferredKey][0]),
      ];
      let sequence = 0,
        scopeId;
      const command = (request) =>
        manager.command({
          sessionId: started.sessionId,
          sequence: ++sequence,
          instancePath: path,
          scopeId,
          buildingPlanEditingPolicy: {
            inheritedChangePolicy: 'apply',
            copyCustomAnswersAutomatically: true,
          },
          ...request,
        });
      let result = await command({ action: 'open-row', parentScopeId: started.scopes[0].scopeId });
      scopeId = result.scopes.find((scope) => scope.instancePath.length === 1).scopeId;
      if (jog) {
        for (const [label, distance] of [
          ['W3.2', -1],
          ['W3', 1],
        ]) {
          const floor = readBuildingPlanRecord({ meta: f.meta, record: result.state }).floors[0];
          const face = floor.rooms[0].faces.find(
            (face) => floor.walls.find((wall) => wall.id === face.wallId).autoLabel === label
          );
          result = await command({
            action: 'building-plan-operation',
            operation: { type: 'resize_face', floorId: f.floorId, faceId: face.id, distance },
          });
          assert.deepEqual(result.issues, []);
        }
      }
      const renderer = new FormRenderer();
      renderer.setSchema(f.schema, {
        repeatableState: result.state.repeatable,
        buildingPlanMeta: [f.meta],
      });
      renderer.applyManagedRepeatableState(result.state.repeatable, {
        planRecords: result.planRecords,
      });
      const previousDocument = globalThis.document;
      try {
        globalThis.document = { createElement: () => ({ dataset: {}, setAttribute() {} }) };
        controller = createSharedBuildingPlanController(
          renderer,
          {},
          f.schema.form.elements[0],
          [],
          f.meta
        );
      } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
      }
      const before = controller.semanticSnapshot;
      const fieldKey =
        f.nodes.floors.fieldsByOriginalDataName.floor_exterior_wall_thickness.dataName;
      // Invalid/empty input also remains a field draft, without changing material.
      result = await command({ action: 'update', fieldKey, values: { [fieldKey]: null } });
      renderer.applyManagedRepeatableState(result.state.repeatable, {
        planRecords: result.planRecords,
      });
      controller.syncFromState();
      assert.equal(controller.conflictElement.textContent || '', '');
      assert.deepEqual(controller.semanticSnapshot, before);
      result = await command({ action: 'update', fieldKey, values: { [fieldKey]: 0.5 } });
      assert.deepEqual(result.issues, []);
      assert.equal(result.state.repeatable[f.nodes.floors.preferredKey][0].values[fieldKey], 0.5);
      renderer.applyManagedRepeatableState(result.state.repeatable, {
        planRecords: result.planRecords,
      });
      controller.syncFromState();
      assert.equal(
        controller.conflictElement.textContent || '',
        '',
        'An uncompleted numeric edit must not report a geometry conflict.'
      );
      assert.deepEqual(controller.semanticSnapshot, before);
      result = await command({ action: 'building-plan-complete', fieldKey });
      assert.equal(result.status, 'applied', JSON.stringify(result.issues));
      renderer.applyManagedRepeatableState(result.state.repeatable, {
        planRecords: result.planRecords,
      });
      controller.syncFromState();
      assert.ok(
        controller.semanticSnapshot.floors[0].walls
          .filter((wall) => wall.exposure === 'exterior')
          .every((wall) => wall.properties.wall_thickness === 0.5)
      );
      result = await command({ action: 'cancel' });
      renderer.applyManagedRepeatableState(result.state.repeatable, {
        planRecords: result.planRecords,
      });
      controller.syncFromState();
      assert.deepEqual(
        controller.semanticSnapshot,
        readBuildingPlanRecord({ meta: f.meta, record: f.record })
      );
      assert.deepEqual(
        result.planRecords,
        [],
        'Closed editors must not leave accepted-row overlays behind.'
      );
    } finally {
      controller?.dispose();
      manager.disposeAll();
    }
  });

test('accepted canvas records stay scoped to their nested floor identities', () => {
  const f = fixture();
  const key = f.nodes.floors.preferredKey;
  const row = structuredClone(f.record.repeatable[key][0]);
  const field = f.nodes.floors.fieldsByOriginalDataName.floor_exterior_wall_thickness.dataName;
  const accepted = structuredClone(row);
  row.values[field] = 0.5;
  const unrelated = { ...structuredClone(row), id: 'other-floor' };
  const renderer = new FormRenderer();
  renderer.applyManagedRepeatableState(
    { buildings: [{ id: 0, values: {}, repeatable: { [key]: [unrelated, row] } }] },
    {
      planRecords: [
        {
          instancePath: [
            part('buildings', { id: 0 }),
            part(key, row, 0), // Identity takes precedence over a former row index.
          ],
          row: accepted,
        },
      ],
    }
  );
  const record = renderer.getBuildingPlanRecord([{ key: 'buildings', index: 0 }]);
  assert.equal(record.repeatable[key][0].values[field], 0.5);
  assert.equal(record.repeatable[key][1].values[field], 0.2);
  assert.equal(renderer.activeRepeatableState.buildings[0].repeatable[key][1].values[field], 0.5);
  record.repeatable[key][1].values[field] = 0.9;
  assert.equal(
    renderer.getBuildingPlanRecord([{ key: 'buildings', index: 0 }]).repeatable[key][1].values[
      field
    ],
    0.2
  );
  const invalid = renderer.getBuildingPlanRecord([{ key: 'buildings', index: 0 }]);
  invalid.repeatable[key] = [invalid.repeatable[key][1]];
  invalid.repeatable[key][0].values[field] = 0.5;
  assert.throws(
    () => readBuildingPlanRecord({ meta: f.meta, record: invalid }),
    /Captured faces and accepted wall thickness disagree/
  );
});
