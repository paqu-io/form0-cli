import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expandBuildingPlanSchema,
  createFormEngine,
  createBuildingPlanSession,
  writeBuildingPlanRecord,
  readBuildingPlanRecord,
} from 'form0-core';
import { createPreviewSessionManager } from '../src/server/preview-events/editor.js';

function fixture() {
  const expanded = expandBuildingPlanSchema({
    form: {
      name: 'Shared wall editor',
      elements: [
        {
          type: 'BuildingPlanSection',
          key: 'plan',
          data_name: 'plan',
          label: 'Plan',
          description: null,
          description_mode: null,
          visible_conditions: null,
          read_only_conditions: null,
          visible: true,
          read_only: false,
          node_overrides: null,
        },
      ],
    },
  });
  const meta = expanded.buildingPlanMeta[0];
  const nodes = meta.repeatablesByNodeKey;
  const domain = createBuildingPlanSession();
  const floorId = domain.apply({
    type: 'create_floor',
    values: {
      floor_name: { choice: [{ value: 'ground_floor', label: 'Ground floor' }], other: [] },
      floor_elevation_m: 0,
      floor_height_m: 3,
    },
  }).created.id;
  for (const [x, y] of [
    [0, 0],
    [3, 3.2],
  ])
    domain.apply({
      type: 'create_room',
      floorId,
      rectangle: { x, y, width: 5, height: 3 },
      values: { room_name: { choice: [{ value: 'bedroom', label: 'Bedroom' }], other: [] } },
    });
  const floor = domain.getSnapshot().floors[0];
  const faceId = floor.rooms[0].faces[2].id;
  assert.equal(
    domain.apply({
      type: 'bind_faces',
      floorId,
      referenceFaceId: faceId,
      faceId: floor.rooms[1].faces[0].id,
    }).status,
    'applied'
  );
  const record = writeBuildingPlanRecord({ meta, plan: domain.getSnapshot() });
  record.repeatable[nodes.floors.preferredKey][0].id = 0;
  return { ...expanded, meta, nodes, record, floorId, faceId };
}
const at = (row, path) =>
  path.reduce(
    (cursor, part) =>
      cursor.repeatable[part.repeatableKey].find(
        (entry) => (entry.id ?? entry.record_id) === part.instanceId
      ),
    row
  );
const part = (key, row, index = 0) => ({
  repeatableKey: key,
  instanceId: row.id,
  index,
  identity: 'id',
});

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
        assert.ok(changed.floors[0].rooms[1].vertices.length > 4);
        assert.equal(
          readBuildingPlanRecord({ meta: f.meta, record: result.committedState }).floors[0].rooms[1]
            .vertices.length,
          4
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
          assert.equal(count > 4, direction === 'redo');
          assert.deepEqual(lifecycleEvents(), initialLifecycle);
        }
        result = await command({ action: 'cancel', instancePath: roomPath, scopeId: roomScope });
        assert.deepEqual(result.issues, []);
        assert.deepEqual(lifecycleEvents(), initialLifecycle);
        assert.equal(
          readBuildingPlanRecord({ meta: f.meta, record: result.state }).floors[0].rooms[1].vertices
            .length,
          4
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
  test(`removing a floor describes observation loss before changing its stored rows (${security})`, async () => {
    const f = fixture();
    const domain = createBuildingPlanSession({
      snapshot: readBuildingPlanRecord({ meta: f.meta, record: f.record }),
    });
    assert.equal(
      domain.apply({
        type: 'add_observation',
        floorId: f.floorId,
        subject: { type: 'room_face', id: f.faceId },
        observedAt: '2026-11-02',
        values: {},
        evidence: ['photo-1'],
      }).status,
      'applied'
    );
    const record = writeBuildingPlanRecord({
      meta: f.meta,
      plan: domain.getSnapshot(),
      record: f.record,
    });
    const manager = createPreviewSessionManager({
      getSchema: () => f.schema,
      serializeRecord: (_schema, state) => state,
      evaluationOptions: { security: { mode: security } },
    });
    try {
      const started = await manager.create({
        state: record,
        configuration: { lifecycle: true, recordKind: 'existing' },
      });
      const path = [
        part(f.nodes.floors.preferredKey, record.repeatable[f.nodes.floors.preferredKey][0]),
      ];
      const request = {
        sessionId: started.sessionId,
        action: 'remove-row',
        scopeId: started.scopes[0].scopeId,
        instancePath: [],
        affectedPath: path,
      };
      const refused = await manager.command({ ...request, sequence: 1 });
      assert.ok(
        refused.issues.some((issue) => issue.code === 'observation_deletion_requires_confirmation')
      );
      assert.equal(
        readBuildingPlanRecord({ meta: f.meta, record: refused.state }).floors.length,
        1
      );
      const confirmed = await manager.command({
        ...request,
        sequence: 2,
        allowObservationDeletion: true,
      });
      assert.deepEqual(confirmed.issues, []);
      assert.equal(
        readBuildingPlanRecord({ meta: f.meta, record: confirmed.state }).floors.length,
        0
      );
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
      assert.equal(result.eligible, false);
      let path = [],
        scopeId = started.scopes[0].scopeId;
      for (const node of ['floors', 'rooms', 'walls']) {
        const row = at(result.state, path).repeatable[f.nodes[node].preferredKey][0];
        path = [...path, part(f.nodes[node].preferredKey, row)];
        result = await command({ action: 'open-row', instancePath: path, parentScopeId: scopeId });
        assert.deepEqual(result.issues, []);
        scopeId = result.scopes.find((entry) => entry.instancePath.length === path.length).scopeId;
      }
      const height = f.nodes.walls.fieldsByOriginalDataName.wall_height_m.dataName;
      result = await command({
        action: 'update',
        instancePath: path,
        scopeId,
        values: { [height]: 3 },
        fieldKey: height,
      });
      assert.deepEqual(result.issues, []);
      assert.equal(at(result.state, path).values[height], 3);
      result = await command({ action: 'accept-row', instancePath: path, scopeId });
      assert.equal(result.eligible, true, JSON.stringify(result.validationSummary));
    } finally {
      manager.disposeAll();
    }
  });
