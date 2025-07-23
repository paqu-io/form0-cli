import { generateKey } from 'form0-core';

/**
 * Recursively ensures that every field (including sections) with a `data_name`
 * has a generated `key` if missing, and normalizes all field_id/field_key references in conditions to use the field key.
 * Does NOT touch the root-level key or data_name.
 */
export function ensureKeysForSchema(elements) {
  // First pass: build data_name → key map
  const dataNameToKey = {};
  function collectKeys(fields) {
    fields.forEach((field) => {
      if (field.data_name) {
        if (!field.key) field.key = generateKey(field.data_name);
        dataNameToKey[field.data_name] = field.key;
      }
      if (field.type === 'Section' && Array.isArray(field.elements)) {
        collectKeys(field.elements);
      }
    });
  }
  collectKeys(elements);

  // Only normalize field_id/field_key inside conditions
  function normalizeConditionRefs(obj) {
    if (!obj || typeof obj !== 'object') return;
    // Handle arrays
    if (Array.isArray(obj)) {
      obj.forEach(normalizeConditionRefs);
      return;
    }
    // Normalize field_id and legacy field_key in conditions only
    if (obj.field_id || obj.field_key) {
      const ref = obj.field_id || obj.field_key;
      // If ref is a data_name, replace with key
      if (dataNameToKey[ref]) {
        obj.field_id = dataNameToKey[ref];
      } else {
        obj.field_id = ref; // fallback, may already be a key
      }
      // Remove legacy field_key
      if (obj.field_key) delete obj.field_key;
    }
    // Recursively normalize nested conditions
    ['and', 'or'].forEach((logicKey) => {
      if (Array.isArray(obj[logicKey])) {
        obj[logicKey].forEach(normalizeConditionRefs);
      }
    });
  }

  function normalizeFields(fields) {
    fields.forEach((field) => {
      // Normalize all known condition types
      ['visible_conditions', 'requirement_conditions', 'read_only_conditions'].forEach((condKey) => {
        if (field[condKey]) normalizeConditionRefs(field[condKey]);
      });
      if (field.type === 'Section' && Array.isArray(field.elements)) {
        normalizeFields(field.elements);
      }
    });
  }
  normalizeFields(elements);
}
