import test from 'node:test';
import assert from 'node:assert/strict';
import { createManagedBuildingPlanController } from '../src/server/static/building-plan-preview.js';

function fixture() {
  let session = {},
    opened = false,
    readonly = false,
    release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const state = {
    values: {},
    repeatable: { floors: [{ id: 0, values: {}, repeatable: { rooms: [] } }] },
  };
  const calls = [],
    errors = [],
    busyStates = [];
  let depth = 0;
  const controller = {
    contextPath: [],
    floorSection: {},
    floors: [{ id: 0 }],
    disposed: false,
    emitUpdate() {},
    syncFromState() {},
    setActiveFloor() {},
    getActiveFloorPath: () => [{ key: 'floors', index: 0 }],
    createRoom() {
      calls.push('create');
      state.repeatable.floors[0].repeatable.rooms.push({ id: 'room' });
      return { id: 'room' };
    },
    settleFieldUpdates: () => pending,
  };
  const proxy = createManagedBuildingPlanController({
    controller,
    client: {
      getScopes: () => [],
      getState: () => state,
      request: async (request) => {
        calls.push(request);
        return { issues: [] };
      },
    },
    renderer: { applyManagedRepeatableState() {}, syncBuildingPlanControllers() {} },
    stateManager: {
      suspendEngineUpdates: () => depth++,
      resumeEngineUpdates: () => depth--,
      getCurrentFormState: () => structuredClone(state),
      applyFormState() {},
    },
    configuration: () => ({ readonly }),
    session: () => session,
    target: () => ({
      instancePath: [{ repeatableKey: 'floors', instanceId: 0, index: 0, identity: 'id' }],
      scopeId: opened ? 'floor' : undefined,
    }),
    add: async () => ({ issues: [] }),
    edit: async () => {
      calls.push('edit');
      opened = true;
      return { issues: [] };
    },
    report: (result) => {
      errors.push(...(result.issues || []));
      return result;
    },
    busyChanged: (busy) => busyStates.push(busy),
  });
  return {
    proxy,
    controller,
    calls,
    errors,
    busyStates,
    release,
    depth: () => depth,
    setReadonly: (value) => {
      readonly = value;
    },
    replaceSchema: () => {
      session = {};
      controller.disposed = true;
    },
  };
}

test('canvas waits for geometry writes, auto-opens the floor and commits only its draft', async () => {
  const f = fixture();
  const pending = f.proxy.createRoom();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(f.calls, ['edit', 'create']);
  assert.equal(f.proxy.isBusy(), true);
  assert.deepEqual(f.busyStates, [true]);
  assert.equal(f.depth(), 1);
  f.release();
  assert.deepEqual(await pending, { id: 'room' });
  assert.equal(f.calls[2].action, 'canvas-update');
  assert.equal(f.calls[2].row.id, 0);
  assert.equal(f.calls[2].row.repeatable.rooms.length, 1);
  assert.equal(f.depth(), 0);
  assert.equal(f.proxy.isBusy(), false);
  assert.deepEqual(f.busyStates, [true, false]);
  assert.deepEqual(f.errors, []);
});

test('schema retirement while geometry settles cannot write into the replacement editor', async () => {
  const f = fixture();
  const pending = f.proxy.createRoom();
  await Promise.resolve();
  await Promise.resolve();
  f.replaceSchema();
  f.release();
  assert.equal(await pending, null);
  assert.deepEqual(f.calls, ['edit', 'create']);
  assert.equal(f.depth(), 0);
});

test('readonly canvas input does not open an editor or change local geometry', async () => {
  const f = fixture();
  f.setReadonly(true);
  assert.equal(f.proxy.canEdit(), false);
  assert.equal(await f.proxy.createRoom(), null);
  assert.deepEqual(f.calls, []);
  assert.equal(f.depth(), 0);
});
