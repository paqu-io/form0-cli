import { buildDatasetDescriptors, resolveDatasetRowTitle, flattenFields } from 'form0-core';

export const submissionMessages = {
  childCalculations: 'child calculations',
  totalChanges: 'total changes',
  title: 'Update child calculations?',
  refresh: 'Update all and continue',
  retain: 'Keep existing values and continue',
  cancel: 'Cancel',
  previous: 'Previous',
  next: 'Next',
  pending: 'Some saved child calculations still need updating.',
  explanation:
    'Review the calculated values that will change. Your choice applies to all affected children.',
};
export const displaySubmissionValue = (value) =>
  value == null ? '—' : typeof value === 'string' ? value : JSON.stringify(value);

const schemaLabels = new WeakMap();
function labelsForSchema(schema) {
  if (!schema || typeof schema !== 'object') return { fields: new Map(), descriptors: [] };
  if (!schemaLabels.has(schema))
    schemaLabels.set(schema, {
      fields: new Map(
        flattenFields(schema?.form?.elements || []).flatMap((field) => [
          [field.key, field],
          [field.data_name, field],
        ])
      ),
      descriptors: buildDatasetDescriptors(schema),
    });
  return schemaLabels.get(schema);
}

export function createInstancePathLabeler(schema, snapshot) {
  const { fields, descriptors } = labelsForSchema(schema);
  const indexes = new WeakMap();
  const paths = new Map();
  return (path = []) => {
    const signature = JSON.stringify(path);
    if (paths.has(signature)) return paths.get(signature);
    let record = snapshot;
    const titles = path.map((part) => {
      const rows = record?.repeatable?.[part.repeatableKey] || [];
      if (part.identity === 'id') {
        if (!indexes.has(rows))
          indexes.set(rows, new Map(rows.map((row) => [row.id ?? row.record_id, row])));
        record = indexes.get(rows).get(part.instanceId);
      } else record = rows[part.index];
      const descriptor = descriptors.find(
        (entry) =>
          entry.repeatable_output_key === part.repeatableKey ||
          entry.repeatable_field_id === part.repeatableKey
      );
      return (
        resolveDatasetRowTitle(descriptor, record?.values || {}) ||
        `${fields.get(part.repeatableKey)?.label || part.repeatableKey} ${part.index + 1}`
      );
    });
    const label = titles.length ? titles.join(' / ') : schema?.form?.name || 'Form';
    paths.set(signature, label);
    return label;
  };
}

export function createChangeLabels(schema, snapshot) {
  const { fields } = labelsForSchema(schema);
  const pathLabel = createInstancePathLabeler(schema, snapshot);
  return (change) =>
    `${pathLabel(change.instancePath)} · ${fields.get(change.fieldKey)?.label || change.fieldName || 'Record'}`;
}
