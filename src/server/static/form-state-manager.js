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
        if (field.type === 'ChoiceField' && field.allow_other) {
          // Handle allow_other ChoiceField restoration
          try {
            const parsedValue = typeof value === 'string' ? JSON.parse(value) : value;
            const container = document.querySelector(`[data-name="${fieldName}"] .choice-field-container`);
            
            if (container) {
              const select = container.querySelector('.choice-field-select');
              const otherInput = container.querySelector('.choice-field-other');
              const hiddenInput = container.querySelector(`input[name="${fieldName}"]`);
              
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
      case 'ChoiceField':
        if (field.allow_other) {
          // For allow_other fields, value should be a JSON string with choice/other structure
          try {
            const parsedValue = typeof value === 'string' ? JSON.parse(value) : value;
            return parsedValue && typeof parsedValue === 'object' && 
                   Array.isArray(parsedValue.choice) && Array.isArray(parsedValue.other);
          } catch (e) {
            return false;
          }
        } else {
          // For simple choice fields, check if value exists in choices
          return field.choices && field.choices.some((choice) => choice.value === value);
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
        } else if (field.type === 'ChoiceField') {
          if (field.allow_other) {
            // For allow_other fields, the value is already JSON from the hidden input
            try {
              values[key] = value === '' ? null : JSON.parse(value);
            } catch (e) {
              values[key] = null;
            }
          } else {
            // For simple choice fields, use the value directly
            values[key] = value === '' ? null : value;
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
      if (field && field.type === 'ChoiceField' && field.allow_other) {
        // Handle allow_other ChoiceField readonly
        const container = document.querySelector(`[data-name="${fieldName}"] .choice-field-container`);
        if (container) {
          const select = container.querySelector('.choice-field-select');
          const otherInput = container.querySelector('.choice-field-other');
          if (select) select.disabled = isReadOnly;
          if (otherInput) otherInput.readOnly = isReadOnly;
          
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
      
      if (field && field.type === 'ChoiceField' && field.allow_other) {
        // Handle allow_other ChoiceField values
        const container = document.querySelector(`[data-name="${fieldName}"] .choice-field-container`);
        
        if (container && value) {
          const select = container.querySelector('.choice-field-select');
          const otherInput = container.querySelector('.choice-field-other');
          const hiddenInput = container.querySelector(`input[name="${fieldName}"]`);
          
          if (select && otherInput && hiddenInput) {
            try {
              const parsedValue = typeof value === 'string' ? JSON.parse(value) : value;
              
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
      
      if (field.type === 'ChoiceField' && field.allow_other) {
        // Check if allow_other ChoiceField has a value
        const hiddenInput = document.querySelector(`input[name="${fieldName}"]`);
        if (hiddenInput && hiddenInput.value) {
          try {
            const parsedValue = JSON.parse(hiddenInput.value);
            hasValue = (parsedValue.choice && parsedValue.choice.length > 0) ||
                      (parsedValue.other && parsedValue.other.length > 0 && parsedValue.other[0].label);
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
