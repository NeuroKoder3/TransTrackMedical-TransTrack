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
 *           Local .pfx file (works for OV certificates that ship as a file
 *           and for EV certs exported into a software-protected PFX).
 *           Required env vars:
 *             CSC_LINK             - absolute path to the .pfx file
 *             CSC_KEY_PASSWORD     - PFX export password
 *
 *   MODE 3  TRANSTRACK_SIGN_MODE=skip
 *           No-op. Used for unsigned local development builds. The artifact
 *           will still be produced but Windows SmartScreen will block it on
 *           any machine other than the build machine. Never use for release.
 *
 * Auto-detect: when TRANSTRACK_SIGN_MODE is unset, the script picks the
 * first mode for which all required env vars are present, in the order
 * ssl_esigner -> pfx -> skip.
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
  const pfx = process.env.CSC_LINK;
  const pfxPwd = process.env.CSC_KEY_PASSWORD;
  if (!fs.existsSync(pfx)) {
    throw new Error(`CSC_LINK not found: ${pfx}`);
  }
  // Use the Windows SDK's signtool from PATH. CI runners (GitHub Actions
  // windows-latest) ship with it; locally, install via the Windows 10/11 SDK.
  const args = [
    'sign',
    '/fd',  'sha256',
    '/td',  'sha256',
    '/tr',  process.env.SIGN_TIMESTAMP_URL || 'http://timestamp.sectigo.com',
    '/f',   pfx,
    '/p',   pfxPwd,
    filePath,
  ];
  _log(`Signing via signtool/PFX: ${path.basename(filePath)}`);
  const result = child_process.spawnSync('signtool', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr?.toString() || '');
    throw new Error(`signtool failed (exit ${result.status})`);
  }
  process.stdout.write(result.stdout?.toString() || '');
  _log(`Signed (PFX): ${path.basename(filePath)}`);
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
    _warn('No file path provided to signer; skipping');
    return;
  }
  if (MODE === 'skip') {
    _warn(
      `TRANSTRACK_SIGN_MODE=skip (auto-detected: no signing credentials in environment). ` +
      `Artifact "${path.basename(filePath)}" will be UNSIGNED. ` +
      `Set ESIGNER_* or CSC_LINK/CSC_KEY_PASSWORD before producing a release.`
    );
    return;
  }
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
};
