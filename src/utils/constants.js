// Shared constants for form0-cli interactive mode

export const BRAND_COLOR = '#DB3700';

export const COMMON_SCHEMA_PATHS = ['form.schema.json', 'schema.json', 'form.json'];
export const COMMON_SCHEMA_PATTERNS = ['form.schema*.json', 'schema*.json', 'form*.json'];

export const COMMON_TEST_VALUE_FILES = [
  'test-values.json',
  'test.values.json',
  'values.json',
  'sample-data.json',
  'test-data.json',
];

export const COMMANDS = [
  'help',
  'h',
  'load',
  'l',
  'preview',
  'p',
  'run',
  'r',
  'validate',
  'v',
  'watch',
  'w',
  'status',
  's',
  'values',
  'reload',
  'rld',
  'clear',
  'cls',
  'exit',
  'quit',
  'q',
  'init',
  'fields',
  'f',
  'theme',
  'locale',
  'serve',
  'schema',
];

export const WATCH_OPTIONS = ['--auto-run', '--auto-validate', '--values', 'stop'];
export const CLEAR_OPTIONS = ['values'];
export const RUN_OPTIONS = ['--values'];

export const WATCHER_CONFIG = {
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 500, // Wait 500ms after last change
    pollInterval: 100,
  },
};

export const READLINE_CONFIG = {
  historySize: 100, // Remember last 100 commands
};
