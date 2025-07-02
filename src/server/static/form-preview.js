import { FormRenderer } from './form-renderer.js';
import { FormStateManager } from './form-state-manager.js';

// WebSocket connection for live reload
const wsHost = window.location.hostname;
const wsPort = window.location.port;
const ws = new WebSocket(`ws://${wsHost}:${wsPort}`);
let currentSchema = null;
let schemaSource = 'Current Schema'; // Will be updated by server

// Initialize modular components
const formRenderer = new FormRenderer();
const formStateManager = new FormStateManager(formRenderer);

// Load initial schema on page load
async function loadInitialSchema() {
    try {
        const response = await fetch('/api/schema');
        if (response.ok) {
            const data = await response.json();
            currentSchema = data.schema;
            schemaSource = data.source || 'Current Schema';
            renderForm();
        } else {
            document.getElementById('status').textContent = '❌ Failed to load schema';
            console.error('Failed to load schema:', response.statusText);
        }
    } catch (err) {
        document.getElementById('status').textContent = '❌ Error loading schema';
        console.error('Error loading schema:', err);
    }
}

// Load schema when page loads
document.addEventListener('DOMContentLoaded', loadInitialSchema);

ws.onopen = () => {
    console.log('🔗 WebSocket connected');
    document.getElementById('status').textContent = '✅ Connected - watching for changes';
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'schema-update') {
        console.log('📡 Received schema update from server');
        
        // Preserve current form values before schema update
        formStateManager.preserveCurrentValues();
        
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



function renderForm() {
    if (!currentSchema) return;
    
    // Set schema in renderer and render form
    formRenderer.setSchema(currentSchema);
    formRenderer.renderForm();
    
    // Update schema path in header with schema source
    document.getElementById('schema-path').textContent = schemaSource;
    
    // Add event listeners to form inputs
    addFormEventListeners();
    
    // Restore preserved values AFTER form is fully rendered
    formStateManager.restorePreservedValues();
    
    // Initial engine evaluation (this will also recalculate any calculated fields)
    formStateManager.updateFormState();
}

function addFormEventListeners() {
    // Add event listeners to all form inputs
    const inputs = document.querySelectorAll('#main-form input, #main-form select');
    inputs.forEach(input => {
        input.addEventListener('input', () => formStateManager.updateFormState());
        input.addEventListener('change', () => formStateManager.updateFormState());
    });
}

 