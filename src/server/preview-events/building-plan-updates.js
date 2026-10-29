import { normalizeFieldValue } from 'form0-core';
import { copyEventData } from './session-dispatcher.js';

const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const identity = (row) => row?.id ?? row?.record_id;
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

  const stage = (path, original, input) => {
    const floor = definition(path);
    if (!floor) invalid('Canvas updates require an owned BuildingPlan floor.');
    if (identity(input) !== identity(original))
      invalid('Canvas updates cannot change the floor identity.');
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
    const row = prepare(floor, original, input, path);
    const updates = Object.fromEntries(
      Object.entries(row.values).filter(([name, value]) => !equal(value, original.values?.[name]))
    );
    return { row, updates, nodes };
  };
  stage.readOnly = (path, parentState) => {
    const info = definition(path);
    const section = info && floorSections.get(info.field.data_name);
    return section && parentState?.read_only?.[section.data_name] === true;
  };
  return stage;
}
