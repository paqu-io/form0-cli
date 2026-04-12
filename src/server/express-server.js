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
  expandBuildingPlanSchema,
} from 'form0-core';
import { fileURLToPath } from 'url';
import { getLocale, t, getRawTranslation } from '../utils/i18n.js';
import { v7 as uuidv7 } from 'uuid';
import { connectorManager } from '../utils/connector-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MEDIA_FIELD_TYPES = new Set(['PhotoField', 'VideoField', 'SignatureField']);
const MEDIA_PRESERVED_FIELDS = [
  'photo_id',
  'video_id',
  'signature_id',
  'media_id',
  'asset_id',
  'upload_id',
  'upload_status',
  'filename',
  'duration',
  'caption',
  'data',
  'mime_type',
  'size',
  'size_bytes',
  'checksum_sha256',
  'original_filename',
  'thumbnail_url',
  'preview_url',
  'url',
  'public_url',
  'field_key',
  'field_data_name',
  'attached_at_client',
  'captured_at_client',
  'signed_at_client',
  'uploaded_at_server',
  'ready_at_server',
  'error',
];

function ensureIsoString(value, fallback) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return fallback;
}

function isObjectRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function useDataNameKeys(fieldKeyMode) {
  const normalized = typeof fieldKeyMode === 'string' ? fieldKeyMode.toLowerCase() : '';
  return normalized === 'data-name' || normalized === 'data_name' || normalized === 'dataname';
}

function resolveFieldOutputKey(field, preferredKey, fieldKeyMode) {
  if (useDataNameKeys(fieldKeyMode)) {
    return field?.data_name || preferredKey;
  }
  return preferredKey || field?.key || field?.data_name;
}

function resolveRepeatableOutputKey(repInfo, fieldKeyMode) {
  if (useDataNameKeys(fieldKeyMode)) {
    return repInfo?.field?.data_name || repInfo?.preferredKey;
  }
  return repInfo?.preferredKey || repInfo?.field?.data_name;
}

function readFieldValue(values, field) {
  if (!values || !field) {
    return undefined;
  }
  const keys = [field.data_name, field.key].filter(
    (key) => typeof key === 'string' && key.trim().length > 0
  );
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return values[key];
    }
  }
  return undefined;
}

function copyMediaFields(source, target) {
  if (!isObjectRecord(source)) {
    return target;
  }
  const output = isObjectRecord(target) ? target : {};
  MEDIA_PRESERVED_FIELDS.forEach((fieldName) => {
    if (Object.prototype.hasOwnProperty.call(source, fieldName)) {
      output[fieldName] = source[fieldName];
    }
  });
  return output;
}

function preserveMediaValue(source, target) {
  if (Array.isArray(source)) {
    const targetArray = Array.isArray(target) ? target : [];
    return source.map((item, index) => copyMediaFields(item, targetArray[index]));
  }
  return copyMediaFields(source, target);
}

function mediaIdFor(value, idKey) {
  return value.media_id || value[idKey] || value.asset_id || value.upload_id || uuidv7();
}

function enrichMediaObject(value, idKey, timestamp, extra = {}) {
  if (!value || typeof value !== 'object') {
    return value;
  }
  const mediaId = mediaIdFor(value, idKey);
  value[idKey] = value[idKey] || mediaId;
  value.media_id = value.media_id || mediaId;
  value.attached_at_client = ensureIsoString(value.attached_at_client, timestamp);
  Object.entries(extra).forEach(([key, fallback]) => {
    if (value[key] === undefined || value[key] === null || value[key] === '') {
      value[key] = typeof fallback === 'function' ? fallback(value) : fallback;
    }
  });
  return value;
}

function applyMediaDefaultsToValues(values, flattenedFields, timestamp) {
  if (!values || typeof values !== 'object') {
    return;
  }
  flattenedFields.forEach((field) => {
    const fieldKeys = [field.data_name, field.key].filter(
      (key) => typeof key === 'string' && key.trim().length > 0
    );
    const fieldKey = fieldKeys.find((key) => Object.prototype.hasOwnProperty.call(values, key));
    if (!fieldKey) {
      return;
    }
    const fieldValue = values[fieldKey];

    if (!fieldValue) return; // Skip if no value

    if (field.type === 'SignatureField') {
      if (typeof fieldValue === 'object' && (fieldValue.data || fieldValue.asset_id)) {
        enrichMediaObject(fieldValue, 'signature_id', timestamp, {
          signed_at_client: (value) => ensureIsoString(value.signed_at_client, timestamp),
          mime_type: (value) => value.mime_type || (value.data ? 'image/png' : null),
          original_filename: (value) =>
            value.original_filename || `${field.data_name || field.key || 'signature'}.png`,
        });
      }
    } else if (field.type === 'PhotoField') {
      if (Array.isArray(fieldValue)) {
        fieldValue.forEach((photo) => {
          if (typeof photo === 'object' && photo !== null) {
            enrichMediaObject(photo, 'photo_id', timestamp, {
              original_filename: (value) => value.original_filename || value.filename || null,
            });
          }
        });
      }
    } else if (field.type === 'VideoField') {
      if (Array.isArray(fieldValue)) {
        fieldValue.forEach((video) => {
          if (typeof video === 'object' && video !== null) {
            enrichMediaObject(video, 'video_id', timestamp, {
              original_filename: (value) => value.original_filename || value.filename || null,
            });
          }
        });
      }
    }
  });
}

function applyMediaDefaultsToRepeatable(repeatable, flattenedFields, timestamp) {
  if (!repeatable || typeof repeatable !== 'object') {
    return;
  }
  Object.values(repeatable).forEach((rows) => {
    if (!Array.isArray(rows)) {
      return;
    }
    rows.forEach((row) => {
      if (!row || typeof row !== 'object') {
        return;
      }
      applyMediaDefaultsToValues(row.values, flattenedFields, timestamp);
      applyMediaDefaultsToRepeatable(row.repeatable, flattenedFields, timestamp);
    });
  });
}

/**
 * Preserve or generate storage-agnostic media metadata for media fields.
 * @param {Object} state - Form state with values/repeatable values
 * @param {Array} flattenedFields - Flattened field definitions
 * @returns {Object} Enhanced state with stable media ids and client timestamps
 */
function generateUUIDs(state, flattenedFields) {
  const enhancedState = JSON.parse(JSON.stringify(state)); // Deep clone
  const timestamp = new Date().toISOString();

  applyMediaDefaultsToValues(enhancedState.values, flattenedFields, timestamp);
  applyMediaDefaultsToRepeatable(enhancedState.repeatable, flattenedFields, timestamp);

  return enhancedState;
}

function preserveMediaMetadataInFormValues(formValues, values, fields, fieldKeyMode) {
  if (!formValues || !values || !Array.isArray(fields)) {
    return;
  }
  fields.forEach((fieldInfo) => {
    const field = fieldInfo.field || fieldInfo;
    if (!MEDIA_FIELD_TYPES.has(field?.type)) {
      return;
    }
    const sourceValue = readFieldValue(values, field);
    if (sourceValue === undefined || sourceValue === null) {
      return;
    }
    const outputKey = resolveFieldOutputKey(
      field,
      fieldInfo.preferredKey || field.key || field.data_name,
      fieldKeyMode
    );
    formValues[outputKey] = preserveMediaValue(sourceValue, formValues[outputKey]);
  });
}

function preserveRepeatableMediaMetadata(formValues, repeatable, repInfo, fieldKeyMode) {
  if (!formValues || !repeatable || !repInfo) {
    return;
  }
  const stateRows = repeatable[repInfo.preferredKey] || repeatable[repInfo.field?.data_name] || [];
  if (!Array.isArray(stateRows) || stateRows.length === 0) {
    return;
  }
  const outputKey = resolveRepeatableOutputKey(repInfo, fieldKeyMode);
  const structuredRows = Array.isArray(formValues[outputKey]) ? formValues[outputKey] : [];

  stateRows.forEach((stateRow, index) => {
    const structuredRow = structuredRows[index];
    if (!structuredRow?.form_values) {
      return;
    }
    preserveMediaMetadataInFormValues(
      structuredRow.form_values,
      stateRow.values || {},
      Array.from(repInfo.fields.values()),
      fieldKeyMode
    );
    for (const [, childRepInfo] of repInfo.children) {
      preserveRepeatableMediaMetadata(
        structuredRow.form_values,
        stateRow.repeatable || {},
        childRepInfo,
        fieldKeyMode
      );
    }
  });
}

function preserveStructuredMediaMetadata(record, state, elements, fieldKeyMode) {
  if (!record?.form_values || !state || !Array.isArray(elements)) {
    return record;
  }
  const { repeatableSectionTree, fieldOwnership } = buildRepeatableMetadata(elements);
  const rootFields = [];
  fieldOwnership.forEach((fieldInfo) => {
    if (fieldInfo.parentPath.length === 0) {
      rootFields.push(fieldInfo);
    }
  });
  preserveMediaMetadataInFormValues(
    record.form_values,
    state.values || {},
    rootFields,
    fieldKeyMode
  );

  for (const [, repInfo] of repeatableSectionTree) {
    if (repInfo.parentPath.length === 0) {
      preserveRepeatableMediaMetadata(
        record.form_values,
        state.repeatable || {},
        repInfo,
        fieldKeyMode
      );
    }
  }
  return record;
}

/**
 * Regenerate unique IDs for repeatable section instances within a structured record.
 * Ensures every child record receives a fresh UUID for each submission.
 * @param {Object} record - Structured record object (mutated in place)
 */
function regenerateRepeatableRecordIds(record) {
  if (!record || !record.form_values) {
    return;
  }

  const assignIds = (formValues) => {
    if (!formValues || typeof formValues !== 'object') {
      return;
    }

    Object.values(formValues).forEach((value) => {
      if (!Array.isArray(value) || value.length === 0) {
        return;
      }

      const appearsRepeatable = value.every(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          Object.prototype.hasOwnProperty.call(entry, 'form_values')
      );

      if (!appearsRepeatable) {
        return;
      }

      value.forEach((entry) => {
        if (!entry || typeof entry !== 'object') {
          return;
        }

        const newId = uuidv7();
        entry.id = newId;
        if (!entry.record_id) {
          entry.record_id = newId;
        }

        assignIds(entry.form_values);
      });
    });
  };

  assignIds(record.form_values);
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

  const childRecordIdsOption = options.childRecordIds;
  if (!childRecordIdsOption) {
    return options;
  }

  // Reuse the same RepeatableSection tree building logic from record-transformer.js
  const repeatableSectionTree = new Map();

  const buildRepeatableSectionTree = (elements, parentPath = []) => {
    if (!Array.isArray(elements)) return;

    elements.forEach((element) => {
      if (element.type === 'Section') {
        if (Array.isArray(element.elements)) {
          buildRepeatableSectionTree(element.elements, parentPath);
        }
      } else if (element.type === 'RepeatableSection') {
        const preferredKey =
          element.key && element.key.trim() !== '' ? element.key : element.data_name;
        const currentPath = [...parentPath, preferredKey];

        repeatableSectionTree.set(element.data_name, {
          preferredKey,
          parentPath: [...parentPath],
          currentPath: [...currentPath],
        });

        if (Array.isArray(element.elements)) {
          buildRepeatableSectionTree(element.elements, currentPath);
        }
      }
    });
  };

  buildRepeatableSectionTree(originalElements);

  const childRecordIds = { ...childRecordIdsOption };

  for (const [, repInfo] of repeatableSectionTree) {
    const { preferredKey, parentPath } = repInfo;

    if (parentPath.length === 0) {
      if (Array.isArray(childRecordIds[preferredKey])) {
        continue;
      }
    } else {
      let current = childRecordIds;
      let valid = true;

      for (let i = 0; i < parentPath.length; i++) {
        const pathKey = parentPath[i];
        const next = current[pathKey];

        if (!next) {
          valid = false;
          break;
        }

        if (Array.isArray(next)) {
          valid = false;
          break;
        }

        const recordId = next._records?.[0];
        if (!recordId || !next[recordId]) {
          valid = false;
          break;
        }

        current = next[recordId];
      }

      if (!valid) {
        continue;
      }

      if (Array.isArray(current[preferredKey])) {
        continue;
      }
    }
  }

  options.childRecordIds = childRecordIds;

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
  const unsupportedEventWarnings = new Set();

  function warnUnsupportedEvents(preparedSchema) {
    if (unsupportedEventWarnings.has('edit-record')) {
      return;
    }
    const code = preparedSchema?.form?.events?.code;
    if (typeof code !== 'string') {
      return;
    }
    if (!/\bON\s*\(\s*['"]edit-record['"]/i.test(code)) {
      return;
    }
    unsupportedEventWarnings.add('edit-record');
    console.warn(
      "[form0-cli] The 'edit-record' event is not supported in form0-cli; handlers will be skipped in preview."
    );
  }

  // Initialize connector manager with configuration
  async function initializeConnectors() {
    try {
      await connectorManager.loadConnectorConfig({ projectDir });

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

  function getPreparedSchemaPayload(schemaOverride = null) {
    const schema = schemaOverride || getCurrentSchema();
    if (!schema) {
      return null;
    }

    const { schema: preparedSchema, buildingPlanMeta } = expandBuildingPlanSchema(schema);
    warnUnsupportedEvents(preparedSchema);
    return {
      schema: preparedSchema,
      source: schemaOverride
        ? 'Request Schema'
        : getSchemaSource
          ? getSchemaSource()
          : 'Current Schema',
      buildingPlanMeta,
    };
  }

  // Serve static files
  app.use(express.static(path.join(__dirname, 'static')));

  // Serve supporting images from the current project directory
  app.use('/supporting-images', express.static(path.join(projectDir, 'supporting-images')));

  // API endpoint to get current schema
  app.get('/api/schema', (req, res) => {
    const payload = getPreparedSchemaPayload();
    if (!payload) {
      return res.status(404).json({ error: 'No schema loaded' });
    }
    res.json(payload);
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
      const payload = getPreparedSchemaPayload();
      if (!payload) {
        return res.status(404).json({ error: 'No schema loaded' });
      }
      const { schema } = payload;

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
      const payload = getPreparedSchemaPayload();
      if (!payload) {
        return res.status(404).json({ error: 'No schema loaded' });
      }
      const { schema } = payload;

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
      const schemaOverride = req.body?.schema;
      if (
        schemaOverride !== undefined &&
        schemaOverride !== null &&
        (typeof schemaOverride !== 'object' || !schemaOverride.form)
      ) {
        return res
          .status(400)
          .json({ error: 'Invalid schema payload. Expected a schema with a form property.' });
      }

      const payload = getPreparedSchemaPayload(schemaOverride || null);
      if (!payload) {
        return res.status(404).json({ error: 'No schema loaded' });
      }
      const { schema } = payload;

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
      preserveStructuredMediaMetadata(
        structuredRecord,
        enhancedState,
        schema.form?.elements || [],
        options.fieldKeyMode
      );

      // Ensure each repeatable instance receives a fresh UUID so connector inserts remain unique
      regenerateRepeatableRecordIds(structuredRecord);

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
