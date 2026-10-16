import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import fs from 'fs-extra';
import { ServerManager } from '../src/commands/interactive/managers/server-manager.js';
import { resolveAppEndpoint, waitForPort } from '../src/utils/app-dev-server.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = path.join(repositoryRoot, 'bin', 'form0.js');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, 'localhost', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function project(config) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-app-order-'));
  await fs.writeFile(path.join(dir, 'form0.config.js'), `export default ${config};\n`);
  return dir;
}

test('resolveAppEndpoint reads a valid devServer.port and ignores anything else', async () => {
  const cases = [
    [
      "{ devServer: { command: 'npm run dev', port: 5173 } }",
      { port: 5173, url: 'http://localhost:5173' },
    ],
    // Expo apps are opened from a device, so there is no browser URL to show.
    ["{ devServer: { type: 'app', provider: 'expo', port: 8081 } }", { port: 8081, url: null }],
    ["{ devServer: { command: 'npm run dev' } }", null],
    ["{ devServer: { command: 'npm run dev', port: 'abc' } }", null],
    ["{ devServer: { command: 'npm run dev', port: 70000 } }", null],
  ];
  for (const [config, expected] of cases) {
    const dir = await project(config);
    try {
      assert.deepEqual(await resolveAppEndpoint(dir), expected, config);
    } finally {
      await fs.remove(dir);
    }
  }
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-app-order-'));
  try {
    assert.equal(await resolveAppEndpoint(empty), null);
  } finally {
    await fs.remove(empty);
  }
});

test('waitForPort resolves once the port listens, and stops for a timeout or a stopped app', async () => {
  const port = await freePort();
  const server = net.createServer();
  setTimeout(() => server.listen(port, 'localhost'), 300);
  try {
    assert.equal(await waitForPort(port, { timeoutMs: 5000, intervalMs: 50 }), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(await waitForPort(port, { timeoutMs: 300, intervalMs: 50 }), false);
  const started = Date.now();
  assert.equal(await waitForPort(port, { timeoutMs: 5000, isAlive: () => false }), false);
  assert.ok(Date.now() - started < 1000);
});

test('interactive serve --app starts the app before the dev server when its port is declared', async () => {
  const appPort = await freePort();
  const dir = await project(`{ devServer: { command: 'node app.js', port: ${appPort} } }`);
  const app = net.createServer();
  try {
    const order = [];
    const manager = new ServerManager(
      { getCurrentSchemaPath: () => path.join(dir, 'form.schema.json') },
      null,
      null
    );
    manager.startAppServer = async () => {
      order.push('app');
      manager.appServerProcess = { pid: 1 };
      setTimeout(() => app.listen(appPort, 'localhost'), 200);
    };
    manager.startDevServer = async () => {
      order.push(`dev (app listening: ${await waitForPort(appPort, { timeoutMs: 1 })})`);
      manager.devServer = {
        getStatus: () => ({ running: true, host: 'localhost', port: 3030 }),
      };
    };
    const printed = [];
    const log = console.log;
    console.log = (line) => printed.push(String(line));
    try {
      await manager.startDevAndAppServers([]);
    } finally {
      console.log = log;
    }
    assert.deepEqual(order, ['app', 'dev (app listening: true)']);
    const summary = printed.join('\n');
    assert.match(summary, new RegExp(`Open your app: http://localhost:${appPort}`));
    assert.match(summary, /form0 dev server \(API and schema preview\): http:\/\/localhost:3030/);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await fs.remove(dir);
  }
});

// The app records whether the CLI's port opened before it listened, then exits,
// which also stops the CLI.
const APP = `import fs from 'node:fs';
import net from 'node:net';
const [appPort, cliPort] = process.argv.slice(2).map(Number);
const open = (port) => new Promise((resolve) => {
  const socket = net.connect({ port, host: 'localhost' });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});
await new Promise((resolve) => setTimeout(resolve, 800));
const cliOpenBeforeApp = await open(cliPort);
const server = net.createServer().listen(appPort, 'localhost');
let cliOpened = cliOpenBeforeApp;
for (let n = 0; n < 100 && !cliOpened; n++) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  cliOpened = await open(cliPort);
}
fs.writeFileSync('order.json', JSON.stringify({ cliOpenBeforeApp, cliOpened }));
await new Promise((resolve) => setTimeout(resolve, 500));
server.close();
`;

async function runServeApp({ declarePort }) {
  const [appPort, cliPort] = [await freePort(), await freePort()];
  const dir = await project(
    `{ devServer: { command: 'node app.mjs ${appPort} ${cliPort}'${declarePort ? `, port: ${appPort}` : ''} } }`
  );
  await fs.writeFile(path.join(dir, 'app.mjs'), APP);
  try {
    const result = await execFileAsync(
      process.execPath,
      [executable, 'serve', '--app', '--port', `${cliPort}`],
      {
        cwd: dir,
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
      }
    ).catch((error) => error);
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    return {
      ...(await fs.readJson(path.join(dir, 'order.json'))),
      summary: output.includes(`Open your app: http://localhost:${appPort}`),
    };
  } finally {
    await fs.remove(dir);
  }
}

test('serve --app opens the app port before the dev server when devServer.port is declared', async () => {
  assert.deepEqual(await runServeApp({ declarePort: true }), {
    cliOpenBeforeApp: false,
    cliOpened: true,
    summary: true,
  });
});

test('serve --app keeps starting the dev server first without a declared port', async () => {
  assert.deepEqual(await runServeApp({ declarePort: false }), {
    cliOpenBeforeApp: true,
    cliOpened: true,
    summary: false,
  });
});
