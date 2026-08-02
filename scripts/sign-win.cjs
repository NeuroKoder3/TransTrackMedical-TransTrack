/**
 * TransTrack — Windows Authenticode signer for electron-builder.
 *
 * electron-builder calls this hook for every Windows artifact that needs to
 * be signed (the .exe, the embedded launcher, and the NSIS installer). The
 * script supports three signing modes, selected by environment variable, in
 * priority order:
 *
 *   MODE 1  TRANSTRACK_SIGN_MODE=ssl_esigner   (recommended for CI/CD)
 *           SSL.com eSigner CodeSignTool — cloud HSM, no physical USB token,
 *           CI-friendly. Required env vars:
 *             ESIGNER_USERNAME      - SSL.com account username
 *             ESIGNER_PASSWORD      - SSL.com account password
 *             ESIGNER_CREDENTIAL_ID - certificate slot id from SSL.com dashboard
 *             ESIGNER_TOTP_SECRET   - the BASE32 TOTP secret (NOT the 6-digit code)
 *             ESIGNER_TOOL_PATH     - absolute path to CodeSignTool.bat (or .sh on linux/mac)
 *
 *   MODE 2  TRANSTRACK_SIGN_MODE=pfx
 *           A PKCS#12 certificate held as a file. Required env vars:
 *             CSC_LINK             - path to the .pfx, OR its base64 contents
 *                                    (CI secrets carry the bytes, not a path)
 *             CSC_KEY_PASSWORD     - PFX export password
 *
 *   MODE 3  TRANSTRACK_SIGN_MODE=skip
 *           No-op. Used for unsigned local development builds. The artifact is
 *           still produced but arrives unverifiable on any other machine, so
 *           Windows warns the user before it will run. Never use for release —
 *           and on a release build (see _signingRequired) this mode is refused
 *           rather than warned about.
 *
 * Auto-detect: when TRANSTRACK_SIGN_MODE is unset, the script picks the
 * first mode for which all required env vars are present, in the order
 * ssl_esigner -> pfx -> skip. A mode named *explicitly* whose variables are
 * incomplete is an error, not a reason to fall through to skip.
 *
 * The script accepts the file-to-sign path as the first argv after node /
 * the script itself, OR as `process.env.SIGNTOOL_PATH` (electron-builder
 * sets `path` in the configuration object passed to the function form, but
 * since electron-builder@26 also accepts a CommonJS file with a default
 * function we expose both shapes).
 *
 * Logs are written to stdout in a stable, parseable format so CI pipelines
 * can grep for `[sign-win]`.
 */

'use strict';

const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODE = (process.env.TRANSTRACK_SIGN_MODE || _autoDetectMode()).toLowerCase();

function _autoDetectMode() {
  if (
    process.env.ESIGNER_USERNAME &&
    process.env.ESIGNER_PASSWORD &&
    process.env.ESIGNER_CREDENTIAL_ID &&
    process.env.ESIGNER_TOTP_SECRET &&
    process.env.ESIGNER_TOOL_PATH
  ) {
    return 'ssl_esigner';
  }
  if (process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD) {
    return 'pfx';
  }
  return 'skip';
}

function _log(msg)  { process.stdout.write(`[sign-win] ${msg}\n`); }
function _warn(msg) { process.stderr.write(`[sign-win] WARN ${msg}\n`); }

/**
 * Is an unsigned artifact an error rather than a warning?
 *
 * The dangerous failure here is the quiet one. A developer build that comes out
 * unsigned is fine and expected; a *release* build that comes out unsigned while
 * the pipeline reports success is how an unsigned installer reaches a hospital.
 * Warning-and-continuing is the right behaviour for the first case and
 * indefensible for the second, so the two cases are distinguished explicitly
 * rather than by hoping whoever ran the build read stderr.
 *
 * `TRANSTRACK_RELEASE_CHANNEL=public` is the same signal the release gate uses
 * to promote signing checks to mandatory, so the build and the gate cannot
 * disagree about whether a given run is a release.
 */
function _signingRequired() {
  if (process.env.TRANSTRACK_RELEASE_CHANNEL === 'public') return true;
  const explicit = String(process.env.TRANSTRACK_REQUIRE_SIGNING || '').toLowerCase();
  return explicit === '1' || explicit === 'true';
}

const MODE_REQUIREMENTS = Object.freeze({
  ssl_esigner: [
    'ESIGNER_USERNAME',
    'ESIGNER_PASSWORD',
    'ESIGNER_CREDENTIAL_ID',
    'ESIGNER_TOTP_SECRET',
    'ESIGNER_TOOL_PATH',
  ],
  pfx: ['CSC_LINK', 'CSC_KEY_PASSWORD'],
  skip: [],
});

/**
 * Fail before doing any work if the selected mode is missing a variable.
 *
 * Without this, `ESIGNER_TOOL_PATH` being unset surfaces as
 * "ESIGNER_TOOL_PATH not found: undefined" from an existsSync deep in the
 * signing call, part-way through a long build. Naming the missing variable up
 * front turns a confusing late failure into an obvious early one.
 */
function _assertModeConfigured(mode) {
  const required = MODE_REQUIREMENTS[mode];
  if (!required) throw new Error(`Unknown TRANSTRACK_SIGN_MODE: ${mode}`);
  const missing = required.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `TRANSTRACK_SIGN_MODE=${mode} but ${missing.join(', ')} ` +
      `${missing.length === 1 ? 'is' : 'are'} not set. ` +
      `See docs/CODE_SIGNING.md for the full variable set for this mode.`,
    );
  }
}

/**
 * Resolve CSC_LINK to a certificate file on disk.
 *
 * CSC_LINK is conventionally either a path or the base64 content of the .p12 /
 * .pfx, and in CI it can only ever be the latter: a secret store holds bytes,
 * not files, so no path a secret could contain would exist on the runner. The
 * previous implementation accepted only a path, which made pfx mode
 * unreachable from CI and produced the memorable error
 * "CSC_LINK not found: MIIKfAIBAzCCCjIGCSqGSIb3..." for anyone who tried.
 *
 * Returns a cleanup function; the caller must invoke it. The temporary copy is
 * a private key, so it is written under a 0600 file in a 0700 directory and
 * removed in a finally block.
 */
function _materializeCertificate(cscLink) {
  if (fs.existsSync(cscLink)) {
    return { file: cscLink, cleanup: () => {} };
  }

  const der = Buffer.from(cscLink, 'base64');
  // A PKCS#12 file is DER: it begins with a SEQUENCE tag. Checking this
  // distinguishes "base64 of a real certificate" from "a path that is simply
  // wrong", so a typo'd path does not get reported as a corrupt certificate.
  if (der.length < 64 || der[0] !== 0x30) {
    throw new Error(
      `CSC_LINK is neither an existing file nor base64-encoded PKCS#12 content. ` +
      `In CI, set it to the base64 of your .pfx/.p12 ` +
      `(PowerShell: [Convert]::ToBase64String([IO.File]::ReadAllBytes('cert.pfx'))).`,
    );
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-csc-'));
  const file = path.join(dir, 'certificate.pfx');
  fs.writeFileSync(file, der, { mode: 0o600 });
  _log('Materialised certificate from base64 CSC_LINK into a temporary file');

  return {
    file,
    cleanup: () => {
      try { fs.rmSync(dir, { recursive: true, force: true }); }
      catch (e) { _warn(`could not remove temporary certificate directory: ${e.message}`); }
    },
  };
}

function _resolveFilePath(input) {
  // electron-builder@26 may pass a string OR a {path} object.
  if (!input) return null;
  if (typeof input === 'string') return input;
  if (typeof input === 'object' && typeof input.path === 'string') return input.path;
  return null;
}

function _runSslEsigner(filePath) {
  const tool = process.env.ESIGNER_TOOL_PATH;
  if (!fs.existsSync(tool)) {
    throw new Error(`ESIGNER_TOOL_PATH not found: ${tool}`);
  }
  // Use TOTP secret to derive a one-time code at sign time
  const totp = _generateTotp(process.env.ESIGNER_TOTP_SECRET);
  const args = [
    'sign',
    '-username',      process.env.ESIGNER_USERNAME,
    '-password',      process.env.ESIGNER_PASSWORD,
    '-credential_id', process.env.ESIGNER_CREDENTIAL_ID,
    '-totp_secret',   totp,
    '-input_file_path',  filePath,
    '-output_dir_path', path.dirname(filePath),
    '-overwrite',
  ];
  _log(`Signing via SSL.com eSigner: ${path.basename(filePath)}`);
  const result = child_process.spawnSync(tool, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr?.toString() || '');
    throw new Error(`SSL.com CodeSignTool failed (exit ${result.status})`);
  }
  process.stdout.write(result.stdout?.toString() || '');
  _log(`Signed (eSigner): ${path.basename(filePath)}`);
}

function _runPfxSign(filePath) {
  const cert = _materializeCertificate(process.env.CSC_LINK);
  const pfxPwd = process.env.CSC_KEY_PASSWORD;
  try {
    // Use the Windows SDK's signtool from PATH. CI runners (GitHub Actions
    // windows-latest) ship with it; locally, install via the Windows 10/11 SDK.
    const args = [
      'sign',
      '/fd',  'sha256',
      '/td',  'sha256',
      '/tr',  process.env.SIGN_TIMESTAMP_URL || 'http://timestamp.sectigo.com',
      '/f',   cert.file,
      '/p',   pfxPwd,
      filePath,
    ];
    _log(`Signing via signtool/PFX: ${path.basename(filePath)}`);
    const result = child_process.spawnSync('signtool', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });
    if (result.status !== 0) {
      // signtool echoes the /p value in some diagnostics; the password is the
      // one thing that must not reach a build log.
      const stderr = (result.stderr?.toString() || '').split(pfxPwd).join('***');
      process.stderr.write(stderr);
      throw new Error(`signtool failed (exit ${result.status})`);
    }
    process.stdout.write(result.stdout?.toString() || '');
    _log(`Signed (PFX): ${path.basename(filePath)}`);
  } finally {
    cert.cleanup();
  }
}

function _generateTotp(base32Secret) {
  // Standard RFC 6238 TOTP: SHA1, 30s step, 6 digits.
  const crypto = require('crypto');
  const key = _base32Decode(base32Secret.replace(/\s+/g, '').toUpperCase());
  const counter = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(0, 0);
  buf.writeUInt32BE(counter, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset]     & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8)  |
    ( hmac[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, '0');
}

function _base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0;
  const out = [];
  for (const ch of input.replace(/=+$/, '')) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid base32 char: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

async function sign(configuration) {
  const filePath = _resolveFilePath(configuration);
  if (!filePath) {
    // A missing path with signing required means electron-builder called the
    // hook in a shape we do not understand — silently producing an unsigned
    // release artifact is not an acceptable response to that.
    if (_signingRequired()) {
      throw new Error(
        'No file path provided to the signer, and signing is required for this build. ' +
        'The electron-builder hook contract may have changed.',
      );
    }
    _warn('No file path provided to signer; skipping');
    return;
  }

  if (MODE === 'skip') {
    if (_signingRequired()) {
      throw new Error(
        `Signing is required for this build but no credentials are configured, so ` +
        `"${path.basename(filePath)}" would be UNSIGNED. Set the variables for one of ` +
        `the supported modes (${Object.keys(MODE_REQUIREMENTS).filter((m) => m !== 'skip').join(', ')}) ` +
        `— see docs/CODE_SIGNING.md. To build unsigned deliberately, unset ` +
        `TRANSTRACK_RELEASE_CHANNEL and TRANSTRACK_REQUIRE_SIGNING.`,
      );
    }
    _warn(
      `TRANSTRACK_SIGN_MODE=skip (auto-detected: no signing credentials in environment). ` +
      `Artifact "${path.basename(filePath)}" will be UNSIGNED. ` +
      `Set ESIGNER_* or CSC_LINK/CSC_KEY_PASSWORD before producing a release.`
    );
    return;
  }

  _assertModeConfigured(MODE);

  if (MODE === 'ssl_esigner') return _runSslEsigner(filePath);
  if (MODE === 'pfx')         return _runPfxSign(filePath);
  throw new Error(`Unknown TRANSTRACK_SIGN_MODE: ${MODE}`);
}

module.exports = sign;
module.exports.default = sign;
// Underscored exports for unit tests only — do not depend on these from
// production code.
module.exports.__testing__ = {
  _autoDetectMode,
  _generateTotp,
  _base32Decode,
  _resolveFilePath,
  _signingRequired,
  _assertModeConfigured,
  _materializeCertificate,
  MODE_REQUIREMENTS,
};
