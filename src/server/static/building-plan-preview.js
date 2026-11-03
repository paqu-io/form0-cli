const mutations = new Set([
  'createFloor',
  'createRoom',
  'updateRoom',
  'createWall',
  'updateWall',
  'createColumn',
  'updateColumn',
  'createBeam',
  'updateBeam',
  'createDoor',
  'updateDoor',
  'createWindow',
  'updateWindow',
]);

/** Bridge the synchronous geometry controller to one managed floor draft per gesture. */
export function createManagedBuildingPlanController({
  controller,
  client,
  renderer,
  stateManager,
  configuration,
  session,
  target,
  add,
  edit,
  report,
  busyChanged = () => {},
}) {
  if (controller.isSharedModel) {
    let lastRoomScopes = '';
    controller.getActiveRoomId = () => {
      const roomKey = controller.meta.repeatablesByNodeKey.rooms.preferredKey;
      const rooms = [...controller.rooms.values()];
      const matches = client.getScopes().flatMap((scope) => {
        const floorPart = scope.instancePath.find(
          (part) => part.repeatableKey === controller.floorKey
        );
        if (floorPart?.instanceId !== controller.floors[controller.activeFloorIndex]?.rowId)
          return [];
        const roomPart = scope.instancePath.find((part) => part.repeatableKey === roomKey);
        const room = roomPart && rooms.find((entry) => entry.rowId === roomPart.instanceId);
        return room ? [{ room, scopeId: scope.scopeId }] : [];
      });
      const signature = matches.map((entry) => entry.scopeId).join('|');
      if (signature !== lastRoomScopes) {
        controller.preferredRoomId = matches.at(-1)?.room.id || null;
        lastRoomScopes = signature;
      }
      return controller.preferredRoomId;
    };
    controller.readOnly = () => configuration().readonly || !session();
    controller.history = async (direction) => {
      const floorPath = [...controller.contextPath, ...controller.getActiveFloorPath()];
      const chosen = client
        .getScopes()
        .some((scope) => scope.scopeId === controller.lastEditorTarget?.scopeId)
        ? controller.lastEditorTarget
        : target(floorPath);
      const result = report(
        await client.request({ action: 'building-plan-history', ...chosen, direction })
      );
      return result;
    };
    controller.transaction = async (_record, { operation }) => {
      const generation = session();
      const floorPath = [...controller.contextPath, ...controller.getActiveFloorPath()];
      if (!target(floorPath).scopeId) {
        const opened = await edit(floorPath);
        if (opened?.issues?.length || session() !== generation) return false;
      }
      const scopes = client.getScopes();
      const subject =
        controller.walls.get(operation.faceId) || controller.rooms.get(operation.roomId);
      const selectedPath = [
        ...controller.contextPath,
        ...(subject?.path || controller.getActiveFloorPath()),
      ];
      const resolved = client.resolvePath(selectedPath);
      const candidates = scopes.filter(
        (scope) =>
          scope.instancePath.length >= floorPath.length &&
          scope.instancePath.every(
            (part, index) =>
              part.repeatableKey === resolved[index]?.repeatableKey &&
              part.instanceId === resolved[index]?.instanceId
          )
      );
      const chosen =
        candidates.sort((a, b) => b.instancePath.length - a.instancePath.length)[0] ||
        target(floorPath);
      controller.lastEditorTarget = chosen;
      busyChanged(true);
      try {
        const result = report(
          await client.request({ action: 'building-plan-operation', ...chosen, operation })
        );
        if (session() !== generation || controller.disposed || result?.issues?.length) return false;
        return { ...result, record: controller.contextPath.length ? _record : client.getState() };
      } finally {
        busyChanged(false);
      }
    };
    const createFloor = async () => {
      if (!session() || configuration().readonly || controller.isBusy()) return null;
      const result = await add(controller.floorSection, controller.contextPath);
      if (result?.issues?.length || controller.disposed) return null;
      controller.syncFromState();
      controller.setActiveFloor(controller.floors.length - 1);
      return controller.floors.at(-1);
    };
    return new Proxy(controller, {
      get(object, name) {
        if (name === 'createFloor') return createFloor;
        const value = object[name];
        return typeof value === 'function' ? value.bind(object) : value;
      },
    });
  }
  let busy = false;
  const wrappers = new Map();
  const canEdit = () =>
    !busy && !controller.disposed && !configuration().readonly && Boolean(session());
  const restore = () => {
    if (controller.disposed) return;
    const state = client.getState();
    if (state) {
      renderer.applyManagedRepeatableState(state.repeatable || {});
      stateManager.applyFormState(state);
      renderer.syncBuildingPlanControllers();
    }
  };
  async function run(name, args) {
    if (!canEdit()) return null;
    const openedSession = session();
    busy = true;
    busyChanged(true);
    controller.emitUpdate();
    try {
      if (name === 'createFloor') {
        const result = await add(controller.floorSection, controller.contextPath);
        if (result?.issues?.length || session() !== openedSession || controller.disposed)
          return null;
        controller.syncFromState();
        controller.setActiveFloor(controller.floors.length - 1);
        return controller.floors.at(-1);
      }
      const path = controller.getActiveFloorPath();
      if (!path.length) return null;
      let chosen = target(path);
      if (!chosen.scopeId) {
        const result = await edit(path);
        if (result?.issues?.length) return null;
        chosen = target(path);
      }
      if (session() !== openedSession || controller.disposed || !chosen.scopeId) return null;
      stateManager.suspendEngineUpdates();
      try {
        const value = await controller[name](...args);
        await controller.settleFieldUpdates();
        if (session() !== openedSession || controller.disposed) return null;
        let row = stateManager.getCurrentFormState();
        for (const part of path) row = row?.repeatable?.[part.key]?.[part.index];
        const result = report(await client.request({ action: 'canvas-update', ...chosen, row }));
        if (result?.issues?.length) {
          restore();
          return null;
        }
        return value;
      } finally {
        // Geometry writes were committed together through the floor command, not the root updater.
        stateManager.pendingEngineUpdate = false;
        stateManager.resumeEngineUpdates();
      }
    } catch (error) {
      if (session() === openedSession) {
        report({ issues: [{ message: error.message }] });
        restore();
      }
      return null;
    } finally {
      busy = false;
      busyChanged(false);
      if (!controller.disposed) {
        controller.syncFromState();
        controller.emitUpdate();
      }
    }
  }
  return new Proxy(controller, {
    get(object, name) {
      if (name === 'canEdit') return canEdit;
      if (name === 'isBusy') return () => busy;
      if (mutations.has(name)) {
        if (!wrappers.has(name)) wrappers.set(name, (...args) => run(name, args));
        return wrappers.get(name);
      }
      const value = object[name];
      return typeof value === 'function' ? value.bind(object) : value;
    },
  });
}
