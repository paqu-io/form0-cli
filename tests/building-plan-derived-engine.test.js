import test from 'node:test';
import assert from 'node:assert/strict';
import { readBuildingPlanRecord } from 'form0-core';
import { createPreviewSessionManager } from '../src/server/preview-events/editor.js';
import { FormRenderer } from '../src/server/static/form-renderer.js';
import { createSharedBuildingPlanController } from '../src/server/static/building-plan-shared-controller.js';
import { fixture, part } from './fixtures/building-plan-v2.js';

// Removing a room's boundary row: today's engine removes it, the derived core refuses (K1).
for (const derived of [false, true])
  test(`a preview session edits BuildingPlans on the ${derived ? 'derived core' : 'current engine'} it started with`, async () => {
    const f = fixture();
    const manager = createPreviewSessionManager({
      getSchema: () => f.schema,
      serializeRecord: (_schema, state) => state,
    });
    const started = await manager.create({
      state: f.record,
      configuration: { lifecycle: false, recordKind: 'existing' },
      buildingPlanDerivedCommands: derived,
    });
    try {
      const path = [
        part(f.nodes.floors.preferredKey, started.state.repeatable[f.nodes.floors.preferredKey][0]),
      ];
      let sequence = 0;
      const command = (request) =>
        manager.command({
          sessionId: started.sessionId,
          sequence: ++sequence,
          instancePath: path,
          ...request,
        });
      let result = await command({ action: 'open-row', parentScopeId: started.scopes[0].scopeId });
      const scopeId = result.scopes.find((scope) => scope.instancePath.length === 1).scopeId;
      const floor = readBuildingPlanRecord({ meta: f.meta, record: result.state }).floors[0];
      result = await command({
        scopeId,
        action: 'building-plan-operation',
        operation: { type: 'remove_face', floorId: floor.id, faceId: floor.rooms[0].faces[0].id },
      });
      assert.equal(
        result.issues?.[0]?.code === 'boundary_row_required',
        derived,
        JSON.stringify(result.issues)
      );
    } finally {
      manager.dispose?.(started.sessionId);
    }
  });

test('the preview canvas uses the engine the renderer was given', () => {
  const f = fixture();
  for (const derived of [false, true]) {
    const renderer = new FormRenderer();
    renderer.setSchema(f.schema, {
      repeatableState: f.record.repeatable,
      buildingPlanMeta: [f.meta],
    });
    renderer.setBuildingPlanDerivedCommands(derived);
    const previousDocument = globalThis.document;
    let controller;
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
    assert.equal(controller.derivedCommands, derived);
    controller.dispose?.();
  }
});
