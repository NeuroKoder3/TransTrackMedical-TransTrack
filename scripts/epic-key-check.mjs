/**
 * Verifies the private key and JWKS are a matching pair,
 * and checks the JWT assertion that would be sent to Epic.
 */
import { createSign, createVerify, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const privateKeyPath = path.join(__dirname, '..', 'epic-keys', 'transtrack-epic-private.pem');
const jwksPath       = path.join(__dirname, '..', 'epic-keys', 'jwks.json');

console.log('\n\x1b[1mEpic Key Pair Diagnostic\x1b[0m\n');

// ── 1. Load private key ────────────────────────────────────────────────────
let privPem;
try {
  privPem = readFileSync(privateKeyPath, 'utf8');
  console.log('✓ Private key file loaded');
} catch(e) {
  console.log('✗ Cannot read private key:', e.message);
  process.exit(1);
}

// ── 2. Derive public key from private key ─────────────────────────────────
let derivedPub;
try {
  const privKeyObj = createPublicKey({ key: privPem, format: 'pem' });
  derivedPub = privKeyObj.export({ type: 'spki', format: 'pem' });
  console.log('✓ Public key derived from private key');
} catch(e) {
  console.log('✗ Private key is invalid / unreadable:', e.message);
  process.exit(1);
}

// ── 3. Load JWKS and extract n+e ──────────────────────────────────────────
let jwks;
try {
  jwks = JSON.parse(readFileSync(jwksPath, 'utf8'));
  console.log('✓ JWKS file loaded');
  const k = jwks.keys[0];
  console.log(`  kid : ${k.kid}`);
  console.log(`  alg : ${k.alg}`);
  console.log(`  use : ${k.use}`);
  console.log(`  n   : ${k.n.substring(0,32)}…`);
} catch(e) {
  console.log('✗ Cannot read JWKS:', e.message);
  process.exit(1);
}

// ── 4. Verify keypair matches by sign+verify ──────────────────────────────
try {
  const testData = 'transtrack-epic-keypair-check';
  const signer = createSign('RSA-SHA384');
  signer.update(testData);
  const sig = signer.sign(privPem);

  const verifier = createVerify('RSA-SHA384');
  verifier.update(testData);
  const ok = verifier.verify(derivedPub, sig);

  if (ok) {
    console.log('✓ Private key signs correctly — keypair is internally consistent');
  } else {
    console.log('✗ Signature verification failed — key may be corrupted');
  }
} catch(e) {
  console.log('✗ Sign/verify error:', e.message);
}

// ── 5. Reconstruct JWK n value from private key and compare ──────────────
try {
  const pubKey = createPublicKey({ key: privPem, format: 'pem' });
  const jwkFromPrivate = pubKey.export({ format: 'jwk' });
  const nFromPrivate = jwkFromPrivate.n;
  const nFromJwks    = jwks.keys[0].n;

  if (nFromPrivate === nFromJwks) {
    console.log('✓ JWKS n value MATCHES the private key — correct keypair registered');
  } else {
    console.log('✗ JWKS n value DOES NOT MATCH the private key');
    console.log('  This is the cause of invalid_client: Epic has a different public key.');
    console.log('  You need to either:');
    console.log('    (a) Re-register the JWKS in your Epic app with this file\'s public key, OR');
    console.log('    (b) Replace epic-keys/ with the keypair that IS registered in Epic');
    console.log(`\n  n from private key : ${nFromPrivate.substring(0,48)}…`);
    console.log(`  n from jwks.json   : ${nFromJwks.substring(0,48)}…`);
  }
} catch(e) {
  console.log('✗ JWK comparison error:', e.message);
}

// ── 6. Check kid matches ──────────────────────────────────────────────────
const kidInJwks = jwks.keys[0]?.kid;
const kidInCode = 'transtrack-epic-1';
console.log(`\n  kid in jwks.json   : ${kidInJwks}`);
console.log(`  kid used in JWT    : ${kidInCode}`);
if (kidInJwks === kidInCode) {
  console.log('✓ kid values match');
} else {
  console.log('✗ kid MISMATCH — Epic will reject the JWT because kid does not match any registered key');
}

// ── 7. Print the full public key for copy-paste into Epic ─────────────────
console.log('\n\x1b[1mPublic key (for pasting into Epic app registration if needed):\x1b[0m');
console.log(derivedPub);
