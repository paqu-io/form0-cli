import fs from 'fs-extra';
import path from 'path';
import { createFormEngine } from 'form0-core';
import yaml from 'yaml';

export async function runCommand(schemaPath, options) {
  try {
    const data = await fs.readJson(schemaPath);
    const valuesInput = options.values;
    let initialValues = {};

    if (valuesInput) {
        const ext = path.extname(valuesInput).toLowerCase();
        if (ext === '.yaml' || ext === '.yml') {
          const yamlText = await fs.readFile(valuesInput, 'utf8');
          initialValues = yaml.parse(yamlText);
        } else if (ext === '.json') {
          initialValues = await fs.readJson(valuesInput);
        } else {
          // Treat as inline JSON string
          initialValues = JSON.parse(valuesInput);
        }
    }      

    const engine = createFormEngine({
      schema: data,
      initialValues
    });

    engine.eval();
    console.log('🧠 Engine State:\n');
    console.log(JSON.stringify(engine.getState(), null, 2));
  } catch (err) {
    console.error('❌ Failed to run engine:', err.message);
    process.exit(1);
  }
}