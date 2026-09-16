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
];

const COMMAND_CATALOG = Object.freeze([
  { name: 'help', aliases: ['h'], server: true, serverHelpKey: 'help' },
  { name: 'init', aliases: [], server: false },
  { name: 'load', aliases: ['l'], server: false },
  { name: 'preview', aliases: ['p'], server: true, serverHelpKey: 'preview' },
  { name: 'run', aliases: ['r'], server: false },
  { name: 'validate', aliases: ['v'], server: true, serverHelpKey: 'validate' },
  { name: 'test', aliases: ['t'], server: false },
  { name: 'status', aliases: ['s'], server: true, serverHelpKey: 'sessionStatus' },
  { name: 'values', aliases: [], server: false },
  { name: 'fields', aliases: ['f'], server: false },
  { name: 'reload', aliases: ['rld'], server: false },
  { name: 'watch', aliases: ['w'], server: false, completions: ['stop'] },
  {
    name: 'serve',
    aliases: [],
    server: ({ args }) => {
      const [action] = args;
      if (['stop', 'status', 'update', 'app', '--app'].includes(action)) return true;
      return action === 'start' && (args.includes('--app') || args.includes('app'));
    },
    serverHelpKey: 'serveControls',
    completions: SERVE_SUBCOMMANDS,
  },
  { name: 'clear', aliases: ['cls'], server: false },
  { name: 'theme', aliases: [], server: false },
  { name: 'locale', aliases: [], server: false },
  {
    name: 'connector',
    aliases: ['conn', 'c'],
    server: true,
    serverHelpKey: 'connectorCommands',
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
    serverHelpKey: 'schemaCommands',
    completions: ['import', 'export', 'convert', 'edit', 'keys', 'new', 'delete'],
  },
  { name: 'ai', aliases: [], server: true, serverHelpKey: 'aiCommand' },
  {
    name: 'reform',
    aliases: [],
    server: true,
    serverHelpKey: 'reformCommands',
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

export function getServerModeHelpEntries() {
  return COMMAND_CATALOG.filter((command) => command.serverHelpKey).map((command) => ({
    command: command.name,
    translationKey: command.serverHelpKey,
  }));
}

export { COMMAND_CATALOG };
