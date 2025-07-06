import { FormRenderer } from './form-renderer.js';
import { FormStateManager } from './form-state-manager.js';

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

// Initialize WebSocket connection
function initializeWebSocket() {
  const wsHost = window.location.hostname;
  const wsPort = window.location.port;
  ws = new WebSocket(`ws://${wsHost}:${wsPort}`);

  ws.onopen = () => {
    console.log(t('websocketConnected'));
    document.getElementById('status').textContent = t('connectedWatching');
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'schema-update') {
      console.log(t('receivedSchemaUpdate'));

      // Preserve current form values before schema update
      formStateManager.preserveCurrentValues();

      currentSchema = data.schema;
      schemaSource = data.source || 'Current Schema'; // Get schema source from server
      renderForm();

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
      renderForm();
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
  // Add event listeners to all form inputs, but exclude SingleChoiceField internal elements
  const inputs = document.querySelectorAll('#main-form input, #main-form select');
  inputs.forEach((input) => {
    // Skip SingleChoiceField and MultiChoiceField internal elements
    if (input.name.endsWith('_choice') || input.name.endsWith('_other') || 
        input.name.endsWith('_choices') ||
        input.classList.contains('single-choice-field-simple-select') ||
        input.classList.contains('multi-choice-field-select') ||
        input.classList.contains('multi-choice-field-simple-select')) {
      return;
    }
    
    input.addEventListener('input', () => formStateManager.updateFormState());
    input.addEventListener('change', () => formStateManager.updateFormState());
  });
  
  // Listen for SingleChoiceField custom events
  document.addEventListener('singlechoicefield-change', () => {
    formStateManager.updateFormState();
  });
  
  // Listen for MultiChoiceField custom events
  document.addEventListener('multichoicefield-change', () => {
    formStateManager.updateFormState();
  });
}
