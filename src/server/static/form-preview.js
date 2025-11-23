import { FormRenderer } from './form-renderer.js';
import { resolveSupportingImagePath } from './supporting-image-utils.js';
import { FormStateManager } from './form-state-manager.js';
import { OperationProcessor } from './operation-processor.js';

// Submit functionality uses server-side API endpoint
// No need for browser-side imports since we use the real form0-core functions on the server

// Global variables for translations
let currentLocale = 'en';
let translations = {};

// Session-based warning deduplication (better than server-side throttling)
const shownWarnings = new Set();

function markInstanceUpdatedFromTarget(target) {
  if (!target || typeof target.closest !== 'function') return;
  const instanceNode = target.closest('[data-repeatable-context]');
  if (!instanceNode) return;
  const contextKey = instanceNode.getAttribute('data-repeatable-context');
  if (!contextKey) return;
  if (typeof formRenderer.markInstanceUpdated === 'function') {
    formRenderer.markInstanceUpdated(contextKey);
  }
}

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
let currentStatusValue = null; // Selected status for metadata panel (not part of engine state)
let createdAtTimestamp = null; // Simple client-side timestamps for preview
let currentBuildingPlanMeta = [];

const FIELD_KEY_MODE_STORAGE_KEY = 'form0-cli-field-key-mode';
const LABEL_VISIBILITY_STORAGE_KEY = 'form0-cli-label-visibility';
const DEFAULT_LABEL_VISIBILITY = {
  rooms: true,
  walls: true,
  doors: true,
  windows: true,
  columns: true,
  beams: true,
};

let currentFieldKeyMode = 'prefer-key';
let pendingFieldKeyMode = 'prefer-key';

let currentLabelVisibility = { ...DEFAULT_LABEL_VISIBILITY };
let pendingLabelVisibility = { ...DEFAULT_LABEL_VISIBILITY };

let settingsPreviouslyFocused = null;
let settingsLabelCheckboxes = {};
let lastSubmissionTimestamp = null;

function loadFieldKeyModePreference() {
  try {
    const stored = window.localStorage.getItem(FIELD_KEY_MODE_STORAGE_KEY);
    if (stored === 'data-name') {
      currentFieldKeyMode = 'data-name';
      pendingFieldKeyMode = 'data-name';
    }
  } catch (err) {
    // Ignore storage errors (e.g., private browsing)
  }
  pendingFieldKeyMode = currentFieldKeyMode;
}

function persistFieldKeyModePreference(mode) {
  try {
    window.localStorage.setItem(FIELD_KEY_MODE_STORAGE_KEY, mode);
  } catch (err) {
    // Ignore storage errors (e.g., private browsing)
  }
}

function loadLabelVisibilityPreference() {
  try {
    const stored = window.localStorage.getItem(LABEL_VISIBILITY_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === 'object') {
        currentLabelVisibility = { ...DEFAULT_LABEL_VISIBILITY, ...parsed };
      }
    }
  } catch (err) {
    currentLabelVisibility = { ...DEFAULT_LABEL_VISIBILITY };
  }
  pendingLabelVisibility = { ...currentLabelVisibility };
  Object.entries(settingsLabelCheckboxes).forEach(([key, checkbox]) => {
    if (checkbox) {
      checkbox.checked = pendingLabelVisibility[key] !== false;
    }
  });
  if (typeof formRenderer?.setLabelVisibilitySettings === 'function') {
    formRenderer.setLabelVisibilitySettings(currentLabelVisibility);
  }
}

function persistLabelVisibilityPreference(visibility) {
  try {
    window.localStorage.setItem(
      LABEL_VISIBILITY_STORAGE_KEY,
      JSON.stringify(visibility)
    );
  } catch (err) {
    // Ignore storage errors
  }
}

const SETTINGS_DIALOG_ID = 'form-settings-dialog';
let settingsDialog = null;
let settingsKeyModeSelect = null;

function ensureSettingsDialog() {
  if (settingsDialog) {
    if (settingsKeyModeSelect) {
      settingsKeyModeSelect.value = pendingFieldKeyMode;
    }
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = SETTINGS_DIALOG_ID;
  overlay.className = 'settings-modal-overlay hidden';

  const modal = document.createElement('div');
  modal.className = 'settings-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'form-settings-title');

  const header = document.createElement('div');
  header.className = 'settings-modal-header';
  header.id = 'form-settings-title';
  header.textContent = 'Form Settings';

  const body = document.createElement('div');
  body.className = 'settings-modal-body';

  const keyModeLabel = document.createElement('label');
  keyModeLabel.setAttribute('for', 'settings-output-keys');
  keyModeLabel.textContent = 'Structured Output Keys';

  settingsKeyModeSelect = document.createElement('select');
  settingsKeyModeSelect.id = 'settings-output-keys';
  settingsKeyModeSelect.className = 'settings-select';

  const keyOption = document.createElement('option');
  keyOption.value = 'prefer-key';
  keyOption.textContent = 'Field keys (default)';
  const dataOption = document.createElement('option');
  dataOption.value = 'data-name';
  dataOption.textContent = 'Data names';

  settingsKeyModeSelect.appendChild(keyOption);
  settingsKeyModeSelect.appendChild(dataOption);
  settingsKeyModeSelect.value = pendingFieldKeyMode;
  settingsKeyModeSelect.addEventListener('change', handleSettingsKeyModeChange);

  body.appendChild(keyModeLabel);
  body.appendChild(settingsKeyModeSelect);

  const labelGroup = document.createElement('div');
  labelGroup.className = 'settings-group';

  const labelGroupTitle = document.createElement('div');
  labelGroupTitle.className = 'settings-group-title';
  labelGroupTitle.textContent = 'Building Plan Labels';
  labelGroup.appendChild(labelGroupTitle);

  const labelDescription = document.createElement('div');
  labelDescription.className = 'settings-group-description';
  labelDescription.textContent = 'Toggle helper badges for each element type.';
  labelGroup.appendChild(labelDescription);

  const labelList = document.createElement('div');
  labelList.className = 'settings-checkbox-list';

  const labelOptions = [
    { key: 'rooms', label: 'Rooms' },
    { key: 'walls', label: 'Walls' },
    { key: 'doors', label: 'Doors' },
    { key: 'windows', label: 'Windows' },
    { key: 'columns', label: 'Columns' },
    { key: 'beams', label: 'Beams' },
  ];

  settingsLabelCheckboxes = {};

  labelOptions.forEach(({ key, label }) => {
    const checkboxId = `settings-label-${key}`;
    const wrapper = document.createElement('label');
    wrapper.className = 'settings-checkbox-item';
    wrapper.setAttribute('for', checkboxId);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = checkboxId;
    checkbox.checked = pendingLabelVisibility[key] !== false;
    checkbox.addEventListener('change', (event) => {
      pendingLabelVisibility[key] = event.target.checked;
    });

    const span = document.createElement('span');
    span.textContent = label;

    wrapper.appendChild(checkbox);
    wrapper.appendChild(span);
    labelList.appendChild(wrapper);

    settingsLabelCheckboxes[key] = checkbox;
  });

  labelGroup.appendChild(labelList);
  body.appendChild(labelGroup);

  const footer = document.createElement('div');
  footer.className = 'settings-modal-footer';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'primary-button';
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', saveSettingsDialog);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'secondary-button';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', closeSettingsDialog);

  footer.appendChild(saveButton);
  footer.appendChild(closeButton);

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(footer);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  modal.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeSettingsDialog();
    }
  });

  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeSettingsDialog();
    }
  });

  settingsDialog = overlay;
}

function openSettingsDialog() {
  ensureSettingsDialog();
  if (!settingsDialog) return;
  pendingFieldKeyMode = currentFieldKeyMode;
  if (settingsKeyModeSelect) {
    settingsKeyModeSelect.value = pendingFieldKeyMode;
  }
  Object.entries(settingsLabelCheckboxes).forEach(([key, checkbox]) => {
    if (checkbox) {
      checkbox.checked = pendingLabelVisibility[key] !== false;
    }
  });
  settingsPreviouslyFocused =
    document.activeElement && typeof document.activeElement.focus === 'function'
      ? document.activeElement
      : null;
  settingsDialog.classList.remove('hidden');
  document.addEventListener('keydown', handleSettingsKeyDown);
  if (settingsKeyModeSelect) {
    settingsKeyModeSelect.focus();
  }
}

function closeSettingsDialog() {
  if (!settingsDialog) return;
  settingsDialog.classList.add('hidden');
  document.removeEventListener('keydown', handleSettingsKeyDown);
  pendingFieldKeyMode = currentFieldKeyMode;
  if (settingsKeyModeSelect) {
    settingsKeyModeSelect.value = currentFieldKeyMode;
  }
  pendingLabelVisibility = { ...currentLabelVisibility };
  Object.entries(settingsLabelCheckboxes).forEach(([key, checkbox]) => {
    if (checkbox) {
      checkbox.checked = pendingLabelVisibility[key] !== false;
    }
  });
  if (settingsPreviouslyFocused) {
    settingsPreviouslyFocused.focus();
  }
  settingsPreviouslyFocused = null;
}

function handleSettingsKeyModeChange(event) {
  const selected = event.target.value === 'data-name' ? 'data-name' : 'prefer-key';
  pendingFieldKeyMode = selected;
}

function handleSettingsKeyDown(event) {
  if (event.key === 'Escape') {
    closeSettingsDialog();
  }
}

function saveSettingsDialog() {
  currentFieldKeyMode = pendingFieldKeyMode;
  persistFieldKeyModePreference(currentFieldKeyMode);

  Object.entries(settingsLabelCheckboxes).forEach(([key, checkbox]) => {
    if (checkbox) {
      pendingLabelVisibility[key] = checkbox.checked;
    }
  });
  currentLabelVisibility = { ...pendingLabelVisibility };
  persistLabelVisibilityPreference(currentLabelVisibility);
  if (typeof formRenderer.setLabelVisibilitySettings === 'function') {
    formRenderer.setLabelVisibilitySettings(currentLabelVisibility);
  }

  closeSettingsDialog();
}


// Initialize modular components
const formRenderer = new FormRenderer();
const formStateManager = new FormStateManager(formRenderer);
formRenderer.setStateManager(formStateManager);
const operationProcessor = new OperationProcessor(formStateManager);

loadLabelVisibilityPreference();

/**
 * Trigger a form event
 */
async function triggerFormEvent(eventType, fieldKey = null) {
  try {
    const { values, repeatable } = formStateManager.getCurrentFormState();

    const response = await fetch('/api/engine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values, repeatable, eventType, fieldKey }),
    });

    if (!response.ok) {
      console.warn('Failed to trigger form event:', response.statusText);
      return;
    }

    const result = await response.json();

    // Display warnings in browser console with session-based deduplication
    if (result.warnings && result.warnings.length > 0) {
      result.warnings.forEach((warning) => {
        // Create a unique key for this warning (more stable than server-side approach)
        const warningKey = `${warning.message}:${warning.context?.fieldName || ''}`;

        // Only show each unique warning once per browser session
        if (!shownWarnings.has(warningKey)) {
          console.warn(`[form0] ${warning.message}`);
          if (warning.context) {
            const contextInfo = formatExecutionContext(warning.context);
            console.warn(`[form0] Context: ${contextInfo}`);
          }
          if (warning.suggestion) {
            console.info(`[form0] Suggestion: ${warning.suggestion}`);
          }
          if (warning.fieldContext) {
            console.info('[form0] Field context:', warning.fieldContext);
          }

          // Mark this warning as shown for this session
          shownWarnings.add(warningKey);
        }
      });
    }

    // Apply state updates (non-blocking - if this fails, continue anyway)
    try {
      formStateManager.applyFormState(result);
    } catch (err) {
      console.warn('Failed to apply state after event:', err);
    }

    // Process event operations using the operation processor
    if (result.operations && result.operations.length > 0) {
      const eventDesc = fieldKey ? `${eventType}:${fieldKey}` : eventType;
      console.log(
        `🔴 [FORM EVENT] ${eventDesc} → Processing ${result.operations.length} operations`
      );

      // Process operations through the operation processor
      // Note: Server-side validation already filtered invalid operations and generated warnings
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
        currentBuildingPlanMeta = data.buildingPlanMeta || [];
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
      currentBuildingPlanMeta = data.buildingPlanMeta || [];
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
  loadFieldKeyModePreference();
  loadLabelVisibilityPreference();
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
  formRenderer.setSchema(currentSchema, { buildingPlanMeta: currentBuildingPlanMeta });
  formRenderer.renderForm();

  // Update schema path in header with schema source
  document.getElementById('schema-path').textContent = schemaSource;

  // Add event listeners to form inputs
  addFormEventListeners();

  // Add submit button event listener
  addSubmitButtonEventListener();

  // Render header and metadata panel
  renderRecordHeaderAndMetadata();

  // Initialize form with default values from schema
  await initializeDefaultValues();

  // Restore preserved values AFTER form is fully rendered
  formStateManager.restorePreservedValues();

  // Trigger load-record event BEFORE initial engine evaluation
  triggerFormEvent('load-record');

  // Initial engine evaluation (this will also recalculate any calculated fields)
  formStateManager.updateFormState();
}
// ---- Metadata rendering helpers ----
function computeLiveTitle(stateValues) {
  const titleField = currentSchema?.form?.title_field;
  if (!titleField || !Array.isArray(titleField.elements)) return '';
  const parts = [];
  for (const ref of titleField.elements) {
    const field = formRenderer.findFieldByDataName(ref) || formRenderer.findFieldByKey(ref);
    if (!field) continue;
    const value = stateValues[field.data_name];
    if (value == null) continue;
    if (field.type === 'SingleChoiceField') {
      const labels = [];
      if (value.choice && Array.isArray(value.choice) && value.choice.length > 0) {
        const v = value.choice[0].value;
        const found = (field.choices || []).find((c) => c.value === v);
        labels.push(found?.label || value.choice[0].label || v);
      }
      if (value.other && Array.isArray(value.other)) {
        for (const o of value.other) {
          if (o && (o.label || o.value)) labels.push(o.label || o.value);
        }
      }
      const text = labels.filter(Boolean).join(', ');
      if (text) parts.push(text);
    } else if (field.type === 'MultiChoiceField') {
      const labels = [];
      if (value.choices && Array.isArray(value.choices)) {
        for (const c of value.choices) {
          const found = (field.choices || []).find((cc) => cc.value === c.value);
          labels.push(found?.label || c.label || c.value);
        }
      }
      if (value.other && Array.isArray(value.other)) {
        for (const o of value.other) {
          if (o && (o.label || o.value)) labels.push(o.label || o.value);
        }
      }
      const text = labels.filter(Boolean).join(', ');
      if (text) parts.push(text);
    } else if (field.type === 'BooleanField') {
      let label = '';
      if (value.choice && Array.isArray(value.choice) && value.choice.length > 0) {
        const v = value.choice[0].value;
        const found = (field.choices || []).find((c) => c.value === v);
        label = found?.label || value.choice[0].label || v;
      }
      if (label) parts.push(label);
    } else {
      const text = typeof value === 'object' ? null : String(value);
      if (text && text.trim() !== '') parts.push(text);
    }
  }
  return parts.join(', ');
}

function renderRecordHeaderAndMetadata() {
  const container = document.getElementById('form-container');
  if (!container) return;
  // Avoid duplicates on re-render
  if (document.getElementById('record-header')) {
    document.getElementById('record-header')?.remove();
  }
  if (document.getElementById('record-metadata-panel')) {
    document.getElementById('record-metadata-panel')?.remove();
  }

  const header = document.createElement('div');
  header.id = 'record-header';
  header.className = 'record-header';

  const headerLeft = document.createElement('div');
  headerLeft.className = 'record-header-left';

  const statusPill = document.createElement('span');
  statusPill.id = 'record-header-status-pill';
  statusPill.className = 'record-status-pill';

  const titleEl = document.createElement('div');
  titleEl.id = 'record-header-title';
  titleEl.className = 'record-header-title';
  titleEl.textContent = '';

  headerLeft.appendChild(statusPill);
  headerLeft.appendChild(titleEl);

  const headerActions = document.createElement('div');
  headerActions.className = 'record-header-actions';
  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'settings-button';
  settingsButton.setAttribute('aria-label', 'Open settings');
  settingsButton.title = 'Form settings';
  settingsButton.innerHTML = '&#9881;';
  settingsButton.addEventListener('click', openSettingsDialog);
  headerActions.appendChild(settingsButton);

  header.appendChild(headerLeft);
  header.appendChild(headerActions);

  const panel = document.createElement('div');
  panel.id = 'record-metadata-panel';
  panel.className = 'record-metadata-panel';
  const heading = document.createElement('div');
  heading.textContent = 'Record Metadata';
  heading.className = 'section-title';
  panel.appendChild(heading);

  // Title (styled like TextField)
  const titleFieldDiv = document.createElement('div');
  titleFieldDiv.className = 'field readonly';
  titleFieldDiv.setAttribute('data-name', '@title');
  const titleLabelRow = document.createElement('div');
  titleLabelRow.className = 'field-label-row';
  const titleLabel = document.createElement('label');
  titleLabel.id = 'record-metadata-title_label';
  titleLabel.textContent = 'Title';
  titleLabelRow.appendChild(titleLabel);
  titleFieldDiv.appendChild(titleLabelRow);
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.id = 'record-metadata-title';
  titleInput.readOnly = true; // TitleField is read_only
  titleFieldDiv.appendChild(titleInput);
  panel.appendChild(titleFieldDiv);

  // Status (styled like SingleChoiceField simple)
  const statusField = currentSchema?.form?.status_field;
  const statusFieldDiv = document.createElement('div');
  statusFieldDiv.className = 'field';
  statusFieldDiv.setAttribute('data-name', '@status');
  const statusLabelRow = document.createElement('div');
  statusLabelRow.className = 'field-label-row';
  const statusLabel = document.createElement('label');
  statusLabel.id = 'record-metadata-status_label';
  statusLabel.textContent = 'Status';
  statusLabelRow.appendChild(statusLabel);
  statusFieldDiv.appendChild(statusLabelRow);
  const statusContainer = document.createElement('div');
  statusContainer.className = 'single-choice-field-simple-container';
  statusContainer.setAttribute('aria-labelledby', 'record-metadata-status_label');
  const statusSelect = document.createElement('select');
  statusSelect.id = 'record-metadata-status';
  statusSelect.className = 'single-choice-field-simple-select';
  if (statusField && Array.isArray(statusField.choices)) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Select status...';
    statusSelect.appendChild(empty);
    statusField.choices.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.value;
      opt.textContent = c.label || c.value;
      statusSelect.appendChild(opt);
    });
    if (currentStatusValue == null) currentStatusValue = statusField.default_value || '';
    statusSelect.value = currentStatusValue || '';
  }
  statusContainer.appendChild(statusSelect);
  statusFieldDiv.appendChild(statusContainer);
  panel.appendChild(statusFieldDiv);

  // Created at (TextField-like, readonly)
  const createdFieldDiv = document.createElement('div');
  createdFieldDiv.className = 'field readonly';
  createdFieldDiv.setAttribute('data-name', '@created_at');
  const createdLabelRow = document.createElement('div');
  createdLabelRow.className = 'field-label-row';
  const createdLabel = document.createElement('label');
  createdLabel.id = 'record-metadata-created-at_label';
  createdLabel.textContent = 'created_at';
  createdLabelRow.appendChild(createdLabel);
  createdFieldDiv.appendChild(createdLabelRow);
  const createdInput = document.createElement('input');
  createdInput.type = 'text';
  createdInput.id = 'record-metadata-created-at';
  createdInput.readOnly = true;
  createdFieldDiv.appendChild(createdInput);
  panel.appendChild(createdFieldDiv);

  // Updated at (TextField-like, readonly)
  const updatedFieldDiv = document.createElement('div');
  updatedFieldDiv.className = 'field readonly';
  updatedFieldDiv.setAttribute('data-name', '@updated_at');
  const updatedLabelRow = document.createElement('div');
  updatedLabelRow.className = 'field-label-row';
  const updatedLabel = document.createElement('label');
  updatedLabel.id = 'record-metadata-updated-at_label';
  updatedLabel.textContent = 'updated_at';
  updatedLabelRow.appendChild(updatedLabel);
  updatedFieldDiv.appendChild(updatedLabelRow);
  const updatedInput = document.createElement('input');
  updatedInput.type = 'text';
  updatedInput.id = 'record-metadata-updated-at';
  updatedInput.readOnly = true;
  updatedFieldDiv.appendChild(updatedInput);
  panel.appendChild(updatedFieldDiv);

  // Insert header below the form title (h2), then panel below header
  const formTitleEl = container.querySelector('h2');
  if (formTitleEl) {
    formTitleEl.insertAdjacentElement('afterend', header);
    header.insertAdjacentElement('afterend', panel);
  } else {
    // Fallback: append at top if no h2 found
    container.prepend(panel);
    container.prepend(header);
  }

  // Wire status change
  statusSelect.addEventListener('change', () => {
    currentStatusValue = statusSelect.value || '';
    updateHeaderStatusPill();
  });

  // Initial header update
  updateHeaderStatusPill();

  if (createdAtTimestamp) {
    createdInput.value = createdAtTimestamp;
  }
  if (lastSubmissionTimestamp) {
    updatedInput.value = lastSubmissionTimestamp;
  }
}

function updateHeaderStatusPill() {
  const pill = document.getElementById('record-header-status-pill');
  const statusField = currentSchema?.form?.status_field;
  if (!pill || !statusField) return;
  const choice = (statusField.choices || []).find((c) => c.value === currentStatusValue);
  pill.style.background = choice?.color || '#ccc';
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
let formInputHandler = null;
let formChangeHandler = null;

function addFormEventListeners() {
  // Remove old document event listeners first
  documentEventListeners.forEach(({ type, handler }) => {
    document.removeEventListener(type, handler);
  });
  documentEventListeners = [];

  const form = document.getElementById('main-form');
  if (form) {
    if (formInputHandler) {
      form.removeEventListener('input', formInputHandler, true);
    }
    formInputHandler = (event) => {
      const target = event.target;
      if (!target || !(target instanceof Element)) {
        return;
      }
      if (target.closest('[class*="choice-field"]')) {
        return;
      }
      const fieldName = target.getAttribute('name');
      if (!fieldName) {
        return;
      }
      markInstanceUpdatedFromTarget(target);
      formStateManager.updateFormState();
      triggerFormEvent('change', fieldName);
    };
    form.addEventListener('input', formInputHandler, true);

    if (formChangeHandler) {
      form.removeEventListener('change', formChangeHandler, true);
    }
    formChangeHandler = (event) => {
      const target = event.target;
      if (!target || !(target instanceof Element)) {
        return;
      }
      if (target.closest('[class*="choice-field"]')) {
        return;
      }
      markInstanceUpdatedFromTarget(target);
      formStateManager.updateFormState();
    };
    form.addEventListener('change', formChangeHandler, true);
  }

  // Create handlers and keep track of them
  const singleChoiceHandler = (event) => {
    markInstanceUpdatedFromTarget(event.target);
    formStateManager.updateFormState();
    const fieldName = extractFieldNameFromChoiceEvent(event, 'single');
    if (fieldName) {
      triggerFormEvent('change', fieldName);
    }
  };

  const multiChoiceHandler = (event) => {
    markInstanceUpdatedFromTarget(event.target);
    formStateManager.updateFormState();
    const fieldName = extractFieldNameFromChoiceEvent(event, 'multi');
    if (fieldName) {
      triggerFormEvent('change', fieldName);
    }
  };

  const booleanFieldHandler = (event) => {
    markInstanceUpdatedFromTarget(event.target);
    formStateManager.updateFormState();
    const fieldName = extractFieldNameFromChoiceEvent(event, 'boolean');
    if (fieldName) {
      triggerFormEvent('change', fieldName);
    }
  };

  const photoFieldHandler = (event) => {
    markInstanceUpdatedFromTarget(event.target);
    formStateManager.updateFormState();
    const fieldName = extractFieldNameFromChoiceEvent(event, 'photo');
    if (fieldName) {
      triggerFormEvent('change', fieldName);
    }
  };

  const videoFieldHandler = (event) => {
    markInstanceUpdatedFromTarget(event.target);
    formStateManager.updateFormState();
    const fieldName = extractFieldNameFromChoiceEvent(event, 'video');
    if (fieldName) {
      triggerFormEvent('change', fieldName);
    }
  };

  const signatureFieldHandler = (event) => {
    markInstanceUpdatedFromTarget(event.target);
    formStateManager.updateFormState();
    const fieldName = extractFieldNameFromChoiceEvent(event, 'signature');
    if (fieldName) {
      triggerFormEvent('change', fieldName);
    }
  };

  const repeatableChangeHandler = (event) => {
    const detail = event.detail || {};

    // Focus first interactive field when a new instance is added
    if (detail.changeType === 'add' && Array.isArray(detail.instancePath)) {
      try {
        const contextKey = formRenderer.formatContextPath
          ? formRenderer.formatContextPath(detail.instancePath)
          : null;
        if (contextKey) {
          const container = document.querySelector(
            `[data-repeatable-context="${contextKey}"]`
          );
          if (container) {
            const focusTarget = container.querySelector('input, select, textarea');
            if (focusTarget && typeof focusTarget.focus === 'function') {
              focusTarget.focus();
            }
          }
        }
      } catch (focusError) {
        console.warn('Failed to focus new repeatable instance:', focusError);
      }
    }

    markInstanceUpdatedFromTarget(event.target);
    formStateManager.updateFormState();
  };

  // Add document event listeners and track them
  document.addEventListener('singlechoicefield-change', singleChoiceHandler);
  document.addEventListener('multichoicefield-change', multiChoiceHandler);
  document.addEventListener('booleanfield-change', booleanFieldHandler);
  document.addEventListener('photofield-change', photoFieldHandler);
  document.addEventListener('videofield-change', videoFieldHandler);
  document.addEventListener('signaturefield-change', signatureFieldHandler);
  document.addEventListener('form0:repeatable-change', repeatableChangeHandler);

  documentEventListeners.push(
    { type: 'singlechoicefield-change', handler: singleChoiceHandler },
    { type: 'multichoicefield-change', handler: multiChoiceHandler },
    { type: 'booleanfield-change', handler: booleanFieldHandler },
    { type: 'photofield-change', handler: photoFieldHandler },
    { type: 'videofield-change', handler: videoFieldHandler },
    { type: 'signaturefield-change', handler: signatureFieldHandler },
    { type: 'form0:repeatable-change', handler: repeatableChangeHandler }
  );

  // Hook into engine state application to refresh header/metadata title
  const originalApply = formStateManager.applyFormState.bind(formStateManager);
  formStateManager.applyFormState = function (state) {
    try {
      // Update live title
      const title = computeLiveTitle(state.values || {});
      const headerTitle = document.getElementById('record-header-title');
      const metaTitle = document.getElementById('record-metadata-title');
      if (headerTitle) headerTitle.textContent = title || '';
      if (metaTitle) metaTitle.value = title || '';
      // Update created/updated timestamps for preview
      const createdInput = document.getElementById('record-metadata-created-at');
      const updatedInput = document.getElementById('record-metadata-updated-at');
      const now = new Date().toISOString();
      if (!createdAtTimestamp) createdAtTimestamp = now;
      if (createdInput) createdInput.value = createdAtTimestamp;
      const effectiveUpdated = lastSubmissionTimestamp || now;
      if (updatedInput) updatedInput.value = effectiveUpdated;
      // Update status pill color
      updateHeaderStatusPill();
    } catch (e) {
      console.warn('Failed updating metadata preview:', e);
    }
    return originalApply(state);
  };
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
  console.log('🚀 [RECORD SUBMIT] Starting record submission...');

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
    const { values, repeatable } = formStateManager.getCurrentFormState();

    const response = await fetch('/api/engine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values, repeatable }),
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
        validationSummary.requiredFieldErrors.forEach((error) => {
          errorMessages.push(`• ${error.fieldName}: ${error.errorMessage}`);
        });
      }

      if (validationSummary.generalErrors.length > 0) {
        if (errorMessages.length > 0) errorMessages.push('');
        errorMessages.push('Validation errors:');
        validationSummary.generalErrors.forEach((error) => {
          errorMessages.push(`• ${error.fieldName}: ${error.errorMessage}`);
        });
      }

      console.log('❌ [RECORD SUBMIT] Submission blocked due to validation errors');
      showGlobalError(errorMessages.join('\n'));
      return;
    }

    // Create structured record using server-side API
    const submissionTimestamp = new Date().toISOString();
    lastSubmissionTimestamp = submissionTimestamp;
    if (!createdAtTimestamp) {
      createdAtTimestamp = submissionTimestamp;
    }
    const createdInputEl = document.getElementById('record-metadata-created-at');
    if (createdInputEl) createdInputEl.value = createdAtTimestamp;
    const updatedInputEl = document.getElementById('record-metadata-updated-at');
    if (updatedInputEl) updatedInputEl.value = submissionTimestamp;

    const recordResponse = await fetch('/api/create-record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state,
        options: {
          '@status': currentStatusValue,
          fieldKeyMode: currentFieldKeyMode,
          created_at_client: createdAtTimestamp,
          updated_at_client: submissionTimestamp,
          created_at_server: null,
          updated_at_server: null,
        },
      }),
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

    // Submit to database/connectors via /api/submit-record
    try {
      console.log('💾 [DATABASE SUBMIT] Submitting to configured connectors...');
      
      const submitResponse = await fetch('/api/submit-record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record: structuredRecord }),
      });

      if (submitResponse.ok) {
        const submitResult = await submitResponse.json();
        
        if (submitResult.success) {
          console.log(`✅ [DATABASE SUBMIT] ${submitResult.message}`);
          
          // Log individual connector results if available
          if (submitResult.connectorResults && submitResult.connectorResults.length > 0) {
            submitResult.connectorResults.forEach(result => {
              const status = result.success ? '✅' : '❌';
              const details = result.success 
                ? (result.message || 'Success')
                : (result.error || 'Unknown error');
              console.log(`   ${status} ${result.connector}: ${details}`);
            });
          }
        } else {
          console.warn(`⚠️ [DATABASE SUBMIT] ${submitResult.message}`);
        }
      } else {
        const errorResult = await submitResponse.json().catch(() => ({ error: 'Unknown error' }));
        console.warn(`⚠️ [DATABASE SUBMIT] Failed: ${errorResult.error}`);
      }
    } catch (submitError) {
      console.warn(`⚠️ [DATABASE SUBMIT] Error: ${submitError.message}`);
    }

    // Show success message
    showGlobalSuccess('Form submitted successfully! Check console for structured record.');
  } catch (error) {
    console.error('❌ [RECORD SUBMIT] Error during record submission:', error);
    console.log('❌ [RECORD SUBMIT] Submission was not successful');
    showGlobalError(`Submission failed: ${error.message}`);
  } finally {
    // Re-enable submit button
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Record';
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

/**
 * Format execution context for human-readable display in browser console
 * @param {Object} context - Execution context object
 * @returns {string} Formatted context string
 */
function formatExecutionContext(context) {
  if (context.type === 'event') {
    if (context.fieldName) {
      return `Event '${context.eventType}' on field '${context.fieldName}'`;
    } else {
      return `Event '${context.eventType}'`;
    }
  }

  if (context.type === 'calculation') {
    return `CalculatedField '${context.fieldName}'`;
  }

  return `${context.type} context`;
}
