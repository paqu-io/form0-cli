import fs from 'fs-extra';
import path from 'path';
import { pathToFileURL } from 'url';

export const PROJECT_CONFIG_FILENAME = 'form0.config.js';

const INDENT = '  ';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escapeString(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function isValidIdentifier(value) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

function formatKey(key) {
  return isValidIdentifier(key) ? key : `'${escapeString(key)}'`;
}

function formatValue(value, indentLevel) {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return `'${escapeString(value)}'`;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const innerIndent = INDENT.repeat(indentLevel + 1);
    const outerIndent = INDENT.repeat(indentLevel);
    const items = value.map((item) => `${innerIndent}${formatValue(item, indentLevel + 1)},`);
    return `[\n${items.join('\n')}\n${outerIndent}]`;
  }

  if (isPlainObject(value)) {
    return formatObject(value, indentLevel);
  }

  return 'undefined';
}

function formatObject(obj, indentLevel) {
  const entries = Object.entries(obj);
  if (entries.length === 0) {
    return '{}';
  }

  const outerIndent = INDENT.repeat(indentLevel);
  const innerIndent = INDENT.repeat(indentLevel + 1);
  const lines = entries.map(
    ([key, value]) => `${innerIndent}${formatKey(key)}: ${formatValue(value, indentLevel + 1)},`
  );

  return `{\n${lines.join('\n')}\n${outerIndent}}`;
}

function pruneUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(pruneUndefined).filter((item) => item !== undefined);
  }

  if (isPlainObject(value)) {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      const cleaned = pruneUndefined(entry);
      if (cleaned !== undefined) {
        result[key] = cleaned;
      }
    }
    return result;
  }

  return value === undefined ? undefined : value;
}

function findMatchingBrace(source, startIndex) {
  let depth = 0;
  let start = startIndex;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escape = false;

  for (let i = startIndex; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inSingle) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === "'") {
        inSingle = false;
      }
      continue;
    }

    if (inDouble) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inDouble = false;
      }
      continue;
    }

    if (inTemplate) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '`') {
        inTemplate = false;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }

    if (char === "'") {
      inSingle = true;
      continue;
    }

    if (char === '"') {
      inDouble = true;
      continue;
    }

    if (char === '`') {
      inTemplate = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return { start, end: i };
      }
    }
  }

  return null;
}

function findConnectorsPropertyRange(source) {
  const match = source.match(/^[ \t]*connectors\s*:/m);
  if (!match) {
    return null;
  }

  const start = match.index;
  const braceIndex = source.indexOf('{', match.index);
  if (braceIndex === -1) {
    return null;
  }

  const range = findMatchingBrace(source, braceIndex);
  if (!range) {
    return null;
  }

  let end = range.end + 1;
  while (end < source.length && /\s/.test(source[end])) {
    end += 1;
  }
  if (source[end] === ',') {
    end += 1;
  }

  return { start, end };
}

function findExportDefaultObjectRange(source) {
  const exportIndex = source.indexOf('export default');
  if (exportIndex === -1) {
    return null;
  }

  const braceIndex = source.indexOf('{', exportIndex);
  if (braceIndex === -1) {
    return null;
  }

  return findMatchingBrace(source, braceIndex);
}

function formatConnectorsBlock(connectors) {
  return `${INDENT}connectors: ${formatObject(connectors, 1)},`;
}

function updateConnectorsBlock(source, connectors) {
  const connectorsBlock = formatConnectorsBlock(connectors);
  const connectorsRange = findConnectorsPropertyRange(source);

  if (connectorsRange) {
    return (
      source.slice(0, connectorsRange.start) +
      connectorsBlock +
      source.slice(connectorsRange.end)
    );
  }

  const rootRange = findExportDefaultObjectRange(source);
  if (!rootRange) {
    return `${source}\n\n${connectorsBlock}\n`;
  }

  const insertIndex = rootRange.end;
  const before = source.slice(0, insertIndex);
  const after = source.slice(insertIndex);
  const trimmedBefore = before.replace(/\s*$/, '');
  const needsComma = trimmedBefore.length > 0 && !trimmedBefore.endsWith(',');
  const insert = `${needsComma ? ',' : ''}\n\n${connectorsBlock}\n`;

  return before + insert + after;
}

async function importProjectConfig(configPath) {
  try {
    const fileUrl = pathToFileURL(configPath).href;
    const module = await import(`${fileUrl}?t=${Date.now()}`);
    const config = module?.default ?? module;
    return isPlainObject(config) ? config : {};
  } catch (error) {
    console.warn(`Warning: Failed to load ${PROJECT_CONFIG_FILENAME}: ${error.message}`);
    return {};
  }
}

export async function findProjectRoot(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  let previous = null;
  let packageRoot = null;

  while (current !== previous) {
    const configPath = path.join(current, PROJECT_CONFIG_FILENAME);
    if (await fs.pathExists(configPath)) {
      return current;
    }

    if (!packageRoot) {
      const packageJsonPath = path.join(current, 'package.json');
      if (await fs.pathExists(packageJsonPath)) {
        packageRoot = current;
      }
    }

    previous = current;
    current = path.dirname(current);
  }

  return packageRoot;
}

export async function resolveProjectConfig(startDir = process.cwd()) {
  const resolvedStart = path.resolve(startDir);
  const projectRoot = (await findProjectRoot(resolvedStart)) || resolvedStart;
  const configPath = path.join(projectRoot, PROJECT_CONFIG_FILENAME);
  const configExists = await fs.pathExists(configPath);
  const config = configExists ? await importProjectConfig(configPath) : {};

  return {
    projectRoot,
    configPath,
    configExists,
    config,
  };
}

export async function loadProjectConfig(startDir = process.cwd()) {
  return resolveProjectConfig(startDir);
}

export async function getProjectConnectorConfig(connectorName, startDir = process.cwd()) {
  const { config } = await resolveProjectConfig(startDir);
  const connectors = isPlainObject(config.connectors) ? config.connectors : {};
  return connectors[connectorName] || {};
}

export async function getProjectConnectorsConfig(startDir = process.cwd()) {
  const { config } = await resolveProjectConfig(startDir);
  return isPlainObject(config.connectors) ? config.connectors : {};
}

export async function updateProjectConnectorConfig(connectorName, connectorConfig, startDir = process.cwd()) {
  const { projectRoot, configPath, configExists, config } = await resolveProjectConfig(startDir);
  const connectors = isPlainObject(config.connectors) ? config.connectors : {};
  const cleanedConfig = pruneUndefined(connectorConfig);

  const updatedConnectors = pruneUndefined({
    ...connectors,
    [connectorName]: cleanedConfig,
  });

  if (!configExists) {
    const newContent = `export default {\n${formatConnectorsBlock(updatedConnectors)}\n};\n`;
    await fs.writeFile(configPath, newContent);
  } else {
    const source = await fs.readFile(configPath, 'utf8');
    const updatedSource = updateConnectorsBlock(source, updatedConnectors);
    await fs.writeFile(configPath, updatedSource);
  }

  return { projectRoot, configPath, connectors: updatedConnectors };
}

export async function removeProjectConnectorConfig(connectorName, startDir = process.cwd()) {
  const { projectRoot, configPath, configExists, config } = await resolveProjectConfig(startDir);
  const connectors = isPlainObject(config.connectors) ? config.connectors : {};

  if (!Object.prototype.hasOwnProperty.call(connectors, connectorName)) {
    return { projectRoot, configPath, connectors, removed: false };
  }

  const { [connectorName]: _removed, ...remaining } = connectors;

  if (!configExists) {
    return { projectRoot, configPath, connectors: remaining, removed: true };
  }

  const source = await fs.readFile(configPath, 'utf8');
  const updatedSource = updateConnectorsBlock(source, remaining);
  await fs.writeFile(configPath, updatedSource);

  return { projectRoot, configPath, connectors: remaining, removed: true };
}
