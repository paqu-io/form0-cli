import { normalizeFieldValue } from 'form0-core';
import { copyEventData } from './session-dispatcher.js';

const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const identity = (row) => row?.id ?? row?.record_id;
const samePath = (a, b) =>
  a.length === b.length &&
  a.every((part, index) => {
    const other = b[index];
    return (
      part.repeatableKey === other.repeatableKey &&
      part.identity === other.identity &&
      (part.identity === 'id' ? part.instanceId === other.instanceId : part.index === other.index)
    );
  });
const indexOf = (rows, part) =>
  part.identity === 'id' ? rows.findIndex((row) => identity(row) === part.instanceId) : part.index;
const rowAt = (row, path) => {
  for (const part of path) {
    const rows = row?.repeatable?.[part.repeatableKey] || [];
    row = rows[indexOf(rows, part)];
  }
  return row;
};
const invalid = (message) => {
  throw new TypeError(message);
};

/** Prepare one host canvas edit without granting schema events descendant write access. */
export function createCanvasFloorStager(schema, metadata) {
  const floorNames = new Set();
  const floorSections = new Map();
  function visit(elements) {
    for (const field of elements || []) {
      if (field.type === 'BuildingPlanSection') {
        const floor = field.elements?.find((child) => child.type === 'RepeatableSection');
        if (floor) {
          floorNames.add(floor.data_name);
          floorSections.set(floor.data_name, field);
        }
      }
      if (field.elements) visit(field.elements);
    }
  }
  visit(schema.form?.elements);
  const definition = (path) =>
    [...metadata.repeatableSectionTree.values()].find(
      (info) =>
        floorNames.has(info.field.data_name) &&
        info.currentPath.length === path.length &&
        info.currentPath.every((key, index) => key === path[index].repeatableKey)
    );

  const stage = (path, original, input, drafts = []) => {
    const floor = definition(path);
    if (!floor) invalid('Canvas updates require an owned BuildingPlan floor.');
    if (identity(input) !== identity(original))
      invalid('Canvas updates cannot change the floor identity.');
    const sources = [{ path, row: original }, ...drafts].sort(
      (a, b) => a.path.length - b.path.length
    );
    // Compare against the visible tree, including values typed in still-open row editors.
    const visible = copyEventData(original);
    for (const draft of sources.slice(1)) {
      const parent = rowAt(visible, draft.path.slice(path.length, -1));
      const part = draft.path.at(-1);
      if (!parent) invalid('The parent building-plan editor no longer exists.');
      const rows = (parent.repeatable[part.repeatableKey] ||= []);
      let index = indexOf(rows, part);
      if (index < 0) index = rows.length;
      if (index > rows.length) invalid('The positional building-plan editor no longer exists.');
      rows[index] = copyEventData(draft.row);
    }
    const nodes = [];
    function prepare(info, previous, row, instancePath) {
      if (!object(row) || !object(row.values) || !object(row.repeatable))
        invalid('Canvas rows require values and repeatable objects.');
      const result = {
        ...copyEventData(previous || {}),
        ...copyEventData(row),
        values: copyEventData(previous?.values || {}),
        repeatable: copyEventData(previous?.repeatable || {}),
      };
      for (const [name, value] of Object.entries(row.values)) {
        const old = previous?.values?.[name];
        if (Object.hasOwn(previous?.values || {}, name) && equal(value, old)) continue;
        const field = info.fields.get(name)?.field;
        if (!field) invalid(`Unknown canvas value field "${name}".`);
        if (old == null && value == null && ['CalculatedField', 'LabelField'].includes(field.type))
          continue;
        result.values[name] = normalizeFieldValue(field, value);
      }
      const children = new Map(
        [...info.children.values()].map((child) => [child.preferredKey, child])
      );
      for (const [key, rows] of Object.entries(row.repeatable)) {
        const child = children.get(key);
        if (!child) {
          if (!equal(rows, previous?.repeatable?.[key]))
            invalid(`Unknown canvas child collection "${key}".`);
          continue;
        }
        if (!Array.isArray(rows)) invalid('Canvas child collections must be arrays.');
        const old = previous?.repeatable?.[key] || [];
        const ids = new Set();
        result.repeatable[key] = rows.map((value, index) => {
          if (!object(value)) invalid('Canvas child rows must be objects.');
          const id = identity(value);
          if (id != null) {
            if (
              !(
                (typeof id === 'string' && id.length) ||
                (typeof id === 'number' && Number.isFinite(id))
              ) ||
              ids.has(id)
            )
              invalid('Canvas row identities must be valid and unique within their collection.');
            ids.add(id);
          }
          const existing = id == null ? old[index] : old.find((item) => identity(item) === id);
          if (id == null && (!existing || identity(existing) != null))
            invalid('New canvas rows require an identity.');
          return prepare(child, existing, value, [
            ...instancePath,
            {
              repeatableKey: key,
              instanceId: id ?? null,
              index,
              identity: id == null ? 'position' : 'id',
            },
          ]);
        });
      }
      if (
        !equal(result.values, previous?.values || {}) ||
        !equal(result.repeatable, previous?.repeatable || {})
      )
        nodes.push({ path: instancePath, row: result });
      return result;
    }
    const row = prepare(floor, visible, input, path);
    const editors = sources.map((source) => {
      const updated = rowAt(row, source.path.slice(path.length));
      if (!updated) invalid('Canvas updates cannot remove an open row editor.');
      const part = source.path.at(-1);
      if (part.identity === 'position' && identity(updated) != null)
        invalid('Canvas updates cannot replace an open positional row editor.');
      return { path: source.path, row: copyEventData(updated) };
    });
    // An open row owns its changes. Keep its previous accepted version (or absence, for a new row)
    // in its parent's tree so Cancel still discards every edit made through either interface.
    for (const source of sources.slice(1)) {
      const parentPath = source.path.slice(0, -1);
      const parent = editors.find((editor) => samePath(editor.path, parentPath));
      const previous = sources.find((editor) => samePath(editor.path, parentPath));
      if (!parent || !previous) invalid('Open the parent building-plan editor first.');
      const part = source.path.at(-1);
      const rows = parent.row.repeatable[part.repeatableKey];
      const index = indexOf(rows, part);
      const oldRows = previous.row.repeatable?.[part.repeatableKey] || [];
      const old = oldRows[indexOf(oldRows, part)];
      if (old) rows[index] = copyEventData(old);
      else rows.splice(index, 1);
    }
    return {
      editors,
      nodes: nodes.map((node) => {
        const owner = editors.findLast((editor) =>
          samePath(editor.path, node.path.slice(0, editor.path.length))
        );
        return { path: node.path, row: rowAt(owner.row, node.path.slice(owner.path.length)) };
      }),
    };
  };
  stage.readOnly = (path, parentState) => {
    const info = definition(path);
    const section = info && floorSections.get(info.field.data_name);
    return section && parentState?.read_only?.[section.data_name] === true;
  };
  return stage;
}
