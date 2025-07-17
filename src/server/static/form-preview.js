import { FormRenderer } from './form-renderer.js';
import { FormStateManager } from './form-state-manager.js';
import { OperationProcessor } from './operation-processor.js';

// Global variables for translations
let currentLocale = 'en';
let translations = {};

// Simple translation function for browser use
function t(key, params = {}) {
  let translation = translations[key] || key;
  // Replace parameters
  Object.keys(params).forEach((param) => {
    translation = translation.replace(`{${param}}`, params[param]);
  });
  return translation;
}

// Load translations from server
async function loadTranslations() {
  try {
    const response = await fetch('/api/locale');
    if (response.ok) {
      const data = await response.json();
      currentLocale = data.locale;
      translations = data.translations || {};
      console.log(`Loaded translations for locale: ${currentLocale}`);
    } else {
      console.warn('Failed to load translations, using fallback');
      // Fallback translations
      translations = {
        failedToLoadSchema: '❌ Failed to load schema',
        errorLoadingSchema: '❌ Error loading schema',
        connectedWatching: '✅ Connected - watching for changes',
        disconnectedFromServer: '❌ Disconnected from server',
        websocketConnectionError: '❌ WebSocket connection error',
        schemaUpdated: '✅ Schema updated: {timestamp}',
        websocketConnected: '🔗 WebSocket connected',
        receivedSchemaUpdate: '📡 Received schema update from server',
        websocketDisconnected: '🔌 WebSocket disconnected',
        websocketError: '❌ WebSocket error',
      };
    }
  } catch (err) {
    console.error('Error loading translations:', err);
    // Use fallback translations
    translations = {
      failedToLoadSchema: '❌ Failed to load schema',
      errorLoadingSchema: '❌ Error loading schema',
      connectedWatching: '✅ Connected - watching for changes',
      disconnectedFromServer: '❌ Disconnected from server',
      websocketConnectionError: '❌ WebSocket connection error',
      schemaUpdated: '✅ Schema updated: {timestamp}',
      websocketConnected: '🔗 WebSocket connected',
      receivedSchemaUpdate: '📡 Received schema update from server',
      websocketDisconnected: '🔌 WebSocket disconnected',
      websocketError: '❌ WebSocket error',
    };
  }
}

// WebSocket connection for live reload
let ws = null;
let currentSchema = null;
let schemaSource = 'Current Schema'; // Will be updated by server

// Initialize modular components
const formRenderer = new FormRenderer();
const formStateManager = new FormStateManager(formRenderer);
const operationProcessor = new OperationProcessor(formStateManager);

/**
 * Trigger a form event
 */
async function triggerFormEvent(eventType, fieldKey = null) {
  try {
    const values = formStateManager.getCurrentFormValues();
    
    const response = await fetch('/api/engine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values, eventType, fieldKey }),
    });
    
    if (!response.ok) {
      console.warn('Failed to trigger form event:', response.statusText);
      return;
    }
    
    const result = await response.json();
    
    // Apply state updates (non-blocking - if this fails, continue anyway)
    try {
      formStateManager.applyFormState(result);
    } catch (err) {
      console.warn('Failed to apply state after event:', err);
    }
    
    // Process event operations using the operation processor
    if (result.operations && result.operations.length > 0) {
      const eventDesc = fieldKey ? `${eventType}:${fieldKey}` : eventType;
      console.log(`🔴 [FORM EVENT] ${eventDesc} → Processing ${result.operations.length} operations`);
      
      // Process operations through the operation processor
      await operationProcessor.processOperations(result.operations);
    }
  } catch (err) {
    // Don't block form functionality if events fail
    console.warn('Form event error (non-blocking):', err);
  }
}

// Initialize WebSocket connection
function initializeWebSocket() {
  const wsHost = window.location.hostname;
  const wsPort = window.location.port;
  ws = new WebSocket(`ws://${wsHost}:${wsPort}`);

  ws.onopen = () => {
    console.log(t('websocketConnected'));
    document.getElementById('status').textContent = t('connectedWatching');
  };

  ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'schema-update') {
      console.log(t('receivedSchemaUpdate'));

      // Preserve current form values before schema update
      formStateManager.preserveCurrentValues();

      currentSchema = data.schema;
      schemaSource = data.source || 'Current Schema'; // Get schema source from server
      await renderForm();

      // Format timestamp as yyyy-mm-dd hh:mm:ss
      const now = new Date();
      const timestamp =
        now.getFullYear() +
        '-' +
        String(now.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(now.getDate()).padStart(2, '0') +
        ' ' +
        String(now.getHours()).padStart(2, '0') +
        ':' +
        String(now.getMinutes()).padStart(2, '0') +
        ':' +
        String(now.getSeconds()).padStart(2, '0');

      document.getElementById('status').textContent = t('schemaUpdated', { timestamp });
    }
  };

  ws.onclose = () => {
    console.log(t('websocketDisconnected'));
    document.getElementById('status').textContent = t('disconnectedFromServer');
  };

  ws.onerror = (error) => {
    console.error(t('websocketError'), error);
    document.getElementById('status').textContent = t('websocketConnectionError');
  };
}

// Load initial schema on page load
async function loadInitialSchema() {
  try {
    const response = await fetch('/api/schema');
    if (response.ok) {
      const data = await response.json();
      currentSchema = data.schema;
      schemaSource = data.source || 'Current Schema';
      await renderForm();
    } else {
      document.getElementById('status').textContent = t('failedToLoadSchema');
      console.error('Failed to load schema:', response.statusText);
    }
  } catch (err) {
    document.getElementById('status').textContent = t('errorLoadingSchema');
    console.error('Error loading schema:', err);
  }
}

// Initialize application
async function initialize() {
  // Load translations first
  await loadTranslations();

  // Then load schema
  await loadInitialSchema();

  // Initialize WebSocket connection
  initializeWebSocket();
}

// Load everything when page loads
document.addEventListener('DOMContentLoaded', initialize);

async function renderForm() {
  if (!currentSchema) return;

  // Set schema in renderer and render form
  formRenderer.setSchema(currentSchema);
  formRenderer.renderForm();

  // Update schema path in header with schema source
  document.getElementById('schema-path').textContent = schemaSource;

  // Add event listeners to form inputs
  addFormEventListeners();

  // Initialize form with default values from schema
  await initializeDefaultValues();

  // Restore preserved values AFTER form is fully rendered
  formStateManager.restorePreservedValues();

  // Trigger load-record event BEFORE initial engine evaluation
  triggerFormEvent('load-record');

  // Initial engine evaluation (this will also recalculate any calculated fields)
  formStateManager.updateFormState();
}

/**
 * Initialize form fields with default values from schema
 */
async function initializeDefaultValues() {
  if (!currentSchema || !currentSchema.form || !currentSchema.form.elements) return;

  try {
    const response = await fetch('/api/default-values');
    if (response.ok) {
      const data = await response.json();
      const defaultValues = data.defaultValues || {};

      // Apply default values to form inputs (suppress logging during initialization)
      Object.entries(defaultValues).forEach(([fieldName, defaultValue]) => {
        if (defaultValue !== null && defaultValue !== undefined) {
          const field = formRenderer.findFieldByDataName(fieldName);
          if (field) {
            formStateManager.setFieldValue(fieldName, defaultValue, true); // suppressLogging = true
          }
        }
      });
    } else {
      console.warn('Failed to load default values, using fallback');
      // Fallback default values
      const defaultValues = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        age: 30,
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      Object.entries(defaultValues).forEach(([fieldName, defaultValue]) => {
        if (defaultValue !== null && defaultValue !== undefined) {
          const field = formRenderer.findFieldByDataName(fieldName);
          if (field) {
            formStateManager.setFieldValue(fieldName, defaultValue, true); // suppressLogging = true
          }
        }
      });
    }
  } catch (err) {
    console.error('Error loading default values:', err);
    // Fallback default values
    const defaultValues = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@example.com',
      age: 30,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    Object.entries(defaultValues).forEach(([fieldName, defaultValue]) => {
      if (defaultValue !== null && defaultValue !== undefined) {
        const field = formRenderer.findFieldByDataName(fieldName);
        if (field) {
          formStateManager.setFieldValue(fieldName, defaultValue, true); // suppressLogging = true
        }
      }
    });
  }
}

// Keep track of document event listeners so we can remove them
let documentEventListeners = [];

function addFormEventListeners() {
  // Remove old document event listeners first
  documentEventListeners.forEach(({ type, handler }) => {
    document.removeEventListener(type, handler);
  });
  documentEventListeners = [];
  
  // Add event listeners to all form inputs, but exclude choice fields (they have custom handlers)
  const inputs = document.querySelectorAll('#main-form input, #main-form select');
  inputs.forEach((input) => {
    // Skip all choice field elements - they use custom event handlers
    if (input.closest('[class*="choice-field"]')) {
      return;
    }
    
    input.addEventListener('input', () => {
      formStateManager.updateFormState();
      // Trigger change event for this specific field
      if (input.name) {
        triggerFormEvent('change', input.name);
      }
    });
    
    input.addEventListener('change', () => {
      formStateManager.updateFormState();
      // Note: We don't trigger form events on 'change' (blur) to avoid duplicates
      // and to prepare for potential future blur/focus event handling
    });
  });
  
  // Create handlers and keep track of them
  const singleChoiceHandler = (event) => {
    formStateManager.updateFormState();
    const fieldName = extractFieldNameFromChoiceEvent(event, 'single');
    if (fieldName) {
      triggerFormEvent('change', fieldName);
    }
  };
  
  const multiChoiceHandler = (event) => {
    formStateManager.updateFormState();
    const fieldName = extractFieldNameFromChoiceEvent(event, 'multi');
    if (fieldName) {
      triggerFormEvent('change', fieldName);
    }
  };

  const booleanFieldHandler = (event) => {
    formStateManager.updateFormState();
    const fieldName = extractFieldNameFromChoiceEvent(event, 'boolean');
    if (fieldName) {
      triggerFormEvent('change', fieldName);
    }
  };

  const photoFieldHandler = (event) => {
    formStateManager.updateFormState();
    const fieldName = extractFieldNameFromChoiceEvent(event, 'photo');
    if (fieldName) {
      triggerFormEvent('change', fieldName);
    }
  };
  
  // Add document event listeners and track them
  document.addEventListener('singlechoicefield-change', singleChoiceHandler);
  document.addEventListener('multichoicefield-change', multiChoiceHandler);
  document.addEventListener('booleanfield-change', booleanFieldHandler);
  document.addEventListener('photofield-change', photoFieldHandler);
  
  documentEventListeners.push(
    { type: 'singlechoicefield-change', handler: singleChoiceHandler },
    { type: 'multichoicefield-change', handler: multiChoiceHandler },
    { type: 'booleanfield-change', handler: booleanFieldHandler },
    { type: 'photofield-change', handler: photoFieldHandler }
  );
}

/**
 * Extract field name from choice field custom events
 */
function extractFieldNameFromChoiceEvent(event, fieldType) {
  // Try to get field name from event target's closest field container
  try {
    const target = event.target;
    if (target) {
      // Look for the field container that has data-name attribute
      const fieldContainer = target.closest('[data-name]');
      if (fieldContainer) {
        return fieldContainer.getAttribute('data-name');
      }
    }
  } catch (err) {
    console.warn('Could not extract field name from choice event:', err);
  }
  return null;
}
