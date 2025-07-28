import express from 'express';
import path from 'path';
import { createFormEngine, createStructuredRecord, flattenFields } from 'form0-core';
import { fileURLToPath } from 'url';
import { getLocale, t, getRawTranslation } from '../utils/i18n.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(getCurrentSchema, getSchemaSource, projectDir) {
  const app = express();

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

      // Create engine with proper helpers (including builtins)
      const engine = createFormEngine({
        schema: schema,
        initialValues: values,
        helpers: {}, // builtins are included by default in createFormEngine
      });

      engine.eval();
      const state = engine.getState();

      // Handle event triggering if specified (backward compatible - existing calls don't include eventType)
      let operations = [];
      if (eventType) {
        operations = engine.trigger(eventType, fieldKey);
        
        // Log events on server (simple format for now)
        operations.forEach(op => {
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

      // Return state with operations (backward compatible - existing clients ignore operations)
      res.json({ ...state, operations });
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

      // Flatten form elements to get field mappings
      const flattenedFields = flattenFields(schema.form?.elements || []);
      
      // Create structured record using the real form0-core function
      // Pass both flattened fields (for key mapping) and original elements (for nesting)
      const structuredRecord = createStructuredRecord(state, flattenedFields, {
        ...options,
        originalElements: schema.form?.elements || []
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
