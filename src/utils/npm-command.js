import { execFileSync } from 'node:child_process';

const SUPPORTED_ACTIONS = new Set(['install', 'uninstall']);

export function getNpmExecutable(platform = process.platform) {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function buildNpmArguments(action, packageSpecifier) {
  if (!SUPPORTED_ACTIONS.has(action)) {
    throw new Error(`Unsupported npm action: ${action}`);
  }
  if (typeof packageSpecifier !== 'string' || packageSpecifier.length === 0) {
    throw new Error('A package specifier is required');
  }

  return [action, '--', packageSpecifier];
}

export function runNpmCommand(action, packageSpecifier, options = {}) {
  const { cwd = process.cwd(), stdio = 'inherit' } = options;
  return execFileSync(getNpmExecutable(), buildNpmArguments(action, packageSpecifier), {
    cwd,
    stdio,
  });
}
