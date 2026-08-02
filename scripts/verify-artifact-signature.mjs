#!/usr/bin/env node
/**
 * TransTrack — prove that a shipped Windows artifact is actually signed.
 *
 * The release gate previously checked that an installer existed with the right
 * filename and version, under a step named "Code-signed Windows installer
 * present". It never looked at the file. An entirely unsigned installer named
 * correctly passed, which is the wrong way round: the filename is the part an
 * attacker or an accident controls most easily, and the signature is the part
 * that matters.
 *
 * Two levels of evidence, because they prove different things and are available
 * in different places:
 *
 *   1. `readEmbeddedSignature()` parses the PE Certificate Table directly. This
 *      proves a signature is *embedded*, runs anywhere, and needs no tooling —
 *      which matters because the release gate job runs on Linux, where
 *      Get-AuthenticodeSignature does not exist. It cannot tell you the
 *      signature is valid or trusted.
 *   2. `verifyAuthenticode()` shells out to Get-AuthenticodeSignature on
 *      Windows, which does establish validity, trust chain, and signer name.
 *
 * `inspectWindowsArtifact()` combines them and reports which level of assurance
 * it actually achieved, rather than implying the stronger one everywhere.
 *
 * Run standalone: node scripts/verify-artifact-signature.mjs <file.exe>
 */

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Data directory index of the Attribute Certificate Table in a PE image. */
const CERTIFICATE_TABLE_INDEX = 4;
const PE32_MAGIC = 0x10b;
const PE32PLUS_MAGIC = 0x20b;

/**
 * Locate the Attribute Certificate Table of a PE file.
 *
 * @param {string} filePath
 * @returns {{ present: boolean, size: number, offset: number }}
 * @throws if the file is not a PE image at all
 */
export function readEmbeddedSignature(filePath) {
  const buf = readFileSync(filePath);

  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d /* 'MZ' */) {
    throw new Error('not a PE image (missing MZ header)');
  }

  const peOffset = buf.readUInt32LE(0x3c);
  if (peOffset + 24 > buf.length || buf.readUInt32LE(peOffset) !== 0x00004550 /* 'PE\0\0' */) {
    throw new Error('not a PE image (missing PE signature)');
  }

  const optionalHeaderOffset = peOffset + 24;
  const magic = buf.readUInt16LE(optionalHeaderOffset);

  // The data directories sit after the optional header's fixed part, whose
  // length differs between PE32 and PE32+ (the latter widens several fields to
  // 64 bits and drops BaseOfData).
  let dataDirectoryOffset;
  if (magic === PE32_MAGIC) dataDirectoryOffset = optionalHeaderOffset + 96;
  else if (magic === PE32PLUS_MAGIC) dataDirectoryOffset = optionalHeaderOffset + 112;
  else throw new Error(`unrecognised PE optional header magic 0x${magic.toString(16)}`);

  const entryOffset = dataDirectoryOffset + CERTIFICATE_TABLE_INDEX * 8;
  if (entryOffset + 8 > buf.length) {
    return { present: false, size: 0, offset: 0 };
  }

  // Unlike every other data directory entry, this one holds a file offset
  // rather than a relative virtual address.
  const offset = buf.readUInt32LE(entryOffset);
  const size = buf.readUInt32LE(entryOffset + 4);

  return { present: size > 0 && offset > 0, size, offset };
}

/**
 * Ask Windows whether the signature is valid and who signed it.
 *
 * @returns {{ available: false } | { available: true, status: string, subject: string|null, valid: boolean }}
 */
export function verifyAuthenticode(filePath) {
  if (process.platform !== 'win32') return { available: false };

  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$s = Get-AuthenticodeSignature -LiteralPath '${filePath.replace(/'/g, "''")}'; ` +
      `Write-Output ("STATUS=" + $s.Status); ` +
      `Write-Output ("KIND=" + $s.SignatureType); ` +
      `Write-Output ("SUBJECT=" + $s.SignerCertificate.Subject)`,
    ],
    { encoding: 'utf8' },
  );

  if (ps.error || typeof ps.stdout !== 'string') return { available: false };

  const status = /STATUS=(.*)/.exec(ps.stdout)?.[1]?.trim() || 'Unknown';
  const kind = /KIND=(.*)/.exec(ps.stdout)?.[1]?.trim() || 'Unknown';
  const subjectRaw = /SUBJECT=(.*)/.exec(ps.stdout)?.[1]?.trim() || '';

  return {
    available: true,
    status,
    kind,
    subject: subjectRaw === '' ? null : subjectRaw,
    valid: status === 'Valid',
  };
}

/**
 * Full assessment of a Windows artifact.
 *
 * @returns {{ signed: boolean, assurance: 'valid'|'embedded'|'none', detail: string }}
 */
export function inspectWindowsArtifact(filePath) {
  if (!existsSync(filePath)) throw new Error(`artifact not found: ${filePath}`);

  const embedded = readEmbeddedSignature(filePath);
  const authenticode = verifyAuthenticode(filePath);

  if (authenticode.available) {
    // Windows is authoritative on validity, so ask it first rather than
    // inferring from the file layout.
    if (!authenticode.valid) {
      return {
        signed: false,
        assurance: 'none',
        detail: `Authenticode status is ${authenticode.status}, not Valid`,
      };
    }

    // Valid, but is the signature actually part of the file? Windows reports
    // catalog-signed system binaries as Valid even though nothing is embedded —
    // notepad.exe is the canonical example. A catalog lives on the machine that
    // installed it, so it cannot travel with a download: an installer we hand a
    // hospital must carry its signature inside the file.
    if (!embedded.present) {
      return {
        signed: false,
        assurance: 'none',
        detail:
          `signature is ${authenticode.kind}-based, not embedded in the file. ` +
          `A distributed installer must carry an embedded Authenticode signature, ` +
          `because a catalog signature does not travel with the download`,
      };
    }

    const who = authenticode.subject
      ? authenticode.subject.split(',')[0].replace(/^CN=/, '').trim()
      : 'unknown signer';
    return { signed: true, assurance: 'valid', detail: `Valid — signed by ${who}` };
  }

  // Not on Windows: the PE certificate table is the only evidence available.
  if (!embedded.present) {
    return {
      signed: false,
      assurance: 'none',
      detail: 'no Authenticode signature is embedded in the executable',
    };
  }

  return {
    signed: true,
    assurance: 'embedded',
    detail:
      `signature present (${embedded.size} bytes); validity not checked ` +
      `because Get-AuthenticodeSignature is unavailable on ${process.platform}`,
  };
}

// CLI. Compared as a URL rather than by filename so that importing this module
// from the release gate never triggers the command-line path.
const invokedDirectly =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: node scripts/verify-artifact-signature.mjs <file.exe>');
    process.exit(2);
  }
  try {
    const result = inspectWindowsArtifact(target);
    console.log(`${result.signed ? 'SIGNED' : 'UNSIGNED'} [${result.assurance}] ${result.detail}`);
    process.exit(result.signed ? 0 : 1);
  } catch (e) {
    console.error(`ERROR ${e.message}`);
    process.exit(2);
  }
}
