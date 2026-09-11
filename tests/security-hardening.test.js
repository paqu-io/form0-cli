import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import dotenv from 'dotenv';
import fs from 'fs-extra';
import { createApp } from '../src/server/express-server.js';
import {
  ConnectorManager,
  isPathInside,
  isValidConnectorPackageName,
} from '../src/utils/connector-manager.js';
import {
  createAlertDialogContent,
  createDescriptionDialog,
} from '../src/server/static/dom-utils.js';
import { resolveSupportingImageUrl } from '../src/server/static/supporting-image-utils.js';
import { htmlToPlainText } from '../src/utils/formio-schema-converter.js';
import { buildNpmArguments, getNpmExecutable } from '../src/utils/npm-command.js';
import { formatEnvValue } from '../src/utils/project-env.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.style = {};
    this.className = '';
    this.textContent = '';
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  querySelector(selector) {
    const className = selector.startsWith('.') ? selector.slice(1) : null;
    if (className && this.className.split(/\s+/).includes(className)) return this;
    for (const child of this.children) {
      const match = child.querySelector(selector);
      if (match) return match;
    }
    return null;
  }

  set innerHTML(_value) {
    throw new Error('Security-sensitive dialog content must not use innerHTML');
  }
}

const fakeDocument = {
  createElement(tagName) {
    return new FakeElement(tagName);
  },
};

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('npm package specifiers are passed as one process argument', () => {
  const hostileSpecifier = 'example-package; touch /tmp/not-executed';
  assert.deepEqual(buildNpmArguments('install', hostileSpecifier), [
    'install',
    '--',
    hostileSpecifier,
  ]);
  assert.deepEqual(buildNpmArguments('uninstall', '@scope/connector'), [
    'uninstall',
    '--',
    '@scope/connector',
  ]);
  assert.equal(getNpmExecutable('linux'), 'npm');
  assert.equal(getNpmExecutable('win32'), 'npm.cmd');
});

test('runtime connector loading accepts package names and rejects path-like input', async () => {
  assert.equal(isValidConnectorPackageName('form0-connector-pg'), true);
  assert.equal(isValidConnectorPackageName('@paqu-io/form0-connector'), true);
  assert.equal(isValidConnectorPackageName('../form0-connector-pg'), false);
  assert.equal(isValidConnectorPackageName('/tmp/form0-connector-pg'), false);
  assert.equal(isValidConnectorPackageName('form0-connector-pg;whoami'), false);

  const manager = new ConnectorManager();
  await assert.rejects(() => manager.resolveConnectorModule('../outside'), /Invalid connector/);
  assert.equal(isPathInside('/project/package', '/project/package/src/index.js'), true);
  assert.equal(isPathInside('/project/package', '/project/other/index.js'), false);
});

test('normal installed and sibling development connectors still resolve', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-cli-connectors-'));
  const projectRoot = path.join(workspaceRoot, 'project');
  const installedRoot = path.join(projectRoot, 'node_modules', 'form0-connector-installed');
  const siblingRoot = path.join(workspaceRoot, 'form0-connector-sibling');

  try {
    for (const [packageRoot, packageName] of [
      [installedRoot, 'form0-connector-installed'],
      [siblingRoot, 'form0-connector-sibling'],
    ]) {
      await fs.ensureDir(packageRoot);
      await fs.writeJson(path.join(packageRoot, 'package.json'), {
        name: packageName,
        type: 'module',
        main: 'index.js',
      });
      await fs.writeFile(
        path.join(packageRoot, 'index.js'),
        'export const connectorTest = true;\n'
      );
    }

    const manager = new ConnectorManager();
    manager.projectRoot = projectRoot;

    const installed = await manager.resolveConnectorModule('form0-connector-installed');
    assert.equal(installed.type, 'installed');
    assert.equal(installed.module.connectorTest, true);

    const sibling = await manager.resolveConnectorModule('form0-connector-sibling');
    assert.equal(sibling.type, 'local');
    assert.equal(sibling.module.connectorTest, true);
  } finally {
    await fs.remove(workspaceRoot);
  }
});

test('connector package entry points cannot escape their package directory', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-cli-entrypoint-'));
  const packageRoot = path.join(workspaceRoot, 'connector');

  try {
    await fs.ensureDir(packageRoot);
    await fs.writeFile(path.join(workspaceRoot, 'outside.js'), 'export default class Outside {}\n');
    await fs.writeJson(path.join(packageRoot, 'package.json'), { main: '../outside.js' });

    const manager = new ConnectorManager();
    assert.equal(await manager.findConnectorEntryPoint(packageRoot), null);
  } finally {
    await fs.remove(workspaceRoot);
  }
});

test('environment values round-trip without command or dotenv syntax interpretation', () => {
  for (const value of ['simple', 'has spaces', 'hash#value', 'quote\'"value', 'back\\slash']) {
    const parsed = dotenv.parse(`VALUE=${formatEnvValue(value)}`);
    assert.equal(parsed.VALUE, value);
  }
  assert.throws(() => formatEnvValue('line one\nline two'), /line breaks/);
});

test('supporting images allow HTTP(S) and safe relative project paths only', () => {
  assert.equal(
    resolveSupportingImageUrl({ supporting_image_path: 'floor plans/level 1.png' }),
    '/supporting-images/floor%20plans/level%201.png'
  );
  assert.equal(
    resolveSupportingImageUrl({ supporting_image_path: 'https://images.example/plan.png' }),
    'https://images.example/plan.png'
  );
  assert.equal(resolveSupportingImageUrl({ supporting_image_path: '../secret.png' }), undefined);
  assert.equal(
    resolveSupportingImageUrl({ supporting_image_path: 'javascript:alert(1)' }),
    undefined
  );
});

test('schema-controlled dialog strings are inserted as text', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const descriptionDialog = createDescriptionDialog(payload, payload, fakeDocument);
  assert.equal(descriptionDialog.querySelector('.description-dialog-header').textContent, payload);
  assert.equal(descriptionDialog.querySelector('.description-dialog-text').textContent, payload);

  const alertDialog = createAlertDialogContent(payload, payload, fakeDocument);
  assert.equal(alertDialog.querySelector('.alert-dialog-header').textContent, payload);
  assert.equal(alertDialog.querySelector('.alert-dialog-text').textContent, payload);
});

test('Form.io rich text is converted to plain text before it becomes a form label', () => {
  assert.equal(htmlToPlainText('<strong>Hello</strong> &amp; welcome'), 'Hello & welcome');
  assert.equal(htmlToPlainText('&lt;img src=x onerror=alert(1)&gt;Safe'), 'Safe');
  assert.equal(htmlToPlainText('<script>alert(1)</script >Visible'), 'Visible');
  assert.equal(htmlToPlainText('<style>body{display:none}</style>Visible'), 'Visible');
});

test('preview root remains available and arbitrary connectors cannot be tested', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-cli-security-'));
  await fs.writeJson(path.join(projectRoot, 'package.json'), { name: 'security-test-project' });
  const app = createApp(
    () => null,
    () => 'test',
    projectRoot
  );
  const server = http.createServer(app);

  try {
    const address = await listen(server);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const rootResponse = await fetch(`${baseUrl}/`);
    assert.equal(rootResponse.status, 200);
    assert.match(rootResponse.headers.get('content-type') || '', /text\/html/);

    const connectorResponse = await fetch(`${baseUrl}/api/connectors/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectorName: '../outside', config: {} }),
    });
    assert.equal(connectorResponse.status, 404);
    assert.deepEqual(await connectorResponse.json(), {
      error: 'Connector is not configured for this project',
    });
  } finally {
    await close(server);
    await fs.remove(projectRoot);
  }
});
