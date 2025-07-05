import { processChoiceFieldChoices } from 'form0-core';

/**
 * Recursively ensures that every ChoiceField has proper values generated
 * for any choices that are missing values.
 */
export function ensureChoiceValuesForSchema(elements) {
  elements.forEach((field) => {
    if (field.type === 'ChoiceField' && Array.isArray(field.choices)) {
      // Process the choices to auto-generate missing values
      field.choices = processChoiceFieldChoices(field.choices);
    }

    if (field.type === 'Section') {
      ensureChoiceValuesForSchema(field.elements || []);
    }
  });
} 