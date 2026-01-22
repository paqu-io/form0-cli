import fs from 'fs-extra';
import path from 'path';
import yaml from 'yaml';
import { COMMON_SCHEMA_PATTERNS, COMMON_TEST_VALUE_FILES } from './constants.js';
import { resolveProjectConfig } from './project-config.js';
import { isReactNativeProject } from './project-detection.js';

/**
 * Find existing schema files in the current project
 * @returns {Promise<string|null>} Path to found schema file or null
 */
export async function findExistingSchema(startDir = process.cwd()) {
  const { candidates } = await discoverSchemas(startDir);
  if (candidates.length === 1) {
    return candidates[0].path;
  }
  return null;
}

function buildCandidate(fullPath, startDir, source, formName = null) {
  const relativePath = path.relative(startDir, fullPath) || path.basename(fullPath);
  return {
    path: relativePath,
    fullPath,
    displayPath: relativePath,
    source,
    formName,
  };
}

function hasSchemasConfig(config) {
  return (
    config &&
    typeof config === 'object' &&
    config.schemas &&
    typeof config.schemas === 'object'
  );
}

function normalizeConfiguredDir(directory, baseDir) {
  if (!directory || typeof directory !== 'string') {
    return null;
  }
  const trimmed = directory.trim();
  if (!trimmed) {
    return null;
  }
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(baseDir, trimmed);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function patternToRegex(pattern) {
  const escaped = escapeRegex(pattern).replace(/\\\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

const SCHEMA_PATTERN_REGEXES = COMMON_SCHEMA_PATTERNS.map(patternToRegex);

function matchesSchemaPatterns(filename) {
  return SCHEMA_PATTERN_REGEXES.some((regex) => regex.test(filename));
}

async function listSchemaFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && matchesSchemaPatterns(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * Discover schema files in the current project.
 * @param {string} startDir - Base directory for relative paths.
 * @returns {Promise<{ candidates: Array, formsDir: string | null, projectRoot: string }>}
 */
export async function discoverSchemas(startDir = process.cwd()) {
  const resolvedStart = path.resolve(startDir);
  const { projectRoot, config } = await resolveProjectConfig(resolvedStart);
  const baseDir = projectRoot || resolvedStart;
  const candidates = [];
  const seen = new Set();

  const addCandidate = (fullPath, meta) => {
    const normalized = path.resolve(fullPath);
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push(buildCandidate(normalized, resolvedStart, meta.source, meta.formName));
  };

  const rootFiles = await listSchemaFiles(resolvedStart);
  for (const filename of rootFiles) {
    const fullPath = path.resolve(resolvedStart, filename);
    addCandidate(fullPath, { source: 'root' });
  }

  let formsDir = null;
  if (hasSchemasConfig(config)) {
    formsDir = normalizeConfiguredDir(config.schemas.directory, baseDir);
  }

  if (!formsDir) {
    const fallback = path.join(baseDir, 'src', 'forms');
    if (await fs.pathExists(fallback)) {
      formsDir = fallback;
    }
  }

  if (formsDir) {
    try {
      const stats = await fs.stat(formsDir);
      if (!stats.isDirectory()) {
        formsDir = null;
      }
    } catch {
      formsDir = null;
    }
  }

  if (formsDir) {
    const entries = await fs.readdir(formsDir, { withFileTypes: true });
    const formDirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    for (const formName of formDirs) {
      const formDir = path.join(formsDir, formName);
      const schemaFiles = await listSchemaFiles(formDir);
      for (const filename of schemaFiles) {
        const schemaPath = path.join(formDir, filename);
        addCandidate(schemaPath, { source: 'forms', formName });
      }
    }
  } else {
    formsDir = null;
  }

  return { candidates, formsDir, projectRoot: baseDir };
}

/**
 * Detect schema project type and relevant paths.
 * @param {string} startDir
 * @returns {Promise<{type: 'standard'|'web'|'mobile', projectRoot: string, formsDir: string, registryPath: string|null, config: object}>}
 */
export async function detectSchemaProject(startDir = process.cwd()) {
  const resolvedStart = path.resolve(startDir);
  const { projectRoot, config } = await resolveProjectConfig(resolvedStart);
  const baseDir = projectRoot || resolvedStart;
  const configuredFormsDir = hasSchemasConfig(config)
    ? normalizeConfiguredDir(config.schemas.directory, baseDir)
    : null;
  const fallbackFormsDir = path.join(baseDir, 'src', 'forms');
  const formsDir = configuredFormsDir || fallbackFormsDir;
  const registryPath = path.join(formsDir, 'registry.js');

  const isMobile = await isReactNativeProject(baseDir);
  if (isMobile) {
    return {
      type: 'mobile',
      projectRoot: baseDir,
      formsDir,
      registryPath,
      config,
    };
  }

  const hasRegistry = await fs.pathExists(registryPath);
  if (configuredFormsDir || hasRegistry) {
    return {
      type: 'web',
      projectRoot: baseDir,
      formsDir,
      registryPath,
      config,
    };
  }

  return {
    type: 'standard',
    projectRoot: baseDir,
    formsDir,
    registryPath: null,
    config,
  };
}

export function formatSchemaCandidate(candidate) {
  if (candidate.formName) {
    return `${candidate.formName} (${candidate.displayPath})`;
  }
  return candidate.displayPath;
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
    if ((element.type === 'Section' || element.type === 'RepeatableSection') && element.elements) {
      count += countElements(element.elements);
    }
  }
  return count;
}
