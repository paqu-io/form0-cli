import test from 'node:test';
import assert from 'node:assert/strict';
import { expandBuildingPlanSchema } from 'form0-core';
import { createPreviewSessionManager } from '../src/server/preview-events/editor.js';
import { field, repeatable } from './fixtures/preview-event-fields.js';
import { FormRenderer } from '../src/server/static/form-renderer.js';

const { schema, buildingPlanMeta } = expandBuildingPlanSchema({
  form: {
    name: 'Canvas draft ownership',
    elements: [
      field('NumericField', 'multiplier', { default_value: 2 }),
      {
        type: 'BuildingPlanSection',
        key: 'plan',
        data_name: 'plan',
        label: 'Plan',
        description: null,
        description_mode: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        node_overrides: {
          rooms: {
            extra_elements: [
              field('NumericField', 'room_input'),
              field('CalculatedField', 'room_calc', { calculate: '$room_input * $multiplier' }),
            ],
          },
        },
      },
      repeatable('ordinary', [field('TextField', 'ordinary_note')]),
    ],
  },
});
const nodes = buildingPlanMeta[0].repeatablesByNodeKey;
const floorKey = nodes.floors.preferredKey;
const roomKey = nodes.rooms.preferredKey;
const wallKey = nodes.walls.preferredKey;
const vertices = nodes.rooms.fieldsByOriginalDataName.room_vertices.dataName;
const geometry = nodes.walls.fieldsByOriginalDataName.wall_geometry.dataName;
const roomCalc = nodes.rooms.fieldsByOriginalDataName.room_calc.dataName;
const expression = `$${nodes.rooms.fieldsByOriginalDataName.room_input.dataName} * $multiplier`;
schema.form.elements.find(
  (item) => item.type === 'BuildingPlanSection'
).node_overrides.rooms.extra_elements[1].calculate = expression;
const setExpression = (elements) =>
  elements.forEach((item) => {
    if (item.data_name === roomCalc) item.calculate = expression;
    if (item.elements) setExpression(item.elements);
  });
setExpression(schema.form.elements);
const values = (node, input) =>
  Object.fromEntries(
    Object.entries(input).map(([name, value]) => [
      nodes[node].fieldsByOriginalDataName[name]?.dataName || name,
      value,
    ])
  );
const floorValues = () =>
  values('floors', {
    floor_name: { choice: [{ value: 'ground_floor', label: 'Ground Floor' }], other: [] },
    floor_elevation_m: 0,
    floor_height_m: 3,
  });
const path = [{ repeatableKey: floorKey, instanceId: 0, index: 0, identity: 'id' }];
const seed = () => ({
  values: { multiplier: 2 },
  repeatable: {
    [floorKey]: [
      {
        id: 0,
        values: floorValues(),
        repeatable: { [roomKey]: [] },
        custom: 'keep floor metadata',
      },
      { id: 'sibling', values: {}, repeatable: { [roomKey]: [] }, custom: 'untouched sibling' },
    ],
    ordinary: [{ id: 'ordinary', values: {}, repeatable: {} }],
  },
});
const drawn = () => ({
  id: 0,
  values: floorValues(),
  repeatable: {
    [roomKey]: [
      {
        id: 'room-A',
        values: {
          ...values('rooms', {
            room_name: { choice: [{ value: 'bedroom', label: 'Bedroom' }], other: [] },
            room_input: 3,
          }),
          [vertices]: 'geometry',
        },
        repeatable: {
          [wallKey]: [0, 1, 2, 3].map((id) => ({
            id: 'wall-' + id,
            values: {
              ...values('walls', { wall_label: 'Wall', wall_height_m: 3, wall_thickness_m: 0.2 }),
              [geometry]: 'wall-' + id,
            },
            repeatable: {},
          })),
        },
      },
    ],
  },
});

for (const security of [undefined, { mode: 'safe' }])
  for (const lifecycle of [false, true])
    test(`canvas floor changes remain a cancellable draft (${security?.mode || 'trusted'}, lifecycle=${lifecycle})`, async () => {
      const original = seed();
      const manager = createPreviewSessionManager({
        getSchema: () => schema,
        serializeRecord: (_schema, state) => state,
        evaluationOptions: { security },
      });
      try {
        const opened = await manager.create({
          state: original,
          configuration: { lifecycle, recordKind: 'existing' },
        });
        let sequence = 0;
        const command = (data) =>
          manager.command({ sessionId: opened.sessionId, sequence: ++sequence, ...data });
        const edit = await command({
          action: 'open-row',
          instancePath: path,
          parentScopeId: opened.scopes[0].scopeId,
        });
        const scopeId = edit.scopes.find((scope) => scope.instancePath.length)?.scopeId;
        const update = () =>
          command({ action: 'canvas-update', instancePath: path, scopeId, row: drawn() });
        const changed = await update();
        assert.deepEqual(changed.issues, []);
        const floor = changed.state.repeatable[floorKey][0];
        assert.equal(floor.repeatable[roomKey].length, 1);
        assert.equal(floor.repeatable[roomKey][0].values[roomCalc], 6);
        assert.equal(floor.repeatable[roomKey][0].repeatable[wallKey].length, 4);
        assert.equal(floor.custom, 'keep floor metadata');
        assert.equal(changed.committedState.repeatable[floorKey][0].repeatable[roomKey].length, 0);
        assert.deepEqual(changed.state.repeatable[floorKey][1], original.repeatable[floorKey][1]);
        for (const invalid of [
          { ...drawn(), values: { typo: 1 } },
          { ...drawn(), repeatable: { ordinary: [] } },
          {
            ...drawn(),
            repeatable: { [roomKey]: [{ id: 'bad', values: { [roomCalc]: 999 }, repeatable: {} }] },
          },
          {
            ...drawn(),
            repeatable: {
              [roomKey]: [drawn().repeatable[roomKey][0], drawn().repeatable[roomKey][0]],
            },
          },
        ]) {
          const rejected = await command({
            action: 'canvas-update',
            instancePath: path,
            scopeId,
            row: invalid,
          });
          assert.equal(rejected.status, 'failed');
          assert.deepEqual(rejected.state, changed.state);
        }
        const cancelled = await command({ action: 'cancel', instancePath: path, scopeId });
        assert.equal(cancelled.state.repeatable[floorKey][0].repeatable[roomKey].length, 0);
        const again = await command({
          action: 'open-row',
          instancePath: path,
          parentScopeId: opened.scopes[0].scopeId,
        });
        const nextScope = again.scopes.find((scope) => scope.instancePath.length).scopeId;
        await command({
          action: 'canvas-update',
          instancePath: path,
          scopeId: nextScope,
          row: drawn(),
        });
        const saved = await command({
          action: 'accept-row',
          instancePath: path,
          scopeId: nextScope,
        });
        assert.equal(saved.eligible, true);
        assert.equal(saved.state.repeatable[floorKey][0].repeatable[roomKey].length, 1);
        assert.deepEqual(original, seed());
      } finally {
        manager.disposeAll();
      }
    });

test('canvas updates require an active BuildingPlan floor and cannot edit readonly records', async () => {
  const manager = createPreviewSessionManager({
    getSchema: () => schema,
    serializeRecord: (_schema, state) => state,
  });
  try {
    for (const readonly of [false, true]) {
      const started = await manager.create({
        state: seed(),
        configuration: { lifecycle: true, recordKind: 'existing', readonly },
      });
      const result = await manager.command({
        sessionId: started.sessionId,
        sequence: 1,
        action: 'canvas-update',
        instancePath: [],
        scopeId: started.scopes[0].scopeId,
        row: drawn(),
      });
      assert.equal(result.status, 'failed');
      assert.deepEqual(result.state.repeatable, seed().repeatable);
    }
  } finally {
    manager.disposeAll();
  }
});

test('ordinary root updates do not resynchronize plan geometry or prepare the record', () => {
  const renderer = new FormRenderer();
  let synchronizations = 0,
    buttons = 0;
  renderer.buildingPlanRegistry.set('plan', {
    controller: {
      floorKey: 'floors',
      syncFromState: () => synchronizations++,
      emitUpdate: () => {},
    },
    canvas: { updateButtonStates: () => buttons++ },
  });
  renderer.syncBuildingPlanControllers({ action: 'update', instancePath: [], fieldKey: 'outside' });
  renderer.syncBuildingPlanControllers({ action: 'dispatch', type: 'focus', instancePath: [] });
  assert.equal(synchronizations, 0);
  assert.equal(buttons, 2);
  renderer.syncBuildingPlanControllers({
    action: 'cancel',
    instancePath: [{ repeatableKey: 'floors' }],
  });
  assert.equal(synchronizations, 1);
});

test('an authored readonly BuildingPlan rejects canvas writes even in an editable record', async () => {
  const locked = structuredClone(schema);
  locked.form.elements.find((item) => item.type === 'BuildingPlanSection').read_only = true;
  const manager = createPreviewSessionManager({
    getSchema: () => locked,
    serializeRecord: (_schema, state) => state,
  });
  try {
    const start = await manager.create({
      state: seed(),
      configuration: { lifecycle: true, recordKind: 'existing' },
    });
    const edit = await manager.command({
      sessionId: start.sessionId,
      sequence: 1,
      action: 'open-row',
      instancePath: path,
      parentScopeId: start.scopes[0].scopeId,
    });
    const result = await manager.command({
      sessionId: start.sessionId,
      sequence: 2,
      action: 'canvas-update',
      instancePath: path,
      scopeId: edit.scopes.find((scope) => scope.instancePath.length).scopeId,
      row: drawn(),
    });
    assert.equal(result.issues[0].code, 'readonly_scope');
    assert.deepEqual(result.state, edit.state);
  } finally {
    manager.disposeAll();
  }
});
