import { colors } from './theme.js';
import { t } from './i18n.js';

/**
 * Extract all valid data_name fields from a schema
 * @param {Object} schema - The form schema
 * @returns {Array} Array of valid data_name strings
 */
export function getValidDataNames(schema) {
  if (!schema?.form?.elements) {
    return [];
  }

  const dataNames = [];

  const extractDataNames = (elements) => {
    for (const element of elements) {
      if (element.data_name) {
        dataNames.push(element.data_name);
      }
      if ((element.type === 'Section' || element.type === 'RepeatableSection') && element.elements) {
        extractDataNames(element.elements);
      }
    }
  };

  extractDataNames(schema.form.elements);
  return dataNames;
}

/**
 * Validate values against schema field names
 * @param {Object} values - Values to validate
 * @param {Object} schema - The form schema
 * @returns {Object} Object with valid, invalid, and validDataNames arrays
 */
export function validateValues(values, schema) {
  if (!schema) {
    return { valid: [], invalid: Object.keys(values), validDataNames: [] };
  }

  const validDataNames = getValidDataNames(schema);
  const providedKeys = Object.keys(values);

  const valid = providedKeys.filter((key) => validDataNames.includes(key));
  const invalid = providedKeys.filter((key) => !validDataNames.includes(key));

  return { valid, invalid, validDataNames };
}

/**
 * Filter values to only include valid ones and show warnings for invalid ones
 * @param {Object} values - Values to filter
 * @param {Object} schema - The form schema
 * @param {boolean} showWarnings - Whether to show warning messages (default: true)
 * @returns {Object} Filtered values object containing only valid fields
 */
export function filterValidValues(values, schema, showWarnings = true) {
  const { valid, invalid, validDataNames } = validateValues(values, schema);

  if (invalid.length > 0 && showWarnings) {
    console.log(colors.warning(t('common.ignoringInvalidFields', { fields: invalid.join(', ') })));
    if (validDataNames.length > 0) {
      console.log(
        colors.textSecondary(t('common.validFieldNames', { fields: validDataNames.join(', ') }))
      );
    }
  }

  const filteredValues = {};
  for (const key of valid) {
    filteredValues[key] = values[key];
  }

  return filteredValues;
}
