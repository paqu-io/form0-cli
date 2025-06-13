import fs from 'fs-extra';
import { validateSchema } from 'form0';

export async function validateCommand(file) {
  try {
    const data = await fs.readJson(file);
    validateSchema(data.form);
    console.log('✅ Schema is valid.');
  } catch (err) {
    console.error('❌ Schema validation failed:', err.message);
    process.exit(1);
  }
}