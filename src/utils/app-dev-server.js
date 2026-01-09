import { spawn } from 'child_process';
import path from 'path';
import { resolveProjectConfig } from './project-config.js';
import { loadProjectEnv } from './project-env.js';

function normalizeCommand(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

export async function resolveAppDevServerConfig(startDir = process.cwd()) {
  const { projectRoot, configPath, configExists, config } = await resolveProjectConfig(startDir);
  const devServer = config?.devServer || {};
  const command = normalizeCommand(devServer.command);

  return {
    projectRoot,
    configPath,
    configExists,
    devServer,
    command,
  };
}

export function terminateAppDevServer(child, options = {}) {
  if (!child) {
    return;
  }

  const { signal = 'SIGINT', useProcessGroup = false } = options;

  if (useProcessGroup && child.pid && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (err) {
      // Fall back to direct kill.
    }
  }

  try {
    child.kill(signal);
  } catch (err) {
    try {
      child.kill('SIGTERM');
    } catch (innerErr) {
      // Ignore
    }
  }
}

export async function startAppDevServer(startDir = process.cwd(), options = {}) {
  const { projectRoot, configPath, configExists, command } =
    await resolveAppDevServerConfig(startDir);

  if (!configExists) {
    throw new Error(`No ${path.basename(configPath)} found. Add devServer.command to configure.`);
  }

  if (!command) {
    throw new Error(
      `devServer.command is missing in ${path.basename(
        configPath
      )}. If this is not an app project, run "serve" without --app.`
    );
  }

  const { allowInput = true, detached = process.platform !== 'win32' } = options;
  const useProcessGroup = detached && process.platform !== 'win32';

  await loadProjectEnv(projectRoot);

  const child = spawn(command, {
    cwd: projectRoot,
    env: { ...process.env },
    shell: true,
    detached,
    stdio: allowInput ? 'inherit' : ['ignore', 'inherit', 'inherit'],
  });

  return { child, command, projectRoot, configPath, useProcessGroup };
}
