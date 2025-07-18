/**
 * Handles form rendering and field creation
 */
export class FormRenderer {
  constructor() {
    this.currentSchema = null;
  }

  /**
   * Check if a section or field has partially supported features
   */
  hasPartiallySupportedFeatures(element) {
    // For sections, check if display is drilldown
    if (element.type === 'Section') {
      return element.display === 'drilldown';
    }
    
    // For fields, currently no partially supported features
    // This is ready for future expansion
    return false;
  }

  /**
   * Check if a field is not supported at all
   */
  isUnsupportedField(field) {
    // Currently no unsupported fields, but this is ready for future expansion
    return false;
  }

  /**
   * Create a warning icon for partially supported features
   */
  createWarningIcon(element, elementType = 'section') {
    const warningIcon = document.createElement('span');
    warningIcon.className = `warning-icon ${elementType}-warning-icon`;
    warningIcon.textContent = '⚠️';
    warningIcon.title = 'This field is partially supported in form0-cli. Full support available in form0-react and form0-react-native packages.\nWant to learn more? Check out docs.form0.dev/cli/partially-supported-features';
    warningIcon.style.cursor = 'help';
    warningIcon.style.marginLeft = '8px';
    return warningIcon;
  }

  /**
   * Create a stop icon for unsupported features
   */
  createStopIcon(element, elementType = 'field') {
    const stopIcon = document.createElement('span');
    stopIcon.className = `stop-icon ${elementType}-stop-icon`;
    stopIcon.textContent = '⛔';
    stopIcon.title = 'This field type is not supported in form0-cli. Full support available in form0-react and form0-react-native packages.\nWant to learn more? Check out docs.form0.dev/cli/unsupported-features';
    stopIcon.style.cursor = 'help';
    stopIcon.style.marginLeft = '8px';
    return stopIcon;
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

    // Section title row (label + info icon)
    const titleRow = document.createElement('div');
    titleRow.className = 'section-title-row';
    const title = document.createElement('div');
    title.className = 'section-title';
    title.textContent = section.label || section.data_name || 'Section';
    titleRow.appendChild(title);

    // --- Section description logic ---
    if (section.description && typeof section.description === 'string') {
      if (section.description_mode === 'default') {
        // Add info icon aligned right in section title row
        const infoIcon = document.createElement('span');
        infoIcon.className = 'description-info-icon section-info-icon';
        infoIcon.textContent = 'ℹ️';
        infoIcon.title = 'Show description';
        infoIcon.style.cursor = 'pointer';
        infoIcon.tabIndex = 0;
        titleRow.appendChild(infoIcon);

        // Create dialog/modal (hidden by default)
        const dialog = document.createElement('div');
        dialog.className = 'description-dialog';
        dialog.style.display = 'none';
        dialog.innerHTML = `
          <div class="description-dialog-content">
            <span class="description-dialog-close" tabindex="0">&times;</span>
            <div class="description-dialog-header">${section.label || section.data_name || 'Section'}</div>
            <div class="description-dialog-text">${section.description}</div>
          </div>
        `;
        document.body.appendChild(dialog);

        // Show/hide dialog logic
        function showDialog() { dialog.style.display = 'block'; }
        function hideDialog() { dialog.style.display = 'none'; }
        infoIcon.addEventListener('click', showDialog);
        infoIcon.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') showDialog(); });
        dialog.querySelector('.description-dialog-close').addEventListener('click', hideDialog);
        dialog.querySelector('.description-dialog-close').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') hideDialog(); });
        dialog.addEventListener('click', (e) => { if (e.target === dialog) hideDialog(); });
      }
    }

    // --- Warning icon for partially supported features ---
    if (this.hasPartiallySupportedFeatures(section)) {
      const warningIcon = this.createWarningIcon(section, 'section');
      titleRow.appendChild(warningIcon);
    }
    sectionDiv.appendChild(titleRow);

    // Subtext for section (below title row)
    if (section.description && section.description_mode === 'subtext') {
      const subtext = document.createElement('div');
      subtext.className = 'description-subtext';
      subtext.textContent = section.description;
      sectionDiv.appendChild(subtext);
    }

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

    // Skip creating standard label for LabelField since it renders its own content
    if (field.type !== 'LabelField') {
      // Label row (label + info icon)
      const labelRow = document.createElement('div');
      labelRow.className = 'field-label-row';
      const label = document.createElement('label');
      label.id = field.data_name + '_label';
      label.textContent = field.label || field.data_name;
      if (field.required) label.textContent += ' *';
      // Only set for attribute for simple fields that have a direct input with matching id
      const simpleFieldTypes = ['TextField', 'NumericField', 'CalculatedField', 'DateField', 'TimeField'];
      if (simpleFieldTypes.includes(field.type)) {
        label.htmlFor = field.data_name;
      }
      labelRow.appendChild(label);

      // --- Description logic ---
      if (field.description && typeof field.description === 'string') {
        if (field.description_mode === 'default') {
          // Add info icon aligned right in label row
          const infoIcon = document.createElement('span');
          infoIcon.className = 'description-info-icon field-info-icon';
          infoIcon.textContent = 'ℹ️';
          infoIcon.title = 'Show description';
          infoIcon.style.cursor = 'pointer';
          infoIcon.tabIndex = 0;
          labelRow.appendChild(infoIcon);

          // Create dialog/modal (hidden by default)
          const dialog = document.createElement('div');
          dialog.className = 'description-dialog';
          dialog.style.display = 'none';
          dialog.innerHTML = `
            <div class="description-dialog-content">
              <span class="description-dialog-close" tabindex="0">&times;</span>
              <div class="description-dialog-header">${field.label || field.data_name}</div>
              <div class="description-dialog-text">${field.description}</div>
          </div>
          `;
          document.body.appendChild(dialog);

          // Show/hide dialog logic
          function showDialog() { dialog.style.display = 'block'; }
          function hideDialog() { dialog.style.display = 'none'; }
          infoIcon.addEventListener('click', showDialog);
          infoIcon.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') showDialog(); });
          dialog.querySelector('.description-dialog-close').addEventListener('click', hideDialog);
          dialog.querySelector('.description-dialog-close').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') hideDialog(); });
          dialog.addEventListener('click', (e) => { if (e.target === dialog) hideDialog(); });
        }
      }

      // --- Warning icon for partially supported features ---
      if (this.hasPartiallySupportedFeatures(field)) {
        const warningIcon = this.createWarningIcon(field, 'field');
        labelRow.appendChild(warningIcon);
      }

      // --- Stop icon for unsupported features ---
      if (this.isUnsupportedField(field)) {
        const stopIcon = this.createStopIcon(field, 'field');
        labelRow.appendChild(stopIcon);
      }
      fieldDiv.appendChild(labelRow);

      // Subtext for field (below label row)
      if (field.description && field.description_mode === 'subtext') {
        const subtext = document.createElement('div');
        subtext.className = 'description-subtext';
        subtext.textContent = field.description;
        fieldDiv.appendChild(subtext);
      }
    }

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
          const otherInput = input.querySelector('.single-choice-field-other');
          radios.forEach(radio => radio.disabled = true);
          if (otherInput) otherInput.readOnly = true;
        } else if (field.allow_other) {
          // Handle allow_other SingleChoiceField readonly
          const select = input.querySelector('.single-choice-field-select');
          const otherInput = input.querySelector('.single-choice-field-other');
          if (select) select.disabled = true;
          if (otherInput) otherInput.readOnly = true;
        } else {
          // Handle simple SingleChoiceField readonly
          const select = input.querySelector('.single-choice-field-simple-select');
          if (select) select.disabled = true;
        }
      } else if (field.type === 'MultiChoiceField') {
        const multiChoiceDisplay = field.display || 'default';
        if (multiChoiceDisplay === 'checkbox') {
          // Handle checkbox readonly
          const checkboxes = input.querySelectorAll('input[type="checkbox"]');
          const otherInput = input.querySelector('.multi-single-choice-field-other');
          checkboxes.forEach(checkbox => checkbox.disabled = true);
          if (otherInput) otherInput.readOnly = true;
        } else if (field.allow_other) {
          // Handle allow_other MultiChoiceField readonly
          const select = input.querySelector('.multi-single-choice-field-select');
          const otherInput = input.querySelector('.multi-single-choice-field-other');
          if (select) select.disabled = true;
          if (otherInput) otherInput.readOnly = true;
        } else {
          // Handle simple MultiChoiceField readonly
          const select = input.querySelector('.multi-single-choice-field-simple-select');
          if (select) select.disabled = true;
        }
      } else if (field.type === 'BooleanField') {
        // Handle BooleanField readonly (segmented control)
        const buttons = input.querySelectorAll('.boolean-field-option');
        buttons.forEach(button => button.disabled = true);
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
        input.id = field.data_name;
        input.autocomplete = 'off';
        if (field.pattern) input.pattern = field.pattern;
        break;

      case 'NumericField':
        input = document.createElement('input');
        input.type = 'number';
        input.id = field.data_name;
        input.autocomplete = 'off';
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
          container.className = 'single-choice-field-radio-container';
          container.setAttribute('aria-labelledby', field.data_name + '_label');
          
          // Create hidden input for the actual field value
          const hiddenInput = document.createElement('input');
          hiddenInput.type = 'hidden';
          hiddenInput.id = field.data_name + '_hidden';
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
                const otherInput = container.querySelector('.single-choice-field-other');
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
            const changeEvent = new CustomEvent('singlechoicefield-change', {
              bubbles: true,
              detail: { fieldName: field.data_name, value: value }
            });
            hiddenInput.dispatchEvent(changeEvent);
          }
          
          // Add regular choices as radio buttons
          (field.choices || []).forEach((choice) => {
            const radioDiv = document.createElement('div');
            radioDiv.className = 'single-choice-field-radio-option';
            
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
            otherDiv.className = 'single-choice-field-radio-option';
            
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
            otherInput.id = field.data_name + '_other_input';
            otherInput.name = field.data_name + '_other';
            otherInput.className = 'single-choice-field-other';
            otherInput.placeholder = 'Please specify...';
            
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
            container.className = 'single-choice-field-container';
            container.setAttribute('aria-labelledby', field.data_name + '_label');
            
            const select = document.createElement('select');
            select.id = field.data_name + '_select';
            select.name = field.data_name + '_choice';
            select.className = 'single-choice-field-select';
            
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
            otherInput.id = field.data_name + '_other_input';
            otherInput.name = field.data_name + '_other';
            otherInput.className = 'single-choice-field-other';
            otherInput.placeholder = 'Please specify...';
            otherInput.style.display = 'none';
            
            // Create label for other input (screen reader only)
            const otherInputLabel = document.createElement('label');
            otherInputLabel.htmlFor = otherInput.id;
            otherInputLabel.textContent = 'Specify other option';
            otherInputLabel.className = 'sr-only';
            
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
              const changeEvent = new CustomEvent('singlechoicefield-change', {
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
            container.appendChild(otherInputLabel);
            container.appendChild(otherInput);
            container.appendChild(hiddenInput);
            
            input = container;
          } else {
            // Simple select for non-allow_other fields
            const container = document.createElement('div');
            container.className = 'single-choice-field-simple-container';
            container.setAttribute('aria-labelledby', field.data_name + '_label');
            
            const select = document.createElement('select');
            select.id = field.data_name + '_simple_select';
            select.className = 'single-choice-field-simple-select';
            
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
            hiddenInput.id = field.data_name + '_hidden';
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
              const changeEvent = new CustomEvent('singlechoicefield-change', {
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
          container.setAttribute('aria-labelledby', field.data_name + '_label');
          
          // Create hidden input for the actual field value
          const hiddenInput = document.createElement('input');
          hiddenInput.type = 'hidden';
          hiddenInput.id = field.data_name + '_hidden';
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
            otherInput.id = field.data_name + '_other_input';
            otherInput.name = field.data_name + '_other';
            otherInput.className = 'multi-choice-field-other';
            otherInput.placeholder = 'Please specify...';
            
            // Create label for other input (screen reader only)
            const otherInputLabel = document.createElement('label');
            otherInputLabel.htmlFor = otherInput.id;
            otherInputLabel.textContent = 'Specify other option';
            otherInputLabel.className = 'sr-only';
            
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
            otherDiv.appendChild(otherInputLabel);
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
            container.setAttribute('aria-labelledby', field.data_name + '_label');
            
            const select = document.createElement('select');
            select.id = field.data_name + '_select';
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
            otherInput.id = field.data_name + '_other_input';
            otherInput.name = field.data_name + '_other';
            otherInput.className = 'multi-choice-field-other';
            otherInput.placeholder = 'Please specify...';
            otherInput.style.display = 'none';
            
            // Create label for other input (screen reader only)
            const otherInputLabel = document.createElement('label');
            otherInputLabel.htmlFor = otherInput.id;
            otherInputLabel.textContent = 'Specify other option';
            otherInputLabel.className = 'sr-only';
            
            // Create hidden input for the actual field value
            const hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.id = field.data_name + '_hidden';
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
            container.appendChild(otherInputLabel);
            container.appendChild(otherInput);
            container.appendChild(hiddenInput);
            
            input = container;
          } else {
            // Simple multi-select for non-allow_other fields
            const container = document.createElement('div');
            container.className = 'multi-choice-field-simple-container';
            container.setAttribute('aria-labelledby', field.data_name + '_label');
            
            const select = document.createElement('select');
            select.id = field.data_name + '_simple_select';
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
            hiddenInput.id = field.data_name + '_hidden';
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
        input.id = field.data_name;
        input.readOnly = true;
        break;

      case 'DateField':
        input = document.createElement('input');
        input.type = 'date';
        input.id = field.data_name;
        break;

      case 'TimeField':
        input = document.createElement('input');
        input.type = 'time';
        input.id = field.data_name;
        break;

      case 'BooleanField':
        // BooleanField renders as a segmented control (buttons styled as a group)
        const container = document.createElement('div');
        container.className = 'boolean-field-container';
        container.setAttribute('aria-labelledby', field.data_name + '_label');
        
        // Create hidden input for the actual field value
        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.name = field.data_name;
        
        // Flag to prevent recursive updates
        let isUpdating = false;
        
        // Function to update hidden value
        function updateHiddenValue() {
          if (isUpdating) return;
          
          const selectedButton = container.querySelector('.boolean-field-option.selected');
          let choiceValue = '';
          
          if (selectedButton) {
            choiceValue = selectedButton.dataset.value;
          }
          
          const value = {
            choice: choiceValue ? [{ value: choiceValue }] : [],
            other: []
          };
          
          hiddenInput.value = JSON.stringify(value);
          
          // Dispatch custom event to trigger form state update
          const changeEvent = new CustomEvent('booleanfield-change', {
            bubbles: true,
            detail: { fieldName: field.data_name, value: value }
          });
          hiddenInput.dispatchEvent(changeEvent);
        }
        
        // Create segmented control container
        const segmentedContainer = document.createElement('div');
        segmentedContainer.className = 'boolean-field-segmented';
        
        // Add choice buttons
        (field.choices || []).forEach((choice, index) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'boolean-field-option';
          button.dataset.value = choice.value;
          button.textContent = choice.label || choice.value;
          
          // Add hover effect
          button.addEventListener('mouseenter', function() {
            if (!this.classList.contains('selected')) {
              this.style.background = '#f5f5f5';
            }
          });
          
          button.addEventListener('mouseleave', function() {
            if (!this.classList.contains('selected')) {
              this.style.background = 'white';
            }
          });
          
          // Add click handler
          button.addEventListener('click', function() {
            // Remove selected class from all buttons
            container.querySelectorAll('.boolean-field-option').forEach(btn => {
              btn.classList.remove('selected');
              btn.style.background = 'white';
              btn.style.color = '#666';
            });
            
            // Add selected class to clicked button
            this.classList.add('selected');
            this.style.background = '#007bff';
            this.style.color = 'white';
            
            updateHiddenValue();
          });
          
          segmentedContainer.appendChild(button);
        });
        
        // Store the update flag and function on the container for external access
        container._isUpdating = () => isUpdating;
        container._setUpdating = (value) => { isUpdating = value; };
        container._updateHiddenValue = updateHiddenValue;
        
        container.appendChild(segmentedContainer);
        container.appendChild(hiddenInput);
        
        input = container;
        break;

      case 'LabelField':
        // LabelField renders as a simple div with the label text
        const labelContainer = document.createElement('div');
        labelContainer.className = 'label-field-container';
        labelContainer.id = field.data_name;
        labelContainer.setAttribute('aria-labelledby', field.data_name + '_label');
        
        // Create the label text element with proper newline handling
        const labelText = document.createElement('div');
        labelText.className = 'label-field-text';
        
        // Handle newlines in the label text
        if (field.label) {
          labelText.textContent = field.label;
        }
        
        labelContainer.appendChild(labelText);
        input = labelContainer;
        break;

      case 'SignatureField': {
        // Container for signature pad and controls
        const container = document.createElement('div');
        container.className = 'signature-field-container';

        let errorMsg = null; // <-- Declare before any function uses it

        // Agreement text (plain text) - now above the canvas
        if (field.agreement_text) {
          const agreement = document.createElement('div');
          agreement.className = 'signature-agreement-text';
          agreement.textContent = field.agreement_text;
          agreement.style.marginBottom = '8px';
          container.appendChild(agreement);
        }

        // Canvas for drawing
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 150;
        canvas.style.display = 'block';
        canvas.tabIndex = 0;
        container.appendChild(canvas);

        // Hidden input to store the data URL
        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.name = field.data_name;
        hiddenInput.id = field.data_name + '_hidden';
        container.appendChild(hiddenInput);

        // Clear button
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = 'Clear';
        clearBtn.className = 'signature-clear-btn';
        clearBtn.style.marginTop = '8px';
        container.appendChild(clearBtn);

        // Drawing logic (vanilla JS, modular for future swap)
        let drawing = false;
        let lastX = 0, lastY = 0;
        const ctx = canvas.getContext('2d');
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#222';

        function getPos(e) {
          if (e.touches && e.touches.length > 0) {
            const rect = canvas.getBoundingClientRect();
            return {
              x: e.touches[0].clientX - rect.left,
              y: e.touches[0].clientY - rect.top
            };
          } else {
            const rect = canvas.getBoundingClientRect();
            return {
              x: e.clientX - rect.left,
              y: e.clientY - rect.top
            };
          }
        }

        function startDraw(e) {
          drawing = true;
          const pos = getPos(e);
          lastX = pos.x;
          lastY = pos.y;
        }
        function draw(e) {
          if (!drawing) return;
          e.preventDefault();
          const pos = getPos(e);
          ctx.beginPath();
          ctx.moveTo(lastX, lastY);
          ctx.lineTo(pos.x, pos.y);
          ctx.stroke();
          lastX = pos.x;
          lastY = pos.y;
          updateHiddenInput();
        }
        function endDraw() {
          drawing = false;
          updateHiddenInput();
        }
        function clearCanvas() {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          updateHiddenInput();
        }
        function updateHiddenInput() {
          // Only set value if something is drawn
          const blank = document.createElement('canvas');
          blank.width = canvas.width;
          blank.height = canvas.height;
          if (canvas.toDataURL() !== blank.toDataURL()) {
            hiddenInput.value = canvas.toDataURL('image/png');
          } else {
            hiddenInput.value = '';
          }
          // Update form state using FormStateManager, so errors are cleared/updated
          if (window.formStateManager) {
            window.formStateManager.setFieldValue(field.data_name, hiddenInput.value, true); // suppress logging
            window.formStateManager.updateFormState();
          }
          // Fire a native input event to trigger validation and error clearing
          const event = new Event('input', { bubbles: true });
          hiddenInput.dispatchEvent(event);
        }
        // Mouse events
        canvas.addEventListener('mousedown', startDraw);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', endDraw);
        canvas.addEventListener('mouseleave', endDraw);
        // Touch events
        canvas.addEventListener('touchstart', startDraw);
        canvas.addEventListener('touchmove', draw);
        canvas.addEventListener('touchend', endDraw);
        // Clear button
        clearBtn.addEventListener('click', clearCanvas);
        // Keyboard accessibility: clear on Enter/Space when focused
        clearBtn.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            clearCanvas();
          }
        });
        // Initial blank value
        updateHiddenInput();

        // Remove custom error logic for SignatureField

        input = container;
        break;
      }

      case 'PhotoField': {
        const container = document.createElement('div');
        container.className = 'photo-field-container';

        let selectedPhotos = [];

        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.name = field.data_name;
        container.appendChild(hiddenInput);

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.multiple = true;
        if (field.read_only) fileInput.disabled = true;
        container.appendChild(fileInput);

        const preview = document.createElement('div');
        preview.className = 'file-preview-container';
        container.appendChild(preview);

        function renderPhotos() {
          preview.innerHTML = '';
          selectedPhotos.forEach((photo, idx) => {
            const photoContainer = document.createElement('div');
            photoContainer.className = 'file-preview-item';
            
            const img = document.createElement('img');
            img.className = 'photo-field-thumb';
            img.alt = photo.name;
            img.src = photo.url;
            photoContainer.appendChild(img);

            if (!field.read_only) {
              const removeBtn = document.createElement('button');
              removeBtn.type = 'button';
              removeBtn.className = 'file-remove-btn';
              removeBtn.textContent = '×';
              removeBtn.title = 'Remove photo';
              removeBtn.onclick = () => {
                selectedPhotos.splice(idx, 1);
                renderPhotos();
              };
              photoContainer.appendChild(removeBtn);
            }
            
            preview.appendChild(photoContainer);
          });

          hiddenInput.value = JSON.stringify(selectedPhotos.map(({ name, url }) => ({ name, url })));
          hiddenInput.dispatchEvent(new CustomEvent('photofield-change', { bubbles: true }));
        }

        fileInput.addEventListener('change', function() {
          if (fileInput.files && fileInput.files.length > 0) {
            Array.from(fileInput.files).forEach(file => {
              if (!selectedPhotos.some(p => p.name === file.name)) {
                const url = URL.createObjectURL(file);
                selectedPhotos.push({ name: file.name, url, file });
              }
            });
            renderPhotos();
          }
          fileInput.value = '';
        });

        if (field.min_length || field.max_length) {
          const info = document.createElement('div');
          info.className = 'photo-field-info';
          let msg = '';
          if (field.min_length) msg += `Min: ${field.min_length} photo(s). `;
          if (field.max_length) msg += `Max: ${field.max_length} photo(s).`;
          info.textContent = msg.trim();
          container.appendChild(info);
        }

        input = container;
        break;
      }

      case 'VideoField': {
        const container = document.createElement('div');
        container.className = 'video-field-container';

        let selectedVideos = [];

        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.name = field.data_name;
        container.appendChild(hiddenInput);

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'video/*';
        fileInput.multiple = true;
        if (field.read_only) fileInput.disabled = true;
        container.appendChild(fileInput);

        const preview = document.createElement('div');
        preview.className = 'file-preview-container';
        container.appendChild(preview);

        // Helper to render preview and update hidden input
        function renderVideos() {
          preview.innerHTML = '';
          selectedVideos.forEach((video, idx) => {
            const videoContainer = document.createElement('div');
            videoContainer.className = 'file-preview-item';

            const thumb = document.createElement('div');
            thumb.className = 'video-field-thumb';
            thumb.textContent = `${video.name} (${formatDuration(video.duration)})`;
            videoContainer.appendChild(thumb);

            if (!field.read_only) {
              const removeBtn = document.createElement('button');
              removeBtn.type = 'button';
              removeBtn.className = 'file-remove-btn';
              removeBtn.textContent = '×';
              removeBtn.title = 'Remove video';
              removeBtn.onclick = () => {
                selectedVideos.splice(idx, 1);
                renderVideos();
              };
              videoContainer.appendChild(removeBtn);
            }

            preview.appendChild(videoContainer);
          });
          // Update hidden input for validation (array of {name, duration} objects)
          hiddenInput.value = JSON.stringify(selectedVideos.map(({ name, duration }) => ({ name, duration })));
          // Dispatch custom event to trigger form state update
          hiddenInput.dispatchEvent(new CustomEvent('videofield-change', { bubbles: true }));
        }

        // Helper to get video duration
        function formatDuration(seconds) {
          if (isNaN(seconds) || seconds < 0) return '0 m 0 s';
          const minutes = Math.floor(seconds / 60);
          const remainingSeconds = Math.round(seconds % 60);
          return `${minutes} m ${remainingSeconds} s`;
        }

        function getVideoDuration(file) {
          return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.onloadedmetadata = function() {
              window.URL.revokeObjectURL(video.src);
              resolve(video.duration);
            };
            video.onerror = function(err) {
              reject(err);
            };
            video.src = URL.createObjectURL(file);
          });
        }

        // On file input change, add new files to array
        fileInput.addEventListener('change', async function() {
          if (fileInput.files && fileInput.files.length > 0) {
            for (const file of Array.from(fileInput.files)) {
              // Prevent duplicates by name
              if (!selectedVideos.some(v => v.name === file.name)) {
                try {
                  const duration = await getVideoDuration(file);
                  selectedVideos.push({ name: file.name, duration, file });
                } catch (err) {
                  console.error(`Could not get duration for ${file.name}`, err);
                }
              }
            }
            renderVideos();
          }
          // Always clear file input so user can add same file again
          fileInput.value = '';
        });

        // Optionally: show min/max info
        if (field.min_length || field.max_length) {
          const info = document.createElement('div');
          info.className = 'video-field-info';
          let msg = '';
          if (field.min_length) msg += `Min duration: ${field.min_length} min(s). `;
          if (field.max_length) msg += `Max duration: ${field.max_length} min(s).`;
          info.textContent = msg.trim();
          container.appendChild(info);
        }

        input = container;
        break;
      }

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
   * Get appropriate autocomplete value based on field name
   */
  getAutocompleteValue(dataName) {
    const autocompleteMap = {
      'email': 'email',
      'phone': 'tel',
      'name': 'name',
      'first_name': 'given-name',
      'last_name': 'family-name',
      'address': 'street-address',
      'city': 'address-level2',
      'state': 'address-level1',
      'zip': 'postal-code',
      'country': 'country',
      'company': 'organization',
      'job_title': 'organization-title',
      'url': 'url',
      'password': 'current-password',
      'username': 'username'
    };

    // Check for exact matches first
    if (autocompleteMap[dataName]) {
      return autocompleteMap[dataName];
    }

    // Check for partial matches
    for (const [key, value] of Object.entries(autocompleteMap)) {
      if (dataName.includes(key)) {
        return value;
      }
    }

    // Default to 'off' for fields without obvious semantic meaning
    return 'off';
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
