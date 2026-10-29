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
      if (
        client.getScopes().some(
          (scope) =>
            scope.instancePath.length > chosen.instancePath.length &&
            chosen.instancePath.every((part, index) => {
              const other = scope.instancePath[index];
              return (
                part.repeatableKey === other.repeatableKey &&
                part.identity === other.identity &&
                (part.identity === 'id'
                  ? part.instanceId === other.instanceId
                  : part.index === other.index)
              );
            })
        )
      ) {
        report({ issues: [{ message: 'Accept or cancel the open child editor before drawing.' }] });
        return null;
      }
      stateManager.suspendEngineUpdates();
      try {
        const value = controller[name](...args);
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
