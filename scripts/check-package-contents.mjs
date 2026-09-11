import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const cacheDirectory = mkdtempSync(join(tmpdir(), 'form0-package-check-'));
let output;

try {
  output = execFileSync(npmCommand, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: cacheDirectory },
  });
} finally {
  rmSync(cacheDirectory, { recursive: true, force: true });
}
const [{ files }] = JSON.parse(output);
const paths = files.map(({ path }) => path);

const forbiddenPatterns = [
  /^\.env(?:\.|$)/,
  /^\.github\//,
  /^analyses\//,
  /^coverage\//,
  /^tests?\//,
  /(?:^|\/)(?:AGENTS|CLAUDE|GEMINI)\.md$/,
  /(?:^|\/)\.npmrc$/,
  /(?:^|\/).*\.old$/,
  /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/,
];
const allowedEnvironmentExamples = new Set(['.env.example']);
const forbidden = paths.filter(
  (path) =>
    !allowedEnvironmentExamples.has(path) && forbiddenPatterns.some((pattern) => pattern.test(path))
);

const entrypoints = new Set();
const collectEntrypoints = (value) => {
  if (typeof value === 'string') {
    entrypoints.add(value.replace(/^\.\//, ''));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(collectEntrypoints);
  }
};

[manifest.main, manifest.module, manifest.types].forEach(collectEntrypoints);
collectEntrypoints(manifest.bin);
collectEntrypoints(manifest.exports);

const required = ['package.json', 'SECURITY.md', ...entrypoints];

if (!paths.some((path) => /^README(?:\.|$)/i.test(path))) {
  required.push('README');
}
if (!paths.some((path) => /^LICEN[CS]E(?:\.|$)/i.test(path))) {
  required.push('LICENSE');
}

const missing = required.filter((path) => !paths.includes(path));
const missingAllowlistedEntries = (manifest.files ?? [])
  .filter((entry) => !['*', '!', '?', '{', '['].some((token) => entry.includes(token)))
  .filter((entry) => !paths.some((path) => path === entry || path.startsWith(`${entry}/`)))
  .map((entry) => `files:${entry}`);
missing.push(...missingAllowlistedEntries);

if (forbidden.length || missing.length) {
  if (forbidden.length) {
    console.error(`Forbidden package files: ${forbidden.join(', ')}`);
  }
  if (missing.length) {
    console.error(`Missing package files: ${missing.join(', ')}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Package contents verified (${paths.length} files).`);
}
