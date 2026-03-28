/**
 * macOS Notarization Script for electron-builder afterSign hook.
 *
 * Required environment variables:
 *   APPLE_ID           – Apple Developer account email
 *   APPLE_APP_PASSWORD – App-specific password (not account password)
 *   APPLE_TEAM_ID      – 10-character Team ID
 *
 * Skipped automatically on non-macOS platforms and when env vars are absent.
 */

'use strict';

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  let notarize;
  try {
    notarize = require('@electron/notarize').notarize;
  } catch {
    console.warn('Skipping notarization: @electron/notarize not installed');
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.warn('Skipping notarization: APPLE_ID, APPLE_APP_PASSWORD, or APPLE_TEAM_ID not set');
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  console.log(`Notarizing ${appName}...`);

  await notarize({
    appBundleId: context.packager.config.appId,
    appPath: `${appOutDir}/${appName}.app`,
    appleId,
    appleIdPassword,
    teamId,
  });

  console.log('Notarization complete.');
};
