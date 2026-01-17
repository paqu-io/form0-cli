import { generateKey } from 'form0-core';

const CONTAINER_TYPES = new Set(['Section', 'RepeatableSection', 'BuildingPlanSection']);

/**
 * Generate keys only for fields that are missing them.
 * @param {Array} elements - form elements array
 * @returns {number} number of keys generated
 */
export function ensureMissingKeysForSchema(elements) {
  let generatedCount = 0;

  function walk(fields) {
    if (!Array.isArray(fields)) {
      return;
    }

    fields.forEach((field) => {
      if (field && typeof field === 'object') {
        if (field.data_name && !field.key) {
          field.key = generateKey(field.data_name);
          generatedCount += 1;
        }

        if (CONTAINER_TYPES.has(field.type) && Array.isArray(field.elements)) {
          walk(field.elements);
        }
      }
    });
  }

  walk(elements);

  return generatedCount;
}
