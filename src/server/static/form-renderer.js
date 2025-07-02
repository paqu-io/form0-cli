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
    elements.forEach(element => {
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
    input.name = field.data_name;
    
    // Set read-only state based on schema
    if (field.read_only === true || field.type === 'CalculatedField') {
      input.readOnly = true;
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
        
      case 'ChoiceField':
        input = document.createElement('select');
        (field.choices || []).forEach(choice => {
          const option = document.createElement('option');
          option.value = choice.value;
          option.textContent = choice.label || choice.value;
          input.appendChild(option);
        });
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
    elements.forEach(element => {
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