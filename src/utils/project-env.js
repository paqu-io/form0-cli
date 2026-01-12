import fs from 'fs-extra';
import path from 'path';
import dotenv from 'dotenv';
import { resolveProjectConfig } from './project-config.js';

export const PROJECT_ENV_FILENAME = '.env.local';

function formatEnvValue(value) {
  if (value === undefined || value === null) {
    return '';
  }

  const stringValue = String(value);
  if (/[\s#]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '\\"')}"`;
  }

  return stringValue;
}

export async function resolveProjectEnv(startDir = process.cwd()) {
  const { projectRoot } = await resolveProjectConfig(startDir);
  const envPath = path.join(projectRoot, PROJECT_ENV_FILENAME);
  const envExists = await fs.pathExists(envPath);
  let env = {};

  if (envExists) {
    const contents = await fs.readFile(envPath, 'utf8');
    env = dotenv.parse(contents);
  }

  return { projectRoot, envPath, envExists, env };
}

export async function loadProjectEnv(startDir = process.cwd()) {
  const { envPath, envExists } = await resolveProjectEnv(startDir);

  if (!envExists) {
    return { envPath, envExists };
  }

  const result = dotenv.config({ path: envPath });
  return { envPath, envExists, result };
}

export async function upsertProjectEnv(updates, startDir = process.cwd()) {
  const { projectRoot, envPath, envExists } = await resolveProjectEnv(startDir);
  const entries = Object.entries(updates).filter(([, value]) => value !== undefined);

  if (entries.length === 0 && envExists) {
    return { projectRoot, envPath };
  }

  let existingContent = '';
  if (envExists) {
    existingContent = await fs.readFile(envPath, 'utf8');
  }

  const lines = existingContent ? existingContent.split(/\r?\n/) : [];
  const updateKeys = new Set(entries.map(([key]) => key));
  const seenKeys = new Set();

  const updatedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return line;
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      return line;
    }

    const key = line.slice(0, eqIndex).trim();
    if (!updateKeys.has(key)) {
      return line;
    }

    seenKeys.add(key);
    const value = updates[key];
    return `${key}=${formatEnvValue(value)}`;
  });

  for (const [key, value] of entries) {
    if (!seenKeys.has(key)) {
      updatedLines.push(`${key}=${formatEnvValue(value)}`);
    }
  }

  const newContent = updatedLines.join('\n');
  const finalContent = newContent.endsWith('\n') ? newContent : `${newContent}\n`;
  await fs.writeFile(envPath, finalContent);

  return { projectRoot, envPath };
}

export async function removeProjectEnvKeys(keys = [], startDir = process.cwd()) {
  const { projectRoot, envPath, envExists } = await resolveProjectEnv(startDir);
  const keySet = new Set((keys || []).filter(Boolean));

  if (!envExists || keySet.size === 0) {
    return { projectRoot, envPath, removed: [] };
  }

  const existingContent = await fs.readFile(envPath, 'utf8');
  const lines = existingContent.split(/\r?\n/);
  const removed = [];

  const keptLines = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return true;
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      return true;
    }

    const key = line.slice(0, eqIndex).trim();
    if (keySet.has(key)) {
      removed.push(key);
      return false;
    }

    return true;
  });

  const newContent = keptLines.join('\n');
  const finalContent = newContent.endsWith('\n') ? newContent : `${newContent}\n`;
  await fs.writeFile(envPath, finalContent);

  return { projectRoot, envPath, removed };
}
