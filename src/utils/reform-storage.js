import fs from 'fs-extra';
import os from 'os';
import path from 'path';

const FORM0_CONFIG_DIR = path.join(os.homedir(), '.form0-cli');
const REFORM_AUTH_FILE = path.join(FORM0_CONFIG_DIR, 'auth.json');
const REFORM_SETTINGS_FILE = path.join(FORM0_CONFIG_DIR, 'reform.json');
const KEYCHAIN_SERVICE = 'form0-cli.reform';
const KEYCHAIN_ACCOUNT = 'session';

const DEFAULT_REFORM_SETTINGS = {
  authBaseUrl: null,
  apiBaseUrl: null,
  scope: null,
};

let keytarPromise = null;

async function ensureConfigDir() {
  await fs.ensureDir(FORM0_CONFIG_DIR);
}

async function applyPrivateFileMode(filePath) {
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // Ignore chmod failures on platforms/filesystems that do not support it.
  }
}

async function loadKeytar() {
  if (process.env.FORM0_CLI_DISABLE_KEYCHAIN === 'true') {
    return null;
  }

  if (keytarPromise) {
    return keytarPromise;
  }

  keytarPromise = import('keytar')
    .then((module) => module.default ?? module)
    .catch(() => null);

  return keytarPromise;
}

function normalizeScope(scope) {
  if (!scope || typeof scope !== 'object') {
    return null;
  }

  const mainOrgId =
    typeof scope.main_org_id === 'string' ? scope.main_org_id.trim() : '';
  const subOrgId =
    typeof scope.sub_org_id === 'string' ? scope.sub_org_id.trim() : '';

  if (!mainOrgId) {
    return null;
  }

  return {
    main_org_id: mainOrgId,
    sub_org_id: subOrgId || null,
  };
}

export async function getStoredReformAuth() {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      const raw = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch {
      // Fall back to file storage below.
    }
  }

  if (!(await fs.pathExists(REFORM_AUTH_FILE))) {
    return null;
  }

  return fs.readJson(REFORM_AUTH_FILE);
}

export async function saveStoredReformAuth(authRecord) {
  await ensureConfigDir();

  const serialized = JSON.stringify(authRecord);
  const keytar = await loadKeytar();

  if (keytar) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, serialized);
      if (await fs.pathExists(REFORM_AUTH_FILE)) {
        await fs.remove(REFORM_AUTH_FILE);
      }
      return { storage: 'keychain' };
    } catch {
      // Fall back to file storage when the keychain backend is unavailable.
    }
  }

  await fs.writeFile(REFORM_AUTH_FILE, `${serialized}\n`, 'utf8');
  await applyPrivateFileMode(REFORM_AUTH_FILE);
  return { storage: 'file' };
}

export async function clearStoredReformAuth() {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      await keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    } catch {
      // Best effort only.
    }
  }

  if (await fs.pathExists(REFORM_AUTH_FILE)) {
    await fs.remove(REFORM_AUTH_FILE);
  }
}

export async function readReformSettings() {
  await ensureConfigDir();

  if (!(await fs.pathExists(REFORM_SETTINGS_FILE))) {
    return { ...DEFAULT_REFORM_SETTINGS };
  }

  const parsed = await fs.readJson(REFORM_SETTINGS_FILE);
  return {
    ...DEFAULT_REFORM_SETTINGS,
    ...(parsed && typeof parsed === 'object' ? parsed : {}),
    scope: normalizeScope(parsed?.scope),
  };
}

export async function writeReformSettings(settings) {
  await ensureConfigDir();

  const nextSettings = {
    ...DEFAULT_REFORM_SETTINGS,
    ...(settings && typeof settings === 'object' ? settings : {}),
    scope: normalizeScope(settings?.scope),
  };

  await fs.writeJson(REFORM_SETTINGS_FILE, nextSettings, { spaces: 2 });
  await applyPrivateFileMode(REFORM_SETTINGS_FILE);
  return nextSettings;
}

export async function updateReformSettings(updates) {
  const current = await readReformSettings();
  return writeReformSettings({
    ...current,
    ...(updates && typeof updates === 'object' ? updates : {}),
    scope:
      updates && Object.prototype.hasOwnProperty.call(updates, 'scope')
        ? updates.scope
        : current.scope,
  });
}

export async function clearReformScope() {
  const current = await readReformSettings();
  return writeReformSettings({
    ...current,
    scope: null,
  });
}

export function normalizeReformScope(scope) {
  return normalizeScope(scope);
}

export function getReformAuthFilePath() {
  return REFORM_AUTH_FILE;
}

export function getReformSettingsFilePath() {
  return REFORM_SETTINGS_FILE;
}
