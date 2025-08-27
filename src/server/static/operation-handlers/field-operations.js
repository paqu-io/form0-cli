/**
 * Field operation handlers for form0-cli
 * Handles field-related operations like SETVALUE
 */

/**
 * Handler for SETVALUE operation
 * Sets a field value in the form
 * @param {Object} params - Operation parameters
 * @param {string} params.fieldDataName - The field data name to set
 * @param {any} params.valueToSet - The value to set
 * @param {FormStateManager} formStateManager - Form state manager instance
 * @param {boolean} skipStateUpdate - Whether to skip async state update (default: false)
 */
function handleSetValue(params, formStateManager, skipStateUpdate = false) {
  const { fieldDataName, valueToSet } = params;

  if (!fieldDataName) {
    console.error('[SETVALUE] Missing fieldDataName parameter');
    return;
  }

  // Use the FormStateManager to set the field value
  // Note: Server-side validation already filtered invalid operations, so this should be valid
  formStateManager.setFieldValue(fieldDataName, valueToSet, false, skipStateUpdate);
}

/**
 * Export field operation handlers
 */
export const fieldOperationHandlers = {
  SETVALUE: handleSetValue,
  // Future handlers will be added here:
  // SETHIDDEN: handleSetHidden,
  // SETREADONLY: handleSetReadOnly,
  // etc.
};
