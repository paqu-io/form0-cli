import express from 'express';
import path from 'path';
import { createFormEngine } from 'form0-core';
import { fileURLToPath } from 'url';
import { getLocale, t, getRawTranslation } from '../utils/i18n.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(getCurrentSchema, getSchemaSource) {
  const app = express();

  // Serve static files
  app.use(express.static(path.join(__dirname, 'static')));

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

  // API endpoint to run engine with values
  app.post('/api/engine', express.json(), (req, res) => {
    try {
      const schema = getCurrentSchema();
      if (!schema) {
        return res.status(404).json({ error: 'No schema loaded' });
      }

      const { values = {} } = req.body;

      // Create engine with proper helpers (including builtins)
      const engine = createFormEngine({
        schema: schema,
        initialValues: values,
        helpers: {}, // builtins are included by default in createFormEngine
      });

      engine.eval();
      const state = engine.getState();

      res.json(state);
    } catch (err) {
      console.error('Engine evaluation error:', err);
      res.status(400).json({ error: err.message });
    }
  });

  // Serve main page
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'index.html'));
  });

  return app;
}
