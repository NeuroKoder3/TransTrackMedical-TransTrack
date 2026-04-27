#!/usr/bin/env node
// Convert epic-keys/transtrack-epic-public.pem -> epic-keys/jwks.json
// in the JWK Set form that Epic expects at the Non-Production JWK Set URL.
//
// Usage:  node scripts/epic-make-jwks.mjs

import { createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pemPath = resolve('epic-keys/transtrack-epic-public.pem');
const outPath = resolve('epic-keys/jwks.json');

const pem = readFileSync(pemPath, 'utf8');
const key = createPublicKey(pem);
const jwk = key.export({ format: 'jwk' });

jwk.alg = 'RS384';
jwk.use = 'sig';
jwk.kid = 'transtrack-epic-1';

const jwks = { keys: [jwk] };
const json = JSON.stringify(jwks, null, 2);

writeFileSync(outPath, json);

console.log('Wrote', outPath);
console.log('---- copy everything below this line into a new public gist ----');
console.log(json);
console.log('---- copy everything above this line into a new public gist ----');
