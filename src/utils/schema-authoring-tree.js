import { expandBuildingPlanSchema } from 'form0-core';

const predefined = ['floors', 'rooms', 'walls', 'columns', 'beams', 'objects', 'doors', 'windows'];

/** Virtual authoring entries point at raw configuration; generated definitions are never saved. */
export function createSchemaAuthoringTree(elements) {
  const bindings = new WeakMap();
  const map = (fields) =>
    fields.map((field) => {
      if (field.type !== 'BuildingPlanSection') {
        if (!field.elements) return field;
        const view = { ...field, elements: map(field.elements) };
        bindings.set(view, { raw: field });
        return view;
      }
      const {
        buildingPlanMeta: [meta],
      } = expandBuildingPlanSchema({ form: { elements: [field] } });
      const view = { ...field, elements: [] };
      bindings.set(view, { raw: field, kind: 'plan' });
      for (const nodeKey of predefined) {
        const config = () => {
          field.node_overrides ||= {};
          return (field.node_overrides[nodeKey] ||= {});
        };
        const descriptor = meta.repeatablesByNodeKey[nodeKey];
        const entry = { type: 'RepeatableSection', label: `${nodeKey} [predefined]`, elements: [] };
        bindings.set(entry, {
          kind: 'predefined',
          nodeKey,
          plan: field,
          rawElements: field.node_overrides?.[nodeKey]?.extra_elements || [],
          config,
          customElements: () => (config().extra_elements ||= []),
        });
        const system = { type: 'Section', label: 'System fields [protected]', elements: [] };
        bindings.set(system, { kind: 'protected' });
        for (const item of descriptor.fields.filter(
          (item) =>
            item.binding?.system &&
            !['storage', 'geometry', 'derived'].includes(item.binding.role) &&
            !['storage', 'geometry', 'derived'].includes(item.binding.storageRole)
        )) {
          const receiver = item.originalKey?.startsWith('bp_custom_');
          const control = {
            ...item.field,
            label: `${item.field.label} [${receiver ? 'protected receiver' : 'system routing'}]`,
          };
          bindings.set(control, {
            kind: receiver ? 'protected' : 'system',
            nodeKey,
            property: item.originalDataName,
            config,
            field: item.field,
          });
          system.elements.push(control);
        }
        entry.elements.push(system, ...map(field.node_overrides?.[nodeKey]?.extra_elements || []));
        const authored = new Set();
        const collect = (elements) => {
          for (const field of elements || []) {
            authored.add(field.data_name);
            if (field.type === 'Section') collect(field.elements);
          }
        };
        collect(field.node_overrides?.[nodeKey]?.extra_elements);
        for (const item of descriptor.fields) {
          if (
            !item.binding?.inherit ||
            item.binding.system ||
            authored.has(item.originalDataName) ||
            item.binding.outside
          )
            continue;
          const control = { ...item.field, label: `${item.field.label} [inherited placement]` };
          bindings.set(control, {
            kind: 'property',
            nodeKey,
            property: item.binding.property,
            config,
            field: item.field,
          });
          entry.elements.push(control);
        }
        view.elements.push(entry);
      }
      return view;
    });
  return { elements: map(elements || []), bindings };
}

export function buildSchemaAuthoringIndex(elements) {
  const tree = createSchemaAuthoringTree(elements),
    nodes = [],
    byId = new Map();
  const walk = (list, parent, depth, rawList = list) =>
    list.forEach((view, index) => {
      const binding = tree.bindings.get(view),
        element = binding?.raw || view;
      const node = {
        id: nodes.length + 1,
        element,
        parent,
        parentList: rawList,
        index,
        depth,
        virtual: binding?.kind ? binding : null,
      };
      nodes.push(node);
      byId.set(node.id, node);
      if (view.elements) {
        if (binding?.kind === 'predefined') {
          // The protected system group occupies one virtual slot before authored custom content.
          walk(view.elements.slice(0, 1), node, depth + 1, []);
          const custom = view.elements.slice(1).filter((field) => !tree.bindings.get(field)?.kind);
          walk(custom, node, depth + 1, binding.rawElements);
          const inherited = view.elements
            .slice(1)
            .filter((field) => tree.bindings.get(field)?.kind);
          walk(inherited, node, depth + 1, []);
        } else
          walk(
            view.elements,
            node,
            depth + 1,
            binding?.raw?.elements || element.elements || view.elements
          );
      }
    });
  walk(tree.elements, null, 0, elements);
  return { nodes, byId };
}
