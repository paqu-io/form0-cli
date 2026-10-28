import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const [executable, ...nodeArguments] = manifest.scripts.test.trim().split(/\s+/);
if (executable !== 'node') throw new Error('The test command must start with node.');

// Nested test runners must use the same setup as npm test, CI and release checks.
export const testArguments = nodeArguments;
