/**
 * Handles form rendering and field creation
 */
export class FormRenderer {
  constructor() {
    this.currentSchema = null;
  }

  /**
   * Set the current schema
   */
  setSchema(schema) {
    this.currentSchema = schema;
  }

  /**
   * Render the complete form
   */
  renderForm() {
    if (!this.currentSchema) return;

    console.log('🔄 Rendering form:', this.currentSchema.form.name);

    const container = document.getElementById('form-container');
    container.innerHTML = '';

    const formTitle = document.createElement('h2');
    formTitle.textContent = this.currentSchema.form.name || 'Untitled Form';
    container.appendChild(formTitle);

    const form = document.createElement('form');
    form.id = 'main-form';

    this.renderElements(this.currentSchema.form.elements || [], form);
    container.appendChild(form);
  }

  /**
   * Render form elements recursively
   */
  renderElements(elements, container) {
    elements.forEach((element) => {
      if (element.type === 'Section') {
        this.renderSection(element, container);
      } else {
        this.renderField(element, container);
      }
    });
  }

  /**
   * Render a section element
   */
  renderSection(section, container) {
    const sectionDiv = document.createElement('div');
    sectionDiv.className = 'section';
    sectionDiv.setAttribute('data-key', section.key);

    // Show section title using label field (use data_name as fallback)
    const title = document.createElement('div');
    title.className = 'section-title';
    title.textContent = section.label || section.data_name || 'Section';
    sectionDiv.appendChild(title);

    // Render drilldown sections as inline sections
    const elements = section.elements || section.drilldown_elements || [];
    this.renderElements(elements, sectionDiv);

    container.appendChild(sectionDiv);
  }

  /**
   * Render a field element
   */
  renderField(field, container) {
    const fieldDiv = document.createElement('div');
    fieldDiv.className = 'field';
    fieldDiv.setAttribute('data-key', field.key);
    fieldDiv.setAttribute('data-name', field.data_name);

    const label = document.createElement('label');
    label.textContent = field.label || field.data_name;
    if (field.required) label.textContent += ' *';
    fieldDiv.appendChild(label);

    const input = this.createFieldInput(field);
    
    // Only set name attribute if input is a form element (not a container)
    if (input.tagName && input.tagName.toLowerCase() !== 'div') {
      input.name = field.data_name;
    }

    // Set read-only state based on schema
    if (field.read_only === true || field.type === 'CalculatedField') {
      if (field.type === 'SingleChoiceField') {
        const choiceDisplay = field.display || 'default';
        if (choiceDisplay === 'radio') {
          // Handle radio button readonly
          const radios = input.querySelectorAll('input[type="radio"]');
          const otherInput = input.querySelector('.choice-field-other');
          radios.forEach(radio => radio.disabled = true);
          if (otherInput) otherInput.readOnly = true;
        } else if (field.allow_other) {
          // Handle allow_other SingleChoiceField readonly
          const select = input.querySelector('.choice-field-select');
          const otherInput = input.querySelector('.choice-field-other');
          if (select) select.disabled = true;
          if (otherInput) otherInput.readOnly = true;
        } else {
          // Handle simple SingleChoiceField readonly
          const select = input.querySelector('.choice-field-simple-select');
          if (select) select.disabled = true;
        }
      } else if (field.type === 'MultiChoiceField') {
        const multiChoiceDisplay = field.display || 'default';
        if (multiChoiceDisplay === 'checkbox') {
          // Handle checkbox readonly
          const checkboxes = input.querySelectorAll('input[type="checkbox"]');
          const otherInput = input.querySelector('.multi-choice-field-other');
          checkboxes.forEach(checkbox => checkbox.disabled = true);
          if (otherInput) otherInput.readOnly = true;
        } else if (field.allow_other) {
          // Handle allow_other MultiChoiceField readonly
          const select = input.querySelector('.multi-choice-field-select');
          const otherInput = input.querySelector('.multi-choice-field-other');
          if (select) select.disabled = true;
          if (otherInput) otherInput.readOnly = true;
        } else {
          // Handle simple MultiChoiceField readonly
          const select = input.querySelector('.multi-choice-field-simple-select');
          if (select) select.disabled = true;
        }
      } else {
        input.readOnly = true;
      }
      fieldDiv.classList.add('readonly');
    }

    // Add calculated class for calculated fields
    if (field.type === 'CalculatedField') {
      fieldDiv.classList.add('calculated');
    }

    fieldDiv.appendChild(input);
    container.appendChild(fieldDiv);
  }

  /**
   * Create input element based on field type
   */
  createFieldInput(field) {
    let input;

    switch (field.type) {
      case 'TextField':
        input = document.createElement('input');
        input.type = 'text';
        if (field.pattern) input.pattern = field.pattern;
        break;

      case 'NumericField':
        input = document.createElement('input');
        input.type = 'number';
        if (field.min !== undefined) input.min = field.min;
        if (field.max !== undefined) input.max = field.max;
        if (field.format === 'integer') input.step = '1';
        break;

      case 'SingleChoiceField':
        // Check display type - default to 'default' if not specified
        const choiceDisplay = field.display || 'default';
        
        if (choiceDisplay === 'radio') {
          // Render as radio buttons
          const container = document.createElement('div');
          container.className = 'choice-field-radio-container';
          
          // Create hidden input for the actual field value
          const hiddenInput = document.createElement('input');
          hiddenInput.type = 'hidden';
          hiddenInput.name = field.data_name;
          
          // Flag to prevent recursive updates
          let isUpdating = false;
          
          // Function to update hidden value
          function updateHiddenValue() {
            if (isUpdating) return;
            
            const selectedRadio = container.querySelector('input[type="radio"]:checked');
            let choiceValue = '';
            let otherValue = '';
            
            if (selectedRadio) {
              if (selectedRadio.value === '__other__') {
                const otherInput = container.querySelector('.choice-field-other');
                otherValue = otherInput ? otherInput.value.trim() : '';
              } else {
                choiceValue = selectedRadio.value;
              }
            }
            
            const value = {
              choice: choiceValue ? [{ value: choiceValue }] : [],
              other: otherValue ? [{ label: otherValue }] : []
            };
            
            hiddenInput.value = JSON.stringify(value);
            
            // Dispatch custom event to trigger form state update
            const changeEvent = new CustomEvent('choicefield-change', {
              bubbles: true,
              detail: { fieldName: field.data_name, value: value }
            });
            hiddenInput.dispatchEvent(changeEvent);
          }
          
          // Add regular choices as radio buttons
          (field.choices || []).forEach((choice) => {
            const radioDiv = document.createElement('div');
            radioDiv.className = 'choice-field-radio-option';
            
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = field.data_name + '_radio';
            radio.value = choice.value;
            radio.id = field.data_name + '_' + choice.value;
            
            const label = document.createElement('label');
            label.htmlFor = radio.id;
            label.textContent = choice.label || choice.value;
            
            radio.addEventListener('change', updateHiddenValue);
            
            radioDiv.appendChild(radio);
            radioDiv.appendChild(label);
            container.appendChild(radioDiv);
          });
          
          // Add "Other" option if allowed
          if (field.allow_other) {
            const otherDiv = document.createElement('div');
            otherDiv.className = 'choice-field-radio-option';
            
            const otherRadio = document.createElement('input');
            otherRadio.type = 'radio';
            otherRadio.name = field.data_name + '_radio';
            otherRadio.value = '__other__';
            otherRadio.id = field.data_name + '_other_radio';
            
            const otherLabel = document.createElement('label');
            otherLabel.htmlFor = otherRadio.id;
            otherLabel.textContent = 'Other (specify)';
            
            const otherInput = document.createElement('input');
            otherInput.type = 'text';
            otherInput.className = 'choice-field-other';
            otherInput.placeholder = 'Please specify...';
            otherInput.style.display = 'none';
            otherInput.style.marginLeft = '20px';
            otherInput.style.marginTop = '5px';
            
            otherRadio.addEventListener('change', function() {
              if (this.checked) {
                otherInput.style.display = 'block';
                otherInput.focus();
              }
              updateHiddenValue();
            });
            
            // Hide other input when other radio options are selected
            container.addEventListener('change', function(e) {
              if (e.target.type === 'radio' && e.target.value !== '__other__') {
                otherInput.style.display = 'none';
                otherInput.value = '';
              }
            });
            
            otherInput.addEventListener('input', updateHiddenValue);
            
            otherDiv.appendChild(otherRadio);
            otherDiv.appendChild(otherLabel);
            otherDiv.appendChild(otherInput);
            container.appendChild(otherDiv);
          }
          
          // Store the update flag and function on the container for external access
          container._isUpdating = () => isUpdating;
          container._setUpdating = (value) => { isUpdating = value; };
          container._updateHiddenValue = updateHiddenValue;
          
          container.appendChild(hiddenInput);
          input = container;
        } else {
          // Default rendering (dropdown select)
          if (field.allow_other) {
            // Create a container for choice field with "other" option
            const container = document.createElement('div');
            container.className = 'choice-field-container';
            
            const select = document.createElement('select');
            select.name = field.data_name + '_choice';
            select.className = 'choice-field-select';
            
            // Add default empty option
            const emptyOption = document.createElement('option');
            emptyOption.value = '';
            emptyOption.textContent = 'Select an option...';
            select.appendChild(emptyOption);
            
            // Add regular choices
            (field.choices || []).forEach((choice) => {
              const option = document.createElement('option');
              option.value = choice.value;
              option.textContent = choice.label || choice.value;
              select.appendChild(option);
            });
            
            // Add "Other" option
            const otherOption = document.createElement('option');
            otherOption.value = '__other__';
            otherOption.textContent = 'Other (specify)';
            select.appendChild(otherOption);
            
            // Create text input for "other" value
            const otherInput = document.createElement('input');
            otherInput.type = 'text';
            otherInput.name = field.data_name + '_other';
            otherInput.className = 'choice-field-other';
            otherInput.placeholder = 'Please specify...';
            otherInput.style.display = 'none';
            
            // Create hidden input for the actual field value
            const hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.name = field.data_name;
            
            // Flag to prevent recursive updates
            let isUpdating = false;
            
            // Function to update hidden value
            function updateHiddenValue() {
              if (isUpdating) return;
              
              const choiceValue = select.value === '__other__' ? '' : select.value;
              const otherValue = select.value === '__other__' ? otherInput.value.trim() : '';
              
              const value = {
                choice: choiceValue ? [{ value: choiceValue }] : [],
                other: otherValue ? [{ label: otherValue }] : []
              };
              
              hiddenInput.value = JSON.stringify(value);
              
              // Dispatch custom event to trigger form state update
              const changeEvent = new CustomEvent('choicefield-change', {
                bubbles: true,
                detail: { fieldName: field.data_name, value: value }
              });
              hiddenInput.dispatchEvent(changeEvent);
            }
            
            // Add event listener for select change
            select.addEventListener('change', function() {
              if (isUpdating) return;
              
              if (this.value === '__other__') {
                otherInput.style.display = 'block';
                otherInput.focus();
              } else {
                otherInput.style.display = 'none';
                otherInput.value = '';
              }
              updateHiddenValue();
            });
            
            // Add event listener for other input
            otherInput.addEventListener('input', updateHiddenValue);
            
            // Store the update flag and function on the container for external access
            container._isUpdating = () => isUpdating;
            container._setUpdating = (value) => { isUpdating = value; };
            container._updateHiddenValue = updateHiddenValue;
            
            container.appendChild(select);
            container.appendChild(otherInput);
            container.appendChild(hiddenInput);
            
            input = container;
          } else {
            // Simple select for non-allow_other fields
            const container = document.createElement('div');
            container.className = 'choice-field-simple-container';
            
            const select = document.createElement('select');
            select.className = 'choice-field-simple-select';
            
            // Add default empty option
            const emptyOption = document.createElement('option');
            emptyOption.value = '';
            emptyOption.textContent = 'Select an option...';
            select.appendChild(emptyOption);
            
            (field.choices || []).forEach((choice) => {
              const option = document.createElement('option');
              option.value = choice.value;
              option.textContent = choice.label || choice.value;
              select.appendChild(option);
            });
            
            // Create hidden input for the actual field value
            const hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.name = field.data_name;
            
            // Function to update hidden value for simple choice field
            function updateSimpleHiddenValue() {
              const choiceValue = select.value;
              const value = {
                choice: choiceValue ? [{ value: choiceValue }] : [],
                other: []
              };
              hiddenInput.value = JSON.stringify(value);
              
              // Dispatch custom event to trigger form state update
              const changeEvent = new CustomEvent('choicefield-change', {
                bubbles: true,
                detail: { fieldName: field.data_name, value: value }
              });
              hiddenInput.dispatchEvent(changeEvent);
            }
            
            // Add event listener for select change
            select.addEventListener('change', updateSimpleHiddenValue);
            
            container.appendChild(select);
            container.appendChild(hiddenInput);
            
            input = container;
          }
        }
        break;

      case 'MultiChoiceField':
        // Check display type - default to 'default' if not specified
        const multiChoiceDisplay = field.display || 'default';
        
        if (multiChoiceDisplay === 'checkbox') {
          // Render as checkboxes
          const container = document.createElement('div');
          container.className = 'multi-choice-field-checkbox-container';
          
          // Create hidden input for the actual field value
          const hiddenInput = document.createElement('input');
          hiddenInput.type = 'hidden';
          hiddenInput.name = field.data_name;
          
          // Initialize with correct structure
          hiddenInput.value = JSON.stringify({
            choices: [],
            other: []
          });
          
          // Flag to prevent recursive updates
          let isUpdating = false;
          
          // Function to update hidden value
          function updateHiddenValue() {
            if (isUpdating) return;
            
            const checkedBoxes = container.querySelectorAll('input[type="checkbox"]:checked');
            const hasOther = Array.from(checkedBoxes).some(cb => cb.value === '__other__');
            
            // Get regular choices (excluding "other")
            const choiceValues = Array.from(checkedBoxes)
              .filter(cb => cb.value !== '__other__')
              .map(cb => ({ value: cb.value }));
            
            // Get other value if selected
            let otherValue = '';
            if (hasOther) {
              const otherInput = container.querySelector('.multi-choice-field-other');
              otherValue = otherInput ? otherInput.value.trim() : '';
            }
            
            const value = {
              choices: choiceValues,
              other: otherValue ? [{ label: otherValue }] : []
            };
            
            hiddenInput.value = JSON.stringify(value);
            
            // Dispatch custom event to trigger form state update
            const changeEvent = new CustomEvent('multichoicefield-change', {
              bubbles: true,
              detail: { fieldName: field.data_name, value: value }
            });
            hiddenInput.dispatchEvent(changeEvent);
          }
          
          // Add regular choices as checkboxes
          (field.choices || []).forEach((choice) => {
            const checkboxDiv = document.createElement('div');
            checkboxDiv.className = 'multi-choice-field-checkbox-option';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.name = field.data_name + '_checkbox';
            checkbox.value = choice.value;
            checkbox.id = field.data_name + '_' + choice.value;
            
            const label = document.createElement('label');
            label.htmlFor = checkbox.id;
            label.textContent = choice.label || choice.value;
            
            checkbox.addEventListener('change', updateHiddenValue);
            
            checkboxDiv.appendChild(checkbox);
            checkboxDiv.appendChild(label);
            container.appendChild(checkboxDiv);
          });
          
          // Add "Other" option if allowed
          if (field.allow_other) {
            const otherDiv = document.createElement('div');
            otherDiv.className = 'multi-choice-field-checkbox-option';
            
            const otherCheckbox = document.createElement('input');
            otherCheckbox.type = 'checkbox';
            otherCheckbox.name = field.data_name + '_checkbox';
            otherCheckbox.value = '__other__';
            otherCheckbox.id = field.data_name + '_other_checkbox';
            
            const otherLabel = document.createElement('label');
            otherLabel.htmlFor = otherCheckbox.id;
            otherLabel.textContent = 'Other (specify)';
            
            const otherInput = document.createElement('input');
            otherInput.type = 'text';
            otherInput.className = 'multi-choice-field-other';
            otherInput.placeholder = 'Please specify...';
            otherInput.style.display = 'none';
            otherInput.style.marginLeft = '20px';
            otherInput.style.marginTop = '5px';
            
            otherCheckbox.addEventListener('change', function() {
              if (this.checked) {
                otherInput.style.display = 'block';
                otherInput.focus();
              } else {
                otherInput.style.display = 'none';
                otherInput.value = '';
              }
              updateHiddenValue();
            });
            
            otherInput.addEventListener('input', updateHiddenValue);
            
            otherDiv.appendChild(otherCheckbox);
            otherDiv.appendChild(otherLabel);
            otherDiv.appendChild(otherInput);
            container.appendChild(otherDiv);
          }
          
          // Store the update flag and function on the container for external access
          container._isUpdating = () => isUpdating;
          container._setUpdating = (value) => { isUpdating = value; };
          container._updateHiddenValue = updateHiddenValue;
          
          container.appendChild(hiddenInput);
          input = container;
        } else {
          // Default rendering (multi-select dropdown)
          if (field.allow_other) {
            // Create a container for multi choice field with "other" option
            const container = document.createElement('div');
            container.className = 'multi-choice-field-container';
            
            const select = document.createElement('select');
            select.name = field.data_name + '_choices';
            select.className = 'multi-choice-field-select';
            select.multiple = true;
            select.size = Math.min(field.choices ? field.choices.length + 1 : 6, 8); // Show up to 8 options
            
            // Add regular choices
            (field.choices || []).forEach((choice) => {
              const option = document.createElement('option');
              option.value = choice.value;
              option.textContent = choice.label || choice.value;
              select.appendChild(option);
            });
            
            // Add "Other" option
            const otherOption = document.createElement('option');
            otherOption.value = '__other__';
            otherOption.textContent = 'Other (specify)';
            select.appendChild(otherOption);
            
            // Create text input for "other" value
            const otherInput = document.createElement('input');
            otherInput.type = 'text';
            otherInput.name = field.data_name + '_other';
            otherInput.className = 'multi-choice-field-other';
            otherInput.placeholder = 'Please specify...';
            otherInput.style.display = 'none';
            
            // Create hidden input for the actual field value
            const hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.name = field.data_name;
            
            // Initialize with correct structure
            hiddenInput.value = JSON.stringify({
              choices: [],
              other: []
            });
            
            // Flag to prevent recursive updates
            let isUpdating = false;
            
            // Function to update hidden value
            function updateHiddenValue() {
              if (isUpdating) return;
              
              const selectedOptions = Array.from(select.selectedOptions);
              const hasOther = selectedOptions.some(option => option.value === '__other__');
              
              // Get regular choices (excluding "other")
              const choiceValues = selectedOptions
                .filter(option => option.value !== '__other__')
                .map(option => ({ value: option.value }));
              
              // Get other value if selected - only include if there's text (same as SingleChoiceField)
              const otherValue = hasOther ? otherInput.value.trim() : '';
              
              const value = {
                choices: choiceValues,
                other: otherValue ? [{ label: otherValue }] : []
              };
              
              hiddenInput.value = JSON.stringify(value);
              
              // Dispatch custom event to trigger form state update
              const changeEvent = new CustomEvent('multichoicefield-change', {
                bubbles: true,
                detail: { fieldName: field.data_name, value: value }
              });
              hiddenInput.dispatchEvent(changeEvent);
            }
            
            // Add event listener for select change
            select.addEventListener('change', function() {
              if (isUpdating) return;
              
              const selectedOptions = Array.from(this.selectedOptions);
              const hasOther = selectedOptions.some(option => option.value === '__other__');
              
              if (hasOther) {
                otherInput.style.display = 'block';
                otherInput.focus();
              } else {
                otherInput.style.display = 'none';
                otherInput.value = '';
              }
              updateHiddenValue();
            });
            
            // Add event listener for other input
            otherInput.addEventListener('input', updateHiddenValue);
            
            // Store the update flag and function on the container for external access
            container._isUpdating = () => isUpdating;
            container._setUpdating = (value) => { isUpdating = value; };
            container._updateHiddenValue = updateHiddenValue;
            
            container.appendChild(select);
            container.appendChild(otherInput);
            container.appendChild(hiddenInput);
            
            input = container;
          } else {
            // Simple multi-select for non-allow_other fields
            const container = document.createElement('div');
            container.className = 'multi-choice-field-simple-container';
            
            const select = document.createElement('select');
            select.className = 'multi-choice-field-simple-select';
            select.multiple = true;
            select.size = Math.min(field.choices ? field.choices.length : 6, 8); // Show up to 8 options
            
            (field.choices || []).forEach((choice) => {
              const option = document.createElement('option');
              option.value = choice.value;
              option.textContent = choice.label || choice.value;
              select.appendChild(option);
            });
            
            // Create hidden input for the actual field value
            const hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.name = field.data_name;
            
            // Initialize with correct structure
            hiddenInput.value = JSON.stringify({
              choices: [],
              other: []
            });
            
            // Function to update hidden value for simple multi choice field
            function updateSimpleHiddenValue() {
              const selectedOptions = Array.from(select.selectedOptions);
              const choiceValues = selectedOptions.map(option => ({ value: option.value }));
              
              const value = {
                choices: choiceValues,
                other: []
              };
              hiddenInput.value = JSON.stringify(value);
              
              // Dispatch custom event to trigger form state update
              const changeEvent = new CustomEvent('multichoicefield-change', {
                bubbles: true,
                detail: { fieldName: field.data_name, value: value }
              });
              hiddenInput.dispatchEvent(changeEvent);
            }
            
            // Add event listener for select change
            select.addEventListener('change', updateSimpleHiddenValue);
            
            container.appendChild(select);
            container.appendChild(hiddenInput);
            
            input = container;
          }
        }
        break;

      case 'CalculatedField':
        input = document.createElement('input');
        input.type = 'text';
        input.readOnly = true;
        break;

      default:
        input = document.createElement('input');
        input.type = 'text';
    }

    return input;
  }

  /**
   * Count total fields in elements array
   */
  countFields(elements) {
    let count = 0;
    elements.forEach((element) => {
      if (element.type === 'Section') {
        count += this.countFields(element.elements || element.drilldown_elements || []);
      } else {
        count++;
      }
    });
    return count;
  }

  /**
   * Find field definition by data_name
   */
  findFieldByDataName(dataName) {
    function searchElements(elements) {
      for (const element of elements) {
        if (element.data_name === dataName) {
          return element;
        }
        if (element.type === 'Section') {
          const found = searchElements(element.elements || element.drilldown_elements || []);
          if (found) return found;
        }
      }
      return null;
    }

    return this.currentSchema ? searchElements(this.currentSchema.form.elements || []) : null;
  }
}
