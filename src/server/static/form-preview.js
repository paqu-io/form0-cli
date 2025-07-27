import { FormRenderer } from './form-renderer.js';
import { resolveSupportingImagePath } from './supporting-image-utils.js';
import { FormStateManager } from './form-state-manager.js';
import { OperationProcessor } from './operation-processor.js';

// Submit functionality uses server-side API endpoint
// No need for browser-side imports since we use the real form0-core functions on the server

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

      // Check if schema has actually changed to prevent duplicate rendering
      const newSchema = data.schema;
      const schemaChanged = JSON.stringify(currentSchema) !== JSON.stringify(newSchema);
      
      if (schemaChanged) {
        // Preserve current form values before schema update
        formStateManager.preserveCurrentValues();

        currentSchema = newSchema;
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
      } else {
        console.log('Schema unchanged, skipping re-render');
      }
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

  // Add submit button event listener
  addSubmitButtonEventListener();

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

  const videoFieldHandler = (event) => {
    formStateManager.updateFormState();
    const fieldName = extractFieldNameFromChoiceEvent(event, 'video');
    if (fieldName) {
      triggerFormEvent('change', fieldName);
    }
  };
  
  // Add document event listeners and track them
  document.addEventListener('singlechoicefield-change', singleChoiceHandler);
  document.addEventListener('multichoicefield-change', multiChoiceHandler);
  document.addEventListener('booleanfield-change', booleanFieldHandler);
  document.addEventListener('photofield-change', photoFieldHandler);
  document.addEventListener('videofield-change', videoFieldHandler);
  
  documentEventListeners.push(
    { type: 'singlechoicefield-change', handler: singleChoiceHandler },
    { type: 'multichoicefield-change', handler: multiChoiceHandler },
    { type: 'booleanfield-change', handler: booleanFieldHandler },
    { type: 'photofield-change', handler: photoFieldHandler },
    { type: 'videofield-change', handler: videoFieldHandler }
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

/**
 * Add event listener to submit button
 */
function addSubmitButtonEventListener() {
  const submitBtn = document.getElementById('submit-btn');
  if (submitBtn) {
    // Remove existing event listener if any
    submitBtn.removeEventListener('click', handleFormSubmit);
    // Add new event listener
    submitBtn.addEventListener('click', handleFormSubmit);
  }
}

/**
 * Handle form submission
 */
async function handleFormSubmit() {
  console.log('🚀 [FORM SUBMIT] Starting form submission...');
  
  const submitBtn = document.getElementById('submit-btn');
  
  try {
    // Disable submit button during processing
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
    }

    // Hide any existing error messages
    hideGlobalError();

    // Update form state to ensure latest validation
    await formStateManager.updateFormState();

    // Get current form state via /api/engine endpoint
    const values = formStateManager.getCurrentFormValues();
    
    const response = await fetch('/api/engine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get form state: ${response.statusText}`);
    }

    const state = await response.json();

    // Check for validation errors
    const validationSummary = formStateManager.getFormValidationSummary();
    
    if (validationSummary.hasErrors) {
      const errorMessages = [];
      
      if (validationSummary.requiredFieldErrors.length > 0) {
        errorMessages.push('Required fields are missing:');
        validationSummary.requiredFieldErrors.forEach(error => {
          errorMessages.push(`• ${error.fieldName}: ${error.errorMessage}`);
        });
      }
      
      if (validationSummary.generalErrors.length > 0) {
        if (errorMessages.length > 0) errorMessages.push('');
        errorMessages.push('Validation errors:');
        validationSummary.generalErrors.forEach(error => {
          errorMessages.push(`• ${error.fieldName}: ${error.errorMessage}`);
        });
      }
      
      console.log('❌ [FORM SUBMIT] Submission blocked due to validation errors');
      showGlobalError(errorMessages.join('\n'));
      return;
    }

    // Create structured record using server-side API
    const recordResponse = await fetch('/api/create-record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });

    if (!recordResponse.ok) {
      throw new Error(`Failed to create structured record: ${recordResponse.statusText}`);
    }

    const recordResult = await recordResponse.json();
    const structuredRecord = recordResult.record;

    // Log structured record to console
    console.log('📋 [STRUCTURED RECORD] Generated structured JSON record:');
    //console.log(JSON.stringify(structuredRecord, null, 2));
    console.log(structuredRecord);

    // Show success message
    showGlobalSuccess('Form submitted successfully! Check console for structured record.');

  } catch (error) {
    console.error('❌ [FORM SUBMIT] Error during form submission:', error);
    console.log('❌ [FORM SUBMIT] Submission was not successful');
    showGlobalError(`Submission failed: ${error.message}`);
  } finally {
    // Re-enable submit button
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Form';
    }
  }
}

/**
 * Show global error message
 */
function showGlobalError(message) {
  const errorBanner = document.getElementById('global-error-banner');
  const errorMessage = document.getElementById('global-error-message');
  
  if (errorBanner && errorMessage) {
    errorMessage.textContent = message;
    errorBanner.classList.remove('hidden');
    
    // Scroll to error banner
    errorBanner.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/**
 * Hide global error message
 */
function hideGlobalError() {
  const errorBanner = document.getElementById('global-error-banner');
  if (errorBanner) {
    errorBanner.classList.add('hidden');
  }
}

/**
 * Show global success message
 */
function showGlobalSuccess(message) {
  // For now, we'll use the error banner with success styling
  // In the future, you might want to create a separate success banner
  const errorBanner = document.getElementById('global-error-banner');
  const errorMessage = document.getElementById('global-error-message');
  
  if (errorBanner && errorMessage) {
    errorMessage.textContent = message;
    errorBanner.style.background = '#d4edda';
    errorBanner.style.borderColor = '#c3e6cb';
    errorBanner.style.borderLeftColor = '#28a745';
    errorMessage.style.color = '#155724';
    errorBanner.classList.remove('hidden');
    
    // Auto-hide success message after 5 seconds
    setTimeout(() => {
      hideGlobalError();
      // Reset to error styling
      errorBanner.style.background = '#f8d7da';
      errorBanner.style.borderColor = '#f5c6cb';
      errorBanner.style.borderLeftColor = '#dc3545';
      errorMessage.style.color = '#721c24';
    }, 5000);
    
    // Scroll to success banner
    errorBanner.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
