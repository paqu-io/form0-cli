import { spawn } from 'child_process';
import fs from 'fs-extra';
import { createHash } from 'node:crypto';
import path from 'path';
import { resolveProjectConfig } from './project-config.js';
import { loadProjectEnv } from './project-env.js';

const INSTALL_STATE_DIR = '.form0';
const INSTALL_STATE_FILE = 'install-state.json';

const LOCKFILE_CANDIDATES = {
  pnpm: ['pnpm-lock.yaml'],
  yarn: ['yarn.lock'],
  bun: ['bun.lockb', 'bun.lock'],
  npm: ['package-lock.json', 'npm-shrinkwrap.json'],
};

const LOCKFILE_ORDER = ['pnpm', 'yarn', 'bun', 'npm'];
const EXPO_HOST_MODES = new Set(['lan', 'localhost', 'tunnel']);
const EXPO_COMMAND_BY_MANAGER = {
  npm: 'npx expo start',
  pnpm: 'pnpm exec expo start',
  yarn: 'yarn expo start',
  bun: 'bunx expo start',
};

function normalizeCommand(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function normalizeBoolean(value, defaultValue) {
  if (typeof value === 'boolean') {
    return value;
  }

  return defaultValue;
}

function normalizeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePackageManager(value) {
  if (!value) {
    return null;
  }

  const name = String(value).trim().split('@')[0];
  if (name === 'npm' || name === 'pnpm' || name === 'yarn' || name === 'bun') {
    return name;
  }

  return null;
}

function inferPackageManagerFromCommand(command) {
  if (!command) {
    return null;
  }

  const [firstToken] = command.trim().split(/\s+/);
  if (
    firstToken === 'npm' ||
    firstToken === 'pnpm' ||
    firstToken === 'yarn' ||
    firstToken === 'bun'
  ) {
    return firstToken;
  }

  if (firstToken === 'npx') {
    return 'npm';
  }

  return null;
}

function resolveInstallCommand(manager) {
  switch (manager) {
    case 'pnpm':
      return 'pnpm install';
    case 'yarn':
      return 'yarn install';
    case 'bun':
      return 'bun install';
    case 'npm':
    default:
      return 'npm install';
  }
}

async function readPackageJson(projectRoot) {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (!(await fs.pathExists(packageJsonPath))) {
    return { packageJsonPath, packageJson: null };
  }

  const raw = await fs.readFile(packageJsonPath, 'utf8');
  try {
    return { packageJsonPath, packageJson: JSON.parse(raw) };
  } catch {
    return { packageJsonPath, packageJson: null };
  }
}

async function findLockfile(projectRoot, manager) {
  const candidates = LOCKFILE_CANDIDATES[manager] || [];
  for (const name of candidates) {
    const lockfilePath = path.join(projectRoot, name);
    if (await fs.pathExists(lockfilePath)) {
      return lockfilePath;
    }
  }

  return null;
}

async function findAnyLockfile(projectRoot) {
  for (const manager of LOCKFILE_ORDER) {
    const lockfilePath = await findLockfile(projectRoot, manager);
    if (lockfilePath) {
      return { manager, lockfilePath };
    }
  }

  return { manager: null, lockfilePath: null };
}

async function detectPackageManager(projectRoot, command) {
  const { packageJson } = await readPackageJson(projectRoot);
  const fromPackageManager = parsePackageManager(packageJson?.packageManager);
  const fromCommand = inferPackageManagerFromCommand(command);

  const preferred = fromPackageManager || fromCommand;
  if (preferred) {
    const lockfilePath = await findLockfile(projectRoot, preferred);
    return {
      manager: preferred,
      lockfilePath,
    };
  }

  const detected = await findAnyLockfile(projectRoot);
  return {
    manager: detected.manager || 'npm',
    lockfilePath: detected.lockfilePath,
  };
}

export function isStructuredExpoDevServer(devServer = {}) {
  return devServer?.type === 'app' && devServer?.provider === 'expo';
}

export function hasConfiguredAppDevServer(devServer = {}) {
  return Boolean(normalizeCommand(devServer?.command) || isStructuredExpoDevServer(devServer));
}

export function resolvePublicUrl(devServer = {}, options = {}, env = process.env) {
  const cliValue = normalizeCommand(options?.publicUrl);
  if (cliValue) {
    return cliValue;
  }

  const envName = normalizeCommand(devServer?.publicUrlEnv);
  if (envName && env && typeof env[envName] === 'string') {
    const envValue = normalizeCommand(env[envName]);
    if (envValue) {
      return envValue;
    }
  }

  return normalizeCommand(devServer?.publicUrl);
}

function validateExpoHostMode(hostMode) {
  if (!EXPO_HOST_MODES.has(hostMode)) {
    throw new Error(
      `Unsupported Expo devServer.host "${hostMode}". Use one of: lan, localhost, tunnel.`
    );
  }
}

function resolveExpoHostMode(devServer = {}) {
  const hostMode = normalizeCommand(devServer?.host) || 'lan';
  validateExpoHostMode(hostMode);
  return hostMode;
}

export function buildExpoStartCommand(packageManager = 'npm', options = {}) {
  const manager = parsePackageManager(packageManager) || 'npm';
  const baseCommand = EXPO_COMMAND_BY_MANAGER[manager] || EXPO_COMMAND_BY_MANAGER.npm;
  const hostMode = options.hostMode || 'lan';
  validateExpoHostMode(hostMode);

  const args = [];
  if (hostMode === 'localhost') {
    args.push('--localhost');
  } else if (hostMode === 'tunnel') {
    args.push('--tunnel');
  } else {
    args.push('--lan');
  }

  if (normalizeBoolean(options.clearCache, true)) {
    args.push('-c');
  }

  const port = normalizeInteger(options.port, 8081);
  args.push('-p', String(port));

  return `${baseCommand} ${args.join(' ')}`;
}

export async function resolveStructuredExpoLaunch(projectRoot, devServer = {}, options = {}) {
  const hostMode = resolveExpoHostMode(devServer);
  const publicUrl = resolvePublicUrl(devServer, options, options.env);

  if (publicUrl && hostMode === 'tunnel') {
    throw new Error(
      'Structured Expo dev server cannot use devServer.host="tunnel" together with publicUrl/publicUrlEnv. Use host "lan" or "localhost" when setting a public URL.'
    );
  }

  const managerInfo = await detectPackageManager(projectRoot, '');
  const command = buildExpoStartCommand(managerInfo.manager, {
    hostMode,
    port: devServer?.port,
    clearCache: devServer?.clearCache,
  });

  return {
    mode: 'structured-expo',
    command,
    spawnCommand: command,
    envOverrides: publicUrl ? { EXPO_PACKAGER_PROXY_URL: publicUrl } : {},
    publicUrl: publicUrl || null,
    packageManager: managerInfo.manager,
  };
}

export async function resolveAppDevServerLaunch(projectRoot, devServer = {}, options = {}) {
  const legacyCommand = normalizeCommand(devServer?.command);
  if (legacyCommand) {
    return {
      mode: 'legacy',
      command: legacyCommand,
      spawnCommand: legacyCommand,
      envOverrides: {},
      publicUrl: null,
    };
  }

  if (isStructuredExpoDevServer(devServer)) {
    return resolveStructuredExpoLaunch(projectRoot, devServer, options);
  }

  throw new Error(
    'App dev server is not configured. Add devServer.command or use structured Expo devServer settings in form0.config.js.'
  );
}

async function readInstallState(projectRoot) {
  const statePath = path.join(projectRoot, INSTALL_STATE_DIR, INSTALL_STATE_FILE);
  if (!(await fs.pathExists(statePath))) {
    return null;
  }

  try {
    return await fs.readJson(statePath);
  } catch {
    return null;
  }
}

async function writeInstallState(projectRoot, state) {
  const stateDir = path.join(projectRoot, INSTALL_STATE_DIR);
  await fs.ensureDir(stateDir);
  const statePath = path.join(stateDir, INSTALL_STATE_FILE);
  await fs.writeJson(statePath, state, { spaces: 2 });
}

async function computeInstallHash(projectRoot, lockfilePath) {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (!(await fs.pathExists(packageJsonPath))) {
    return null;
  }

  const hash = createHash('sha256');
  const packageJsonBuffer = await fs.readFile(packageJsonPath);
  hash.update('package.json');
  hash.update(packageJsonBuffer);

  if (lockfilePath && (await fs.pathExists(lockfilePath))) {
    const lockfileBuffer = await fs.readFile(lockfilePath);
    hash.update(path.basename(lockfilePath));
    hash.update(lockfileBuffer);
  }

  return hash.digest('hex');
}

async function hasInstallArtifacts(projectRoot, manager) {
  const nodeModulesPath = path.join(projectRoot, 'node_modules');
  if (await fs.pathExists(nodeModulesPath)) {
    return true;
  }

  if (manager === 'yarn') {
    const pnpCandidates = ['.pnp.cjs', '.pnp.js', '.pnp.data.json'];
    for (const candidate of pnpCandidates) {
      if (await fs.pathExists(path.join(projectRoot, candidate))) {
        return true;
      }
    }
  }

  return false;
}

async function runInstallCommand(command, projectRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: projectRoot,
      shell: true,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

async function ensureDependenciesInstalled(projectRoot, command) {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (!(await fs.pathExists(packageJsonPath))) {
    return { performed: false, reason: 'no-package-json' };
  }

  const managerInfo = await detectPackageManager(projectRoot, command);
  const installArtifactsExist = await hasInstallArtifacts(projectRoot, managerInfo.manager);

  const currentHash = await computeInstallHash(projectRoot, managerInfo.lockfilePath);
  const previousState = await readInstallState(projectRoot);

  const shouldInstall =
    !installArtifactsExist ||
    (currentHash && (!previousState || previousState.hash !== currentHash));

  if (!shouldInstall) {
    return { performed: false, reason: 'up-to-date' };
  }

  const installCommand = resolveInstallCommand(managerInfo.manager);
  await runInstallCommand(installCommand, projectRoot);

  const updatedHash = await computeInstallHash(projectRoot, managerInfo.lockfilePath);
  if (updatedHash) {
    await writeInstallState(projectRoot, {
      hash: updatedHash,
      manager: managerInfo.manager,
      lockfile: managerInfo.lockfilePath ? path.basename(managerInfo.lockfilePath) : null,
      updatedAt: new Date().toISOString(),
    });
  }

  return { performed: true, reason: 'installed' };
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
    isStructuredExpo: isStructuredExpoDevServer(devServer),
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
  const { projectRoot, configPath, configExists, devServer } =
    await resolveAppDevServerConfig(startDir);

  if (!configExists) {
    throw new Error(
      `No ${path.basename(configPath)} found. Add an app dev server configuration before using --app.`
    );
  }

  await loadProjectEnv(projectRoot);

  const launch = await resolveAppDevServerLaunch(projectRoot, devServer, {
    publicUrl: options?.publicUrl,
    env: process.env,
  });

  await ensureDependenciesInstalled(projectRoot, launch.spawnCommand);

  const { allowInput = true, detached = process.platform !== 'win32' } = options;
  const useProcessGroup = detached && process.platform !== 'win32';

  const child = spawn(launch.spawnCommand, {
    cwd: projectRoot,
    env: { ...process.env, ...launch.envOverrides },
    shell: true,
    detached,
    stdio: allowInput ? 'inherit' : ['ignore', 'inherit', 'inherit'],
  });

  return {
    child,
    command: launch.command,
    projectRoot,
    configPath,
    useProcessGroup,
    publicUrl: launch.publicUrl,
    mode: launch.mode,
  };
}
