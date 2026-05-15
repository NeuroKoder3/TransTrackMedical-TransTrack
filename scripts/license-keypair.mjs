#!/usr/bin/env node
/**
 * TransTrack — Generate the publisher Ed25519 keypair.
 *
 * This is run ONCE, by the operator, to mint the keypair that signs
 * customer licenses. The PUBLIC key is then committed into the app at
 * electron/license/publisherPublicKey.cjs (or env-injected at build
 * time). The PRIVATE key is kept OFFLINE — never committed.
 *
 * For production use:
 *   - Run this on an air-gapped or HSM-backed workstation.
 *   - Store the private key in a hardware security module (or at minimum,
 *     in a password-protected encrypted vault).
 *   - Back up to two geographically-separate secure locations.
 *   - Rotate every 3 years OR immediately on suspected compromise.
 *
 * Usage:
 *   node scripts/license-keypair.mjs --out keys/license
 *   node scripts/license-keypair.mjs --out keys/license --force  (overwrite)
 *
 * After running, paste the printed PUBLIC_KEY_BASE64 into
 * electron/license/publisherPublicKey.cjs and commit only that file.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return def;
}
const force = argv.includes('--force');
const outDir = arg('out', 'keys/license');

const privPath = path.join(outDir, 'license-private.pem');
const pubPath  = path.join(outDir, 'license-public.pem');

if ((fs.existsSync(privPath) || fs.existsSync(pubPath)) && !force) {
  console.error(`ERROR: ${privPath} or ${pubPath} already exists. Pass --force to overwrite.`);
  console.error('       Overwriting will invalidate every license issued under the previous key.');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pubPem  = publicKey.export({ type: 'spki', format: 'pem' });

const pubRaw  = publicKey.export({ type: 'spki', format: 'der' });
// Ed25519 SPKI DER is: 30 2A 30 05 06 03 2B 65 70 03 21 00 || 32-byte-key
// so the raw 32-byte key is the last 32 bytes.
const pubKeyBytes = pubRaw.subarray(pubRaw.length - 32);

fs.writeFileSync(privPath, privPem, { mode: 0o600 });
fs.writeFileSync(pubPath,  pubPem);
try { fs.chmodSync(privPath, 0o600); } catch { /* windows */ }

console.log('TransTrack publisher Ed25519 keypair generated.');
console.log('');
console.log('  PRIVATE KEY: ' + privPath + '  (KEEP THIS SECRET — do NOT commit)');
console.log('  PUBLIC KEY : ' + pubPath  + '  (safe to share; ship with app)');
console.log('');
console.log('  PUBLIC_KEY_BASE64 (paste into electron/license/publisherPublicKey.cjs):');
console.log('    ' + pubKeyBytes.toString('base64'));
console.log('');
console.log('  PUBLIC_KEY_PEM:');
console.log(pubPem);
