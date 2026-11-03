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
    readRecord: () => owner({ values: {}, repeatable: renderer.activeRepeatableState || {} }),
    writeRecord: (record, command) => controller.transaction?.(record, command) ?? false,
    focusRow: (path) => {
      const fullPath = [...contextPath, ...path];
      renderer.ensureRepeatablePathExpanded(fullPath);
      const element = renderer.getRepeatableInstanceContainer(fullPath);
      element?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    },
    reportIssues: (issues) => {
      issue.textContent = issues.map((entry) => entry.message).join(' ');
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
