import fs from 'fs-extra';
import path from 'path';
import yaml from 'yaml';
import { COMMON_SCHEMA_PATHS, COMMON_TEST_VALUE_FILES } from './constants.js';

/**
 * Find existing schema files in the current directory
 * @returns {Promise<string|null>} Path to found schema file or null
 */
export async function findExistingSchema() {
  for (const schemaPath of COMMON_SCHEMA_PATHS) {
    if (await fs.pathExists(schemaPath)) {
      return schemaPath;
    }
  }
  return null;
}

/**
 * Parse values input from various formats (JSON file, YAML file, or inline JSON)
 * @param {string} valuesInput - File path or JSON string
 * @returns {Promise<Object>} Parsed values object
 */
export async function parseValuesInput(valuesInput) {
  const ext = path.extname(valuesInput).toLowerCase();

  if (ext === '.yaml' || ext === '.yml') {
    const yamlText = await fs.readFile(valuesInput, 'utf8');
    return yaml.parse(yamlText);
  } else if (ext === '.json') {
    return await fs.readJson(valuesInput);
  } else {
    // Treat as inline JSON string
    return JSON.parse(valuesInput);
  }
}

/**
 * Find existing test value files in the current directory
 * @returns {Promise<string|null>} Path to found test file or null
 */
export async function findTestValueFile() {
  for (const testFile of COMMON_TEST_VALUE_FILES) {
    if (await fs.pathExists(testFile)) {
      return testFile;
    }
  }
  return null;
}

/**
 * Count total number of elements in a form structure (recursive)
 * @param {Array} elements - Form elements array
 * @returns {number} Total count of elements
 */
export function countElements(elements) {
  let count = 0;
  for (const element of elements) {
    count++;
    if (element.type === 'Section' && element.elements) {
      count += countElements(element.elements);
    }
  }
  return count;
}
