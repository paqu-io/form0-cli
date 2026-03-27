import crypto from 'node:crypto';
import path from 'path';
import fs from 'fs-extra';
import { validateSchema } from 'form0-core';
import { ensureChoiceValuesForSchema } from './ensure-choice-values.js';
import { detectSchemaProject } from './schema-utils.js';
import {
  removeFormFromRegistry,
  upsertFormInRegistry,
} from './schema-registry.js';
import { getReformFormSchema, listReformForms } from './reform-client.js';

export const REFORM_SYNC_MANIFEST_VERSION = 1;
export const REFORM_SYNC_MANIFEST_PATHNAME = path.join(
  '.form0',
  'reform-sync.json',
);

function createEmptyManifest() {
  return {
    version: REFORM_SYNC_MANIFEST_VERSION,
    scope: null,
    forms: {},
  };
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

function normalizeManifestEntry(remoteFormId, entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const localAlias =
    typeof entry.localAlias === 'string' ? entry.localAlias.trim() : '';
  const localPath =
    typeof entry.localPath === 'string' ? entry.localPath.trim() : '';

  if (!localAlias || !localPath) {
    return null;
  }

  return {
    remoteFormId,
    localAlias,
    localPath,
    scope: normalizeScope(entry.scope),
    remoteRevision:
      typeof entry.remoteRevision === 'number' ? entry.remoteRevision : null,
    lastSyncedRevision:
      typeof entry.lastSyncedRevision === 'number'
        ? entry.lastSyncedRevision
        : null,
    remoteUpdatedAt:
      typeof entry.remoteUpdatedAt === 'string' ? entry.remoteUpdatedAt : null,
    lastSyncedHash:
      typeof entry.lastSyncedHash === 'string' ? entry.lastSyncedHash : null,
    lastSyncedAt:
      typeof entry.lastSyncedAt === 'string' ? entry.lastSyncedAt : null,
    remoteState:
      typeof entry.remoteState === 'string' ? entry.remoteState : 'active',
    syncStatus:
      typeof entry.syncStatus === 'string' ? entry.syncStatus : 'synced',
    lastImportError:
      typeof entry.lastImportError === 'string' ? entry.lastImportError : null,
    lastConflictAt:
      typeof entry.lastConflictAt === 'string' ? entry.lastConflictAt : null,
  };
}

function normalizeManifest(manifest) {
  const normalized = createEmptyManifest();
  if (!manifest || typeof manifest !== 'object') {
    return normalized;
  }

  normalized.version =
    typeof manifest.version === 'number'
      ? manifest.version
      : REFORM_SYNC_MANIFEST_VERSION;
  normalized.scope = normalizeScope(manifest.scope);

  const forms =
    manifest.forms && typeof manifest.forms === 'object' ? manifest.forms : {};
  for (const [remoteFormId, entry] of Object.entries(forms)) {
    const normalizedEntry = normalizeManifestEntry(remoteFormId, entry);
    if (normalizedEntry) {
      normalized.forms[remoteFormId] = normalizedEntry;
    }
  }

  return normalized;
}

function hashString(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function hashFile(filePath) {
  if (!(await fs.pathExists(filePath))) {
    return null;
  }

  const contents = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function sanitizeAlias(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getFallbackAlias(remoteFormId) {
  return `form-${String(remoteFormId).slice(0, 8).toLowerCase()}`;
}

function isAppProject(project) {
  return project.type === 'web' || project.type === 'mobile';
}

function ensureRegistryAvailable(project) {
  if (!isAppProject(project)) {
    return;
  }
  if (!project.registryPath) {
    throw new Error('App projects require a forms registry file.');
  }
}

function getAbsoluteSchemaPath(project, localAlias) {
  if (isAppProject(project)) {
    return path.join(project.formsDir, localAlias, 'schema.json');
  }
  return path.join(project.projectRoot, `${localAlias}.schema.json`);
}

function getRelativeSchemaPath(project, localAlias) {
  return path.relative(
    project.projectRoot,
    getAbsoluteSchemaPath(project, localAlias),
  );
}

function buildRegistryEntry(localAlias, formSummary) {
  return {
    id: localAlias,
    title:
      typeof formSummary?.name === 'string' && formSummary.name.trim().length > 0
        ? formSummary.name.trim()
        : localAlias,
    description:
      typeof formSummary?.description === 'string'
        ? formSummary.description
        : '',
    tags: [],
  };
}

async function assignLocalAlias(project, manifest, remoteFormId, remoteName) {
  const usedAliases = new Set(
    Object.entries(manifest.forms)
      .filter(([entryRemoteFormId]) => entryRemoteFormId !== remoteFormId)
      .map(([, entry]) => entry.localAlias),
  );

  const baseAlias =
    sanitizeAlias(remoteName) || getFallbackAlias(remoteFormId);
  let candidate = baseAlias;
  let suffix = 2;

  while (true) {
    const targetPath = getAbsoluteSchemaPath(project, candidate);
    const alreadyExistsOnDisk = await fs.pathExists(targetPath);
    if (!usedAliases.has(candidate) && !alreadyExistsOnDisk) {
      return candidate;
    }

    candidate = `${baseAlias}-${suffix}`;
    suffix += 1;
  }
}

async function writeSchemaFile(project, localAlias, schemaObject, formSummary) {
  const absoluteSchemaPath = getAbsoluteSchemaPath(project, localAlias);
  await fs.ensureDir(path.dirname(absoluteSchemaPath));
  const serialized = `${JSON.stringify(schemaObject, null, 2)}\n`;
  await fs.writeFile(absoluteSchemaPath, serialized, 'utf8');

  if (isAppProject(project)) {
    ensureRegistryAvailable(project);
    await upsertFormInRegistry(
      project.registryPath,
      buildRegistryEntry(localAlias, formSummary),
    );
  }

  return {
    absoluteSchemaPath,
    relativeSchemaPath: path.relative(project.projectRoot, absoluteSchemaPath),
    serialized,
  };
}

async function ensureRegistryEntry(project, localAlias, formSummary) {
  if (!isAppProject(project)) {
    return;
  }

  ensureRegistryAvailable(project);
  await upsertFormInRegistry(
    project.registryPath,
    buildRegistryEntry(localAlias, formSummary),
  );
}

async function isEntryLocallyModified(project, entry) {
  const absoluteSchemaPath = path.resolve(project.projectRoot, entry.localPath);
  const currentHash = await hashFile(absoluteSchemaPath);
  if (!currentHash || !entry.lastSyncedHash) {
    return false;
  }
  return currentHash !== entry.lastSyncedHash;
}

function sortEntries(entries) {
  return [...entries].sort((left, right) =>
    left.localAlias.localeCompare(right.localAlias),
  );
}

export function getReformSyncManifestPath(projectRoot) {
  return path.join(projectRoot, REFORM_SYNC_MANIFEST_PATHNAME);
}

export async function loadReformSyncManifest(projectRoot) {
  const manifestPath = getReformSyncManifestPath(projectRoot);
  if (!(await fs.pathExists(manifestPath))) {
    return createEmptyManifest();
  }

  const parsed = await fs.readJson(manifestPath);
  return normalizeManifest(parsed);
}

export async function saveReformSyncManifest(projectRoot, manifest) {
  const manifestPath = getReformSyncManifestPath(projectRoot);
  const normalized = normalizeManifest(manifest);
  await fs.ensureDir(path.dirname(manifestPath));
  await fs.writeJson(manifestPath, normalized, { spaces: 2 });
  return normalized;
}

export async function getReformSyncStatus(projectRoot = process.cwd()) {
  const project = await detectSchemaProject(projectRoot);
  const manifest = await loadReformSyncManifest(project.projectRoot);
  const manifestPath = getReformSyncManifestPath(project.projectRoot);

  const entries = await Promise.all(
    Object.values(manifest.forms).map(async (entry) => {
      const absoluteSchemaPath = path.resolve(project.projectRoot, entry.localPath);
      const currentHash = await hashFile(absoluteSchemaPath);

      return {
        ...entry,
        absoluteSchemaPath,
        exists: currentHash !== null,
        modifiedLocally:
          Boolean(currentHash) &&
          Boolean(entry.lastSyncedHash) &&
          currentHash !== entry.lastSyncedHash,
      };
    }),
  );

  return {
    project,
    manifestPath,
    manifest,
    entries: sortEntries(entries),
  };
}

export async function pullReformForms({
  projectRoot = process.cwd(),
  apiBaseUrl,
  accessToken,
  scope,
  force = false,
}) {
  const normalizedScope = normalizeScope(scope);
  if (!normalizedScope) {
    throw new Error('A Reform scope is required before syncing forms.');
  }

  const project = await detectSchemaProject(projectRoot);
  if (isAppProject(project)) {
    ensureRegistryAvailable(project);
    if (!(await fs.pathExists(project.registryPath))) {
      throw new Error(`Registry file not found at ${project.registryPath}.`);
    }
  }

  const manifest = await loadReformSyncManifest(project.projectRoot);
  manifest.scope = normalizedScope;

  const remoteForms = await listReformForms({
    apiBaseUrl,
    accessToken,
    scope: normalizedScope,
    state: 'all',
  });

  const nowIso = new Date().toISOString();
  const remoteIds = new Set();
  const summary = {
    created: [],
    updated: [],
    unchanged: [],
    deleted: [],
    unreachable: [],
    conflicts: [],
    importErrors: [],
  };

  for (const formSummary of remoteForms) {
    const remoteFormId = String(formSummary.id);
    remoteIds.add(remoteFormId);

    const existingEntry = manifest.forms[remoteFormId] ?? null;
    const remoteState = formSummary.deleted_at ? 'deleted' : 'active';

    if (remoteState === 'deleted') {
      if (existingEntry) {
        manifest.forms[remoteFormId] = {
          ...existingEntry,
          scope: normalizedScope,
          remoteRevision: formSummary.revision_number,
          remoteUpdatedAt: formSummary.updated_at ?? null,
          remoteState: 'deleted',
          syncStatus: 'deleted',
          lastImportError: null,
        };
        summary.deleted.push(existingEntry.localAlias);
      }
      continue;
    }

    const localAlias =
      existingEntry?.localAlias ??
      (await assignLocalAlias(
        project,
        manifest,
        remoteFormId,
        formSummary.name,
      ));
    const localPath = getRelativeSchemaPath(project, localAlias);
    const baseEntry = {
      remoteFormId,
      localAlias,
      localPath,
      scope: normalizedScope,
      remoteRevision: formSummary.revision_number,
      lastSyncedRevision: existingEntry?.lastSyncedRevision ?? null,
      remoteUpdatedAt: formSummary.updated_at ?? null,
      lastSyncedHash: existingEntry?.lastSyncedHash ?? null,
      lastSyncedAt: existingEntry?.lastSyncedAt ?? null,
      remoteState: 'active',
      syncStatus: existingEntry?.syncStatus ?? 'synced',
      lastImportError: existingEntry?.lastImportError ?? null,
      lastConflictAt: existingEntry?.lastConflictAt ?? null,
    };

    if (existingEntry) {
      await ensureRegistryEntry(project, localAlias, formSummary);
    }

    const shouldRefetch =
      !existingEntry ||
      existingEntry.lastSyncedRevision !== formSummary.revision_number ||
      Boolean(existingEntry.lastImportError);

    if (!shouldRefetch) {
      manifest.forms[remoteFormId] = {
        ...baseEntry,
        syncStatus: 'synced',
        lastImportError: null,
      };
      summary.unchanged.push(localAlias);
      continue;
    }

    const modifiedLocally =
      existingEntry && (await isEntryLocallyModified(project, existingEntry));

    if (modifiedLocally && !force) {
      manifest.forms[remoteFormId] = {
        ...baseEntry,
        syncStatus: 'modified_locally',
        lastConflictAt: nowIso,
      };
      summary.conflicts.push(localAlias);
      continue;
    }

    try {
      const formSchema = await getReformFormSchema({
        apiBaseUrl,
        accessToken,
        formId: remoteFormId,
        scope: normalizedScope,
      });

      ensureChoiceValuesForSchema(formSchema?.form?.elements ?? []);
      validateSchema(formSchema.form);

      const writeResult = await writeSchemaFile(
        project,
        localAlias,
        formSchema,
        formSummary,
      );
      const lastSyncedHash = hashString(writeResult.serialized);

      manifest.forms[remoteFormId] = {
        ...baseEntry,
        localPath: writeResult.relativeSchemaPath,
        lastSyncedRevision: formSummary.revision_number,
        lastSyncedHash,
        lastSyncedAt: nowIso,
        syncStatus: 'synced',
        lastImportError: null,
        lastConflictAt: null,
      };

      if (existingEntry) {
        summary.updated.push(localAlias);
      } else {
        summary.created.push(localAlias);
      }
    } catch (error) {
      manifest.forms[remoteFormId] = {
        ...baseEntry,
        syncStatus: 'import_error',
        lastImportError: error.message,
      };
      summary.importErrors.push({
        localAlias,
        message: error.message,
      });
    }
  }

  for (const [remoteFormId, entry] of Object.entries(manifest.forms)) {
    if (remoteIds.has(remoteFormId)) {
      continue;
    }

    manifest.forms[remoteFormId] = {
      ...entry,
      scope: normalizedScope,
      remoteState: 'unreachable',
      syncStatus: 'unreachable',
    };
    summary.unreachable.push(entry.localAlias);
  }

  const savedManifest = await saveReformSyncManifest(
    project.projectRoot,
    manifest,
  );

  return {
    project,
    manifestPath: getReformSyncManifestPath(project.projectRoot),
    manifest: savedManifest,
    summary,
  };
}

export async function pruneDeletedReformForms({
  projectRoot = process.cwd(),
  force = false,
  dryRun = false,
}) {
  const status = await getReformSyncStatus(projectRoot);
  const manifest = status.manifest;

  const prunable = status.entries.filter((entry) => entry.remoteState === 'deleted');
  const skippedModified = [];
  const pruned = [];

  for (const entry of prunable) {
    if (entry.modifiedLocally && !force) {
      skippedModified.push(entry.localAlias);
      continue;
    }

    pruned.push(entry.localAlias);
    if (dryRun) {
      continue;
    }

    if (isAppProject(status.project)) {
      const formDirectory = path.dirname(entry.absoluteSchemaPath);
      if (await fs.pathExists(formDirectory)) {
        await fs.remove(formDirectory);
      }
      if (status.project.registryPath && (await fs.pathExists(status.project.registryPath))) {
        await removeFormFromRegistry(status.project.registryPath, entry.localAlias);
      }
    } else if (await fs.pathExists(entry.absoluteSchemaPath)) {
      await fs.remove(entry.absoluteSchemaPath);
    }

    delete manifest.forms[entry.remoteFormId];
  }

  if (!dryRun && pruned.length > 0) {
    await saveReformSyncManifest(status.project.projectRoot, manifest);
  }

  return {
    ...status,
    prunable: prunable.map((entry) => entry.localAlias),
    skippedModified,
    pruned,
    dryRun,
  };
}
