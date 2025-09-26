import express from 'express';
import path from 'path';
import {
  createFormEngine,
  createStructuredRecord,
  flattenFields,
  WarningSystem,
  recordVersion,
  formVersion,
  buildRepeatableMetadata,
} from 'form0-core';
import { fileURLToPath } from 'url';
import { getLocale, t, getRawTranslation } from '../utils/i18n.js';
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid';
import { connectorManager } from '../utils/connector-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate UUIDs for media fields (PhotoField, VideoField, SignatureField)
 * @param {Object} state - Form state with values
 * @param {Array} flattenedFields - Flattened field definitions
 * @returns {Object} Enhanced state with UUIDs injected into media field values
 */
function generateUUIDs(state, flattenedFields) {
  const enhancedState = JSON.parse(JSON.stringify(state)); // Deep clone

  flattenedFields.forEach((field) => {
    const fieldValue = enhancedState.values[field.data_name];

    if (!fieldValue) return; // Skip if no value

    if (field.type === 'SignatureField') {
      // SignatureField: {signature_id: null, data: base64String}
      if (typeof fieldValue === 'object' && fieldValue.data) {
        fieldValue.signature_id = uuidv4();
      }
    } else if (field.type === 'PhotoField') {
      // PhotoField: array of {photo_id: null, filename: string, caption: string|null}
      if (Array.isArray(fieldValue)) {
        fieldValue.forEach((photo, index) => {
          if (typeof photo === 'object' && photo !== null) {
            photo.photo_id = uuidv4();
          }
        });
      }
    } else if (field.type === 'VideoField') {
      // VideoField: array of {video_id: null, filename: string, duration: number, caption: string|null}
      if (Array.isArray(fieldValue)) {
        fieldValue.forEach((video, index) => {
          if (typeof video === 'object' && video !== null) {
            video.video_id = uuidv4();
          }
        });
      }
    }
  });

  return enhancedState;
}

/**
 * Generate record IDs (UUIDv7) for main record and child records
 * Reuses the same tree-building logic as record-transformer.js
 * @param {Array} originalElements - Original nested form elements from schema
 * @param {Object} existingOptions - Existing options from request
 * @returns {Object} Options with generated record IDs
 */
function generateRecordIds(originalElements, existingOptions) {
  const options = { ...existingOptions };

  // Generate main record ID
  if (!options.mainRecordId) {
    options.mainRecordId = uuidv7();
  }

  // Generate changeset ID for this submission (all records will share this)
  if (!options.changeset_id) {
    options.changeset_id = uuidv7();
  }

  // Reuse the same RepeatableSection tree building logic from record-transformer.js
  const repeatableSectionTree = new Map();

  // Helper function (copied from record-transformer.js)
  const buildRepeatableSectionTree = (elements, parentPath = []) => {
    if (!Array.isArray(elements)) return;

    elements.forEach((element) => {
      if (element.type === 'Section') {
        // Recursively process Section children with same parentPath
        if (Array.isArray(element.elements)) {
          buildRepeatableSectionTree(element.elements, parentPath);
        }
      } else if (element.type === 'RepeatableSection') {
        const preferredKey =
          element.key && element.key.trim() !== '' ? element.key : element.data_name;
        const currentPath = [...parentPath, preferredKey];

        // Store this RepeatableSection in the tree
        repeatableSectionTree.set(element.data_name, {
          preferredKey,
          parentPath: [...parentPath],
          currentPath: [...currentPath],
        });

        // Recursively process RepeatableSection children with updated path
        if (Array.isArray(element.elements)) {
          buildRepeatableSectionTree(element.elements, currentPath);
        }
      }
    });
  };

  // Build the tree structure from original elements
  buildRepeatableSectionTree(originalElements);

  // Generate child record IDs using the proper nested structure
  const childRecordIds = { ...options.childRecordIds };

  // For form0-cli, generate one child record per RepeatableSection
  for (const [dataName, repInfo] of repeatableSectionTree) {
    const { preferredKey, parentPath } = repInfo;

    if (parentPath.length === 0) {
      // Top-level RepeatableSection: simple array format
      if (!childRecordIds[preferredKey]) {
        childRecordIds[preferredKey] = [uuidv7()];
      }
    } else {
      // Nested RepeatableSection: build nested structure
      let current = childRecordIds;

      // Navigate to the parent RepeatableSection
      for (let i = 0; i < parentPath.length; i++) {
        const pathKey = parentPath[i];

        if (!current[pathKey]) {
          current[pathKey] = { _records: [uuidv7()] };
        }

        // Convert simple array to nested structure if needed
        if (Array.isArray(current[pathKey])) {
          const recordId = current[pathKey][0];
          current[pathKey] = { _records: [recordId] };
        }

        // Create record-specific section if it doesn't exist
        const recordId = current[pathKey]._records[0];
        if (!current[pathKey][recordId]) {
          current[pathKey][recordId] = {};
        }

        current = current[pathKey][recordId];
      }

      // Add the nested RepeatableSection
      if (!current[preferredKey]) {
        current[preferredKey] = [uuidv7()];
      }
    }
  }

  if (Object.keys(childRecordIds).length > 0) {
    options.childRecordIds = childRecordIds;
  }

  return options;
}

function pickStateSlice(stateMap, fieldNames, { omitFalsy = false } = {}) {
  const result = {};
  if (!stateMap) return result;

  fieldNames.forEach((name) => {
    if (!Object.prototype.hasOwnProperty.call(stateMap, name)) {
      return;
    }
    const value = stateMap[name];
    if (omitFalsy && !value) {
      return;
    }
    result[name] = value;
  });

  return result;
}

function evaluateRepeatableInstance({ schema, repInfo, instance, parentValues, engineOptions }) {
  const fieldNames = Array.from(repInfo.fields.keys());

  // Merge parent values with direct instance values for evaluation
  const mergedValues = {
    ...parentValues,
    ...(instance?.values || {}),
  };

  const engine = createFormEngine({
    schema,
    initialValues: mergedValues,
    helpers: engineOptions.helpers,
    security: engineOptions.security,
  });

  engine.eval();
  const evaluatedState = engine.getState();

  const valuesSlice = pickStateSlice(evaluatedState.values, fieldNames);
  const errorsSlice = pickStateSlice(evaluatedState.errors, fieldNames, { omitFalsy: true });
  const visibleSlice = pickStateSlice(evaluatedState.visible, fieldNames);
  const requiredSlice = pickStateSlice(evaluatedState.required, fieldNames);
  const readOnlySlice = pickStateSlice(evaluatedState.read_only, fieldNames);

  // Prepare values for nested repeatables
  const nextParentValues = { ...parentValues };
  Object.entries(valuesSlice).forEach(([key, value]) => {
    nextParentValues[key] = value;
  });

  const nestedRepeatable = {};
  for (const [, childRepInfo] of repInfo.children) {
    const childInstances = instance?.repeatable?.[childRepInfo.preferredKey] || [];
    if (!Array.isArray(childInstances) || childInstances.length === 0) {
      continue;
    }

    const evaluatedChildren = childInstances.map((childInstance) =>
      evaluateRepeatableInstance({
        schema,
        repInfo: childRepInfo,
        instance: childInstance,
        parentValues: nextParentValues,
        engineOptions,
      })
    );

    if (evaluatedChildren.length > 0) {
      nestedRepeatable[childRepInfo.preferredKey] = evaluatedChildren;
    }
  }

  return {
    ...instance,
    id: instance?.id ?? instance?.record_id ?? null,
    values: valuesSlice,
    errors: errorsSlice,
    visible: visibleSlice,
    required: requiredSlice,
    read_only: readOnlySlice,
    repeatable: nestedRepeatable,
  };
}

function evaluateRepeatableState({ schema, baseValues, repeatableInput, metadata, engineOptions }) {
  const result = {};

  for (const [, repInfo] of metadata.repeatableSectionTree) {
    if (repInfo.parentPath.length > 0) {
      continue;
    }

    const instances = repeatableInput?.[repInfo.preferredKey] || [];
    if (!Array.isArray(instances) || instances.length === 0) {
      continue;
    }

    const evaluatedInstances = instances.map((instance) =>
      evaluateRepeatableInstance({
        schema,
        repInfo,
        instance,
        parentValues: baseValues,
        engineOptions,
      })
    );

    if (evaluatedInstances.length > 0) {
      result[repInfo.preferredKey] = evaluatedInstances;
    }
  }

  return result;
}

export function createApp(getCurrentSchema, getSchemaSource, projectDir) {
  const app = express();

  // Create a shared warning system for the entire server session
  // Client-side handles deduplication, so server just collects all warnings
  const sharedWarningSystem = new WarningSystem({
    enableConsoleWarnings: false, // Disable server console - we want warnings in browser
    enableCollection: true,
    throttleMs: 0, // No server-side throttling - client handles deduplication
  });

  // Initialize connector manager with configuration
  async function initializeConnectors() {
    try {
      await connectorManager.loadConnectorConfig();
      
      // Auto-load connectors marked for auto-loading
      const config = connectorManager.config;
      for (const [connectorName, connectorConfig] of Object.entries(config)) {
        if (connectorConfig.enabled && connectorConfig.autoLoad) {
          try {
            console.log(`Auto-loading connector: ${connectorName}`);
            await connectorManager.loadConnector(connectorName);
          } catch (error) {
            console.warn(`Failed to auto-load connector '${connectorName}':`, error.message);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to initialize connector manager:', error.message);
    }
  }

  // Initialize connectors when the app is created
  initializeConnectors();

  // Serve static files
  app.use(express.static(path.join(__dirname, 'static')));

  // Serve supporting images from the current project directory
  app.use('/supporting-images', express.static(path.join(projectDir, 'supporting-images')));

  // API endpoint to get current schema
  app.get('/api/schema', (req, res) => {
    const schema = getCurrentSchema();
    if (!schema) {
      return res.status(404).json({ error: 'No schema loaded' });
    }
    const source = getSchemaSource ? getSchemaSource() : 'Current Schema';
    res.json({ schema, source });
  });

  // API endpoint to get current locale and translations
  app.get('/api/locale', (req, res) => {
    const locale = getLocale();
    const clientTranslations = getRawTranslation('client') || {};
    res.json({ locale, translations: clientTranslations });
  });

  // API endpoint to get default values from schema
  app.get('/api/default-values', (req, res) => {
    try {
      const schema = getCurrentSchema();
      if (!schema) {
        return res.status(404).json({ error: 'No schema loaded' });
      }

      // Create engine to get default values
      const engine = createFormEngine({
        schema: schema,
        initialValues: {}, // Empty to get only default values
      });

      engine.eval();
      const state = engine.getState();

      res.json({ defaultValues: state.values || {} });
    } catch (err) {
      console.error('Error getting default values:', err);
      res.status(400).json({ error: err.message });
    }
  });

  // API endpoint to run engine with values
  app.post('/api/engine', express.json(), (req, res) => {
    try {
      const schema = getCurrentSchema();
      if (!schema) {
        return res.status(404).json({ error: 'No schema loaded' });
      }

      const { values = {}, repeatable = {}, eventType, fieldKey } = req.body;

      // Create engine with shared warning system to enable throttling across requests
      const engineOptions = {
        helpers: {},
        security: { mode: 'development' },
      };

      const engine = createFormEngine({
        schema: schema,
        initialValues: values,
        helpers: engineOptions.helpers, // builtins are included by default in createFormEngine
        security: engineOptions.security, // Enable development mode for better warnings
        warningSystem: sharedWarningSystem, // Use shared instance for throttling
      });

      // Note: Shared warning system already has collection enabled and handles throttling

      engine.eval();
      const state = engine.getState();

      const metadata = buildRepeatableMetadata(schema.form?.elements || []);
      const evaluatedRepeatable = evaluateRepeatableState({
        schema,
        baseValues: state.values || {},
        repeatableInput: repeatable,
        metadata,
        engineOptions,
      });

      const responseState = {
        ...state,
        repeatable: evaluatedRepeatable,
      };

      // Handle event triggering if specified (backward compatible - existing calls don't include eventType)
      let operations = [];
      if (eventType) {
        operations = engine.trigger(eventType, fieldKey);

        // Log events on server (simple format for now)
        operations.forEach((op) => {
          let message = '';

          // Format message based on operation type
          if (op.operation === 'ALERT') {
            message = `"${op.params.message}"`;
          } else if (op.operation === 'SETVALUE') {
            message = `"${op.params.fieldDataName}" = ${JSON.stringify(op.params.valueToSet)}`;
          } else {
            message = JSON.stringify(op.params);
          }

          if (fieldKey) {
            console.log(`🔴 [FORM EVENT] ${eventType}:${fieldKey} → ${op.operation}: ${message}`);
          } else {
            console.log(`🔴 [FORM EVENT] ${eventType} → ${op.operation}: ${message}`);
          }
        });
      }

      // Collect warnings for browser display (from shared warning system)
      const collectedWarnings = sharedWarningSystem.getCollectedWarnings();

      // Return state with operations and warnings (backward compatible - existing clients ignore warnings)
      res.json({ ...responseState, operations, warnings: collectedWarnings });

      // Clear warnings immediately after sending - the 30-second throttling prevents spam
      // No need for setTimeout hack since throttling handles duplicate prevention
      sharedWarningSystem.clearCollectedWarnings();
    } catch (err) {
      console.error('Engine evaluation error:', err);
      res.status(400).json({ error: err.message });
    }
  });

  // API endpoint to create structured record
  app.post('/api/create-record', express.json(), (req, res) => {
    try {
      const schema = getCurrentSchema();
      if (!schema) {
        return res.status(404).json({ error: 'No schema loaded' });
      }

      const { state, options = {} } = req.body;

      if (!state) {
        return res.status(400).json({ error: 'Form state is required' });
      }

      // Validate version if provided in options
      if (options.version !== undefined) {
        if (!recordVersion.isValid(options.version)) {
          return res.status(400).json({
            error: 'Invalid record version. Must be a positive integer (e.g., 1, 2, 3)',
          });
        }
      }

      // Validate form version if present in schema
      if (schema.form?.version !== undefined) {
        if (!formVersion.isValid(schema.form.version)) {
          return res.status(400).json({
            error:
              'Invalid form version format. Use simple format (e.g., "1", "2-dev1704123456") or semantic (e.g., "1.1.1", "1.2.0-dev1704123456")',
          });
        }
      }

      // Flatten form elements to get field mappings
      const flattenedFields = flattenFields(schema.form?.elements || []);

      // Generate UUIDs for records and media fields
      const enhancedState = generateUUIDs(state, flattenedFields);
      const recordOptions = generateRecordIds(schema.form?.elements || [], options);

      // Create structured record using the real form0-core function
      // Pass both flattened fields (for key mapping) and original elements (for nesting)
      const structuredRecord = createStructuredRecord(enhancedState, flattenedFields, {
        ...recordOptions,
        originalElements: schema.form?.elements || [],
        // Pass top-level fields for record transformer title/status computation
        title_field: schema.form?.title_field || null,
        status_field: schema.form?.status_field || null,
        // If client provided @status in options, merge it here so transformer picks it up
        '@status': options['@status'] || undefined,
      });

      res.json({ record: structuredRecord });
    } catch (err) {
      console.error('Error creating structured record:', err);
      res.status(400).json({ error: err.message });
    }
  });

  // API endpoint to submit record to connectors
  app.post('/api/submit-record', express.json(), async (req, res) => {
    try {
      const { record } = req.body;

      if (!record) {
        return res.status(400).json({ 
          error: 'Record is required',
          connectorResults: []
        });
      }

      // Check if any connectors are loaded
      const loadedConnectors = connectorManager.getLoadedConnectors();
      
      if (loadedConnectors.length === 0) {
        return res.json({
          success: true,
          message: 'Record processed successfully (no connectors configured)',
          connectorResults: [],
          record: record
        });
      }

      // Submit to all loaded connectors
      const connectorResults = await connectorManager.submitToConnectors(record);

      // Determine overall success based on connector results
      const hasSuccessfulConnector = connectorResults.some(result => result.success);
      const hasFailedConnector = connectorResults.some(result => !result.success);

      let overallMessage = '';
      if (connectorResults.length === 0) {
        overallMessage = 'Record processed successfully (no connectors configured)';
      } else if (hasSuccessfulConnector && !hasFailedConnector) {
        overallMessage = `Record submitted successfully to ${connectorResults.length} connector(s)`;
      } else if (hasSuccessfulConnector && hasFailedConnector) {
        const successCount = connectorResults.filter(r => r.success).length;
        const failCount = connectorResults.filter(r => !r.success).length;
        overallMessage = `Partial success: ${successCount} connector(s) succeeded, ${failCount} failed`;
      } else {
        overallMessage = 'All connector submissions failed';
      }

      // Log submission results
      console.log(`📝 [FORM SUBMISSION] ${overallMessage}`);
      connectorResults.forEach(result => {
        const status = result.success ? '✅' : '❌';
        const details = result.success 
          ? (result.message || 'Success')
          : (result.error || 'Unknown error');
        console.log(`   ${status} ${result.connector}: ${details}`);
      });

      res.json({
        success: hasSuccessfulConnector || connectorResults.length === 0,
        message: overallMessage,
        connectorResults: connectorResults,
        record: record
      });

    } catch (err) {
      console.error('Error submitting record to connectors:', err);
      res.status(500).json({ 
        error: err.message,
        connectorResults: []
      });
    }
  });

  // API endpoint to get connector status
  app.get('/api/connectors/status', async (req, res) => {
    try {
      const loadedConnectors = connectorManager.getLoadedConnectors();
      const healthChecks = await connectorManager.healthCheckAll();
      const metadata = connectorManager.getAllConnectorMetadata();

      res.json({
        connectors: loadedConnectors,
        health: healthChecks,
        metadata: metadata
      });
    } catch (err) {
      console.error('Error getting connector status:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // API endpoint to test connector connection
  app.post('/api/connectors/test', express.json(), async (req, res) => {
    try {
      const { connectorName, config = {} } = req.body;

      if (!connectorName) {
        return res.status(400).json({ error: 'Connector name is required' });
      }

      const testResult = await connectorManager.testConnector(connectorName, config);

      res.json({
        connector: connectorName,
        ...testResult
      });
    } catch (err) {
      console.error('Error testing connector:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Serve main page
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'index.html'));
  });

  return app;
}
