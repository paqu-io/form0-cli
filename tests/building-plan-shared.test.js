import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFormEngine,
  createBuildingPlanSession,
  writeBuildingPlanRecord,
  readBuildingPlanRecord,
} from 'form0-core';
import { createFieldTemplate } from '../src/utils/field-template.js';
import { createPreviewSessionManager } from '../src/server/preview-events/editor.js';

import { fixture, at, part } from './fixtures/building-plan-v2.js';

for (const security of ['trusted', 'safe'])
  for (const lifecycle of [false, true]) {
    test(`partial shared geometry belongs to its initiating row checkpoint (${security}, lifecycle=${lifecycle})`, async () => {
      const f = fixture();
      const events = [];
      const lifecycleEvents = () => events.filter((type) => /^(new|edit|save)-/.test(type));
      const manager = createPreviewSessionManager({
        createEngine: (options) => {
          const engine = createFormEngine(options);
          const trigger = engine.triggerDetailed.bind(engine);
          engine.triggerDetailed = (type, ...args) => {
            events.push(type);
            return trigger(type, ...args);
          };
          return engine;
        },
        getSchema: () => f.schema,
        serializeRecord: (_schema, state) => state,
        evaluationOptions: { security: { mode: security } },
      });
      try {
        const started = await manager.create({
          state: f.record,
          configuration: { lifecycle, recordKind: 'existing' },
        });
        let sequence = 0;
        const command = (request) =>
          manager.command({ sessionId: started.sessionId, sequence: ++sequence, ...request });
        const floorPath = [
          part(f.nodes.floors.preferredKey, f.record.repeatable[f.nodes.floors.preferredKey][0]),
        ];
        let result = await command({
          action: 'open-row',
          instancePath: floorPath,
          parentScopeId: started.scopes[0].scopeId,
        });
        assert.deepEqual(result.issues, []);
        const floorScope = result.scopes.find((scope) => scope.instancePath.length === 1).scopeId;
        const roomRow = at(result.state, floorPath).repeatable[f.nodes.rooms.preferredKey][0];
        const roomPath = [...floorPath, part(f.nodes.rooms.preferredKey, roomRow)];
        result = await command({
          action: 'open-row',
          instancePath: roomPath,
          parentScopeId: floorScope,
        });
        assert.deepEqual(result.issues, []);
        const roomScope = result.scopes.find((scope) => scope.instancePath.length === 2).scopeId;
        const initialLifecycle = lifecycleEvents();
        result = await command({
          action: 'building-plan-operation',
          instancePath: roomPath,
          scopeId: roomScope,
          operation: { type: 'resize_face', floorId: f.floorId, faceId: f.faceId, distance: 0.5 },
        });
        assert.deepEqual(result.issues, []);
        const changed = readBuildingPlanRecord({ meta: f.meta, record: result.state });
        assert.ok(changed.floors[0].rooms[1].vertices.length > 5);
        assert.equal(
          readBuildingPlanRecord({ meta: f.meta, record: result.committedState }).floors[0].rooms[1]
            .vertices.length,
          5
        );
        for (const direction of ['undo', 'redo']) {
          result = await command({
            action: 'building-plan-history',
            instancePath: roomPath,
            scopeId: roomScope,
            direction,
          });
          assert.deepEqual(result.issues, []);
          const count = readBuildingPlanRecord({ meta: f.meta, record: result.state }).floors[0]
            .rooms[1].vertices.length;
          assert.equal(count > 5, direction === 'redo');
          assert.deepEqual(lifecycleEvents(), initialLifecycle);
        }
        result = await command({ action: 'cancel', instancePath: roomPath, scopeId: roomScope });
        assert.deepEqual(result.issues, []);
        assert.deepEqual(lifecycleEvents(), initialLifecycle);
        assert.equal(
          readBuildingPlanRecord({ meta: f.meta, record: result.state }).floors[0].rooms[1].vertices
            .length,
          5
        );
        result = await command({ action: 'cancel', instancePath: floorPath, scopeId: floorScope });
        assert.deepEqual(result.issues, []);
        assert.deepEqual(
          readBuildingPlanRecord({ meta: f.meta, record: result.state }),
          readBuildingPlanRecord({ meta: f.meta, record: f.record })
        );
      } finally {
        manager.disposeAll();
      }
    });
  }

for (const security of ['trusted', 'safe'])
  test(`removing a floor needs no removed observation cascade (${security})`, async () => {
    const f = fixture();
    const manager = createPreviewSessionManager({
      getSchema: () => f.schema,
      serializeRecord: (_schema, state) => state,
      evaluationOptions: { security: { mode: security } },
    });
    try {
      const started = await manager.create({
        state: f.record,
        configuration: { lifecycle: true, recordKind: 'existing' },
      });
      const path = [
        part(f.nodes.floors.preferredKey, f.record.repeatable[f.nodes.floors.preferredKey][0]),
      ];
      const result = await manager.command({
        sessionId: started.sessionId,
        sequence: 1,
        action: 'remove-row',
        scopeId: started.scopes[0].scopeId,
        instancePath: [],
        affectedPath: path,
      });
      assert.deepEqual(result.issues, []);
      assert.equal(readBuildingPlanRecord({ meta: f.meta, record: result.state }).floors.length, 0);
    } finally {
      manager.disposeAll();
    }
  });

for (const security of ['trusted', 'safe'])
  test(`typed physical answers survive scoped evaluation before row Save (${security})`, async () => {
    const f = fixture();
    const manager = createPreviewSessionManager({
      getSchema: () => f.schema,
      serializeRecord: (_schema, state) => state,
      evaluationOptions: { security: { mode: security } },
    });
    try {
      const started = await manager.create({
        state: f.record,
        configuration: { lifecycle: true, recordKind: 'existing' },
      });
      let sequence = 0;
      const command = (request) =>
        manager.command({ sessionId: started.sessionId, sequence: ++sequence, ...request });
      let result = await command({
        action: 'prepare',
        instancePath: [],
        scopeId: started.scopes[0].scopeId,
        intent: 'submit',
      });
      // Walls take their room's height (2026-11-16), so the record starts complete.
      assert.equal(result.eligible, true, JSON.stringify(result.validationSummary));
      let path = [],
        scopeId = started.scopes[0].scopeId;
      for (const node of ['floors', 'rooms', 'walls']) {
        const row = at(result.state, path).repeatable[f.nodes[node].preferredKey][0];
        path = [...path, part(f.nodes[node].preferredKey, row)];
        result = await command({ action: 'open-row', instancePath: path, parentScopeId: scopeId });
        assert.deepEqual(result.issues, []);
        scopeId = result.scopes.find((entry) => entry.instancePath.length === path.length).scopeId;
      }
      const height = f.nodes.walls.fieldsByOriginalDataName.wall_height.dataName;
      result = await command({
        action: 'update',
        instancePath: path,
        scopeId,
        values: { [height]: 2.8 },
        fieldKey: height,
      });
      assert.deepEqual(result.issues, []);
      assert.equal(at(result.state, path).values[height], 2.8);
      result = await command({ action: 'accept-row', instancePath: path, scopeId });
      assert.equal(result.eligible, true, JSON.stringify(result.validationSummary));
      assert.equal(at(result.state, path).values[height], 2.8);
    } finally {
      manager.disposeAll();
    }
  });

for (const security of ['trusted', 'safe'])
  for (const value of ['apply', 'cancel'])
    test(`focused thickness completion preserves physical ownership without a copy question (${security}, ${value})`, async () => {
      const provider = createFieldTemplate('NumericField', { dataName: 'default_wall_height' });
      provider.key = 'default_wall_height';
      provider.building_plan = {
        property: 'wall_height',
        scope: 'physical_wall',
        inherit_to: 'walls',
      };
      const note = createFieldTemplate('TextField', { dataName: 'survey_note' });
      note.key = 'survey_note';
      note.building_plan = { property: 'survey_note', scope: 'physical_wall', on_split: 'confirm' };
      const f = fixture({
        floors: { extra_elements: [provider] },
        walls: { extra_elements: [note] },
      });
      const domain = createBuildingPlanSession({
        snapshot: readBuildingPlanRecord({ meta: f.meta, record: f.record }),
        properties: f.meta.properties,
      });
      assert.equal(
        domain.apply({
          type: 'set_property',
          floorId: f.floorId,
          faceId: f.faceId,
          property: 'survey_note',
          value: 'Measured on site',
        }).status,
        'applied'
      );
      f.record = writeBuildingPlanRecord({
        meta: f.meta,
        record: f.record,
        plan: domain.getSnapshot(),
      });
      const manager = createPreviewSessionManager({
        getSchema: () => f.schema,
        serializeRecord: (_schema, state) => state,
        evaluationOptions: { security: { mode: security } },
      });
      try {
        const started = await manager.create({
          state: f.record,
          configuration: { lifecycle: true, recordKind: 'existing' },
        });
        let sequence = 0;
        const command = (request) =>
          manager.command({ sessionId: started.sessionId, sequence: ++sequence, ...request });
        let path = [],
          scopeId = started.scopes[0].scopeId,
          result;
        for (const key of ['floors', 'rooms', 'walls']) {
          const rows = at(f.record, path).repeatable[f.nodes[key].preferredKey];
          const storage =
            key === 'walls' &&
            f.nodes.walls.fields.find((field) => field.binding?.role === 'storage').dataName;
          const selected =
            key === 'walls'
              ? rows.find((row) => JSON.parse(row.values[storage]).id === f.faceId)
              : rows[0];
          path = [...path, part(f.nodes[key].preferredKey, selected)];
          result = await command({
            action: 'open-row',
            instancePath: path,
            parentScopeId: scopeId,
          });
          assert.deepEqual(result.issues, []);
          scopeId = result.scopes.find(
            (scope) => scope.instancePath.length === path.length
          ).scopeId;
        }
        const field = f.nodes.walls.fieldsByOriginalDataName.wall_thickness.dataName;
        result = await command({
          action: 'update',
          scopeId,
          instancePath: path,
          values: { [field]: 0.4 },
          fieldKey: field,
        });
        assert.deepEqual(result.issues, []);
        result = await command({
          action: value === 'apply' ? 'accept-row' : 'cancel',
          scopeId,
          instancePath: path,
          intent: 'submit',
        });
        assert.ok(!result.presentations.some((operation) => operation.operation === 'MESSAGEBOX'));
        assert.ok(!result.scopes.some((scope) => scope.scopeId === scopeId));
        assert.deepEqual(result.issues, []);
        if (value === 'apply') {
          assert.ok(!result.scopes.some((scope) => scope.scopeId === scopeId));
          const plan = readBuildingPlanRecord({ meta: f.meta, record: result.state });
          const face = plan.floors[0].rooms[0].faces.find((face) => face.id === f.faceId);
          assert.equal(
            plan.floors[0].walls.find((wall) => wall.id === face.wallId).properties.wall_thickness,
            0.4
          );
        } else {
          const plan = readBuildingPlanRecord({ meta: f.meta, record: result.committedState });
          assert.ok(plan.floors[0].walls.every((wall) => wall.properties.wall_thickness === 0.2));
        }
      } finally {
        manager.disposeAll();
      }
    });
