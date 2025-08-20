/**
 * Manages form state updates and value preservation
 */
export class FormStateManager {
  constructor(formRenderer) {
    this.formRenderer = formRenderer;
    this.preservedValues = {}; // Store values to preserve across schema updates
  }

  /**
   * Preserve current form values before schema update
   */
  preserveCurrentValues() {
    const form = document.getElementById('main-form');
    if (!form) return;

    this.preservedValues = {};

    // First, get values from FormData (for regular fields)
    const formData = new FormData(form);
    for (const [key, value] of formData.entries()) {
      if (value !== '') {
        this.preservedValues[key] = value;
      }
    }

    // Then, capture values from read-only fields (including those set by SETVALUE)
    const allInputs = form.querySelectorAll('input, textarea, select');
    allInputs.forEach((input) => {
      if (input.name && input.value !== '' && !this.preservedValues[input.name]) {
        // Only capture if not already in FormData and has a value
        this.preservedValues[input.name] = input.value;
      }
    });

    if (Object.keys(this.preservedValues).length > 0) {
      console.log('💾 Preserved values:', this.preservedValues);
    }
  }

  /**
   * Restore preserved values after form render
   */
  restorePreservedValues() {
    if (Object.keys(this.preservedValues).length === 0) return;

    let restoredCount = 0;
    Object.entries(this.preservedValues).forEach(([fieldName, value]) => {
      const field = this.formRenderer.findFieldByDataName(fieldName);
      if (field && this.isValueCompatible(field, value)) {
        if (field.type === 'SingleChoiceField') {
          // Handle SingleChoiceField restoration (both simple and allow_other)
          try {
            const parsedValue = typeof value === 'string' ? JSON.parse(value) : value;
            const container =
              document.querySelector(`[data-name="${fieldName}"] .single-choice-field-container`) ||
              document.querySelector(
                `[data-name="${fieldName}"] .single-choice-field-simple-container`
              ) ||
              document.querySelector(
                `[data-name="${fieldName}"] .single-choice-field-radio-container`
              );

            if (container) {
              const hiddenInput = container.querySelector(`input[name="${fieldName}"]`);

              // Check if this is a radio container
              if (container.classList.contains('single-choice-field-radio-container')) {
                // Handle radio SingleChoiceField restoration
                if (hiddenInput) {
                  // Set updating flag to prevent event conflicts
                  if (container._setUpdating) container._setUpdating(true);

                  // Clear all radio selections first
                  const allRadios = container.querySelectorAll('input[type="radio"]');
                  allRadios.forEach((radio) => (radio.checked = false));

                  if (parsedValue.choice && parsedValue.choice.length > 0) {
                    // Select the regular choice radio
                    const targetRadio = container.querySelector(
                      `input[type="radio"][value="${parsedValue.choice[0].value}"]`
                    );
                    if (targetRadio) {
                      targetRadio.checked = true;
                    }
                    // Hide other input
                    const otherInput = container.querySelector('.single-choice-field-other');
                    if (otherInput) {
                      otherInput.style.display = 'none';
                      otherInput.value = '';
                    }
                  } else if (parsedValue.other && parsedValue.other.length > 0) {
                    // Select the "other" radio and show/populate other input
                    const otherRadio = container.querySelector(
                      'input[type="radio"][value="__other__"]'
                    );
                    const otherInput = container.querySelector('.single-choice-field-other');
                    if (otherRadio && otherInput) {
                      otherRadio.checked = true;
                      otherInput.value =
                        parsedValue.other[0].label || parsedValue.other[0].value || '';
                      otherInput.style.display = 'block';
                    }
                  }

                  hiddenInput.value = JSON.stringify(parsedValue);

                  // Clear updating flag
                  if (container._setUpdating) container._setUpdating(false);
                  restoredCount++;
                }
              } else if (field.allow_other) {
                // Handle allow_other SingleChoiceField (dropdown)
                const select = container.querySelector('.single-choice-field-select');
                const otherInput = container.querySelector('.single-choice-field-other');

                if (select && otherInput && hiddenInput) {
                  // Set updating flag to prevent event conflicts
                  if (container._setUpdating) container._setUpdating(true);

                  if (parsedValue.choice && parsedValue.choice.length > 0) {
                    select.value = parsedValue.choice[0].value;
                    otherInput.style.display = 'none';
                    otherInput.value = '';
                  } else if (parsedValue.other && parsedValue.other.length > 0) {
                    select.value = '__other__';
                    otherInput.value =
                      parsedValue.other[0].label || parsedValue.other[0].value || '';
                    otherInput.style.display = 'block';
                  }
                  hiddenInput.value = JSON.stringify(parsedValue);

                  // Clear updating flag
                  if (container._setUpdating) container._setUpdating(false);
                  restoredCount++;
                }
              } else {
                // Handle simple SingleChoiceField (dropdown)
                const select = container.querySelector('.single-choice-field-simple-select');

                if (select && hiddenInput) {
                  if (parsedValue.choice && parsedValue.choice.length > 0) {
                    select.value = parsedValue.choice[0].value;
                  } else {
                    select.value = '';
                  }
                  hiddenInput.value = JSON.stringify(parsedValue);
                  restoredCount++;
                }
              }
            }
          } catch (e) {
            // Ignore invalid JSON
          }
        } else if (field.type === 'BooleanField') {
          // Handle BooleanField restoration (segmented control)
          try {
            const parsedValue = typeof value === 'string' ? JSON.parse(value) : value;
            const container = document.querySelector(
              `[data-name="${fieldName}"] .boolean-field-container`
            );

            if (container) {
              const hiddenInput = container.querySelector(`input[name="${fieldName}"]`);

              if (hiddenInput) {
                // Set updating flag to prevent event conflicts
                if (container._setUpdating) container._setUpdating(true);

                // Clear all button selections first
                const allButtons = container.querySelectorAll('.boolean-field-option');
                allButtons.forEach((button) => {
                  button.classList.remove('selected');
                  button.style.background = 'white';
                  button.style.color = '#666';
                });

                if (parsedValue.choice && parsedValue.choice.length > 0) {
                  // Select the choice button
                  const targetButton = container.querySelector(
                    `.boolean-field-option[data-value="${parsedValue.choice[0].value}"]`
                  );
                  if (targetButton) {
                    targetButton.classList.add('selected');
                    targetButton.style.background = '#007bff';
                    targetButton.style.color = 'white';
                  }
                }

                hiddenInput.value = JSON.stringify(parsedValue);

                // Clear updating flag
                if (container._setUpdating) container._setUpdating(false);
                restoredCount++;
              }
            }
          } catch (e) {
            // Ignore invalid JSON
          }
        } else if (field.type === 'MultiChoiceField') {
          // Handle MultiChoiceField restoration (both simple and allow_other)
          try {
            const parsedValue = typeof value === 'string' ? JSON.parse(value) : value;
            const container =
              document.querySelector(`[data-name="${fieldName}"] .multi-choice-field-container`) ||
              document.querySelector(
                `[data-name="${fieldName}"] .multi-choice-field-simple-container`
              ) ||
              document.querySelector(
                `[data-name="${fieldName}"] .multi-choice-field-checkbox-container`
              );

            if (container) {
              const hiddenInput = container.querySelector(`input[name="${fieldName}"]`);

              // Check if this is a checkbox container
              if (container.classList.contains('multi-choice-field-checkbox-container')) {
                // Handle checkbox MultiChoiceField restoration
                if (hiddenInput) {
                  // Set updating flag to prevent event conflicts
                  if (container._setUpdating) container._setUpdating(true);

                  // Clear all checkbox selections first
                  const allCheckboxes = container.querySelectorAll('input[type="checkbox"]');
                  allCheckboxes.forEach((checkbox) => (checkbox.checked = false));

                  // Restore regular choices
                  if (parsedValue.choices && parsedValue.choices.length > 0) {
                    parsedValue.choices.forEach((choice) => {
                      const targetCheckbox = container.querySelector(
                        `input[type="checkbox"][value="${choice.value}"]`
                      );
                      if (targetCheckbox) {
                        targetCheckbox.checked = true;
                      }
                    });
                  }

                  // Restore other value
                  if (parsedValue.other && parsedValue.other.length > 0) {
                    const otherCheckbox = container.querySelector(
                      'input[type="checkbox"][value="__other__"]'
                    );
                    const otherInput = container.querySelector('.multi-choice-field-other');
                    if (otherCheckbox && otherInput) {
                      otherCheckbox.checked = true;
                      otherInput.value =
                        parsedValue.other[0].label || parsedValue.other[0].value || '';
                      otherInput.style.display = 'block';
                    }
                  }

                  hiddenInput.value = JSON.stringify(parsedValue);

                  // Clear updating flag
                  if (container._setUpdating) container._setUpdating(false);
                  restoredCount++;
                }
              } else if (field.allow_other) {
                // Handle allow_other MultiChoiceField (dropdown)
                const select = container.querySelector('.multi-choice-field-select');
                const otherInput = container.querySelector('.multi-choice-field-other');

                if (select && otherInput && hiddenInput) {
                  // Set updating flag to prevent event conflicts
                  if (container._setUpdating) container._setUpdating(true);

                  // Clear all selections first
                  Array.from(select.options).forEach((option) => (option.selected = false));

                  // Restore regular choices
                  if (parsedValue.choices && parsedValue.choices.length > 0) {
                    parsedValue.choices.forEach((choice) => {
                      const option = select.querySelector(`option[value="${choice.value}"]`);
                      if (option) option.selected = true;
                    });
                  }

                  // Restore other value - only restore when there's actual data (same as SingleChoiceField)
                  if (parsedValue.other && parsedValue.other.length > 0) {
                    const otherOption = select.querySelector('option[value="__other__"]');
                    if (otherOption) otherOption.selected = true;
                    otherInput.value =
                      parsedValue.other[0].label || parsedValue.other[0].value || '';
                    otherInput.style.display = 'block';
                  }
                  // When other is empty, don't touch the current selection (like SingleChoiceField)

                  hiddenInput.value = JSON.stringify(parsedValue);

                  // Clear updating flag
                  if (container._setUpdating) container._setUpdating(false);
                  restoredCount++;
                }
              } else {
                // Handle simple MultiChoiceField (dropdown)
                const select = container.querySelector('.multi-choice-field-simple-select');

                if (select && hiddenInput) {
                  // Clear all selections first
                  Array.from(select.options).forEach((option) => (option.selected = false));

                  // Restore selections
                  if (parsedValue.choices && parsedValue.choices.length > 0) {
                    parsedValue.choices.forEach((choice) => {
                      const option = select.querySelector(`option[value="${choice.value}"]`);
                      if (option) option.selected = true;
                    });
                  }

                  hiddenInput.value = JSON.stringify(parsedValue);
                  restoredCount++;
                }
              }
            }
          } catch (e) {
            // Ignore invalid JSON
          }
        } else {
          // Handle regular fields
          const input = document.querySelector(
            `input[name="${fieldName}"], select[name="${fieldName}"]`
          );
          if (input && !input.readOnly) {
            // Only clear file input if needed
            if (input.type === 'file') {
              if (!value) input.value = '';
              // Do not set file input value to anything else (browser security)
            } else {
              input.value = value;
            }
            restoredCount++;
          }
        }
      }
    });

    if (restoredCount > 0) {
      console.log(`🔄 Restored ${restoredCount} field values`);
      // Clear preserved values after successful restoration
      this.preservedValues = {};
    }
  }

  /**
   * Check if a value is compatible with field type
   */
  isValueCompatible(field, value) {
    switch (field.type) {
      case 'NumericField':
        return !isNaN(Number(value));
      case 'SingleChoiceField':
        // For all ChoiceFields, value should be a JSON string with choice/other structure
        try {
          const parsedValue = typeof value === 'string' ? JSON.parse(value) : value;
          return (
            parsedValue &&
            typeof parsedValue === 'object' &&
            Array.isArray(parsedValue.choice) &&
            Array.isArray(parsedValue.other)
          );
        } catch (e) {
          return false;
        }
      case 'MultiChoiceField':
        // For all MultiChoiceFields, value should be a JSON string with choices/other structure
        try {
          const parsedValue = typeof value === 'string' ? JSON.parse(value) : value;
          return (
            parsedValue &&
            typeof parsedValue === 'object' &&
            Array.isArray(parsedValue.choices) &&
            Array.isArray(parsedValue.other)
          );
        } catch (e) {
          return false;
        }
      case 'BooleanField':
        // For BooleanField, value should be a JSON string with choice array (no other array)
        try {
          const parsedValue = typeof value === 'string' ? JSON.parse(value) : value;
          return (
            parsedValue &&
            typeof parsedValue === 'object' &&
            Array.isArray(parsedValue.choice) &&
            Array.isArray(parsedValue.other)
          );
        } catch (e) {
          return false;
        }
      case 'DateField':
        // Check if value is a valid date string (YYYY-MM-DD format)
        if (typeof value !== 'string') return false;
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        return dateRegex.test(value) && !isNaN(Date.parse(value));
      case 'TimeField':
        // Check if value is a valid time string (HH:MM:SS format)
        if (typeof value !== 'string') return false;
        const timeRegex = /^\d{2}:\d{2}(:\d{2})?$/;
        return timeRegex.test(value);
      case 'LabelField':
        // LabelField doesn't have user input values, so any value is compatible (though it shouldn't have values)
        return true;
      case 'SignatureField':
        // SignatureField now stores an object with {signature_id: null, data: base64String}
        if (typeof value === 'object' && value !== null) {
          return (
            value.hasOwnProperty('signature_id') &&
            value.hasOwnProperty('data') &&
            typeof value.data === 'string'
          );
        }
        return value === null; // Allow null values
      case 'PhotoField':
      case 'VideoField':
        try {
          const parsedValue = typeof value === 'string' ? JSON.parse(value) : value;
          return Array.isArray(parsedValue);
        } catch (e) {
          return false;
        }
      case 'TextField':
      default:
        return true;
    }
  }

  /**
   * Get current form values with proper type conversion
   */
  getCurrentFormValues() {
    const formData = new FormData(document.getElementById('main-form'));
    const values = {};

    // Convert form values to appropriate types based on field definitions
    for (const [key, value] of formData.entries()) {
      const field = this.formRenderer.findFieldByDataName(key);
      if (field) {
        if (field.type === 'NumericField') {
          // Convert to number, handle empty strings
          values[key] = value === '' ? null : Number(value);
        } else if (field.type === 'SingleChoiceField') {
          // For all ChoiceFields, the value is JSON from the hidden input
          try {
            values[key] = value === '' ? null : JSON.parse(value);
          } catch (e) {
            values[key] = null;
          }
        } else if (field.type === 'MultiChoiceField') {
          // For all MultiChoiceFields, the value is JSON from the hidden input
          try {
            values[key] = value === '' ? null : JSON.parse(value);
          } catch (e) {
            values[key] = null;
          }
        } else if (field.type === 'BooleanField') {
          // For BooleanField, the value is JSON from the hidden input
          try {
            values[key] = value === '' ? null : JSON.parse(value);
          } catch (e) {
            values[key] = null;
          }
        } else if (
          field.type === 'PhotoField' ||
          field.type === 'VideoField' ||
          field.type === 'SignatureField'
        ) {
          // For PhotoField, VideoField, and SignatureField, the value is JSON from the hidden input
          try {
            values[key] = value === '' ? null : JSON.parse(value);
          } catch (e) {
            values[key] = null;
          }
        } else {
          values[key] = value === '' ? null : value;
        }
      } else {
        values[key] = value === '' ? null : value;
      }
    }

    return values;
  }

  /**
   * Update form engine and get new state
   */
  async updateFormState() {
    const values = this.getCurrentFormValues();

    try {
      const response = await fetch('/api/engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      });

      const state = await response.json();
      this.applyFormState(state);
    } catch (err) {
      console.error('Failed to update form state:', err);
    }
  }

  /**
   * Apply form state changes to the DOM
   */
  applyFormState(state) {
    // Apply visibility
    Object.entries(state.visible || {}).forEach(([fieldName, isVisible]) => {
      const element = document.querySelector(`[data-name="${fieldName}"]`);
      if (element) {
        element.classList.toggle('hidden', !isVisible);
      }
    });

    // Apply readonly
    Object.entries(state.read_only || {}).forEach(([fieldName, isReadOnly]) => {
      const field = this.formRenderer.findFieldByDataName(fieldName);
      if (field && field.type === 'SingleChoiceField') {
        // Handle SingleChoiceField readonly (both simple and allow_other)
        const container =
          document.querySelector(`[data-name="${fieldName}"] .single-choice-field-container`) ||
          document.querySelector(
            `[data-name="${fieldName}"] .single-choice-field-simple-container`
          );
        if (container) {
          if (field.allow_other) {
            const select = container.querySelector('.single-choice-field-select');
            const otherInput = container.querySelector('.single-choice-field-other');
            if (select) select.disabled = isReadOnly;
            if (otherInput) otherInput.readOnly = isReadOnly;
          } else {
            const select = container.querySelector('.single-choice-field-simple-select');
            if (select) select.disabled = isReadOnly;
          }

          const fieldDiv = document.querySelector(`[data-name="${fieldName}"]`);
          if (fieldDiv) {
            fieldDiv.classList.toggle('readonly', isReadOnly);
          }
        }
      } else if (field && field.type === 'MultiChoiceField') {
        // Handle MultiChoiceField readonly (both simple and allow_other)
        const container =
          document.querySelector(`[data-name="${fieldName}"] .multi-choice-field-container`) ||
          document.querySelector(`[data-name="${fieldName}"] .multi-choice-field-simple-container`);
        if (container) {
          if (field.allow_other) {
            const select = container.querySelector('.multi-choice-field-select');
            const otherInput = container.querySelector('.multi-choice-field-other');
            if (select) select.disabled = isReadOnly;
            if (otherInput) otherInput.readOnly = isReadOnly;
          } else {
            const select = container.querySelector('.multi-choice-field-simple-select');
            if (select) select.disabled = isReadOnly;
          }

          const fieldDiv = document.querySelector(`[data-name="${fieldName}"]`);
          if (fieldDiv) {
            fieldDiv.classList.toggle('readonly', isReadOnly);
          }
        }
      } else {
        // Handle regular fields
        const input = document.querySelector(
          `input[name="${fieldName}"], select[name="${fieldName}"]`
        );
        if (input) {
          input.readOnly = isReadOnly;

          // Only add readonly class if it's not already a calculated field
          if (!input.parentElement.classList.contains('calculated')) {
            input.parentElement.classList.toggle('readonly', isReadOnly);
          }
        }
      }
    });

    // Apply calculated values and other computed values
    Object.entries(state.values || {}).forEach(([fieldName, value]) => {
      const field = this.formRenderer.findFieldByDataName(fieldName);

      if (field && field.type === 'SingleChoiceField') {
        // Handle SingleChoiceField values (both simple and allow_other)
        const container =
          document.querySelector(`[data-name="${fieldName}"] .single-choice-field-container`) ||
          document.querySelector(
            `[data-name="${fieldName}"] .single-choice-field-simple-container`
          ) ||
          document.querySelector(`[data-name="${fieldName}"] .single-choice-field-radio-container`);

        if (container && value) {
          const hiddenInput = container.querySelector(`input[name="${fieldName}"]`);

          if (hiddenInput) {
            try {
              const parsedValue = typeof value === 'string' ? JSON.parse(value) : value;

              // Check if this is a radio container
              if (container.classList.contains('single-choice-field-radio-container')) {
                // Handle radio SingleChoiceField values
                // Set updating flag to prevent event conflicts
                if (container._setUpdating) container._setUpdating(true);

                // For radio buttons, only update the hidden input value
                // Let the original event handlers manage the UI state
                hiddenInput.value = JSON.stringify(parsedValue);

                // Clear updating flag
                if (container._setUpdating) container._setUpdating(false);
              } else if (field.allow_other) {
                // Handle allow_other SingleChoiceField (dropdown)
                const select = container.querySelector('.single-choice-field-select');
                const otherInput = container.querySelector('.single-choice-field-other');

                if (select && otherInput) {
                  // Set updating flag to prevent event conflicts
                  if (container._setUpdating) container._setUpdating(true);

                  if (parsedValue.choice && parsedValue.choice.length > 0) {
                    select.value = parsedValue.choice[0].value;
                    otherInput.style.display = 'none';
                    otherInput.value = '';
                  } else if (parsedValue.other && parsedValue.other.length > 0) {
                    select.value = '__other__';
                    otherInput.value =
                      parsedValue.other[0].label || parsedValue.other[0].value || '';
                    otherInput.style.display = 'block';
                  }
                  hiddenInput.value = JSON.stringify(parsedValue);

                  // Clear updating flag
                  if (container._setUpdating) container._setUpdating(false);
                }
              } else {
                // Handle simple SingleChoiceField (dropdown)
                const select = container.querySelector('.single-choice-field-simple-select');

                if (select) {
                  if (parsedValue.choice && parsedValue.choice.length > 0) {
                    select.value = parsedValue.choice[0].value;
                  } else {
                    select.value = '';
                  }
                  hiddenInput.value = JSON.stringify(parsedValue);
                }
              }
            } catch (e) {
              // Ignore invalid JSON
            }
          }
        }
      } else if (field && field.type === 'BooleanField') {
        // Handle BooleanField values (segmented control)
        const container = document.querySelector(
          `[data-name="${fieldName}"] .boolean-field-container`
        );

        if (container && value) {
          const hiddenInput = container.querySelector(`input[name="${fieldName}"]`);

          if (hiddenInput) {
            try {
              const parsedValue = typeof value === 'string' ? JSON.parse(value) : value;

              // Set updating flag to prevent event conflicts
              if (container._setUpdating) container._setUpdating(true);

              // Clear all button selections first
              const allButtons = container.querySelectorAll('.boolean-field-option');
              allButtons.forEach((button) => {
                button.classList.remove('selected');
                button.style.background = 'white';
                button.style.color = '#666';
              });

              if (parsedValue.choice && parsedValue.choice.length > 0) {
                // Select the choice button
                const targetButton = container.querySelector(
                  `.boolean-field-option[data-value="${parsedValue.choice[0].value}"]`
                );
                if (targetButton) {
                  targetButton.classList.add('selected');
                  targetButton.style.background = '#007bff';
                  targetButton.style.color = 'white';
                }
              }

              hiddenInput.value = JSON.stringify(parsedValue);

              // Clear updating flag
              if (container._setUpdating) container._setUpdating(false);
            } catch (e) {
              // Ignore invalid JSON
            }
          }
        }
      } else if (field && field.type === 'MultiChoiceField') {
        // Handle MultiChoiceField values (both simple and allow_other)
        const container =
          document.querySelector(`[data-name="${fieldName}"] .multi-choice-field-container`) ||
          document.querySelector(
            `[data-name="${fieldName}"] .multi-choice-field-simple-container`
          ) ||
          document.querySelector(
            `[data-name="${fieldName}"] .multi-choice-field-checkbox-container`
          );

        if (container && value) {
          const hiddenInput = container.querySelector(`input[name="${fieldName}"]`);

          if (hiddenInput) {
            try {
              const parsedValue = typeof value === 'string' ? JSON.parse(value) : value;

              // Check if this is a checkbox container
              if (container.classList.contains('multi-choice-field-checkbox-container')) {
                // Handle checkbox MultiChoiceField values
                // Set updating flag to prevent event conflicts
                if (container._setUpdating) container._setUpdating(true);

                // For checkboxes, only update the hidden input value
                // Let the original event handlers manage the UI state
                hiddenInput.value = JSON.stringify(parsedValue);

                // Clear updating flag
                if (container._setUpdating) container._setUpdating(false);
              } else if (field.allow_other) {
                // Handle allow_other MultiChoiceField (dropdown)
                const select = container.querySelector('.multi-choice-field-select');
                const otherInput = container.querySelector('.multi-choice-field-other');

                if (select && otherInput) {
                  // Set updating flag to prevent event conflicts
                  if (container._setUpdating) container._setUpdating(true);

                  // Check if other input is currently visible (user is using Other option)
                  const isOtherInputVisible = otherInput.style.display === 'block';

                  // Clear all selections first
                  Array.from(select.options).forEach((option) => (option.selected = false));

                  // Set regular choices
                  if (parsedValue.choices && parsedValue.choices.length > 0) {
                    parsedValue.choices.forEach((choice) => {
                      const option = select.querySelector(`option[value="${choice.value}"]`);
                      if (option) option.selected = true;
                    });
                  }

                  // Set other value - restore when there's data OR when input is visible
                  const otherOption = select.querySelector('option[value="__other__"]');
                  if (parsedValue.other && parsedValue.other.length > 0) {
                    if (otherOption) otherOption.selected = true;
                    otherInput.value =
                      parsedValue.other[0].label || parsedValue.other[0].value || '';
                    otherInput.style.display = 'block';
                  } else if (isOtherInputVisible) {
                    // Keep Other selected if input is visible (user just selected it)
                    if (otherOption) otherOption.selected = true;
                  }

                  hiddenInput.value = JSON.stringify(parsedValue);

                  // Clear updating flag
                  if (container._setUpdating) container._setUpdating(false);
                }
              } else {
                // Handle simple MultiChoiceField (dropdown)
                const select = container.querySelector('.multi-choice-field-simple-select');

                if (select) {
                  // Clear all selections first
                  Array.from(select.options).forEach((option) => (option.selected = false));

                  // Set selections
                  if (parsedValue.choices && parsedValue.choices.length > 0) {
                    parsedValue.choices.forEach((choice) => {
                      const option = select.querySelector(`option[value="${choice.value}"]`);
                      if (option) option.selected = true;
                    });
                  }

                  hiddenInput.value = JSON.stringify(parsedValue);
                }
              }
            } catch (e) {
              // Ignore invalid JSON
            }
          }
        }
      } else {
        // Handle regular fields
        const input = document.querySelector(`input[name="${fieldName}"]`);
        if (input) {
          // Convert boolean values to string for display
          const displayValue = value === null || value === undefined ? '' : String(value);

          // Always update calculated fields and readonly fields
          if (input.readOnly || (field && field.type === 'CalculatedField')) {
            // Prevent setting value for file inputs except to clear
            if (input.type === 'file') {
              if (!displayValue) input.value = '';
              // Do not set file input value to anything else (browser security)
            } else {
              input.value = displayValue;
            }
          }
          // For non-readonly fields, only update if the field is empty (to avoid overwriting user input)
          else if (!input.value || input.value === '') {
            // Prevent setting value for file inputs except to clear
            if (input.type === 'file') {
              if (!displayValue) input.value = '';
              // Do not set file input value to anything else (browser security)
            } else {
              input.value = displayValue;
            }
          }
        }
      }
    });

    // Apply errors
    this.clearErrors();
    Object.entries(state.errors || {}).forEach(([fieldName, errorMessage]) => {
      this.showFieldError(fieldName, errorMessage);
    });

    // Handle required field validation
    Object.entries(state.required || {}).forEach(([fieldName, isRequired]) => {
      this.handleRequiredFieldValidation(fieldName, isRequired);
    });
  }

  /**
   * Clear all error messages
   */
  clearErrors() {
    document.querySelectorAll('.error-message').forEach((el) => el.remove());
    document.querySelectorAll('.field.error').forEach((el) => el.classList.remove('error'));
  }

  /**
   * Show error for a specific field
   */
  showFieldError(fieldName, errorMessage) {
    const fieldDiv = document.querySelector(`[data-name="${fieldName}"]`);
    if (fieldDiv && errorMessage) {
      fieldDiv.classList.add('error');
      const errorDiv = document.createElement('div');
      errorDiv.className = 'error-message';
      errorDiv.textContent = errorMessage;
      fieldDiv.appendChild(errorDiv);
    }
  }

  /**
   * Handle required field validation
   */
  handleRequiredFieldValidation(fieldName, isRequired) {
    const fieldDiv = document.querySelector(`[data-name="${fieldName}"]`);
    const field = this.formRenderer.findFieldByDataName(fieldName);

    if (fieldDiv && field && isRequired) {
      let hasValue = false;

      if (field.type === 'SingleChoiceField') {
        // Check if SingleChoiceField has a value (both simple and allow_other)
        const hiddenInput = document.querySelector(`input[name="${fieldName}"]`);
        if (hiddenInput && hiddenInput.value) {
          try {
            const parsedValue = JSON.parse(hiddenInput.value);
            if (field.allow_other) {
              hasValue =
                (parsedValue.choice && parsedValue.choice.length > 0) ||
                (parsedValue.other && parsedValue.other.length > 0 && parsedValue.other[0].label);
            } else {
              hasValue = parsedValue.choice && parsedValue.choice.length > 0;
            }
          } catch (e) {
            hasValue = false;
          }
        }
      } else if (field.type === 'BooleanField') {
        // Check if BooleanField has a value (segmented control)
        const container = document.querySelector(
          `[data-name="${fieldName}"] .boolean-field-container`
        );

        if (container) {
          const hiddenInput = container.querySelector(`input[name="${fieldName}"]`);
          if (hiddenInput && hiddenInput.value) {
            try {
              const parsedValue = JSON.parse(hiddenInput.value);
              hasValue = parsedValue.choice && parsedValue.choice.length > 0;
            } catch (e) {
              // Ignore invalid JSON
            }
          }
        }
      } else if (field.type === 'MultiChoiceField') {
        // Check if MultiChoiceField has a value (both simple and allow_other)
        const hiddenInput = document.querySelector(`input[name="${fieldName}"]`);
        if (hiddenInput && hiddenInput.value) {
          try {
            const parsedValue = JSON.parse(hiddenInput.value);
            if (field.allow_other) {
              hasValue =
                (parsedValue.choices && parsedValue.choices.length > 0) ||
                (parsedValue.other && parsedValue.other.length > 0 && parsedValue.other[0].label);
            } else {
              hasValue = parsedValue.choices && parsedValue.choices.length > 0;
            }
          } catch (e) {
            hasValue = false;
          }
        }
      } else if (field.type === 'PhotoField') {
        // Check if PhotoField has a value
        const container = document.querySelector(
          `[data-name="${fieldName}"] .photo-field-container`
        );

        if (container) {
          const hiddenInput = container.querySelector(`input[type="hidden"][name="${fieldName}"]`);

          if (hiddenInput && hiddenInput.value) {
            try {
              const parsedValue = JSON.parse(hiddenInput.value);
              hasValue = Array.isArray(parsedValue) && parsedValue.length > 0;
            } catch (e) {
              hasValue = false;
            }
          }
        }

        // For PhotoField and VideoField, prioritize required validation over min/max
        // Only show min/max errors if the field has some value but not enough
        if (!hasValue && isRequired) {
          // Show required error when field is empty
          if (!fieldDiv.classList.contains('error')) {
            this.showFieldError(fieldName, 'This field is required');
          }
          return; // Don't check min/max if field is empty
        }
      } else if (field.type === 'VideoField') {
        // Check if VideoField has a value
        const container = document.querySelector(
          `[data-name="${fieldName}"] .video-field-container`
        );
        if (container) {
          const hiddenInput = container.querySelector(`input[type="hidden"][name="${fieldName}"]`);
          if (hiddenInput && hiddenInput.value) {
            try {
              const parsedValue = JSON.parse(hiddenInput.value);
              hasValue = Array.isArray(parsedValue) && parsedValue.length > 0;
            } catch (e) {
              hasValue = false;
            }
          }
        }
        if (!hasValue && isRequired) {
          if (!fieldDiv.classList.contains('error')) {
            this.showFieldError(fieldName, 'This field is required');
          }
          return;
        }
      } else if (field.type === 'SignatureField') {
        // Check if SignatureField has a value
        const container = document.querySelector(
          `[data-name="${fieldName}"] .signature-field-container`
        );
        if (container) {
          const hiddenInput = container.querySelector(`input[type="hidden"][name="${fieldName}"]`);
          if (hiddenInput && hiddenInput.value) {
            try {
              const parsedValue = JSON.parse(hiddenInput.value);
              hasValue = parsedValue && parsedValue.data && parsedValue.data.trim() !== '';
            } catch (e) {
              hasValue = false;
            }
          }
        }
        if (!hasValue && isRequired) {
          if (!fieldDiv.classList.contains('error')) {
            this.showFieldError(fieldName, 'This field is required');
          }
          return;
        }
      } else {
        // Check regular fields
        const input = document.querySelector(
          `input[name="${fieldName}"], select[name="${fieldName}"]`
        );
        if (input) {
          const value = input.value;
          hasValue = value && value.trim() !== '';
        }
      }

      if (!hasValue) {
        // Only show required error if field is not already showing another error
        if (!fieldDiv.classList.contains('error')) {
          this.showFieldError(fieldName, 'This field is required');
        }
      }
    }
  }

  /**
   * Programmatically set a field value
   * This method is used by operation handlers to set field values
   * @param {string} fieldDataName - The field data name to set
   * @param {any} valueToSet - The value to set
   * @param {boolean} suppressLogging - Whether to suppress console logging (default: false)
   * @param {boolean} skipStateUpdate - Whether to skip the async state update (default: false)
   */
  setFieldValue(fieldDataName, valueToSet, suppressLogging = false, skipStateUpdate = false) {
    const field = this.formRenderer.findFieldByDataName(fieldDataName);

    if (!field) {
      if (!suppressLogging) {
        console.warn(`[SETVALUE] Field "${fieldDataName}" not found in form`);
      }
      return;
    }

    if (!suppressLogging) {
      console.log(`[SETVALUE] Setting field "${fieldDataName}" (${field.type}) to:`, valueToSet);
    }

    if (field.type === 'SingleChoiceField') {
      this.setSingleChoiceFieldValue(fieldDataName, valueToSet, suppressLogging);
    } else if (field.type === 'BooleanField') {
      this.setBooleanFieldValue(fieldDataName, valueToSet, suppressLogging);
    } else if (field.type === 'MultiChoiceField') {
      this.setMultiChoiceFieldValue(fieldDataName, valueToSet, suppressLogging);
    } else {
      this.setRegularFieldValue(fieldDataName, valueToSet, suppressLogging);
    }

    // Only trigger async state update if not suppressed
    if (!skipStateUpdate) {
      this.updateFormState();
    }
  }

  /**
   * Set value for SingleChoiceField
   * @param {string} fieldDataName - Field data name
   * @param {any} valueToSet - Value to set (string or object)
   * @param {boolean} suppressLogging - Whether to suppress console logging (default: false)
   */
  setSingleChoiceFieldValue(fieldDataName, valueToSet, suppressLogging = false) {
    const container =
      document.querySelector(`[data-name="${fieldDataName}"] .single-choice-field-container`) ||
      document.querySelector(
        `[data-name="${fieldDataName}"] .single-choice-field-simple-container`
      ) ||
      document.querySelector(`[data-name="${fieldDataName}"] .single-choice-field-radio-container`);

    if (!container) {
      if (!suppressLogging) {
        console.warn(`[SETVALUE] SingleChoiceField container not found for "${fieldDataName}"`);
      }
      return;
    }

    const hiddenInput = container.querySelector(`input[name="${fieldDataName}"]`);
    if (!hiddenInput) {
      if (!suppressLogging) {
        console.warn(`[SETVALUE] Hidden input not found for SingleChoiceField "${fieldDataName}"`);
      }
      return;
    }

    // Convert string value to proper SingleChoiceField format
    let choiceValue;
    if (typeof valueToSet === 'string') {
      choiceValue = {
        choice: [{ value: valueToSet, label: valueToSet }],
        other: [],
      };
    } else {
      choiceValue = valueToSet;
    }

    // Set updating flag to prevent event conflicts
    if (container._setUpdating) container._setUpdating(true);

    // Update the hidden input
    hiddenInput.value = JSON.stringify(choiceValue);

    // Update the UI based on container type
    if (container.classList.contains('single-choice-field-radio-container')) {
      // Handle radio buttons
      const allRadios = container.querySelectorAll('input[type="radio"]');
      allRadios.forEach((radio) => (radio.checked = false));

      if (choiceValue.choice && choiceValue.choice.length > 0) {
        const targetRadio = container.querySelector(
          `input[type="radio"][value="${choiceValue.choice[0].value}"]`
        );
        if (targetRadio) {
          targetRadio.checked = true;
        }
      }
    } else {
      // Handle dropdown
      const select =
        container.querySelector('.single-choice-field-select') ||
        container.querySelector('.single-choice-field-simple-select');

      if (select && choiceValue.choice && choiceValue.choice.length > 0) {
        select.value = choiceValue.choice[0].value;
      }
    }

    // Clear updating flag
    if (container._setUpdating) container._setUpdating(false);
  }

  /**
   * Set value for MultiChoiceField
   * @param {string} fieldDataName - Field data name
   * @param {any} valueToSet - Value to set (array of strings or object)
   * @param {boolean} suppressLogging - Whether to suppress console logging (default: false)
   */
  setMultiChoiceFieldValue(fieldDataName, valueToSet, suppressLogging = false) {
    const container =
      document.querySelector(`[data-name="${fieldDataName}"] .multi-choice-field-container`) ||
      document.querySelector(
        `[data-name="${fieldDataName}"] .multi-choice-field-simple-container`
      ) ||
      document.querySelector(
        `[data-name="${fieldDataName}"] .multi-choice-field-checkbox-container`
      );

    if (!container) {
      if (!suppressLogging) {
        console.warn(`[SETVALUE] MultiChoiceField container not found for "${fieldDataName}"`);
      }
      return;
    }

    const hiddenInput = container.querySelector(`input[name="${fieldDataName}"]`);
    if (!hiddenInput) {
      if (!suppressLogging) {
        console.warn(`[SETVALUE] Hidden input not found for MultiChoiceField "${fieldDataName}"`);
      }
      return;
    }

    // Convert array of strings to proper MultiChoiceField format
    let choiceValue;
    if (Array.isArray(valueToSet)) {
      choiceValue = {
        choices: valueToSet.map((value) => ({ value, label: value })),
        other: [],
      };
    } else {
      choiceValue = valueToSet;
    }

    // Apply DOM updates synchronously first
    this.applySyncMultiChoiceDOM(container, hiddenInput, choiceValue);
  }

  /**
   * Apply synchronous DOM updates for MultiChoiceField
   * @param {Element} container - The field container element
   * @param {Element} hiddenInput - The hidden input element
   * @param {Object} choiceValue - The choice value object
   */
  applySyncMultiChoiceDOM(container, hiddenInput, choiceValue) {
    // Set updating flag to prevent event conflicts
    if (container._setUpdating) container._setUpdating(true);

    // Update the hidden input
    hiddenInput.value = JSON.stringify(choiceValue);

    // Update the UI based on container type
    if (container.classList.contains('multi-choice-field-checkbox-container')) {
      // Handle checkboxes
      const allCheckboxes = container.querySelectorAll('input[type="checkbox"]');
      allCheckboxes.forEach((checkbox) => (checkbox.checked = false));

      if (choiceValue.choices && choiceValue.choices.length > 0) {
        choiceValue.choices.forEach((choice) => {
          const targetCheckbox = container.querySelector(
            `input[type="checkbox"][value="${choice.value}"]`
          );
          if (targetCheckbox) {
            targetCheckbox.checked = true;
          }
        });
      }
    } else {
      // Handle dropdown - clear all selections first for consistency
      const select =
        container.querySelector('.multi-choice-field-select') ||
        container.querySelector('.multi-choice-field-simple-select');

      if (select) {
        // Always clear all selections first to ensure empty arrays clear the UI
        Array.from(select.options).forEach((option) => (option.selected = false));
        
        // Then apply new selections if any
        if (choiceValue.choices && choiceValue.choices.length > 0) {
          choiceValue.choices.forEach((choice) => {
            const option = select.querySelector(`option[value="${choice.value}"]`);
            if (option) option.selected = true;
          });
        }
      }
    }

    // Clear updating flag
    if (container._setUpdating) container._setUpdating(false);
  }

  /**
   * Set value for regular fields (TextField, NumericField, etc.)
   * @param {string} fieldDataName - Field data name
   * @param {any} valueToSet - Value to set
   * @param {boolean} suppressLogging - Whether to suppress console logging (default: false)
   */
  setRegularFieldValue(fieldDataName, valueToSet, suppressLogging = false) {
    const input = document.querySelector(
      `input[name="${fieldDataName}"], select[name="${fieldDataName}"]`
    );

    if (!input) {
      if (!suppressLogging) {
        console.warn(`[SETVALUE] Input not found for field "${fieldDataName}"`);
      }
      return;
    }

    // Convert the value to string for display
    const displayValue = valueToSet === null || valueToSet === undefined ? '' : String(valueToSet);
    input.value = displayValue;
  }

  /**
   * Set value for BooleanField
   * @param {string} fieldDataName - Field data name
   * @param {any} valueToSet - Value to set (string or object)
   * @param {boolean} suppressLogging - Whether to suppress console logging (default: false)
   */
  setBooleanFieldValue(fieldDataName, valueToSet, suppressLogging = false) {
    const container = document.querySelector(
      `[data-name="${fieldDataName}"] .boolean-field-container`
    );

    if (!container) {
      if (!suppressLogging) {
        console.warn(`[SETVALUE] BooleanField container not found for "${fieldDataName}"`);
      }
      return;
    }

    const hiddenInput = container.querySelector(`input[name="${fieldDataName}"]`);
    if (!hiddenInput) {
      if (!suppressLogging) {
        console.warn(`[SETVALUE] Hidden input not found for BooleanField "${fieldDataName}"`);
      }
      return;
    }

    // Convert string value to proper BooleanField format
    let booleanValue;
    if (typeof valueToSet === 'string') {
      booleanValue = {
        choice: [{ value: valueToSet, label: valueToSet }],
      };
    } else {
      booleanValue = valueToSet;
    }

    // Set updating flag to prevent event conflicts
    if (container._setUpdating) container._setUpdating(true);

    // Update the hidden input
    hiddenInput.value = JSON.stringify(booleanValue);

    // Update the UI based on container type
    const allButtons = container.querySelectorAll('.boolean-field-option');
    allButtons.forEach((button) => {
      button.classList.remove('selected');
      button.style.background = 'white';
      button.style.color = '#666';
    });

    if (booleanValue.choice && booleanValue.choice.length > 0) {
      const targetButton = container.querySelector(
        `.boolean-field-option[data-value="${booleanValue.choice[0].value}"]`
      );
      if (targetButton) {
        targetButton.classList.add('selected');
        targetButton.style.background = '#007bff';
        targetButton.style.color = 'white';
      }
    }

    // Clear updating flag
    if (container._setUpdating) container._setUpdating(false);
  }

  /**
   * Validate all required fields in the form
   * @returns {Array} Array of validation error objects with { fieldName, errorMessage }
   */
  validateAllRequiredFields() {
    const errors = [];
    const form = document.getElementById('main-form');
    if (!form) return errors;

    // Get all field containers
    const fieldContainers = form.querySelectorAll('[data-name]');

    fieldContainers.forEach((fieldDiv) => {
      const fieldName = fieldDiv.getAttribute('data-name');
      const field = this.formRenderer.findFieldByDataName(fieldName);

      if (!field) return;

      // Skip validation for invisible fields
      if (fieldDiv.classList.contains('hidden')) {
        return;
      }

      // Check if field is required (look for existing required validation)
      const isRequired =
        fieldDiv.classList.contains('error') &&
        fieldDiv.querySelector('.error-message')?.textContent === 'This field is required';

      if (isRequired) {
        errors.push({
          fieldName: fieldName,
          errorMessage: 'This field is required',
        });
      }
    });

    return errors;
  }

  /**
   * Check if there are any current validation errors in the form
   * @returns {boolean} True if there are validation errors
   */
  hasValidationErrors() {
    const form = document.getElementById('main-form');
    if (!form) return false;

    const errorElements = form.querySelectorAll('.field.error');
    return errorElements.length > 0;
  }

  /**
   * Get a summary of all current validation issues
   * @returns {Object} Object with arrays of required field errors and general validation errors
   */
  getFormValidationSummary() {
    const requiredFieldErrors = this.validateAllRequiredFields();
    const hasOtherErrors = this.hasValidationErrors();

    const generalErrors = [];

    if (hasOtherErrors) {
      const form = document.getElementById('main-form');
      const errorElements = form.querySelectorAll('.field.error .error-message');

      errorElements.forEach((errorElement) => {
        const fieldDiv = errorElement.closest('.field');
        const fieldName = fieldDiv?.getAttribute('data-name');
        const errorMessage = errorElement.textContent;

        // Skip validation errors for invisible fields
        if (fieldDiv && fieldDiv.classList.contains('hidden')) {
          return;
        }

        // Skip required field errors as they're already captured
        if (errorMessage !== 'This field is required') {
          generalErrors.push({
            fieldName: fieldName || 'Unknown field',
            errorMessage: errorMessage,
          });
        }
      });
    }

    // Filter out required field errors for invisible fields
    const visibleRequiredFieldErrors = requiredFieldErrors.filter((error) => {
      const fieldDiv = document.querySelector(`[data-name="${error.fieldName}"]`);
      return fieldDiv && !fieldDiv.classList.contains('hidden');
    });

    return {
      requiredFieldErrors: visibleRequiredFieldErrors,
      generalErrors,
      hasErrors: visibleRequiredFieldErrors.length > 0 || generalErrors.length > 0,
    };
  }
}
