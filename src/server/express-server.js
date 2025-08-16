import express from 'express';
import path from 'path';
import {
  createFormEngine,
  createStructuredRecord,
  flattenFields,
  WarningSystem,
  recordVersion,
  formVersion,
} from 'form0-core';
import { fileURLToPath } from 'url';
import { getLocale, t, getRawTranslation } from '../utils/i18n.js';
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid';

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

export function createApp(getCurrentSchema, getSchemaSource, projectDir) {
  const app = express();

  // Create a shared warning system for the entire server session
  // Client-side handles deduplication, so server just collects all warnings
  const sharedWarningSystem = new WarningSystem({
    enableConsoleWarnings: false, // Disable server console - we want warnings in browser
    enableCollection: true,
    throttleMs: 0, // No server-side throttling - client handles deduplication
  });

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

      const { values = {}, eventType, fieldKey } = req.body;

      // Create engine with shared warning system to enable throttling across requests
      const engine = createFormEngine({
        schema: schema,
        initialValues: values,
        helpers: {}, // builtins are included by default in createFormEngine
        security: { mode: 'development' }, // Enable development mode for better warnings
        warningSystem: sharedWarningSystem, // Use shared instance for throttling
      });

      // Note: Shared warning system already has collection enabled and handles throttling

      engine.eval();
      const state = engine.getState();

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
      res.json({ ...state, operations, warnings: collectedWarnings });

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

  // Serve main page
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'index.html'));
  });

  return app;
}
