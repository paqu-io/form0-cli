import { COMMANDS, WATCH_OPTIONS, CLEAR_OPTIONS, RUN_OPTIONS } from './constants.js';
import { getAvailableThemes } from './theme.js';
import { getAvailableLocales } from './config.js';

/**
 * Handle tab completion for interactive commands
 * @param {string} line - Current input line
 * @returns {Array} [completions, originalString]
 */
export function completer(line) {
  const args = line.split(' ');
  const command = args[0];

  if (args.length === 1) {
    // Complete main commands
    const hits = COMMANDS.filter((cmd) => cmd.startsWith(line));
    return [hits.length ? hits : [], line];
  }

  if (command === 'watch' && args.length >= 2) {
    // Complete watch options
    const lastArg = args[args.length - 1];
    const hits = WATCH_OPTIONS.filter((opt) => opt.startsWith(lastArg));
    return [hits, lastArg];
  }

  if (command === 'clear' && args.length === 2) {
    // Complete clear options
    const hits = CLEAR_OPTIONS.filter((opt) => opt.startsWith(args[1]));
    return [hits, args[1]];
  }

  if (command === 'run' && args.length >= 2) {
    // Complete run options
    const lastArg = args[args.length - 1];
    const hits = RUN_OPTIONS.filter((opt) => opt.startsWith(lastArg));
    return [hits, lastArg];
  }

  if (command === 'theme' && args.length === 2) {
    // Complete theme names
    const availableThemes = getAvailableThemes();
    const hits = availableThemes.filter((theme) => theme.startsWith(args[1]));
    return [hits, args[1]];
  }

  if (command === 'locale' && args.length === 2) {
    // Complete locale options
    const availableLocales = getAvailableLocales();
    const hits = availableLocales.filter((locale) => locale.startsWith(args[1]));
    return [hits, args[1]];
  }

  if (command === 'serve' && args.length >= 2) {
    // Complete serve subcommands and options
    const serveOptions = ['start', 'stop', 'status', 'update', '--port', '--host'];
    const lastArg = args[args.length - 1];
    const hits = serveOptions.filter((opt) => opt.startsWith(lastArg));
    return [hits, lastArg];
  }

  if (command === 'schema' && args.length >= 2) {
    // Complete schema subcommands
    const schemaOptions = ['import', 'export', 'edit', 'keys', 'new', 'delete'];
    const lastArg = args[args.length - 1];
    const hits = schemaOptions.filter((opt) => opt.startsWith(lastArg));
    return [hits, lastArg];
  }

  if (command === 'reform' && args.length >= 2) {
    const reformOptions = [
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
    ];
    const lastArg = args[args.length - 1];
    const hits = reformOptions.filter((opt) => opt.startsWith(lastArg));
    return [hits, lastArg];
  }

  return [[], line];
}
