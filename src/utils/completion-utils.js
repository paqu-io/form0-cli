import { COMMANDS, WATCH_OPTIONS, CLEAR_OPTIONS, RUN_OPTIONS } from './constants.js';

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
    const hits = COMMANDS.filter(cmd => cmd.startsWith(line));
    return [hits.length ? hits : [], line];
  }
  
  if (command === 'watch' && args.length >= 2) {
    // Complete watch options
    const lastArg = args[args.length - 1];
    const hits = WATCH_OPTIONS.filter(opt => opt.startsWith(lastArg));
    return [hits, lastArg];
  }
  
  if (command === 'clear' && args.length === 2) {
    // Complete clear options
    const hits = CLEAR_OPTIONS.filter(opt => opt.startsWith(args[1]));
    return [hits, args[1]];
  }
  
  if (command === 'run' && args.length >= 2) {
    // Complete run options
    const lastArg = args[args.length - 1];
    const hits = RUN_OPTIONS.filter(opt => opt.startsWith(lastArg));
    return [hits, lastArg];
  }
  
  return [[], line];
} 