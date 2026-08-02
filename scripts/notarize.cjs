/**
 * macOS notarization — electron-builder `afterSign` hook.
 *
 * Required environment variables:
 *   APPLE_ID           – Apple Developer account email
 *   APPLE_APP_PASSWORD – app-specific password (NOT the account password)
 *   APPLE_TEAM_ID      – 10-character Team ID
 *
 * Always skipped on non-macOS platforms.
 *
 * On a release build every other skip is an error. This hook used to warn and
 * return whenever a variable was missing or `@electron/notarize` was absent,
 * which meant the most likely way to ship an un-notarized DMG was to believe
 * you had notarized it: the build succeeded, the log line scrolled past, and
 * Gatekeeper rejected the download on the customer's machine. A missing
 * credential is now fatal when the build is a release, and only a developer
 * convenience otherwise.
 *
 * The variable name has caught people out too. `docs/DEPLOYMENT_PRODUCTION.md`
 * previously said APPLE_APP_SPECIFIC_PASSWORD, which is what Apple calls the
 * thing but not what this reads. If that spelling is present and the expected
 * one is not, the mistake is named rather than silently treated as absent.
 */

'use strict';

const REQUIRED = ['APPLE_ID', 'APPLE_APP_PASSWORD', 'APPLE_TEAM_ID'];

/** Mistaken spellings that are worth naming instead of reporting as "not set". */
const ALIASES = Object.freeze({
  APPLE_APP_PASSWORD: ['APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_ID_PASSWORD'],
  APPLE_TEAM_ID: ['APPLE_TEAMID'],
});

function notarizationRequired(env = process.env) {
  if (env.TRANSTRACK_RELEASE_CHANNEL === 'public') return true;
  const explicit = String(env.TRANSTRACK_REQUIRE_NOTARIZATION || '').toLowerCase();
  return explicit === '1' || explicit === 'true';
}

/**
 * @returns {{ missing: string[], hints: string[] }}
 */
function inspectCredentials(env = process.env) {
  const missing = REQUIRED.filter((v) => !env[v]);
  const hints = [];
  for (const name of missing) {
    for (const alias of ALIASES[name] || []) {
      if (env[alias]) {
        hints.push(`${alias} is set but this hook reads ${name} — rename it.`);
      }
    }
  }
  return { missing, hints };
}

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const required = notarizationRequired();

  let notarize;
  try {
    notarize = require('@electron/notarize').notarize;
  } catch {
    const msg = '@electron/notarize is not installed';
    if (required) {
      throw new Error(
        `Cannot notarize: ${msg}. This build is a release, so an un-notarized ` +
        `artifact is not acceptable. Run: npm install --save-dev @electron/notarize`,
      );
    }
    console.warn(`Skipping notarization: ${msg}`);
    return;
  }

  const { missing, hints } = inspectCredentials();
  if (missing.length > 0) {
    const detail = [`${missing.join(', ')} not set`, ...hints].join('. ');
    if (required) {
      throw new Error(
        `Cannot notarize: ${detail}. This build is a release, so it must not ` +
        `produce an un-notarized artifact. See docs/CODE_SIGNING.md. To build ` +
        `without notarization deliberately, unset TRANSTRACK_RELEASE_CHANNEL ` +
        `and TRANSTRACK_REQUIRE_NOTARIZATION.`,
      );
    }
    console.warn(`Skipping notarization: ${detail}`);
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  console.log(`Notarizing ${appName}...`);

  await notarize({
    appBundleId: context.packager.config.appId,
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });

  console.log('Notarization complete.');
};

// Exported for unit tests; not part of the electron-builder contract.
exports.__testing__ = { notarizationRequired, inspectCredentials, REQUIRED, ALIASES };
