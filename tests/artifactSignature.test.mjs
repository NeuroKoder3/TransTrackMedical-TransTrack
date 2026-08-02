/**
 * TransTrack — Windows artifact signature verification.
 *
 * The release gate used to accept any file named like an installer as proof of
 * a signed release. This suite covers the check that replaced that: does the
 * artifact actually carry an Authenticode signature, and on Windows, does the
 * OS consider it valid.
 *
 * PE fixtures are synthesised rather than committed, so the parser is exercised
 * identically on every platform (the release gate job runs on Linux, where no
 * signed .exe is available). On Windows the suite additionally checks two real
 * binaries, because a hand-built fixture only proves the parser agrees with the
 * author's reading of the PE specification.
 *
 * Run standalone: node tests/artifactSignature.test.mjs
 */

import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readEmbeddedSignature,
  verifyAuthenticode,
  inspectWindowsArtifact,
} from '../scripts/verify-artifact-signature.mjs';

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) { FAIL++; failures.push({ name, error: e }); console.log(`  FAIL ${name}: ${e.message}`); }
}

const SANDBOX = mkdtempSync(join(tmpdir(), 'tt-pe-'));

const PE_OFFSET = 0x80;
const OPTIONAL_HEADER = PE_OFFSET + 24;

/**
 * Build a minimal but structurally valid PE image.
 *
 * @param {{ plus?: boolean, certOffset?: number, certSize?: number }} opts
 */
function makePe({ plus = true, certOffset = 0, certSize = 0 } = {}) {
  const buf = Buffer.alloc(0x400);
  buf.writeUInt16LE(0x5a4d, 0);              // 'MZ'
  buf.writeUInt32LE(PE_OFFSET, 0x3c);        // e_lfanew
  buf.writeUInt32LE(0x00004550, PE_OFFSET);  // 'PE\0\0'
  buf.writeUInt16LE(plus ? 0x20b : 0x10b, OPTIONAL_HEADER);

  // Data directories follow the fixed part of the optional header, whose size
  // differs between the two formats.
  const dataDirs = OPTIONAL_HEADER + (plus ? 112 : 96);
  const certEntry = dataDirs + 4 * 8; // index 4 = Attribute Certificate Table
  buf.writeUInt32LE(certOffset, certEntry);
  buf.writeUInt32LE(certSize, certEntry + 4);
  return buf;
}

function fixture(name, buf) {
  const p = join(SANDBOX, name);
  writeFileSync(p, buf);
  return p;
}

console.log('\nPE certificate table parsing');

test('a PE32+ image with a certificate table reports a signature', () => {
  const p = fixture('signed64.exe', makePe({ plus: true, certOffset: 0x300, certSize: 0x40 }));
  const sig = readEmbeddedSignature(p);
  assert.strictEqual(sig.present, true);
  assert.strictEqual(sig.size, 0x40);
  assert.strictEqual(sig.offset, 0x300);
});

test('a PE32 image with a certificate table reports a signature', () => {
  // The 32-bit optional header is 16 bytes shorter; reading the directories at
  // the 64-bit offset would silently look at the wrong entry.
  const p = fixture('signed32.exe', makePe({ plus: false, certOffset: 0x200, certSize: 0x18 }));
  const sig = readEmbeddedSignature(p);
  assert.strictEqual(sig.present, true);
  assert.strictEqual(sig.size, 0x18);
});

test('an image with an empty certificate table reports no signature', () => {
  const p = fixture('unsigned.exe', makePe({ certOffset: 0, certSize: 0 }));
  assert.strictEqual(readEmbeddedSignature(p).present, false);
});

test('a zero-size entry with a non-zero offset still counts as unsigned', () => {
  const p = fixture('empty-cert.exe', makePe({ certOffset: 0x300, certSize: 0 }));
  assert.strictEqual(readEmbeddedSignature(p).present, false);
});

console.log('\nMalformed input');

test('a non-PE file is rejected rather than read as unsigned', () => {
  // Reporting "unsigned" for a file that is not an executable at all would let
  // a truncated or wrong-format artifact fail for a misleading reason.
  const p = fixture('notpe.txt', Buffer.from('this is not an executable'));
  assert.throws(() => readEmbeddedSignature(p), /not a PE image \(missing MZ header\)/);
});

test('an MZ file with no PE header is rejected', () => {
  const buf = Buffer.alloc(0x200);
  buf.writeUInt16LE(0x5a4d, 0);
  buf.writeUInt32LE(PE_OFFSET, 0x3c);
  assert.throws(() => readEmbeddedSignature(fixture('nope.exe', buf)), /missing PE signature/);
});

test('an unrecognised optional header magic is rejected', () => {
  const buf = makePe();
  buf.writeUInt16LE(0xdead, OPTIONAL_HEADER);
  assert.throws(
    () => readEmbeddedSignature(fixture('badmagic.exe', buf)),
    /unrecognised PE optional header magic/,
  );
});

test('a missing artifact is reported as missing', () => {
  assert.throws(
    () => inspectWindowsArtifact(join(SANDBOX, 'absent.exe')),
    /artifact not found/,
  );
});

console.log('\nOverall verdict');

test('an unsigned artifact is not accepted', () => {
  const p = fixture('verdict-unsigned.exe', makePe());
  const r = inspectWindowsArtifact(p);
  assert.strictEqual(r.signed, false);
  assert.strictEqual(r.assurance, 'none');
});

test('off Windows, an embedded signature is accepted with reduced assurance', () => {
  if (process.platform === 'win32') {
    console.log('      (skipped on Windows — the OS verdict is authoritative there)');
    return;
  }
  const p = fixture('verdict-signed.exe', makePe({ certOffset: 0x300, certSize: 0x40 }));
  const r = inspectWindowsArtifact(p);
  assert.strictEqual(r.signed, true);
  assert.strictEqual(r.assurance, 'embedded', 'must not claim validity it did not check');
  assert.match(r.detail, /validity not checked/);
});

/**
 * Whether this machine can actually evaluate a trust chain.
 *
 * Not every Windows host can. A hosted CI runner returned no verdict at all for
 * node.exe, which is genuinely signed. Where that is the case the verifier
 * degrades to the same evidence a Linux host has — a signature is embedded, its
 * trust unestablished — and the assertions below have to degrade with it rather
 * than assert a capability the environment does not have.
 */
let osProbe = null;
function osVerdict() {
  if (osProbe === null) osProbe = verifyAuthenticode(process.execPath);
  return osProbe;
}
function osVerdictWorks() {
  const v = osVerdict();
  return v.available && v.valid;
}

test('a fixture with a fake certificate table does not pass as validly signed', () => {
  if (process.platform !== 'win32') {
    console.log('      (skipped off Windows)');
    return;
  }
  // The table points at filler, not a PKCS#7 blob. This is the case PE parsing
  // alone cannot catch, so what can be asserted depends on whether the OS is
  // able to look.
  const p = fixture('verdict-fake.exe', makePe({ certOffset: 0x300, certSize: 0x40 }));
  const r = inspectWindowsArtifact(p);

  if (osVerdictWorks()) {
    // Windows answers NotSigned — a conclusion, not an inability to reach one.
    assert.strictEqual(r.signed, false, 'a forged certificate table must be rejected');
  } else {
    // Without an OS verdict the forgery is indistinguishable from a real
    // signature by file layout alone. The verifier must not claim otherwise.
    assert.notStrictEqual(r.assurance, 'valid', 'must not claim validity it could not check');
    assert.match(r.detail, /not checked|could not complete/);
    console.log('      (no OS verdict here — checked that validity is not claimed)');
  }
});

console.log('\nWhen the OS cannot reach a verdict');

test('an absent Windows verdict is reported as unavailable, not as invalid', () => {
  // A build machine that cannot complete a revocation check, or a PowerShell
  // that fails to start, says nothing about the artifact. Treating silence as
  // "not valid" would fail a correctly signed release for a reason that has
  // nothing to do with the file — which is exactly what happened on a hosted
  // runner the first time this suite ran there.
  const v = verifyAuthenticode(join(SANDBOX, 'absent.exe'));
  if (v.available) {
    // The file does not exist, so a verdict here can only be a negative one.
    assert.notStrictEqual(v.status, undefined);
    assert.strictEqual(v.valid, false);
  } else {
    assert.ok(v.reason, 'unavailability must carry a reason the operator can act on');
  }
});

console.log('\nReal binaries (Windows only)');

test('a genuinely signed executable is accepted', () => {
  if (process.platform !== 'win32') {
    console.log('      (skipped off Windows)');
    return;
  }
  // node.exe carries an embedded Authenticode signature.
  const r = inspectWindowsArtifact(process.execPath);
  assert.strictEqual(r.signed, true, `expected ${process.execPath} to be signed: ${r.detail}`);

  if (osVerdictWorks()) {
    assert.strictEqual(r.assurance, 'valid');
  } else {
    // Some build environments cannot validate a chain at all. The verifier must
    // still find the signature and must say plainly that it did not confirm
    // trust, rather than claiming either more or less than it knows.
    assert.strictEqual(r.assurance, 'embedded');
    assert.match(r.detail, /not checked|could not complete/);
    // Print why, so a future failure on a new runner is diagnosable from the
    // log rather than needing a reproduction.
    const v = osVerdict();
    console.log(`      (no trust evaluation here: ${v.available ? `status ${v.status}` : v.reason})`);
  }
});

test('a catalog-signed system binary is rejected for distribution', () => {
  if (process.platform !== 'win32') {
    console.log('      (skipped off Windows)');
    return;
  }
  const notepad = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe');
  if (!existsSync(notepad)) {
    console.log('      (skipped — notepad.exe not present)');
    return;
  }
  // Windows reports this Valid, but the signature lives in a system catalog
  // rather than in the file. A catalog cannot travel with a download, so an
  // installer signed only this way would arrive at a customer unverifiable.
  // This holds whether or not the OS verdict is available, because the
  // deciding fact — nothing embedded in the file — is read from the file.
  const r = inspectWindowsArtifact(notepad);
  assert.strictEqual(r.signed, false, 'catalog-only signing must not satisfy the release gate');
  assert.match(r.detail, /not embedded|no Authenticode signature is embedded/);
});

rmSync(SANDBOX, { recursive: true, force: true });

console.log(`\n${PASS} passed, ${FAIL} failed\n`);
if (FAIL > 0) {
  for (const f of failures) console.error(`${f.name}\n${f.error.stack || f.error.message}\n`);
  process.exit(1);
}
