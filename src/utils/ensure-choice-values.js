import { processChoiceFieldChoices } from 'form0-core';

/**
 * Recursively ensures that every SingleChoiceField has proper values generated
 * for any choices that are missing values.
 */
export function ensureChoiceValuesForSchema(elements) {
  for (const field of elements) {
    if (field.type === 'SingleChoiceField' && Array.isArray(field.choices)) {
      field.choices = processChoiceFieldChoices(field.choices);
    } else if (field.type === 'BooleanField' && Array.isArray(field.choices)) {
      field.choices = processChoiceFieldChoices(field.choices);
    } else if (field.type === 'MultiChoiceField' && Array.isArray(field.choices)) {
      field.choices = processChoiceFieldChoices(field.choices);
    }

    if ((field.type === 'Section' || field.type === 'RepeatableSection') && Array.isArray(field.elements)) {
      ensureChoiceValuesForSchema(field.elements || []);
    }
  }
} 