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

    const formData = new FormData(form);
    this.preservedValues = {};

    for (const [key, value] of formData.entries()) {
      if (value !== '') {
        this.preservedValues[key] = value;
      }
    }

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
              const container = document.querySelector(`[data-name="${fieldName}"] .choice-field-container`) ||
                              document.querySelector(`[data-name="${fieldName}"] .choice-field-simple-container`) ||
                              document.querySelector(`[data-name="${fieldName}"] .choice-field-radio-container`);
              
              if (container) {
                const hiddenInput = container.querySelector(`input[name="${fieldName}"]`);
                
                // Check if this is a radio container
                if (container.classList.contains('choice-field-radio-container')) {
                  // Handle radio SingleChoiceField restoration
                  if (hiddenInput) {
                    // Set updating flag to prevent event conflicts
                    if (container._setUpdating) container._setUpdating(true);
                    
                    // Clear all radio selections first
                    const allRadios = container.querySelectorAll('input[type="radio"]');
                    allRadios.forEach(radio => radio.checked = false);
                    
                    if (parsedValue.choice && parsedValue.choice.length > 0) {
                      // Select the regular choice radio
                      const targetRadio = container.querySelector(`input[type="radio"][value="${parsedValue.choice[0].value}"]`);
                      if (targetRadio) {
                        targetRadio.checked = true;
                      }
                      // Hide other input
                      const otherInput = container.querySelector('.choice-field-other');
                      if (otherInput) {
                        otherInput.style.display = 'none';
                        otherInput.value = '';
                      }
                    } else if (parsedValue.other && parsedValue.other.length > 0) {
                      // Select the "other" radio and show/populate other input
                      const otherRadio = container.querySelector('input[type="radio"][value="__other__"]');
                      const otherInput = container.querySelector('.choice-field-other');
                      if (otherRadio && otherInput) {
                        otherRadio.checked = true;
                        otherInput.value = parsedValue.other[0].label || parsedValue.other[0].value || '';
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
                  const select = container.querySelector('.choice-field-select');
                  const otherInput = container.querySelector('.choice-field-other');
                  
                  if (select && otherInput && hiddenInput) {
                    // Set updating flag to prevent event conflicts
                    if (container._setUpdating) container._setUpdating(true);
                    
                    if (parsedValue.choice && parsedValue.choice.length > 0) {
                      select.value = parsedValue.choice[0].value;
                      otherInput.style.display = 'none';
                      otherInput.value = '';
                    } else if (parsedValue.other && parsedValue.other.length > 0) {
                      select.value = '__other__';
                      otherInput.value = parsedValue.other[0].label || parsedValue.other[0].value || '';
                      otherInput.style.display = 'block';
                    }
                    hiddenInput.value = JSON.stringify(parsedValue);
                    
                    // Clear updating flag
                    if (container._setUpdating) container._setUpdating(false);
                    restoredCount++;
                  }
                } else {
                  // Handle simple SingleChoiceField (dropdown)
                  const select = container.querySelector('.choice-field-simple-select');
                  
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
        } else if (field.type === 'MultiChoiceField') {
          // Handle MultiChoiceField restoration (both simple and allow_other)
          try {
            const parsedValue = typeof value === 'string' ? JSON.parse(value) : value;
            const container = document.querySelector(`[data-name="${fieldName}"] .multi-choice-field-container`) ||
                            document.querySelector(`[data-name="${fieldName}"] .multi-choice-field-simple-container`) ||
                            document.querySelector(`[data-name="${fieldName}"] .multi-choice-field-checkbox-container`);
            
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
                  allCheckboxes.forEach(checkbox => checkbox.checked = false);
                  
                  // Restore regular choices
                  if (parsedValue.choices && parsedValue.choices.length > 0) {
                    parsedValue.choices.forEach(choice => {
                      const targetCheckbox = container.querySelector(`input[type="checkbox"][value="${choice.value}"]`);
                      if (targetCheckbox) {
                        targetCheckbox.checked = true;
                      }
                    });
                  }
                  
                  // Restore other value
                  if (parsedValue.other && parsedValue.other.length > 0) {
                    const otherCheckbox = container.querySelector('input[type="checkbox"][value="__other__"]');
                    const otherInput = container.querySelector('.multi-choice-field-other');
                    if (otherCheckbox && otherInput) {
                      otherCheckbox.checked = true;
                      otherInput.value = parsedValue.other[0].label || parsedValue.other[0].value || '';
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
                  Array.from(select.options).forEach(option => option.selected = false);
                  
                  // Restore regular choices
                  if (parsedValue.choices && parsedValue.choices.length > 0) {
                    parsedValue.choices.forEach(choice => {
                      const option = select.querySelector(`option[value="${choice.value}"]`);
                      if (option) option.selected = true;
                    });
                  }
                  
                  // Restore other value - only restore when there's actual data (same as SingleChoiceField)
                  if (parsedValue.other && parsedValue.other.length > 0) {
                    const otherOption = select.querySelector('option[value="__other__"]');
                    if (otherOption) otherOption.selected = true;
                    otherInput.value = parsedValue.other[0].label || parsedValue.other[0].value || '';
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
                  Array.from(select.options).forEach(option => option.selected = false);
                  
                  // Restore selections
                  if (parsedValue.choices && parsedValue.choices.length > 0) {
                    parsedValue.choices.forEach(choice => {
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
            input.value = value;
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
          return parsedValue && typeof parsedValue === 'object' && 
                 Array.isArray(parsedValue.choice) && Array.isArray(parsedValue.other);
        } catch (e) {
          return false;
        }
      case 'MultiChoiceField':
        // For all MultiChoiceFields, value should be a JSON string with choices/other structure
        try {
          const parsedValue = typeof value === 'string' ? JSON.parse(value) : value;
          return parsedValue && typeof parsedValue === 'object' && 
                 Array.isArray(parsedValue.choices) && Array.isArray(parsedValue.other);
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
        const container = document.querySelector(`[data-name="${fieldName}"] .choice-field-container`) ||
                        document.querySelector(`[data-name="${fieldName}"] .choice-field-simple-container`);
        if (container) {
          if (field.allow_other) {
            const select = container.querySelector('.choice-field-select');
            const otherInput = container.querySelector('.choice-field-other');
            if (select) select.disabled = isReadOnly;
            if (otherInput) otherInput.readOnly = isReadOnly;
          } else {
            const select = container.querySelector('.choice-field-simple-select');
            if (select) select.disabled = isReadOnly;
          }
          
          const fieldDiv = document.querySelector(`[data-name="${fieldName}"]`);
          if (fieldDiv) {
            fieldDiv.classList.toggle('readonly', isReadOnly);
          }
        }
      } else if (field && field.type === 'MultiChoiceField') {
        // Handle MultiChoiceField readonly (both simple and allow_other)
        const container = document.querySelector(`[data-name="${fieldName}"] .multi-choice-field-container`) ||
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
        const container = document.querySelector(`[data-name="${fieldName}"] .choice-field-container`) ||
                        document.querySelector(`[data-name="${fieldName}"] .choice-field-simple-container`) ||
                        document.querySelector(`[data-name="${fieldName}"] .choice-field-radio-container`);
        
        if (container && value) {
          const hiddenInput = container.querySelector(`input[name="${fieldName}"]`);
          
          if (hiddenInput) {
            try {
              const parsedValue = typeof value === 'string' ? JSON.parse(value) : value;
              
              // Check if this is a radio container
              if (container.classList.contains('choice-field-radio-container')) {
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
                const select = container.querySelector('.choice-field-select');
                const otherInput = container.querySelector('.choice-field-other');
                
                if (select && otherInput) {
                  // Set updating flag to prevent event conflicts
                  if (container._setUpdating) container._setUpdating(true);
                  
                  if (parsedValue.choice && parsedValue.choice.length > 0) {
                    select.value = parsedValue.choice[0].value;
                    otherInput.style.display = 'none';
                    otherInput.value = '';
                  } else if (parsedValue.other && parsedValue.other.length > 0) {
                    select.value = '__other__';
                    otherInput.value = parsedValue.other[0].label || parsedValue.other[0].value || '';
                    otherInput.style.display = 'block';
                  }
                  hiddenInput.value = JSON.stringify(parsedValue);
                  
                  // Clear updating flag
                  if (container._setUpdating) container._setUpdating(false);
                }
              } else {
                // Handle simple SingleChoiceField (dropdown)
                const select = container.querySelector('.choice-field-simple-select');
                
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
      } else if (field && field.type === 'MultiChoiceField') {
        // Handle MultiChoiceField values (both simple and allow_other)
        const container = document.querySelector(`[data-name="${fieldName}"] .multi-choice-field-container`) ||
                        document.querySelector(`[data-name="${fieldName}"] .multi-choice-field-simple-container`) ||
                        document.querySelector(`[data-name="${fieldName}"] .multi-choice-field-checkbox-container`);
        
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
                  Array.from(select.options).forEach(option => option.selected = false);
                  
                  // Set regular choices
                  if (parsedValue.choices && parsedValue.choices.length > 0) {
                    parsedValue.choices.forEach(choice => {
                      const option = select.querySelector(`option[value="${choice.value}"]`);
                      if (option) option.selected = true;
                    });
                  }
                  
                  // Set other value - restore when there's data OR when input is visible
                  const otherOption = select.querySelector('option[value="__other__"]');
                  if (parsedValue.other && parsedValue.other.length > 0) {
                    if (otherOption) otherOption.selected = true;
                    otherInput.value = parsedValue.other[0].label || parsedValue.other[0].value || '';
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
                  Array.from(select.options).forEach(option => option.selected = false);
                  
                  // Set selections
                  if (parsedValue.choices && parsedValue.choices.length > 0) {
                    parsedValue.choices.forEach(choice => {
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
            input.value = displayValue;
          }
          // For non-readonly fields, only update if the field is empty (to avoid overwriting user input)
          else if (!input.value || input.value === '') {
            input.value = displayValue;
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
              hasValue = (parsedValue.choice && parsedValue.choice.length > 0) ||
                        (parsedValue.other && parsedValue.other.length > 0 && parsedValue.other[0].label);
            } else {
              hasValue = (parsedValue.choice && parsedValue.choice.length > 0);
            }
          } catch (e) {
            hasValue = false;
          }
        }
      } else if (field.type === 'MultiChoiceField') {
        // Check if MultiChoiceField has a value (both simple and allow_other)
        const hiddenInput = document.querySelector(`input[name="${fieldName}"]`);
        if (hiddenInput && hiddenInput.value) {
          try {
            const parsedValue = JSON.parse(hiddenInput.value);
            if (field.allow_other) {
              hasValue = (parsedValue.choices && parsedValue.choices.length > 0) ||
                        (parsedValue.other && parsedValue.other.length > 0 && parsedValue.other[0].label);
            } else {
              hasValue = (parsedValue.choices && parsedValue.choices.length > 0);
            }
          } catch (e) {
            hasValue = false;
          }
        }
      } else {
        // Check regular fields
        const input = document.querySelector(`input[name="${fieldName}"], select[name="${fieldName}"]`);
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
}
