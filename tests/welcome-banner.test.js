import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { showWelcomeBanner } from '../src/utils/display-utils.js';
import { setLocale } from '../src/utils/i18n.js';

test('the welcome banner shows the CLI version, right-aligned under the title lines', async () => {
  const { version } = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  );
  setLocale('en');
  const lines = [];
  const log = console.log;
  console.log = (text = '') =>
    lines.push(
      ...String(text)
        .replace(/\u001b\[[0-9;]*m/g, '')
        .split('\n')
    );
  try {
    showWelcomeBanner();
  } finally {
    console.log = log;
  }

  const title = lines.find((line) => line.includes('Interactive CLI Environment'));
  const versionLine = lines.find((line) => line.trim() === `v${version}`);
  assert.ok(versionLine, `no v${version} line`);
  assert.ok(lines.indexOf(versionLine) > lines.indexOf(title));
  assert.equal(versionLine.length, title.length);
});
