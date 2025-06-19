import { generateKey } from 'form0-core';

/**
 * Recursively ensures that every field (including sections) with a `data_name`
 * has a generated `key` if missing.
 */
export function ensureKeysForSchema(elements) {
  elements.forEach(field => {
    if (!field.key && field.data_name) {
      field.key = generateKey(field.data_name);
    }

    if (field.type === 'Section') {
      ensureKeysForSchema(field.elements || []);
    }
  });
}