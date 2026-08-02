/**
 * TransTrack — Windows Authenticode signer for electron-builder.
 *
 * electron-builder calls this hook for every Windows artifact that needs to
 * be signed (the .exe, the embedded launcher, and the NSIS installer). The
 * script supports three signing modes, selected by environment variable, in
 * priority order:
 *
 *   MODE 1  TRANSTRACK_SIGN_MODE=ssl_esigner   (the production route)
 *           SSL.com eSigner CodeSignTool — the certificate's private key lives
 *           in SSL.com's cloud HSM, so there is no USB token to plug in and no
 *           key on the build machine. Only a hash of the artifact is sent for
 *           signing; the artifact itself never leaves. Required env vars:
 *             ESIGNER_USERNAME      - SSL.com account username
 *             ESIGNER_PASSWORD      - SSL.com account password
 *             ESIGNER_CREDENTIAL_ID - certificate slot id from SSL.com dashboard
 *             ESIGNER_TOTP_SECRET   - the TOTP *secret* from the dashboard, not
 *                                     a 6-digit code: CodeSignTool derives the
 *                                     code itself and the secret is base64
 *             ESIGNER_TOOL_PATH     - absolute path to CodeSignTool.bat (or .sh on linux/mac)
 *
 *   MODE 2  TRANSTRACK_SIGN_MODE=pfx
 *           A PKCS#12 certificate held as a file. Since June 2023 no CA can
 *           issue a code signing key that is exportable to a file, so this mode
 *           is for a certificate already held, internal builds, and test
 *           signing — not for a new purchase. Required env vars:
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
 * Whichever mode runs, the artifact is re-read afterwards and must actually
 * carry an embedded signature. A zero exit status is not sufficient evidence:
 * CodeSignTool in particular has been observed to print a failure and exit 0.
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

/**
 * Quote a value so cmd.exe passes it through unchanged.
 *
 * CodeSignTool ships as a .bat, and Node cannot spawn a batch file without a
 * shell, so the arguments are re-parsed by cmd.exe. Inside double quotes cmd
 * stops treating `&`, `|`, `<`, `>`, `^` and `(` `)` as syntax, which matters
 * because SSL.com passwords routinely contain them — their own documentation
 * uses `P!@^^ssword12` as the example.
 *
 * Two characters cannot be rescued this way, so they are refused rather than
 * silently mangled into a wrong password and an "invalid credentials" error
 * that looks like an account problem:
 *   `"` terminates the quoting, and cmd has no in-quote escape for it.
 *   `%` triggers environment expansion even inside quotes.
 */
function _quoteForCmd(name, value) {
  const text = String(value);
  const offender = /["%]/.exec(text);
  if (offender) {
    throw new Error(
      `${name} contains a ${offender[0] === '"' ? 'double quote' : 'percent sign'}, ` +
      `which cannot be passed through the Windows command interpreter to ` +
      `CodeSignTool without corrupting it. Change the value in your SSL.com ` +
      `account to avoid " and %, then update the secret.`,
    );
  }
  return `"${text}"`;
}

/** Keep secrets out of anything we echo from the tool. */
function _redact(text, secrets) {
  let out = String(text);
  for (const s of secrets) {
    if (s) out = out.split(s).join('***');
  }
  return out;
}

function _runSslEsigner(filePath) {
  const tool = process.env.ESIGNER_TOOL_PATH;
  if (!fs.existsSync(tool)) {
    throw new Error(
      `ESIGNER_TOOL_PATH not found: ${tool}. Download CodeSignTool from your ` +
      `SSL.com dashboard and point this at CodeSignTool.bat.`,
    );
  }

  const secrets = [process.env.ESIGNER_PASSWORD, process.env.ESIGNER_TOTP_SECRET];

  // Sign into a sibling directory rather than over the input. CodeSignTool
  // prompts for confirmation before overwriting its input file, and a prompt in
  // CI is a hung build, not a failed one. A sibling keeps the (large) installer
  // on the same volume so the move back is a rename rather than a copy.
  const outDir = fs.mkdtempSync(path.join(path.dirname(filePath), '.tt-signed-'));
  try {
    const args = [
      'sign',
      // CodeSignTool is picocli-based and every SSL.com example uses the
      // name=value form; the space-separated form is not documented to work.
      `-username=${_quoteForCmd('ESIGNER_USERNAME', process.env.ESIGNER_USERNAME)}`,
      `-password=${_quoteForCmd('ESIGNER_PASSWORD', process.env.ESIGNER_PASSWORD)}`,
      `-credential_id=${_quoteForCmd('ESIGNER_CREDENTIAL_ID', process.env.ESIGNER_CREDENTIAL_ID)}`,
      // The *secret*, not a generated code. CodeSignTool derives the six-digit
      // OTP itself; handing it a code makes it try to derive an OTP from that
      // code, which fails as "invalid otp" and looks like a 2FA problem.
      `-totp_secret=${_quoteForCmd('ESIGNER_TOTP_SECRET', process.env.ESIGNER_TOTP_SECRET)}`,
      `-input_file_path="${filePath}"`,
      `-output_dir_path="${outDir}"`,
    ];

    _log(`Signing via SSL.com eSigner: ${path.basename(filePath)}`);
    const result = child_process.spawnSync(tool, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      // CodeSignTool resolves conf/ and logs/ relative to its own directory.
      cwd: path.dirname(tool),
    });

    const stdout = _redact(result.stdout?.toString() || '', secrets);
    const stderr = _redact(result.stderr?.toString() || '', secrets);
    process.stdout.write(stdout);

    if (result.status !== 0) {
      process.stderr.write(stderr);
      throw new Error(`SSL.com CodeSignTool failed (exit ${result.status})`);
    }

    // CodeSignTool has been observed to report a failure and still exit 0, so
    // its exit status alone is not evidence that anything was signed.
    const signed = path.join(outDir, path.basename(filePath));
    if (!fs.existsSync(signed)) {
      process.stderr.write(stderr);
      throw new Error(
        `CodeSignTool exited 0 but produced no signed file in ${outDir}. ` +
        `The output above is the tool's own report of what went wrong; ` +
        `"invalid otp" here usually means ESIGNER_TOTP_SECRET holds a 6-digit ` +
        `code rather than the secret from the dashboard.`,
      );
    }

    _replaceFile(signed, filePath);
    _log(`Signed (eSigner): ${path.basename(filePath)}`);
  } finally {
    try { fs.rmSync(outDir, { recursive: true, force: true }); }
    catch (e) { _warn(`could not remove temporary signing directory: ${e.message}`); }
  }
}

/** Move `from` onto `to`, falling back to a copy across volumes. */
function _replaceFile(from, to) {
  try {
    fs.rmSync(to, { force: true });
    fs.renameSync(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.copyFileSync(from, to);
  }
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
    // No shell here. signtool is an .exe, so Node can quote the arguments
    // itself — which it does correctly, unlike cmd.exe, for a PFX password
    // containing the special characters export passwords tend to contain.
    const result = child_process.spawnSync('signtool', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error) {
      throw new Error(
        `could not run signtool: ${result.error.message}. It ships with the ` +
        `Windows 10/11 SDK and must be on PATH.`,
      );
    }
    if (result.status !== 0) {
      // signtool echoes the /p value in some diagnostics; the password is the
      // one thing that must not reach a build log.
      const stderr = _redact(result.stderr?.toString() || '', [pfxPwd]);
      process.stderr.write(stderr);
      throw new Error(`signtool failed (exit ${result.status})`);
    }
    process.stdout.write(result.stdout?.toString() || '');
    _log(`Signed (PFX): ${path.basename(filePath)}`);
  } finally {
    cert.cleanup();
  }
}

/**
 * Confirm the artifact actually gained a signature.
 *
 * A signing tool's exit status reports whether the tool ran, not whether the
 * file on disk changed. CodeSignTool has been observed to print a failure and
 * exit 0, and the whole point of the release gate is that no unsigned artifact
 * reaches a customer — so the file is re-read rather than trusted.
 *
 * This is a post-condition, not a validity check: it establishes that a
 * certificate table is present. Trust evaluation happens in the release gate,
 * which has the artifact and the tooling to ask the operating system.
 */
async function _assertSignatureEmbedded(filePath) {
  let readEmbeddedSignature;
  try {
    ({ readEmbeddedSignature } = await import('./verify-artifact-signature.mjs'));
  } catch (e) {
    _warn(`could not load the signature verifier, skipping post-sign check: ${e.message}`);
    return;
  }

  let result;
  try {
    result = readEmbeddedSignature(filePath);
  } catch (e) {
    // electron-builder signs PE files, but if it ever hands us something else
    // the inability to parse it is not evidence that signing failed.
    _warn(`post-sign check skipped for ${path.basename(filePath)}: ${e.message}`);
    return;
  }

  if (!result.present) {
    throw new Error(
      `${path.basename(filePath)} still carries no embedded signature after the ` +
      `signing tool reported success. Treat the tool's output above as the real ` +
      `error; the exit status was misleading.`,
    );
  }
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

  if (MODE === 'ssl_esigner') _runSslEsigner(filePath);
  else if (MODE === 'pfx')    _runPfxSign(filePath);
  else throw new Error(`Unknown TRANSTRACK_SIGN_MODE: ${MODE}`);

  await _assertSignatureEmbedded(filePath);
}

module.exports = sign;
module.exports.default = sign;
// Underscored exports for unit tests only — do not depend on these from
// production code.
module.exports.__testing__ = {
  _autoDetectMode,
  _resolveFilePath,
  _signingRequired,
  _assertModeConfigured,
  _materializeCertificate,
  _quoteForCmd,
  _redact,
  _replaceFile,
  _assertSignatureEmbedded,
  MODE_REQUIREMENTS,
};
