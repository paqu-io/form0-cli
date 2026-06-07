import { spawn } from 'node:child_process';
import path from 'path';
import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import fs from 'fs-extra';
import { colors } from '../utils/theme.js';
import { t } from '../utils/i18n.js';
import {
  DEFAULT_REFORM_DEVICE_CLIENT_ID,
  fetchReformSession,
  listSubOrganizations,
  listTopLevelOrganizations,
  pollDeviceToken,
  requestDeviceCode,
  resolveReformBaseUrls,
  signOutReformSession,
} from '../utils/reform-client.js';
import {
  clearReformScope,
  clearStoredReformAuth,
  getStoredReformAuth,
  readReformSettings,
  saveStoredReformAuth,
  updateReformSettings,
} from '../utils/reform-storage.js';
import {
  getReformSyncStatus,
  pullReformForms,
  pruneDeletedReformForms,
} from '../utils/reform-sync.js';

function canPrompt(readlineInterface) {
  return Boolean(readlineInterface || (input.isTTY && output.isTTY));
}

function createReadline(readlineInterface) {
  if (readlineInterface) {
    return { rl: readlineInterface, shouldClose: false };
  }

  return {
    rl: readline.createInterface({ input, output }),
    shouldClose: true,
  };
}

async function askQuestion(readlineInterface, prompt) {
  const { rl, shouldClose } = createReadline(readlineInterface);
  const answer = await new Promise((resolve) => {
    rl.question(prompt, (response) => {
      resolve(response.trim());
    });
  });

  if (shouldClose) {
    rl.close();
  }

  return answer;
}

async function confirmAction(message, { readlineInterface } = {}) {
  if (!canPrompt(readlineInterface)) {
    return false;
  }

  const answer = await askQuestion(readlineInterface, colors.warning(`${message} [y/N] `));

  return /^y(es)?$/i.test(answer);
}

async function promptSelect({
  title,
  options,
  includeNoneOption = false,
  noneLabel = t('commands.reform.selection.none'),
  readlineInterface,
}) {
  if (!canPrompt(readlineInterface)) {
    return null;
  }

  const renderedOptions = includeNoneOption
    ? [{ label: noneLabel, value: null }, ...options]
    : options;

  console.log(colors.header(`\n${title}`));
  renderedOptions.forEach((option, index) => {
    console.log(colors.text(`  ${index + 1}) ${option.label}`));
  });

  while (true) {
    const answer = await askQuestion(
      readlineInterface,
      colors.text(t('commands.reform.selection.prompt'))
    );

    if (!answer) {
      return null;
    }

    const selectedIndex = Number.parseInt(answer, 10);
    if (
      Number.isInteger(selectedIndex) &&
      selectedIndex >= 1 &&
      selectedIndex <= renderedOptions.length
    ) {
      return renderedOptions[selectedIndex - 1].value;
    }

    console.log(colors.warning(t('commands.reform.selection.invalid')));
  }
}

function formatScope(scope) {
  if (!scope?.main_org_id) {
    return t('commands.reform.scope.notSelected');
  }

  if (scope.sub_org_id) {
    return t('commands.reform.scope.format.mainAndSub', {
      mainOrgId: scope.main_org_id,
      subOrgId: scope.sub_org_id,
    });
  }

  return t('commands.reform.scope.format.mainOnly', {
    mainOrgId: scope.main_org_id,
  });
}

function parseDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function formatExpiry(expiresAt) {
  const parsed = parseDate(expiresAt);
  if (!parsed) {
    return t('commands.reform.common.unknown');
  }
  return parsed.toISOString();
}

async function isWslEnvironment() {
  if (process.platform !== 'linux') {
    return false;
  }

  try {
    const version = await fs.readFile('/proc/version', 'utf8');
    return /microsoft/i.test(version);
  } catch {
    return false;
  }
}

async function tryLaunchBrowser(url) {
  const commands = [];

  if (process.platform === 'darwin') {
    commands.push(['open', [url]]);
  } else if (process.platform === 'win32') {
    commands.push(['cmd', ['/c', 'start', '', url]]);
  } else {
    if (await isWslEnvironment()) {
      commands.push(['wslview', [url]]);
    }
    commands.push(['xdg-open', [url]]);
  }

  for (const [command, args] of commands) {
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(command, args, {
          stdio: 'ignore',
          detached: true,
        });
        child.once('error', reject);
        child.once('spawn', () => {
          child.unref();
          resolve();
        });
      });
      return true;
    } catch {
      // Try the next launcher.
    }
  }

  return false;
}

function parseFlagArguments(args) {
  const flags = {};
  const positional = [];

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--force') {
      flags.force = true;
      continue;
    }
    if (value === '--dry-run') {
      flags.dryRun = true;
      continue;
    }
    if ((value === '--auth-url' || value === '--api-url') && index + 1 < args.length) {
      const key = value === '--auth-url' ? 'authUrl' : 'apiUrl';
      flags[key] = args[index + 1];
      index += 1;
      continue;
    }
    if ((value === '--main' || value === '--sub') && index + 1 < args.length) {
      flags[value.slice(2)] = args[index + 1];
      index += 1;
      continue;
    }
    positional.push(value);
  }

  return { flags, positional };
}

async function loadAuthenticatedContext() {
  const settings = await readReformSettings();
  const storedAuth = await getStoredReformAuth();

  if (!storedAuth?.accessToken) {
    throw new Error(t('commands.reform.auth.notLoggedIn'));
  }

  if (storedAuth.expiresAt) {
    const expiry = parseDate(storedAuth.expiresAt);
    if (expiry && expiry.getTime() <= Date.now()) {
      await clearStoredReformAuth();
      throw new Error(t('commands.reform.auth.sessionExpired'));
    }
  }

  const resolvedBaseUrls = resolveReformBaseUrls({
    savedAuthBaseUrl: storedAuth.authBaseUrl || settings.authBaseUrl,
    savedApiBaseUrl: storedAuth.apiBaseUrl || settings.apiBaseUrl,
  });

  return {
    settings,
    storedAuth,
    accessToken: storedAuth.accessToken,
    authBaseUrl: resolvedBaseUrls.authBaseUrl,
    apiBaseUrl: resolvedBaseUrls.apiBaseUrl,
  };
}

async function fetchOrganizationTree(context) {
  const mainOrganizations = await listTopLevelOrganizations({
    apiBaseUrl: context.apiBaseUrl,
    accessToken: context.accessToken,
  });

  const subOrganizationsByMain = new Map();
  await Promise.all(
    mainOrganizations.map(async (organization) => {
      const subOrganizations = await listSubOrganizations({
        apiBaseUrl: context.apiBaseUrl,
        accessToken: context.accessToken,
        mainOrgId: organization.id,
      });
      subOrganizationsByMain.set(organization.id, subOrganizations);
    })
  );

  return {
    mainOrganizations,
    subOrganizationsByMain,
  };
}

function printSyncSummary(summary) {
  const counts = [
    [t('commands.reform.sync.summary.createdLabel'), summary.created.length],
    [t('commands.reform.sync.summary.updatedLabel'), summary.updated.length],
    [t('commands.reform.sync.summary.unchangedLabel'), summary.unchanged.length],
    [t('commands.reform.sync.summary.deletedLabel'), summary.deleted.length],
    [t('commands.reform.sync.summary.unreachableLabel'), summary.unreachable.length],
    [t('commands.reform.sync.summary.conflictsLabel'), summary.conflicts.length],
    [t('commands.reform.sync.summary.importErrorsLabel'), summary.importErrors.length],
  ];

  console.log(colors.header(`\n${t('commands.reform.sync.summary.title')}`));
  for (const [label, count] of counts) {
    console.log(colors.text(`${label}: ${count}`));
  }

  if (summary.created.length > 0) {
    console.log(
      colors.success(
        t('commands.reform.sync.summary.createdItems', {
          items: summary.created.join(', '),
        })
      )
    );
  }
  if (summary.updated.length > 0) {
    console.log(
      colors.success(
        t('commands.reform.sync.summary.updatedItems', {
          items: summary.updated.join(', '),
        })
      )
    );
  }
  if (summary.conflicts.length > 0) {
    console.log(
      colors.warning(
        t('commands.reform.sync.summary.skippedLocalModifications', {
          items: summary.conflicts.join(', '),
        })
      )
    );
  }
  if (summary.unreachable.length > 0) {
    console.log(
      colors.warning(
        t('commands.reform.sync.summary.missingFromRemoteScope', {
          items: summary.unreachable.join(', '),
        })
      )
    );
  }
  if (summary.importErrors.length > 0) {
    summary.importErrors.forEach((item) => {
      console.log(
        colors.error(
          t('commands.reform.sync.summary.importErrorItem', {
            localAlias: item.localAlias,
            message: item.message,
          })
        )
      );
    });
  }
}

export async function reformLoginCommand(options = {}) {
  try {
    const settings = await readReformSettings();
    const { authBaseUrl, apiBaseUrl } = resolveReformBaseUrls({
      overrideAuthBaseUrl: options.authUrl,
      overrideApiBaseUrl: options.apiUrl,
      savedAuthBaseUrl: settings.authBaseUrl,
      savedApiBaseUrl: settings.apiBaseUrl,
    });
    const deviceCodeResponse = await requestDeviceCode({
      authBaseUrl,
      clientId: DEFAULT_REFORM_DEVICE_CLIENT_ID,
    });
    const verificationUrl =
      deviceCodeResponse.verification_uri_complete || deviceCodeResponse.verification_uri;

    console.log(colors.header(`\n${t('commands.reform.login.title')}`));
    console.log(
      colors.text(
        t('commands.reform.login.verificationUrl', {
          url: verificationUrl,
        })
      )
    );
    if (
      deviceCodeResponse.verification_uri &&
      deviceCodeResponse.verification_uri !== verificationUrl
    ) {
      console.log(
        colors.textSecondary(
          t('commands.reform.login.verificationPage', {
            url: deviceCodeResponse.verification_uri,
          })
        )
      );
    }
    console.log(
      colors.text(
        t('commands.reform.login.userCode', {
          code: colors.value(deviceCodeResponse.user_code),
        })
      )
    );
    console.log(colors.textMuted(t('commands.reform.login.manualUrlHint')));
    if (
      deviceCodeResponse.verification_uri &&
      deviceCodeResponse.verification_uri !== verificationUrl
    ) {
      console.log(colors.textMuted(t('commands.reform.login.manualPageHint')));
    }

    const browserOpened = await tryLaunchBrowser(verificationUrl);
    if (browserOpened) {
      console.log(colors.textSecondary(t('commands.reform.login.browserOpened')));
    } else {
      console.log(colors.warning(t('commands.reform.login.browserUnavailable')));
    }

    console.log(colors.text(`${t('commands.reform.login.waiting')}\n`));
    const tokenResponse = await pollDeviceToken({
      authBaseUrl,
      deviceCode: deviceCodeResponse.device_code,
      intervalSeconds: deviceCodeResponse.interval,
      expiresInSeconds: deviceCodeResponse.expires_in,
      clientId: DEFAULT_REFORM_DEVICE_CLIENT_ID,
    });

    const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString();
    const session = await fetchReformSession({
      authBaseUrl,
      accessToken: tokenResponse.access_token,
    });

    const storageResult = await saveStoredReformAuth({
      accessToken: tokenResponse.access_token,
      expiresAt,
      authBaseUrl,
      apiBaseUrl,
      user: session?.user ?? null,
      session: session?.session ?? null,
    });
    await updateReformSettings({
      authBaseUrl,
      apiBaseUrl,
    });

    const email = session?.user?.email || t('commands.reform.common.unknownUser');
    console.log(
      colors.success(
        t('commands.reform.login.success', {
          email,
          storage: storageResult.storage,
        })
      )
    );
  } catch (error) {
    console.error(colors.error(t('commands.reform.login.failed', { message: error.message })));
    process.exitCode = 1;
  }
}

export async function reformLogoutCommand() {
  try {
    const storedAuth = await getStoredReformAuth();
    const settings = await readReformSettings();

    if (storedAuth?.accessToken) {
      const { authBaseUrl } = resolveReformBaseUrls({
        savedAuthBaseUrl: storedAuth.authBaseUrl || settings.authBaseUrl,
      });

      try {
        await signOutReformSession({
          authBaseUrl,
          accessToken: storedAuth.accessToken,
        });
      } catch {
        // Local cleanup still succeeds even if remote revocation fails.
      }
    }

    await clearStoredReformAuth();
    await clearReformScope();
    console.log(colors.success(t('commands.reform.logout.success')));
  } catch (error) {
    console.error(colors.error(t('commands.reform.logout.failed', { message: error.message })));
    process.exitCode = 1;
  }
}

export async function reformWhoamiCommand() {
  try {
    const context = await loadAuthenticatedContext();
    const session = await fetchReformSession({
      authBaseUrl: context.authBaseUrl,
      accessToken: context.accessToken,
    });

    console.log(colors.header(`\n${t('commands.reform.whoami.title')}`));
    console.log(
      colors.text(
        t('commands.reform.whoami.user', {
          user: session?.user?.email || t('commands.reform.common.unknown'),
        })
      )
    );
    if (session?.user?.name) {
      console.log(colors.text(t('commands.reform.whoami.name', { name: session.user.name })));
    }
    console.log(
      colors.text(
        t('commands.reform.whoami.sessionExpires', {
          expiry: formatExpiry(context.storedAuth.expiresAt),
        })
      )
    );
    console.log(
      colors.text(
        t('commands.reform.whoami.scope', {
          scope: formatScope(context.settings.scope),
        })
      )
    );
  } catch (error) {
    console.error(colors.error(t('commands.reform.whoami.failed', { message: error.message })));
    process.exitCode = 1;
  }
}

export async function reformOrgsListCommand() {
  try {
    const context = await loadAuthenticatedContext();
    const { mainOrganizations, subOrganizationsByMain } = await fetchOrganizationTree(context);

    if (mainOrganizations.length === 0) {
      console.log(colors.warning(t('commands.reform.orgs.none')));
      return;
    }

    console.log(colors.header(`\n${t('commands.reform.orgs.title')}`));
    for (const mainOrganization of mainOrganizations) {
      console.log(
        colors.text(
          t('commands.reform.orgs.mainLine', {
            name: mainOrganization.name || mainOrganization.id,
            id: mainOrganization.id,
          })
        )
      );
      const subOrganizations = subOrganizationsByMain.get(mainOrganization.id) ?? [];
      for (const subOrganization of subOrganizations) {
        console.log(
          colors.textSecondary(
            t('commands.reform.orgs.subLine', {
              name: subOrganization.name || subOrganization.id,
              id: subOrganization.id,
            })
          )
        );
      }
    }
  } catch (error) {
    console.error(colors.error(t('commands.reform.orgs.failed', { message: error.message })));
    process.exitCode = 1;
  }
}

export async function reformScopeShowCommand() {
  try {
    const settings = await readReformSettings();
    console.log(colors.header(`\n${t('commands.reform.scope.title')}`));
    console.log(colors.text(formatScope(settings.scope)));
  } catch (error) {
    console.error(colors.error(t('commands.reform.scope.showFailed', { message: error.message })));
    process.exitCode = 1;
  }
}

export async function reformScopeUseCommand(options = {}) {
  try {
    const context = await loadAuthenticatedContext();
    let mainOrgId = typeof options.main === 'string' ? options.main.trim() : '';
    let subOrgId = typeof options.sub === 'string' ? options.sub.trim() : '';

    if (!mainOrgId) {
      if (!canPrompt(options.readlineInterface)) {
        throw new Error(t('commands.reform.scope.nonInteractiveMainRequired'));
      }

      const { mainOrganizations } = await fetchOrganizationTree(context);
      if (mainOrganizations.length === 0) {
        throw new Error(t('commands.reform.orgs.none'));
      }

      mainOrgId =
        (await promptSelect({
          title: t('commands.reform.scope.selectMainTitle'),
          options: mainOrganizations.map((organization) => ({
            label: `${organization.name || organization.id} [${organization.id}]`,
            value: organization.id,
          })),
          readlineInterface: options.readlineInterface,
        })) || '';
    }

    if (!mainOrgId) {
      console.log(colors.warning(t('commands.reform.scope.cancelled')));
      return;
    }

    if (!subOrgId && canPrompt(options.readlineInterface)) {
      const subOrganizations = await listSubOrganizations({
        apiBaseUrl: context.apiBaseUrl,
        accessToken: context.accessToken,
        mainOrgId,
      });

      if (subOrganizations.length > 0) {
        const selectedSubOrgId = await promptSelect({
          title: t('commands.reform.scope.selectSubTitle'),
          options: subOrganizations.map((organization) => ({
            label: `${organization.name || organization.id} [${organization.id}]`,
            value: organization.id,
          })),
          includeNoneOption: true,
          noneLabel: t('commands.reform.scope.noneOption'),
          readlineInterface: options.readlineInterface,
        });

        subOrgId = selectedSubOrgId || '';
      }
    }

    const nextSettings = await updateReformSettings({
      scope: {
        main_org_id: mainOrgId,
        sub_org_id: subOrgId || null,
      },
    });

    console.log(
      colors.success(
        t('commands.reform.scope.saved', {
          scope: formatScope(nextSettings.scope),
        })
      )
    );
  } catch (error) {
    console.error(colors.error(t('commands.reform.scope.useFailed', { message: error.message })));
    process.exitCode = 1;
  }
}

export async function reformSyncPullCommand(options = {}) {
  try {
    const context = await loadAuthenticatedContext();
    if (!context.settings.scope?.main_org_id) {
      throw new Error(t('commands.reform.sync.noScope'));
    }

    const result = await pullReformForms({
      projectRoot: process.cwd(),
      apiBaseUrl: context.apiBaseUrl,
      accessToken: context.accessToken,
      scope: context.settings.scope,
      force: Boolean(options.force),
    });

    printSyncSummary(result.summary);
    console.log(
      colors.textSecondary(
        t('commands.reform.sync.manifest', {
          path: path.relative(process.cwd(), result.manifestPath),
        })
      )
    );
  } catch (error) {
    console.error(colors.error(t('commands.reform.sync.pullFailed', { message: error.message })));
    process.exitCode = 1;
  }
}

export async function reformSyncStatusCommand() {
  try {
    const status = await getReformSyncStatus(process.cwd());
    const entries = status.entries;

    console.log(colors.header(`\n${t('commands.reform.sync.status.title')}`));
    console.log(
      colors.textSecondary(
        t('commands.reform.sync.manifest', {
          path: path.relative(process.cwd(), status.manifestPath),
        })
      )
    );
    console.log(
      colors.text(
        t('commands.reform.sync.savedScope', {
          scope: formatScope(status.manifest.scope),
        })
      )
    );

    if (entries.length === 0) {
      console.log(colors.warning(t('commands.reform.sync.status.none')));
      return;
    }

    for (const entry of entries) {
      const flags = [];
      if (entry.modifiedLocally) {
        flags.push(t('commands.reform.sync.status.flags.modifiedLocally'));
      }
      if (!entry.exists) {
        flags.push(t('commands.reform.sync.status.flags.missingLocally'));
      }

      const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : '';
      console.log(
        colors.text(
          t('commands.reform.sync.status.entry', {
            localAlias: entry.localAlias,
            syncStatus: entry.syncStatus,
            remoteState: entry.remoteState,
            revision: entry.remoteRevision ?? t('commands.reform.common.notApplicable'),
            suffix,
          })
        )
      );
      console.log(
        colors.textSecondary(
          t('commands.reform.sync.status.localPath', {
            path: entry.localPath,
          })
        )
      );
      if (entry.lastImportError) {
        console.log(
          colors.error(
            t('commands.reform.sync.status.importError', {
              message: entry.lastImportError,
            })
          )
        );
      }
    }
  } catch (error) {
    console.error(
      colors.error(t('commands.reform.sync.status.failed', { message: error.message }))
    );
    process.exitCode = 1;
  }
}

export async function reformSyncPruneCommand(options = {}) {
  try {
    const preview = await pruneDeletedReformForms({
      projectRoot: process.cwd(),
      force: Boolean(options.force),
      dryRun: true,
    });

    console.log(colors.header(`\n${t('commands.reform.sync.prune.title')}`));

    if (preview.prunable.length === 0) {
      console.log(colors.warning(t('commands.reform.sync.prune.none')));
      return;
    }

    console.log(
      colors.text(
        t('commands.reform.sync.prune.prunable', {
          items: preview.prunable.join(', '),
        })
      )
    );
    if (preview.skippedModified.length > 0) {
      console.log(
        colors.warning(
          t('commands.reform.sync.prune.skippedModified', {
            items: preview.skippedModified.join(', '),
          })
        )
      );
    }

    if (options.dryRun) {
      console.log(colors.textSecondary(t('commands.reform.sync.prune.dryRun')));
      return;
    }

    if (!options.force && !canPrompt(options.readlineInterface)) {
      throw new Error(t('commands.reform.sync.prune.nonInteractiveRefusal'));
    }

    if (!options.force) {
      const confirmed = await confirmAction(t('commands.reform.sync.prune.confirm'), {
        readlineInterface: options.readlineInterface,
      });
      if (!confirmed) {
        console.log(colors.warning(t('commands.reform.sync.prune.cancelled')));
        return;
      }
    }

    const result = await pruneDeletedReformForms({
      projectRoot: process.cwd(),
      force: Boolean(options.force),
      dryRun: false,
    });

    if (result.pruned.length === 0) {
      console.log(colors.warning(t('commands.reform.sync.prune.noneRemoved')));
      return;
    }

    console.log(
      colors.success(
        t('commands.reform.sync.prune.pruned', {
          items: result.pruned.join(', '),
        })
      )
    );
  } catch (error) {
    console.error(colors.error(t('commands.reform.sync.prune.failed', { message: error.message })));
    process.exitCode = 1;
  }
}

export async function handleReformCommand(args, options = {}) {
  const [section, subsection, ...rest] = args;

  switch (section) {
    case 'login':
      {
        const { flags } = parseFlagArguments([subsection, ...rest].filter(Boolean));
        await reformLoginCommand(flags);
      }
      return;
    case 'logout':
      await reformLogoutCommand();
      return;
    case 'whoami':
      await reformWhoamiCommand();
      return;
    case 'orgs':
      if (subsection !== 'list') {
        throw new Error(t('commands.reform.usage.orgs'));
      }
      await reformOrgsListCommand();
      return;
    case 'scope':
      if (subsection === 'show') {
        await reformScopeShowCommand();
        return;
      }
      if (subsection === 'use') {
        const { flags } = parseFlagArguments(rest);
        await reformScopeUseCommand({
          ...flags,
          readlineInterface: options.readlineInterface,
        });
        return;
      }
      throw new Error(t('commands.reform.usage.scope'));
    case 'sync':
      if (subsection === 'pull') {
        const { flags } = parseFlagArguments(rest);
        await reformSyncPullCommand(flags);
        return;
      }
      if (subsection === 'status') {
        await reformSyncStatusCommand();
        return;
      }
      if (subsection === 'prune') {
        const { flags } = parseFlagArguments(rest);
        await reformSyncPruneCommand({
          ...flags,
          readlineInterface: options.readlineInterface,
        });
        return;
      }
      throw new Error(t('commands.reform.usage.sync'));
    default:
      throw new Error(t('commands.reform.usage.root'));
  }
}
