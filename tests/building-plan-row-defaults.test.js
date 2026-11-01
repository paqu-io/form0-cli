import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormEngine, expandBuildingPlanSchema } from 'form0-core';
import { FormRenderer } from '../src/server/static/form-renderer.js';
import { BuildingPlanController } from '../src/server/static/building-plan-controller.js';
import { createPreviewEventUI } from '../src/server/static/preview-event-ui.js';
import { createPreviewSessionManager } from '../src/server/preview-events/editor.js';

const { schema, buildingPlanMeta } = expandBuildingPlanSchema({
  form: {
    name: 'List-created geometry',
    elements: [
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
        node_overrides: null,
      },
    ],
  },
});
const meta = buildingPlanMeta[0];
const nodes = meta.repeatablesByNodeKey;
const key = (node) => nodes[node].preferredKey;
const name = (node, field) => nodes[node].fieldsByOriginalDataName[field].dataName;
const values = (node, entries) =>
  Object.fromEntries(Object.entries(entries).map(([field, value]) => [name(node, field), value]));
const geometry = (vertices) => JSON.stringify({ unit: 'meters', gridSize: 20, vertices });
const floorPath = [{ key: key('floors'), index: 0 }];
const roomPath = [...floorPath, { key: key('rooms'), index: 0 }];
const wallPath = [...roomPath, { key: key('walls'), index: 0 }];
const seed = () => ({
  values: {},
  repeatable: {
    [key('floors')]: [
      {
        id: 0,
        values: values('floors', {
          floor_name: { choice: [{ value: 'ground_floor', label: 'Ground Floor' }], other: [] },
          floor_elevation_m: 0,
          floor_height_m: 3,
        }),
        repeatable: {
          [key('rooms')]: [
            {
              id: 'existing-room',
              values: values('rooms', {
                room_name: { choice: [{ value: 'bedroom', label: 'Bedroom' }], other: [] },
                room_vertices: geometry([
                  { x: 2, y: 2 },
                  { x: 8, y: 2 },
                  { x: 8, y: 6 },
                  { x: 2, y: 6 },
                ]),
              }),
              repeatable: {
                [key('walls')]: [
                  {
                    id: 'existing-wall',
                    values: values('walls', {
                      wall_label: 'North wall',
                      wall_height_m: 3,
                      wall_thickness_m: 0.2,
                      wall_geometry: geometry([
                        { x: 2, y: 2 },
                        { x: 8, y: 2 },
                      ]),
                    }),
                    repeatable: { [key('doors')]: [], [key('windows')]: [] },
                  },
                ],
                [key('columns')]: [],
                [key('beams')]: [],
              },
            },
          ],
        },
      },
    ],
  },
});

for (const [node, parentPath, expectedFields] of [
  ['rooms', floorPath, ['room_vertices']],
  ['walls', roomPath, ['wall_geometry']],
  ['columns', roomPath, ['column_identifier', 'column_cross_section_width_m', 'column_center_u']],
  [
    'beams',
    roomPath,
    ['beam_identifier', 'beam_cross_section_width_m', 'beam_start_u', 'beam_end_u'],
  ],
  ['doors', wallPath, ['door_label', 'door_width_m', 'door_height_m', 'door_wall_reference']],
  [
    'windows',
    wallPath,
    ['window_label', 'window_width_m', 'window_height_m', 'window_wall_reference'],
  ],
])
  test(`managed Add ${node} initializes its geometry before opening the row, without editing accepted data`, async () => {
    const savedDocument = globalThis.document;
    globalThis.document = new EventTarget();
    let controller;
    try {
      const state = seed();
      const renderer = new FormRenderer();
      renderer.activeRepeatableState = state.repeatable;
      controller = new BuildingPlanController(renderer, null, schema.form.elements[0], [], meta);
      renderer.buildingPlanRegistry.set('plan', { controller });
      const resolvePath = (path) => {
        let row = state;
        return path.map((part) => {
          row = row.repeatable[part.key][part.index];
          return { repeatableKey: part.key, instanceId: row.id, index: part.index, identity: 'id' };
        });
      };
      const scopes = [[], ...parentPath.map((_, index) => parentPath.slice(0, index + 1))].map(
        (path, index) => ({ scopeId: `scope-${index}`, instancePath: resolvePath(path) })
      );
      const ui = createPreviewEventUI({
        client: {
          getScopes: () => scopes,
          getState: () => structuredClone(state),
          resolvePath,
          request: async (request) => ({ ...request, issues: [] }),
        },
        renderer,
        stateManager: {},
        translate: (key) => key,
        showError: assert.fail,
      });
      const before = structuredClone(state);
      const snapshot = structuredClone(controller.getSnapshot());
      const section = controller.getRepeatableByDataName(
        nodes[node].dataName,
        node === 'rooms'
          ? controller.floorSection.elements
          : node === 'doors' || node === 'windows'
            ? controller.wallSection.elements
            : controller.roomSection.elements
      );
      const result = await ui.rendererHooks.add(section, parentPath);
      assert.equal(result.action, 'open-row');
      assert.equal(result.recordKind, 'new');
      for (const field of expectedFields) {
        assert.notEqual(
          result.row.values[name(node, field)],
          null,
          `${node}: ${field} must have geometry`
        );
        assert.notEqual(
          result.row.values[name(node, field)],
          undefined,
          `${node}: ${field} must be present`
        );
      }
      if (node === 'rooms') {
        assert.equal(JSON.parse(result.row.values[name(node, 'room_vertices')]).vertices.length, 4);
        assert.equal(result.row.repeatable[key('walls')].length, 4);
        for (const wall of result.row.repeatable[key('walls')])
          assert.equal(JSON.parse(wall.values[name('walls', 'wall_geometry')]).vertices.length, 2);
      }
      if (node === 'doors' || node === 'windows')
        assert.equal(
          result.row.values[name(node, `${node === 'doors' ? 'door' : 'window'}_wall_reference`)],
          'existing-wall'
        );
      assert.deepEqual(state, before);
      assert.deepEqual(controller.getSnapshot(), snapshot);
    } finally {
      controller?.dispose();
      if (savedDocument === undefined) delete globalThis.document;
      else globalThis.document = savedDocument;
    }
  });

test('list-created room geometry survives Save row and remains isolated by room and floor cancellation', async () => {
  const savedDocument = globalThis.document;
  globalThis.document = new EventTarget();
  const manager = createPreviewSessionManager({
    getSchema: () => schema,
    serializeRecord: (_schema, state) => state,
  });
  let controller;
  try {
    const original = seed();
    const opened = await manager.create({
      state: original,
      configuration: { lifecycle: false, recordKind: 'existing' },
    });
    let sequence = 0;
    const command = (request) =>
      manager.command({ sessionId: opened.sessionId, sequence: ++sequence, ...request });
    const floorTarget = [{ repeatableKey: key('floors'), instanceId: 0, index: 0, identity: 'id' }];
    let result = await command({
      action: 'open-row',
      instancePath: floorTarget,
      parentScopeId: opened.scopes[0].scopeId,
    });
    const floorScope = result.scopes.find((scope) => scope.instancePath.length === 1).scopeId;
    const renderer = new FormRenderer();
    renderer.activeRepeatableState = result.state.repeatable;
    controller = new BuildingPlanController(renderer, null, schema.form.elements[0], [], meta);
    const draft = () => {
      const row = controller.createRowDraft(
        controller.roomSection,
        floorPath,
        renderer.createEmptyRepeatableInstance(controller.roomSection),
        result.state
      );
      // Supply the required assessment details, retaining the generated geometry.
      row.values[name('rooms', 'room_name')] = {
        choice: [{ value: 'bedroom', label: 'Bedroom' }],
        other: [],
      };
      for (const wall of row.repeatable[key('walls')])
        Object.assign(
          wall.values,
          values('walls', { wall_label: 'Perimeter', wall_height_m: 3, wall_thickness_m: 0.2 })
        );
      return row;
    };
    for (const action of ['cancel', 'accept-row']) {
      const row = draft();
      const instancePath = [
        ...floorTarget,
        { repeatableKey: key('rooms'), instanceId: row.id, index: 1, identity: 'id' },
      ];
      result = await command({
        action: 'open-row',
        recordKind: 'new',
        instancePath,
        parentScopeId: floorScope,
        row,
      });
      assert.deepEqual(result.issues, []);
      assert.equal(result.state.repeatable[key('floors')][0].repeatable[key('rooms')].length, 2);
      assert.equal(
        result.committedState.repeatable[key('floors')][0].repeatable[key('rooms')].length,
        1
      );
      const scopeId = result.scopes.find((scope) => scope.instancePath.length === 2).scopeId;
      result = await command({ action, instancePath, scopeId });
      assert.deepEqual(result.issues, []);
      const rooms = result.state.repeatable[key('floors')][0].repeatable[key('rooms')];
      assert.equal(rooms.length, action === 'cancel' ? 1 : 2);
      if (action === 'accept-row') {
        assert.equal(result.eligible, true);
        assert.equal(
          rooms[1].values[name('rooms', 'room_vertices')],
          row.values[name('rooms', 'room_vertices')]
        );
        assert.deepEqual(
          rooms[1].repeatable[key('walls')].map(
            (wall) => wall.values[name('walls', 'wall_geometry')]
          ),
          row.repeatable[key('walls')].map((wall) => wall.values[name('walls', 'wall_geometry')])
        );
      }
    }
    result = await command({ action: 'cancel', instancePath: floorTarget, scopeId: floorScope });
    assert.deepEqual(result.issues, []);
    assert.equal(result.state.repeatable[key('floors')][0].repeatable[key('rooms')].length, 1);
    assert.deepEqual(original, seed());
  } finally {
    controller?.dispose();
    manager.disposeAll();
    if (savedDocument === undefined) delete globalThis.document;
    else globalThis.document = savedDocument;
  }
});

const rowAt = (tree, path) =>
  path.reduce((row, part) => row.repeatable[part.key][part.index], tree);
const targetPath = (tree, path) => {
  let row = tree;
  return path.map((part) => {
    row = row.repeatable[part.key][part.index];
    return { repeatableKey: part.key, instanceId: row.id, index: part.index, identity: 'id' };
  });
};

for (const [node, parentPath, movedField] of [
  ['rooms', floorPath, 'room_vertices'],
  ['walls', roomPath, 'wall_geometry'],
  ['columns', roomPath, 'column_center_u'],
  ['beams', roomPath, 'beam_start_u'],
  ['doors', wallPath, 'door_start_ratio'],
  ['windows', wallPath, 'window_start_ratio'],
])
  test(`canvas edits an open form-created ${node} draft without accepting it or losing typed details`, async () => {
    const savedDocument = globalThis.document;
    globalThis.document = new EventTarget();
    const manager = createPreviewSessionManager({
      getSchema: () => schema,
      serializeRecord: (_schema, state) => state,
    });
    let controller;
    try {
      const original = seed();
      let current = await manager.create({
        state: original,
        configuration: { lifecycle: false, recordKind: 'existing' },
      });
      const initial = structuredClone(current.state);
      const sessionId = current.sessionId;
      let sequence = 0;
      const command = async (request) => {
        current = await manager.command({ sessionId, sequence: ++sequence, ...request });
        return current;
      };
      for (let depth = 1; depth <= parentPath.length; depth++) {
        const instancePath = targetPath(current.state, parentPath.slice(0, depth));
        await command({
          action: 'open-row',
          instancePath,
          parentScopeId: current.scopes.find((scope) => scope.instancePath.length === depth - 1)
            .scopeId,
        });
      }
      const renderer = new FormRenderer();
      renderer.activeRepeatableState = current.state.repeatable;
      controller = new BuildingPlanController(renderer, null, schema.form.elements[0], [], meta);
      const section = nodes[node].dataName;
      const find = (fields) => {
        for (const field of fields) {
          if (field.data_name === section) return field;
          const nested = field.elements && find(field.elements);
          if (nested) return nested;
        }
      };
      const definition = find(schema.form.elements);
      const beforeCount = rowAt(current.state, parentPath).repeatable[key(node)]?.length || 0;
      for (const outcome of ['cancel', 'accept-row']) {
        const row = controller.createRowDraft(
          definition,
          parentPath,
          renderer.createEmptyRepeatableInstance(definition),
          current.state
        );
        if (node === 'rooms') {
          row.values[name(node, 'room_name')] = {
            choice: [{ value: 'bedroom', label: 'Bedroom' }],
            other: [],
          };
          for (const wall of row.repeatable[key('walls')])
            Object.assign(
              wall.values,
              values('walls', { wall_label: 'Perimeter', wall_height_m: 3, wall_thickness_m: 0.2 })
            );
        }
        if (node === 'walls')
          Object.assign(
            row.values,
            values('walls', { wall_label: 'Partition', wall_height_m: 3, wall_thickness_m: 0.2 })
          );
        if (node === 'beams') row.values[name(node, 'beam_depth_m')] = 0.3;
        const instancePath = [
          ...targetPath(current.state, parentPath),
          { repeatableKey: key(node), instanceId: row.id, index: beforeCount, identity: 'id' },
        ];
        const localPath = [...parentPath, { key: key(node), index: beforeCount }];
        await command({
          action: 'open-row',
          recordKind: 'new',
          instancePath,
          row,
          parentScopeId: current.scopes.find(
            (scope) => scope.instancePath.length === parentPath.length
          ).scopeId,
        });
        const scopeId = current.scopes.find(
          (scope) => scope.instancePath.length === localPath.length
        ).scopeId;
        const textField =
          node === 'rooms'
            ? 'room_name'
            : node === 'walls'
              ? 'wall_label'
              : node === 'columns'
                ? 'column_identifier'
                : node === 'beams'
                  ? 'beam_identifier'
                  : node === 'doors'
                    ? 'door_label'
                    : 'window_label';
        const typed =
          node === 'rooms'
            ? { choice: [{ value: 'kitchen', label: 'Kitchen' }], other: [] }
            : 'Typed assessment detail';
        await command({
          action: 'update',
          instancePath,
          scopeId,
          values: { [name(node, textField)]: typed },
        });
        const floor = structuredClone(rowAt(current.state, floorPath));
        const changed = rowAt({ repeatable: { [key('floors')]: [floor] } }, localPath);
        const geometryKey = name(node, movedField);
        const old = changed.values[geometryKey];
        const moved =
          typeof old === 'string'
            ? geometry(
                JSON.parse(old).vertices.map((point) => ({ x: point.x + 1, y: point.y + 1 }))
              )
            : old + 0.1;
        changed.values[geometryKey] = moved;
        const floorTarget = targetPath(current.state, floorPath);
        const floorScope = current.scopes.find((scope) => scope.instancePath.length === 1).scopeId;
        await command({
          action: 'canvas-update',
          instancePath: floorTarget,
          scopeId: floorScope,
          row: floor,
        });
        assert.deepEqual(current.issues, [], 'Canvas must allow moving an open child draft');
        assert.equal(rowAt(current.state, localPath).values[geometryKey], moved);
        assert.deepEqual(rowAt(current.state, localPath).values[name(node, textField)], typed);
        assert.ok(
          current.scopes.some((scope) => scope.scopeId === scopeId),
          'The row must remain open'
        );
        assert.deepEqual(
          current.committedState,
          initial,
          'Canvas must not commit open rows into the root'
        );
        const invalid = structuredClone(floor);
        rowAt({ repeatable: { [key('floors')]: [invalid] } }, parentPath).repeatable[key(node)] =
          [];
        const beforeInvalid = structuredClone(current.state);
        await command({
          action: 'canvas-update',
          instancePath: floorTarget,
          scopeId: floorScope,
          row: invalid,
        });
        assert.equal(current.status, 'failed', 'Canvas cannot remove an active row editor');
        assert.deepEqual(current.state, beforeInvalid);
        await command({ action: outcome, instancePath, scopeId });
        assert.deepEqual(current.issues, []);
        const rows = rowAt(current.state, parentPath).repeatable[key(node)] || [];
        assert.equal(rows.length, beforeCount + (outcome === 'accept-row' ? 1 : 0));
        if (outcome === 'accept-row') {
          assert.equal(current.eligible, true, JSON.stringify(current.validationSummary));
          assert.equal(rows.at(-1).values[geometryKey], moved);
        }
      }
      // The same row can be reopened later; cancelling canvas edits must restore its saved geometry.
      const accepted = structuredClone(current.state);
      const localPath = [...parentPath, { key: key(node), index: beforeCount }];
      const instancePath = targetPath(current.state, localPath);
      await command({
        action: 'open-row',
        instancePath,
        parentScopeId: current.scopes.find(
          (scope) => scope.instancePath.length === parentPath.length
        ).scopeId,
      });
      const existingScope = current.scopes.find(
        (scope) => scope.instancePath.length === localPath.length
      ).scopeId;
      for (let gesture = 0; gesture < 2; gesture++) {
        const floor = structuredClone(rowAt(current.state, floorPath));
        const changed = rowAt({ repeatable: { [key('floors')]: [floor] } }, localPath);
        const geometryKey = name(node, movedField);
        const old = changed.values[geometryKey];
        changed.values[geometryKey] =
          typeof old === 'string'
            ? geometry(
                JSON.parse(old).vertices.map((point) => ({ x: point.x + 1, y: point.y + 1 }))
              )
            : old + 0.1;
        await command({
          action: 'canvas-update',
          instancePath: targetPath(current.state, floorPath),
          scopeId: current.scopes.find((scope) => scope.instancePath.length === 1).scopeId,
          row: floor,
        });
        assert.deepEqual(current.issues, []);
        assert.equal(
          rowAt(current.state, localPath).values[geometryKey],
          changed.values[geometryKey]
        );
      }
      await command({ action: 'cancel', instancePath, scopeId: existingScope });
      assert.deepEqual(
        current.state,
        accepted,
        'Cancel must restore an existing row after repeated canvas gestures'
      );
      await command({
        action: 'cancel',
        instancePath: targetPath(current.state, floorPath),
        scopeId: current.scopes.find((scope) => scope.instancePath.length === 1).scopeId,
      });
      assert.deepEqual(
        current.state,
        initial,
        'Cancelling the floor must restore the original plan'
      );
      assert.deepEqual(original, seed());
    } finally {
      controller?.dispose();
      manager.disposeAll();
      if (savedDocument === undefined) delete globalThis.document;
      else globalThis.document = savedDocument;
    }
  });

test('a canvas gesture coordinates nested open editors atomically without replaying their lifecycle', async () => {
  let failRoomEvaluation = false;
  const triggers = [];
  const engines = [];
  const manager = createPreviewSessionManager({
    getSchema: () => schema,
    serializeRecord: (_schema, state) => state,
    createEngine(options) {
      const engine = createFormEngine(options);
      engines.push(engine);
      const evaluate = engine.eval.bind(engine);
      engine.eval = () => {
        if (failRoomEvaluation && options.eventScope.instancePath.length === 2)
          throw new Error('Room evaluation interrupted');
        return evaluate();
      };
      const trigger = engine.triggerDetailed.bind(engine);
      engine.triggerDetailed = (...args) => {
        triggers.push(args[0]);
        return trigger(...args);
      };
      return engine;
    },
  });
  try {
    let current = await manager.create({
      state: seed(),
      configuration: { lifecycle: true, recordKind: 'existing' },
    });
    const initial = structuredClone(current.state);
    const sessionId = current.sessionId;
    let sequence = 0;
    const command = async (request) => {
      current = await manager.command({ sessionId, sequence: ++sequence, ...request });
      return current;
    };
    for (let depth = 1; depth <= wallPath.length; depth++)
      await command({
        action: 'open-row',
        instancePath: targetPath(current.state, wallPath.slice(0, depth)),
        parentScopeId: current.scopes.find((scope) => scope.instancePath.length === depth - 1)
          .scopeId,
      });
    const scopes = structuredClone(current.scopes);
    const scopeAt = (depth) => scopes.find((scope) => scope.instancePath.length === depth);
    await command({
      action: 'update',
      instancePath: scopeAt(3).instancePath,
      scopeId: scopeAt(3).scopeId,
      values: values('walls', { wall_label: 'Typed wall note' }),
    });
    const before = structuredClone(current.state);
    const engineValues = engines.map((engine) => structuredClone(engine.getState().values));
    const floor = structuredClone(rowAt(current.state, floorPath));
    const room = floor.repeatable[key('rooms')][0];
    room.values[name('rooms', 'room_vertices')] = geometry([
      { x: 3, y: 3 },
      { x: 10, y: 3 },
      { x: 10, y: 8 },
      { x: 3, y: 8 },
    ]);
    const wall = room.repeatable[key('walls')][0];
    wall.values[name('walls', 'wall_geometry')] = geometry([
      { x: 3, y: 3 },
      { x: 10, y: 3 },
    ]);
    const canvasUpdate = () =>
      command({
        action: 'canvas-update',
        instancePath: scopeAt(1).instancePath,
        scopeId: scopeAt(1).scopeId,
        row: floor,
      });
    const lifecycleBefore = [...triggers];
    failRoomEvaluation = true;
    await canvasUpdate();
    assert.equal(current.issues[0].code, 'canvas_update_failed');
    assert.deepEqual(
      current.state,
      before,
      'A failed gesture must roll back every affected editor'
    );
    assert.deepEqual(current.scopes, scopes);
    assert.deepEqual(
      engines.map((engine) => engine.getState().values),
      engineValues,
      'Rollback must retain ancestor values available to each editor'
    );
    failRoomEvaluation = false;
    await canvasUpdate();
    assert.deepEqual(current.issues, []);
    assert.deepEqual(triggers, lifecycleBefore, 'Geometry must not replay load/edit/change events');
    assert.deepEqual(current.scopes, scopes);
    assert.equal(
      rowAt(current.state, roomPath).values[name('rooms', 'room_vertices')],
      room.values[name('rooms', 'room_vertices')]
    );
    assert.equal(
      rowAt(current.state, wallPath).values[name('walls', 'wall_geometry')],
      wall.values[name('walls', 'wall_geometry')]
    );
    assert.equal(
      rowAt(current.state, wallPath).values[name('walls', 'wall_label')],
      'Typed wall note'
    );
    assert.deepEqual(current.committedState, initial);
    // Drawing a separate room must also work while these editors remain open.
    const withSibling = structuredClone(rowAt(current.state, floorPath));
    const sibling = structuredClone(
      initial.repeatable[key('floors')][0].repeatable[key('rooms')][0]
    );
    sibling.id = 'canvas-sibling';
    withSibling.repeatable[key('rooms')].push(sibling);
    await command({
      action: 'canvas-update',
      instancePath: scopeAt(1).instancePath,
      scopeId: scopeAt(1).scopeId,
      row: withSibling,
    });
    assert.deepEqual(current.issues, []);
    assert.deepEqual(current.scopes, scopes);
    assert.equal(rowAt(current.state, floorPath).repeatable[key('rooms')].length, 2);
    await command({
      action: 'cancel',
      instancePath: scopeAt(3).instancePath,
      scopeId: scopeAt(3).scopeId,
    });
    assert.equal(
      rowAt(current.state, wallPath).values[name('walls', 'wall_geometry')],
      rowAt(initial, wallPath).values[name('walls', 'wall_geometry')]
    );
    assert.equal(
      rowAt(current.state, roomPath).values[name('rooms', 'room_vertices')],
      room.values[name('rooms', 'room_vertices')]
    );
    await command({
      action: 'cancel',
      instancePath: scopeAt(2).instancePath,
      scopeId: scopeAt(2).scopeId,
    });
    assert.deepEqual(rowAt(current.state, roomPath), rowAt(initial, roomPath));
    assert.equal(
      rowAt(current.state, floorPath).repeatable[key('rooms')].at(-1).id,
      'canvas-sibling'
    );
    await command({
      action: 'cancel',
      instancePath: scopeAt(1).instancePath,
      scopeId: scopeAt(1).scopeId,
    });
    assert.deepEqual(current.state, initial);
  } finally {
    manager.disposeAll();
  }
});
