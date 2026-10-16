import os from 'os';
import { colors } from './theme.js';
import { t } from './i18n.js';

const browserHost = (host) => (['0.0.0.0', '::'].includes(host) ? 'localhost' : host);

/**
 * URL of the dev server on the machine's first external IPv4 address, for
 * opening the preview from another device. Null when there is none.
 */
export function getNetworkUrl(port) {
  const address = Object.values(os.networkInterfaces())
    .flat()
    .find((iface) => iface?.family === 'IPv4' && !iface.internal)?.address;
  return address ? `http://${address}:${port}` : null;
}

/**
 * form0 dev server banners share one shape: a ✅ status line, a 👉 line with
 * the URL to open, indented details, and a single stop hint last.
 * - 'standard': serve without an app; the form0 preview is the page to open.
 * - 'app': serve --app; the dev server provides the app's API. With appUrl
 *   (the app is listening), point to the app.
 * - 'expo': serve --app for an Expo app, opened on the phone from Expo's QR
 *   code. The network URL stays: the device reaches the app's API through it.
 * App banners without a schema add noSchemaHint: how to show one in the
 * preview, which depends on whether the CLI is interactive.
 */
export function printServeBanner(
  kind,
  { host, port },
  { schemaPath, appUrl, stopHint, noSchemaHint } = {}
) {
  const url = `http://${browserHost(host)}:${port}`;
  if (kind === 'app' || kind === 'expo') {
    console.log(colors.success(`\n✅ ${t('commands.serve.devServerForApp', { url })}`));
    if (kind === 'expo') {
      console.log(colors.success(t('commands.serve.openAppWithExpo')));
      const networkUrl = getNetworkUrl(port);
      if (networkUrl) {
        console.log(
          colors.textSecondary(`   ${t('commands.serve.onNetwork', { url: networkUrl })}`)
        );
      }
    } else if (appUrl) {
      console.log(colors.success(t('commands.serve.openApp', { url: appUrl })));
    }
    if (!schemaPath && noSchemaHint) {
      console.log(colors.textSecondary(`   ${noSchemaHint}`));
    }
  } else {
    const ready = schemaPath
      ? t('commands.serve.readyWithSchema', { path: schemaPath })
      : t('commands.serve.ready');
    console.log(colors.success(`\n✅ ${ready}`));
    console.log(colors.success(t('commands.serve.openPreview', { url })));
    const networkUrl = getNetworkUrl(port);
    if (networkUrl) {
      console.log(colors.textSecondary(`   ${t('commands.serve.onNetwork', { url: networkUrl })}`));
    }
  }
  console.log(colors.textSecondary(`   ${stopHint}`));
}
