const SERVE_SUBCOMMANDS = [
  'start',
  'stop',
  'status',
  'update',
  'app',
  '--app',
  '--port',
  '--host',
  '--public-url',
  '--no-diagnostics',
];

const COMMAND_CATALOG = Object.freeze([
  { name: 'help', aliases: ['h'], server: true, serverHelpKeys: ['help.helpCommand'] },
  { name: 'init', aliases: [], server: false },
  { name: 'load', aliases: ['l'], server: true, serverHelpKeys: ['help.loadCommand'] },
  { name: 'preview', aliases: ['p'], server: true, serverHelpKeys: ['help.previewCommand'] },
  { name: 'run', aliases: ['r'], server: false, completions: ['--values', '--no-diagnostics'] },
  {
    name: 'validate',
    aliases: ['v'],
    server: true,
    serverHelpKeys: ['help.validateCommand'],
    completions: ['--no-diagnostics'],
  },
  { name: 'test', aliases: ['t'], server: false },
  { name: 'status', aliases: ['s'], server: true, serverHelpKeys: ['help.statusCommand'] },
  { name: 'values', aliases: [], server: false },
  { name: 'fields', aliases: ['f'], server: false },
  { name: 'reload', aliases: ['rld'], server: false },
  {
    name: 'watch',
    aliases: ['w'],
    server: false,
    completions: ['stop', '--auto-run', '--auto-validate', '--no-diagnostics'],
  },
  {
    name: 'serve',
    aliases: [],
    server: ({ args }) => {
      const [action] = args;
      if (['stop', 'status', 'update', 'app', '--app'].includes(action)) return true;
      return action === 'start' && (args.includes('--app') || args.includes('app'));
    },
    serverHelpKeys: [
      'help.serveStopCommand',
      'help.serveStatusCommand',
      'interactive.serverMode.serveUpdateCommand',
    ],
    completions: SERVE_SUBCOMMANDS,
  },
  { name: 'clear', aliases: ['cls'], server: false },
  { name: 'theme', aliases: [], server: false },
  { name: 'locale', aliases: [], server: false },
  {
    name: 'connector',
    aliases: ['conn', 'c'],
    server: true,
    serverHelpKeys: ['help.connectorCommand'],
    completions: [
      'help',
      'list',
      'status',
      'load',
      'unload',
      'remove',
      'test',
      'reload',
      'config',
      'configure',
      'uninstall',
    ],
  },
  {
    name: 'schema',
    aliases: [],
    server: true,
    serverHelpKeys: ['interactive.serverMode.schemaCommands'],
    completions: ['import', 'export', 'convert', 'edit', 'keys', 'new', 'delete'],
  },
  { name: 'ai', aliases: [], server: true, serverHelpKeys: ['help.aiCommand'] },
  {
    name: 'reform',
    aliases: [],
    server: true,
    serverHelpKeys: ['interactive.serverMode.reformCommands'],
    completions: [
      'login',
      'logout',
      'whoami',
      'orgs',
      'scope',
      'sync',
      'list',
      'show',
      'use',
      'pull',
      'status',
      'prune',
      '--main',
      '--sub',
      '--force',
      '--dry-run',
    ],
  },
  { name: 'exit', aliases: ['quit', 'q'], server: false },
]);

const COMMAND_BY_NAME = new Map(
  COMMAND_CATALOG.flatMap((command) =>
    [command.name, ...command.aliases].map((name) => [name, command])
  )
);

export function parseInteractiveInput(input) {
  const normalized = String(input || '').trim();
  if (!normalized) return { command: '', args: [], normalized };
  const [command, ...args] = normalized.split(/\s+/);
  return { command: command.toLowerCase(), args, normalized };
}

export function getInteractiveCommandNames() {
  return [...COMMAND_BY_NAME.keys()];
}

export function getInteractiveCommand(command) {
  return COMMAND_BY_NAME.get(String(command || '').toLowerCase()) || null;
}

export function getInteractiveCommandCompletions(command) {
  return [...(getInteractiveCommand(command)?.completions || [])];
}

export function getServerModeAvailability(command, args = []) {
  const definition = getInteractiveCommand(command);
  if (!definition) return { allowed: false, reason: 'command_blocked' };
  const allowed =
    typeof definition.server === 'function'
      ? definition.server({ command: definition.name, args })
      : definition.server;
  return allowed
    ? { allowed: true }
    : {
        allowed: false,
        reason: definition.name === 'serve' ? 'serve_action_blocked' : 'command_blocked',
        action: definition.name === 'serve' ? args[0] : null,
      };
}

/**
 * Translation keys of the help lines for commands available while the dev
 * server runs, mostly the main help's own lines. Help comes last, as there.
 */
export function getServerModeHelpEntries() {
  const commands = COMMAND_CATALOG.filter((command) => command.serverHelpKeys);
  return [
    ...commands.filter((command) => command.name !== 'help'),
    ...commands.filter((command) => command.name === 'help'),
  ].flatMap((command) => command.serverHelpKeys);
}

export { COMMAND_CATALOG };
