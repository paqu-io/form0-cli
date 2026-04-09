import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import {
  buildExpoStartCommand,
  hasConfiguredAppDevServer,
  resolveAppDevServerLaunch,
  resolvePublicUrl,
  resolveStructuredExpoLaunch,
} from '../src/utils/app-dev-server.js';

async function createProject(packageManager) {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-cli-app-dev-server-'));
  await fs.writeJson(
    path.join(projectRoot, 'package.json'),
    packageManager
      ? { name: 'app-dev-server-test', packageManager }
      : { name: 'app-dev-server-test' },
    { spaces: 2 }
  );
  return projectRoot;
}

async function run() {
  const cleanupPaths = [];

  try {
    assert.equal(buildExpoStartCommand('npm'), 'npx expo start --lan -c -p 8081');
    assert.equal(
      buildExpoStartCommand('pnpm', { hostMode: 'localhost', port: 19000, clearCache: false }),
      'pnpm exec expo start --localhost -p 19000'
    );
    assert.equal(
      buildExpoStartCommand('yarn', { hostMode: 'tunnel', port: 9001 }),
      'yarn expo start --tunnel -c -p 9001'
    );
    assert.equal(
      buildExpoStartCommand('bun', { hostMode: 'lan', port: 8088 }),
      'bunx expo start --lan -c -p 8088'
    );

    const devServer = {
      type: 'app',
      provider: 'expo',
      host: 'lan',
      publicUrl: 'https://config.example',
      publicUrlEnv: 'FORM0_APP_PUBLIC_URL',
    };

    assert.equal(
      resolvePublicUrl(
        devServer,
        { publicUrl: 'https://cli.example' },
        { FORM0_APP_PUBLIC_URL: 'https://env.example' }
      ),
      'https://cli.example'
    );
    assert.equal(
      resolvePublicUrl(devServer, {}, { FORM0_APP_PUBLIC_URL: 'https://env.example' }),
      'https://env.example'
    );
    assert.equal(resolvePublicUrl(devServer, {}, {}), 'https://config.example');
    assert.equal(
      hasConfiguredAppDevServer(devServer),
      true,
      'Structured Expo config should count as app dev server config'
    );
    assert.equal(
      hasConfiguredAppDevServer({ command: 'npm run dev' }),
      true,
      'Legacy command config should still count as app dev server config'
    );

    const npmProject = await createProject('npm@11.9.0');
    cleanupPaths.push(npmProject);

    const npmLaunch = await resolveStructuredExpoLaunch(npmProject, {
      type: 'app',
      provider: 'expo',
    });
    assert.equal(npmLaunch.command, 'npx expo start --lan -c -p 8081');
    assert.deepEqual(
      npmLaunch.envOverrides,
      {},
      'No public URL should fall back to standard Expo LAN startup'
    );

    const pnpmProject = await createProject('pnpm@10.0.0');
    cleanupPaths.push(pnpmProject);

    const pnpmLaunch = await resolveStructuredExpoLaunch(
      pnpmProject,
      {
        type: 'app',
        provider: 'expo',
        host: 'localhost',
        port: 19001,
        clearCache: false,
        publicUrlEnv: 'FORM0_APP_PUBLIC_URL',
      },
      {
        env: {
          FORM0_APP_PUBLIC_URL: 'https://env.example',
        },
      }
    );
    assert.equal(pnpmLaunch.command, 'pnpm exec expo start --localhost -p 19001');
    assert.equal(pnpmLaunch.publicUrl, 'https://env.example');
    assert.deepEqual(pnpmLaunch.envOverrides, {
      EXPO_PACKAGER_PROXY_URL: 'https://env.example',
    });

    await assert.rejects(
      () =>
        resolveStructuredExpoLaunch(
          npmProject,
          {
            type: 'app',
            provider: 'expo',
            host: 'tunnel',
            publicUrl: 'https://proxy.example',
          },
          { env: {} }
        ),
      /cannot use devServer\.host="tunnel"/
    );

    const legacyLaunch = await resolveAppDevServerLaunch(
      npmProject,
      {
        type: 'app',
        command: 'npm run dev',
      },
      {
        publicUrl: 'https://ignored.example',
        env: {
          FORM0_APP_PUBLIC_URL: 'https://env.example',
        },
      }
    );
    assert.equal(legacyLaunch.mode, 'legacy');
    assert.equal(legacyLaunch.command, 'npm run dev');
    assert.equal(legacyLaunch.publicUrl, null);
    assert.deepEqual(legacyLaunch.envOverrides, {});

    console.log('App dev server tests passed.');
  } finally {
    await Promise.all(cleanupPaths.map((projectRoot) => fs.remove(projectRoot)));
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
