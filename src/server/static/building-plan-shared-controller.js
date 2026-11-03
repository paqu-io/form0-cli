import { BuildingPlanCanvasController } from 'form0-core/building-plan';

/** Keep preview navigation and managed row controls around the portable canvas rules. */
export function createSharedBuildingPlanController(
  renderer,
  stateManager,
  section,
  contextPath,
  meta
) {
  const owner = (record) => {
    for (const part of contextPath) record = record?.repeatable?.[part.key]?.[part.index];
    return record;
  };
  const issue = document.createElement('div');
  issue.className = 'field-error building-plan-conflict';
  issue.setAttribute('role', 'status');
  issue.hidden = true;
  const controller = new BuildingPlanCanvasController({
    meta,
    editingPolicy: renderer.buildingPlanEditingPolicy,
    confirmOpeningRemoval: (issue) =>
      globalThis.confirm?.(
        `${issue.message}\n\n${issue.observationIds.length ? `This also deletes ${issue.observationIds.length} associated observation(s).\n\n` : ''}Keep this position and remove the opening(s)?`
      ) === true,
    readRecord: () => owner({ values: {}, repeatable: renderer.activeRepeatableState || {} }),
    writeRecord: (record, command) => controller.transaction?.(record, command) ?? false,
    focusRow: (path) => {
      controller.preferredRoomId =
        [...controller.rooms.values()].find((room) =>
          room.path.every(
            (part, index) => part.key === path[index]?.key && part.index === path[index]?.index
          )
        )?.id || null;
      const fullPath = [...contextPath, ...path];
      renderer.ensureRepeatablePathExpanded(fullPath);
      // Expansion changes scroll anchoring. Measure after the browser has laid out the row.
      requestAnimationFrame(() => {
        if (controller.disposed) return;
        const element = renderer.getRepeatableInstanceContainer(fullPath);
        const header = element?.querySelector(':scope > .repeatable-instance-header');
        const pane = element?.closest('.building-plan-detail-panel');
        if (header && pane) {
          const top =
            pane.scrollTop +
            header.getBoundingClientRect().top -
            pane.getBoundingClientRect().top -
            pane.clientTop;
          pane.scrollTo({ top, behavior: 'instant' });
        } else header?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      });
    },
    reportIssues: (issues) => {
      issue.textContent = issues[0]?.message || '';
      issue.dataset.diagnostics = JSON.stringify(issues);
      issue.hidden = !issues.length;
    },
  });
  Object.assign(controller, {
    section,
    contextPath,
    conflictElement: issue,
    isSharedModel: true,
    floorKey: meta.repeatablesByNodeKey.floors.preferredKey,
    floorSection: section.elements.find(
      (field) => field.data_name === meta.repeatablesByNodeKey.floors.dataName
    ),
  });
  // New rows are initialized by the managed editor, inside their owning floor checkpoint.
  controller.createRowDraft = () => null;
  return controller;
}
