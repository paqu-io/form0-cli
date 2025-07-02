// WebSocket connection for live reload
const wsHost = window.location.hostname;
const wsPort = window.location.port;
const ws = new WebSocket(`ws://${wsHost}:${wsPort}`);
let currentSchema = null;
let preservedValues = {}; // Store values to preserve across schema updates
let schemaSource = 'Current Schema'; // Will be updated by server

ws.onopen = () => {
    console.log('🔗 WebSocket connected');
    document.getElementById('status').textContent = '✅ Connected - watching for changes';
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'schema-update') {
        console.log('📡 Received schema update from server');
        
        // Preserve current form values before schema update
        preserveCurrentValues();
        
        currentSchema = data.schema;
        schemaSource = data.source || 'Current Schema'; // Get schema source from server
        renderForm();
        
        // Format timestamp as yyyy-mm-dd hh:mm:ss
        const now = new Date();
        const timestamp = now.getFullYear() + '-' + 
                         String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                         String(now.getDate()).padStart(2, '0') + ' ' +
                         String(now.getHours()).padStart(2, '0') + ':' + 
                         String(now.getMinutes()).padStart(2, '0') + ':' + 
                         String(now.getSeconds()).padStart(2, '0');
        
        document.getElementById('status').textContent = `✅ Schema updated: ${timestamp}`;
    }
};

ws.onclose = () => {
    console.log('🔌 WebSocket disconnected');
    document.getElementById('status').textContent = '❌ Disconnected from server';
};

ws.onerror = (error) => {
    console.error('❌ WebSocket error:', error);
    document.getElementById('status').textContent = '❌ WebSocket connection error';
};

function preserveCurrentValues() {
    const form = document.getElementById('main-form');
    if (!form) return;
    
    const formData = new FormData(form);
    preservedValues = {};
    
    for (const [key, value] of formData.entries()) {
        if (value !== '') {
            preservedValues[key] = value;
        }
    }
    
    if (Object.keys(preservedValues).length > 0) {
        console.log('💾 Preserved values:', preservedValues);
    }
}

function restorePreservedValues() {
    if (Object.keys(preservedValues).length === 0) return;
    
    let restoredCount = 0;
    Object.entries(preservedValues).forEach(([fieldName, value]) => {
        const input = document.querySelector(`input[name="${fieldName}"], select[name="${fieldName}"]`);
        if (input && !input.readOnly) {
            // Check if field type is compatible
            const field = findFieldByDataName(fieldName);
            if (field && isValueCompatible(field, value)) {
                input.value = value;
                restoredCount++;
            }
        }
    });
    
    if (restoredCount > 0) {
        console.log(`🔄 Restored ${restoredCount} field values`);
        // Clear preserved values after successful restoration
        preservedValues = {};
    }
}

function isValueCompatible(field, value) {
    switch (field.type) {
        case 'NumericField':
            return !isNaN(Number(value));
        case 'ChoiceField':
            return field.choices && field.choices.some(choice => choice.value === value);
        case 'TextField':
        default:
            return true;
    }
}

function renderForm() {
    if (!currentSchema) return;
    
    console.log('🔄 Rendering form:', currentSchema.form.name);
    
    const container = document.getElementById('form-container');
    container.innerHTML = '';
    
    const formTitle = document.createElement('h2');
    formTitle.textContent = currentSchema.form.name || 'Untitled Form';
    container.appendChild(formTitle);
    
    const form = document.createElement('form');
    form.id = 'main-form';
    
    renderElements(currentSchema.form.elements || [], form);
    container.appendChild(form);
    
    // Update schema path in header with schema source
    document.getElementById('schema-path').textContent = schemaSource;
    
    // Restore preserved values AFTER form is fully rendered
    restorePreservedValues();
    
    // Initial engine evaluation (this will also recalculate any calculated fields)
    updateFormState();
}

function countFields(elements) {
    let count = 0;
    elements.forEach(element => {
        if (element.type === 'Section') {
            count += countFields(element.elements || element.drilldown_elements || []);
        } else {
            count++;
        }
    });
    return count;
}

function renderElements(elements, container) {
    elements.forEach(element => {
        if (element.type === 'Section') {
            renderSection(element, container);
        } else {
            renderField(element, container);
        }
    });
}

function renderSection(section, container) {
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
    renderElements(elements, sectionDiv);
    
    container.appendChild(sectionDiv);
}

function renderField(field, container) {
    const fieldDiv = document.createElement('div');
    fieldDiv.className = 'field';
    fieldDiv.setAttribute('data-key', field.key);
    fieldDiv.setAttribute('data-name', field.data_name);
    
    const label = document.createElement('label');
    label.textContent = field.label || field.data_name;
    if (field.required) label.textContent += ' *';
    fieldDiv.appendChild(label);
    
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
            fieldDiv.classList.add('calculated');
            // Mark as read-only immediately
            fieldDiv.classList.add('readonly');
            break;
            
        default:
            input = document.createElement('input');
            input.type = 'text';
    }
    
    input.name = field.data_name;
    
    // Set read-only state based on schema
    if (field.read_only === true || field.type === 'CalculatedField') {
        input.readOnly = true;
        fieldDiv.classList.add('readonly');
    }
    
    input.addEventListener('input', updateFormState);
    input.addEventListener('change', updateFormState);
    
    fieldDiv.appendChild(input);
    container.appendChild(fieldDiv);
}

async function updateFormState() {
    if (!currentSchema) return;
    
    const formData = new FormData(document.getElementById('main-form'));
    const values = {};
    
    // Convert form values to appropriate types based on field definitions
    for (const [key, value] of formData.entries()) {
        const field = findFieldByDataName(key);
        if (field) {
            if (field.type === 'NumericField') {
                // Convert to number, handle empty strings
                values[key] = value === '' ? null : Number(value);
            } else {
                values[key] = value === '' ? null : value;
            }
        } else {
            values[key] = value === '' ? null : value;
        }
    }
    
    try {
        const response = await fetch('/api/engine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ values })
        });
        
        const state = await response.json();
        applyFormState(state);
        
    } catch (err) {
        console.error('Failed to update form state:', err);
    }
}

function findFieldByDataName(dataName) {
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
    
    return currentSchema ? searchElements(currentSchema.form.elements || []) : null;
}

function applyFormState(state) {
    // Apply visibility
    Object.entries(state.visible || {}).forEach(([fieldName, isVisible]) => {
        const element = document.querySelector(`[data-name="${fieldName}"]`);
        if (element) {
            element.classList.toggle('hidden', !isVisible);
        }
    });
    
    // Apply readonly
    Object.entries(state.read_only || {}).forEach(([fieldName, isReadOnly]) => {
        const input = document.querySelector(`input[name="${fieldName}"], select[name="${fieldName}"]`);
        if (input) {
            input.readOnly = isReadOnly;
            
            // Only add readonly class if it's not already a calculated field
            if (!input.parentElement.classList.contains('calculated')) {
                input.parentElement.classList.toggle('readonly', isReadOnly);
            }
        }
    });
    
    // Apply calculated values and other computed values
    Object.entries(state.values || {}).forEach(([fieldName, value]) => {
        const input = document.querySelector(`input[name="${fieldName}"]`);
        if (input) {
            // Convert boolean values to string for display
            const displayValue = value === null || value === undefined ? '' : String(value);
            
            // Get field definition to check if it's calculated
            const field = findFieldByDataName(fieldName);
            
            // Always update calculated fields and readonly fields
            if (input.readOnly || (field && field.type === 'CalculatedField')) {
                input.value = displayValue;
            }
            // For non-readonly fields, only update if the field is empty (to avoid overwriting user input)
            else if (!input.value || input.value === '') {
                input.value = displayValue;
            }
        }
    });
    
    // Apply errors
    document.querySelectorAll('.error-message').forEach(el => el.remove());
    document.querySelectorAll('.field.error').forEach(el => el.classList.remove('error'));
    
    Object.entries(state.errors || {}).forEach(([fieldName, errorMessage]) => {
        const fieldDiv = document.querySelector(`[data-name="${fieldName}"]`);
        if (fieldDiv && errorMessage) {
            fieldDiv.classList.add('error');
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            errorDiv.textContent = errorMessage;
            fieldDiv.appendChild(errorDiv);
        }
    });
    
    // Handle required field validation
    Object.entries(state.required || {}).forEach(([fieldName, isRequired]) => {
        const fieldDiv = document.querySelector(`[data-name="${fieldName}"]`);
        const input = document.querySelector(`input[name="${fieldName}"], select[name="${fieldName}"]`);
        if (fieldDiv && input && isRequired) {
            const value = input.value;
            if (!value || value.trim() === '') {
                // Only show required error if field is not already showing another error
                if (!fieldDiv.classList.contains('error')) {
                    fieldDiv.classList.add('error');
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'error-message';
                    errorDiv.textContent = 'This field is required';
                    fieldDiv.appendChild(errorDiv);
                }
            }
        }
    });
} 