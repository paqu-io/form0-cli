import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import fs from 'fs-extra';
import { ServerManager } from '../src/commands/interactive/managers/server-manager.js';
import { resolveAppEndpoint, waitForPort } from '../src/utils/app-dev-server.js';
import { printServeBanner } from '../src/utils/serve-banners.js';
import { schemaWithCalculation } from './fixtures/diagnostics-schema.mjs';

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
  const none = { port: null, url: null, expo: false };
  const cases = [
    [
      "{ devServer: { command: 'npm run dev', port: 5173 } }",
      { port: 5173, url: 'http://localhost:5173', expo: false },
    ],
    // Expo apps are opened from a device, so there is no browser URL to show.
    [
      "{ devServer: { type: 'app', provider: 'expo', port: 8081 } }",
      { port: 8081, url: null, expo: true },
    ],
    ["{ devServer: { command: 'npm run dev' } }", none],
    ["{ devServer: { command: 'npm run dev', port: 'abc' } }", none],
    ["{ devServer: { command: 'npm run dev', port: 70000 } }", none],
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
    assert.deepEqual(await resolveAppEndpoint(empty), none);
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
    manager.startAppServer = async (args, options) => {
      order.push(`app (stop hint: ${options.stopHint})`);
      manager.appServerProcess = { pid: 1 };
      setTimeout(() => app.listen(appPort, 'localhost'), 200);
    };
    manager.startDevServer = async (args, options) => {
      const listening = await waitForPort(appPort, { timeoutMs: 1 });
      order.push(
        `dev (app listening: ${listening}, ${options.banner} banner for: ${options.appUrl})`
      );
      manager.devServer = { getStatus: () => ({ running: true }) };
    };
    await manager.startDevAndAppServers([]);
    assert.deepEqual(order, [
      'app (stop hint: false)',
      `dev (app listening: true, app banner for: http://localhost:${appPort})`,
    ]);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await fs.remove(dir);
  }
});

test('interactive serve --app uses the Expo banner, which carries the only stop hint', async () => {
  const dir = await project("{ devServer: { type: 'app', provider: 'expo' } }");
  try {
    const order = [];
    const manager = new ServerManager(
      { getCurrentSchemaPath: () => path.join(dir, 'form.schema.json') },
      null,
      null
    );
    manager.startDevServer = async (args, options) => {
      order.push(`dev (${options.banner} banner)`);
      manager.devServer = { getStatus: () => ({ running: true }) };
    };
    manager.startAppServer = async (args, options) => {
      order.push(`app (stop hint: ${options.stopHint})`);
    };
    await manager.startDevAndAppServers([]);
    assert.deepEqual(order, ['dev (expo banner)', 'app (stop hint: false)']);
  } finally {
    await fs.remove(dir);
  }
});

function printed(callback) {
  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    callback();
  } finally {
    console.log = log;
  }
  return lines.join('\n').trim().split('\n');
}

test('dev server banners share one shape: status, URL to open, details, one stop hint', () => {
  const status = { host: '0.0.0.0', port: 3030 };
  const app = printed(() =>
    printServeBanner('app', status, {
      appUrl: 'http://localhost:5173',
      stopHint: 'Press Ctrl+C to stop both servers.',
    })
  );
  assert.equal(app.length, 3);
  assert.match(app[0], /✅ form0 dev server \(API and schema preview\): http:\/\/localhost:3030/);
  assert.match(app[1], /👉 Open your app: http:\/\/localhost:5173/);
  assert.match(app[2], /Press Ctrl\+C to stop both servers\./);

  // Without a known app URL, there is no app line to point to.
  const unknownApp = printed(() =>
    printServeBanner('app', status, { stopHint: 'Press Ctrl+C to stop both servers.' })
  );
  assert.equal(unknownApp.length, 2);

  const standard = printed(() =>
    printServeBanner('standard', status, {
      schemaPath: 'form.schema.json',
      stopHint: 'Schema changes sync automatically. Press Ctrl+C to stop the server.',
    })
  );
  assert.match(standard[0], /✅ form0 dev server ready · schema: form\.schema\.json/);
  assert.match(standard[1], /👉 Open the preview: http:\/\/localhost:3030/);
  assert.match(standard.at(-1), /Schema changes sync automatically\. Press Ctrl\+C/);
  // Only the optional network line may sit between the preview URL and the stop hint.
  assert.ok(standard.length === 3 || /On your network: http:\/\//.test(standard[2]));

  const expo = printed(() =>
    printServeBanner('expo', status, {
      schemaPath: 'src/forms/demo/schema.json',
      stopHint: 'Use "serve stop" or Ctrl+C to stop both servers.',
    })
  );
  assert.match(expo[0], /✅ form0 dev server \(API and schema preview\): http:\/\/localhost:3030/);
  assert.match(expo[1], /📱 Open your app on your phone: scan Expo's QR code\./);
  assert.match(expo.at(-1), /Use "serve stop" or Ctrl\+C to stop both servers\./);
  // The device reaches the app's API through the network URL, the only optional detail.
  assert.ok(expo.length === 3 || /On your network: http:\/\//.test(expo[2]));

  const expoWithoutSchema = printed(() =>
    printServeBanner('expo', status, { stopHint: 'Press Ctrl+C to stop both servers.' })
  );
  assert.match(expoWithoutSchema.at(-2), /No schema loaded/);
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
      compactBanner:
        output.includes(`Open your app: http://localhost:${appPort}`) &&
        output.includes('Press Ctrl+C to stop both servers.') &&
        !output.includes('form0 Development Server Started'),
      appBanner: output.includes('form0 dev server (API and schema preview)'),
      fullBanner: output.includes('form0 Development Server Started'),
    };
  } finally {
    await fs.remove(dir);
  }
}

test('serve --app opens the app port before the dev server when devServer.port is declared', async () => {
  assert.deepEqual(await runServeApp({ declarePort: true }), {
    cliOpenBeforeApp: false,
    cliOpened: true,
    compactBanner: true,
    appBanner: true,
    fullBanner: false,
  });
});

test('serve --app keeps starting the dev server first without a declared port', async () => {
  assert.deepEqual(await runServeApp({ declarePort: false }), {
    cliOpenBeforeApp: true,
    cliOpened: true,
    compactBanner: false,
    appBanner: true,
    fullBanner: false,
  });
});

test('serve without an app points to the form0 preview', async () => {
  const port = await freePort();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-serve-banner-'));
  await fs.writeJson(path.join(dir, 'form.schema.json'), schemaWithCalculation('1 + 1'));
  const child = spawn(process.execPath, [executable, 'serve', '--port', `${port}`], {
    cwd: dir,
    env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
  });
  let output = '';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No banner:\n${output}`)), 20000);
      const collect = (chunk) => {
        output += chunk;
        if (output.includes('Press Ctrl+C to stop the server.')) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
    });
    assert.match(output, /✅ form0 dev server ready · schema: form\.schema\.json/);
    assert.match(output, new RegExp(`👉 Open the preview: http://localhost:${port}`));
    assert.doesNotMatch(output, /form0 Development Server Started/);
  } finally {
    child.kill('SIGTERM');
    await fs.remove(dir);
  }
});
