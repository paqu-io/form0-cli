import { buildFormRecordSnapshot, buildRepeatableMetadata } from 'form0-core';

/** Restore live choice/media values with core's transformer, retaining record metadata and ID zero. */
export function restorePreviewRecord(schema, record) {
  if (record?.raw_values && !record.form_values) return { ...record, values: record.raw_values };
  if (record?.values && !record.form_values) return record;
  const snapshot = buildFormRecordSnapshot(schema, record);
  const metadata = buildRepeatableMetadata(schema.form?.elements || []);
  function restore(source, selected, children) {
    const repeatable = { ...selected.repeatable };
    for (const info of children.values()) {
      const key = info.preferredKey;
      const stored = source.form_values?.[key] ?? source.form_values?.[info.field.data_name] ?? [];
      const rows = repeatable[key] || [];
      if (!Array.isArray(stored) || stored.length !== rows.length)
        throw new Error('Stored repeatable rows do not match the normalized snapshot.');
      repeatable[key] = rows.map((row, index) => restore(stored[index], row, info.children));
    }
    const result = { ...source, ...selected, repeatable };
    const id = source.id ?? source.record_id;
    if (id != null) result.id = id;
    return result;
  }
  const roots = new Map(
    [...metadata.repeatableSectionTree].filter(([, info]) => !info.parentPath.length)
  );
  return restore(record, { values: snapshot.raw_values, repeatable: snapshot.repeatable }, roots);
}

/** Server policy cannot be granted by browser request data. */
export function validatePreviewStorageOptions({ submissionOptions = {}, storageAdapter } = {}) {
  if (
    submissionOptions.mode !== undefined &&
    !['automatic', 'confirm'].includes(submissionOptions.mode)
  )
    throw new Error('submissionOptions.mode must be automatic or confirm.');
  if (
    submissionOptions.allowRetain !== undefined &&
    typeof submissionOptions.allowRetain !== 'boolean'
  )
    throw new Error('submissionOptions.allowRetain must be boolean.');
  if (
    storageAdapter &&
    (typeof storageAdapter.load !== 'function' || typeof storageAdapter.save !== 'function')
  )
    throw new Error(
      'storageAdapter requires load(identity) and save(identity, { record, freshness }).'
    );
  if (submissionOptions.allowRetain && !storageAdapter)
    throw new Error('Retention requires a persistence-capable storageAdapter.');
}
