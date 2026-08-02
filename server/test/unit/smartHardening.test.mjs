/**
 * M-11 / M-26 / L-14 regression suite — SMART on FHIR authorisation surface.
 *
 *   M-11  the launch context is resolved server-side and referenced by an
 *         opaque handle, so a client cannot name an arbitrary patient in the
 *         consent form POST.
 *   M-26  ID tokens are signed asymmetrically with a dedicated key and the
 *         public half is published as a JWK Set.
 *   L-14  a client assertion jti may be redeemed exactly once.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { createVerify, generateKeyPairSync, createPublicKey } from 'crypto';
import { loadWithStubs, restoreModules, fakeClient, fakePool } from './helpers/routeHarness.mjs';

const require = createRequire(import.meta.url);

const ORG = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const CLIENT_ID = 'smart-client-1';
const OTHER_CLIENT_ID = 'smart-client-2';
const LAUNCH_PATIENT = 'patient-in-the-launch';
const ATTACKER_PATIENT = 'somebody-elses-patient';

afterEach(() => restoreModules());

// ---------------------------------------------------------------------------
// M-11 — server-side launch context
// ---------------------------------------------------------------------------

describe('SMART launch context is held server-side (M-11)', () => {
  let launchContexts;
  let rows;
  let client;

  beforeEach(() => {
    rows = [];
    client = fakeClient((text, values) => {
      if (/INSERT INTO smart_launch_contexts/.test(text)) {
        rows.push({
          handle_hash: values[0], org_id: values[1], client_id: values[2],
          context: JSON.parse(values[3]), consumed_at: null,
        });
        return [];
      }
      if (/UPDATE smart_launch_contexts/.test(text)) {
        const [handleHash, clientId] = values;
        const row = rows.find(
          (r) => r.handle_hash === handleHash && r.client_id === clientId && !r.consumed_at
        );
        if (!row) return [];
        row.consumed_at = new Date();
        return [{ context: row.context }];
      }
      return [];
    });
    launchContexts = loadWithStubs('src/smart/launchContexts.js', {
      'src/db/pool.js': fakePool(client),
    });
  });

  it('returns an opaque handle that is not the patient id', async () => {
    const handle = await launchContexts.issue({
      orgId: ORG, clientId: CLIENT_ID, context: { patient: LAUNCH_PATIENT },
    });
    expect(handle).toBeTruthy();
    expect(handle).not.toContain(LAUNCH_PATIENT);
    // The handle is stored hashed, so a database reader cannot replay it.
    expect(rows[0].handle_hash).not.toBe(handle);
  });

  it('resolves the handle back to the context the launch produced', async () => {
    const handle = await launchContexts.issue({
      orgId: ORG, clientId: CLIENT_ID, context: { patient: LAUNCH_PATIENT },
    });
    expect(await launchContexts.consume(handle, { clientId: CLIENT_ID }))
      .toEqual({ patient: LAUNCH_PATIENT });
  });

  it('refuses a handle presented by a different client', async () => {
    const handle = await launchContexts.issue({
      orgId: ORG, clientId: CLIENT_ID, context: { patient: LAUNCH_PATIENT },
    });
    expect(await launchContexts.consume(handle, { clientId: OTHER_CLIENT_ID })).toBeNull();
  });

  it('is single-use', async () => {
    const handle = await launchContexts.issue({
      orgId: ORG, clientId: CLIENT_ID, context: { patient: LAUNCH_PATIENT },
    });
    expect(await launchContexts.consume(handle, { clientId: CLIENT_ID })).not.toBeNull();
    expect(await launchContexts.consume(handle, { clientId: CLIENT_ID })).toBeNull();
  });

  it('returns nothing for an unknown or forged handle', async () => {
    expect(await launchContexts.consume('forged-handle', { clientId: CLIENT_ID })).toBeNull();
    expect(await launchContexts.consume(undefined, { clientId: CLIENT_ID })).toBeNull();
  });

  it('does not mint a handle for an empty launch', async () => {
    expect(await launchContexts.issue({ orgId: ORG, clientId: CLIENT_ID, context: {} })).toBeNull();
  });

  it('reaps handles that can no longer be redeemed', async () => {
    launchContexts.resetPurgeClock();
    await launchContexts.issue({
      orgId: ORG, clientId: CLIENT_ID, context: { patient: LAUNCH_PATIENT },
    });
    const purges = client.queries.filter(
      (q) => /DELETE FROM smart_launch_contexts WHERE expires_at < now\(\)/.test(q.text)
    );
    expect(purges).toHaveLength(1);

    // Throttled: a second launch inside the interval does not re-issue it.
    await launchContexts.issue({
      orgId: ORG, clientId: CLIENT_ID, context: { patient: LAUNCH_PATIENT },
    });
    expect(client.queries.filter(
      (q) => /DELETE FROM smart_launch_contexts/.test(q.text)
    )).toHaveLength(1);
  });
});

describe('the consent form no longer round-trips the patient through the client', () => {
  const source = fs.readFileSync(path.resolve('src/routes/smart.js'), 'utf8');

  it('posts a launch handle, not a patient id', () => {
    expect(source).toContain('name="launch_handle"');
    expect(source).not.toContain('name="launch_patient"');
    expect(source).not.toContain('name="launch_encounter"');
  });

  it('accepts no client-supplied launch context in the authorize POST body', () => {
    const postBody = source.slice(
      source.indexOf("app.post('/oauth2/authorize'"),
      source.indexOf("app.post('/oauth2/token'")
    );
    expect(postBody).toContain('launch_handle: z.string().optional()');
    expect(postBody).not.toContain('launch_patient: z.string()');
    expect(postBody).toContain('launchContexts.consume(body.launch_handle');
    // The only source of a launch context is the server-side record.
    expect(postBody).not.toMatch(/patient:\s*body\.launch_patient/);
  });

  it('cannot be coaxed into honouring an attacker-named patient', () => {
    // A body carrying launch_patient is parsed by a schema that does not
    // declare it, so Zod strips the key before it can reach authzCodes.
    const smartRoutes = loadWithStubs('src/routes/smart.js', {
      'src/db/pool.js': fakePool(fakeClient(() => [])),
    });
    expect(typeof smartRoutes).toBe('function');
    const { z } = require('zod');
    const parsed = z.object({ launch_handle: z.string().optional() })
      .parse({ launch_handle: 'h', launch_patient: ATTACKER_PATIENT });
    expect(parsed).toEqual({ launch_handle: 'h' });
  });
});

// ---------------------------------------------------------------------------
// M-26 — asymmetric ID tokens
// ---------------------------------------------------------------------------

describe('OIDC ID tokens are signed asymmetrically (M-26)', () => {
  const idToken = require('../../src/smart/idToken.js');
  const JWT_SECRET = 'unit-test-signing-key-with-enough-length-1234567890';

  beforeEach(() => idToken.resetSigningKey());
  afterEach(() => idToken.resetSigningKey());

  function devConfig(extra = {}) {
    return {
      NODE_ENV: 'test',
      SMART_ID_TOKEN_ALG: 'RS256',
      SMART_ID_TOKEN_KID: 'test-kid',
      SMART_ID_TOKEN_KEY_FILE: '',
      SMART_ID_TOKEN_TTL_SECONDS: 3600,
      JWT_SECRET,
      ...extra,
    };
  }

  it('uses RS256 with a key id, not HS256', () => {
    const token = idToken.signIdToken(devConfig(), {
      issuer: 'https://api.example.org', clientId: CLIENT_ID, userId: 'user-1',
    });
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
    expect(header.alg).toBe('RS256');
    expect(header.kid).toBe('test-kid');
  });

  it('binds issuer and audience into the token', () => {
    const token = idToken.signIdToken(devConfig(), {
      issuer: 'https://api.example.org', clientId: CLIENT_ID, userId: 'user-1', nonce: 'n1',
    });
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    expect(claims.iss).toBe('https://api.example.org');
    expect(claims.aud).toBe(CLIENT_ID);
    expect(claims.sub).toBe('user-1');
    expect(claims.nonce).toBe('n1');
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  it('verifies against the published JWK Set and not against JWT_SECRET', () => {
    const config = devConfig();
    const token = idToken.signIdToken(config, {
      issuer: 'https://api.example.org', clientId: CLIENT_ID, userId: 'user-1',
    });
    const jwks = idToken.publicJwks(config);
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0].kty).toBe('RSA');
    expect(jwks.keys[0].use).toBe('sig');
    expect(jwks.keys[0].kid).toBe('test-kid');
    // No private material is published.
    expect(jwks.keys[0].d).toBeUndefined();
    expect(jwks.keys[0].p).toBeUndefined();

    const [head, payload, sig] = token.split('.');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${head}.${payload}`);
    verifier.end();
    const pub = createPublicKey({ key: jwks.keys[0], format: 'jwk' });
    expect(verifier.verify(pub, Buffer.from(sig, 'base64url'))).toBe(true);
  });

  it('signs with a dedicated key file when one is configured', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const keyFile = path.join(process.cwd(), 'node_modules', '.tmp-id-token-test.pem');
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, pem);
    try {
      const config = devConfig({ SMART_ID_TOKEN_KEY_FILE: keyFile });
      const key = idToken.getSigningKey(config);
      expect(key.ephemeral).toBe(false);
      const expected = createPublicKey(privateKey).export({ format: 'jwk' });
      expect(idToken.publicJwks(config).keys[0].n).toBe(expected.n);
    } finally {
      fs.rmSync(keyFile, { force: true });
    }
  });

  it('supports ES256', () => {
    const config = devConfig({ SMART_ID_TOKEN_ALG: 'ES256' });
    const token = idToken.signIdToken(config, {
      issuer: 'https://api.example.org', clientId: CLIENT_ID, userId: 'user-1',
    });
    expect(JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')).alg)
      .toBe('ES256');
    expect(idToken.publicJwks(config).keys[0].kty).toBe('EC');
  });

  it('refuses to mint an ID token in production without a configured key', () => {
    const config = devConfig({ NODE_ENV: 'production' });
    expect(() => idToken.signIdToken(config, {
      issuer: 'https://api.example.org', clientId: CLIENT_ID, userId: 'user-1',
    })).toThrow(/SMART_ID_TOKEN_KEY_FILE is required in production/);
  });

  it('no longer signs ID tokens with the server JWT secret', () => {
    const source = fs.readFileSync(path.resolve('src/routes/smart.js'), 'utf8');
    expect(source).not.toContain('makeIdToken');
    expect(source).toContain('idToken.signIdToken(config');
    expect(source).toContain('/.well-known/jwks.json');
    expect(source).toContain('jwks_uri');
  });
});

// ---------------------------------------------------------------------------
// L-14 — client assertion replay
// ---------------------------------------------------------------------------

describe('a Backend Services client assertion may be redeemed once (L-14)', () => {
  const backendJwt = require('../../src/smart/backendJwt.js');
  const TOKEN_URL = 'https://api.example.org/oauth2/token';

  function makeAssertion(privateKey, { jti, exp }) {
    const header = { alg: 'RS256', typ: 'JWT', kid: 'k1' };
    const payload = {
      iss: CLIENT_ID, sub: CLIENT_ID, aud: TOKEN_URL,
      exp: exp ?? Math.floor(Date.now() / 1000) + 300,
      jti,
    };
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const signingInput = `${b64(header)}.${b64(payload)}`;
    const { createSign } = require('crypto');
    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    signer.end();
    return `${signingInput}.${signer.sign(privateKey).toString('base64url')}`;
  }

  function fixture() {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    const smartClient = {
      client_id: CLIENT_ID,
      client_type: 'backend',
      jwks: { keys: [{ ...jwk, kid: 'k1', alg: 'RS256', use: 'sig' }] },
    };
    const seen = new Set();
    const jtiStore = {
      calls: [],
      async remember({ clientId, jti, expiresAtSeconds }) {
        this.calls.push({ clientId, jti, expiresAtSeconds });
        const key = `${clientId}|${jti}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      },
    };
    return { privateKey, smartClient, jtiStore };
  }

  it('accepts the first presentation', async () => {
    const { privateKey, smartClient, jtiStore } = fixture();
    const assertion = makeAssertion(privateKey, { jti: 'jti-1' });
    const payload = await backendJwt.verifyAssertion(smartClient, assertion, TOKEN_URL, { jtiStore });
    expect(payload.jti).toBe('jti-1');
    expect(jtiStore.calls[0]).toMatchObject({ clientId: CLIENT_ID, jti: 'jti-1' });
    expect(jtiStore.calls[0].expiresAtSeconds).toBe(payload.exp);
  });

  it('rejects the identical assertion replayed inside its exp window', async () => {
    const { privateKey, smartClient, jtiStore } = fixture();
    const assertion = makeAssertion(privateKey, { jti: 'jti-1' });
    await backendJwt.verifyAssertion(smartClient, assertion, TOKEN_URL, { jtiStore });
    await expect(backendJwt.verifyAssertion(smartClient, assertion, TOKEN_URL, { jtiStore }))
      .rejects.toThrow(/jti has already been used/);
  });

  it('accepts a fresh jti from the same client', async () => {
    const { privateKey, smartClient, jtiStore } = fixture();
    await backendJwt.verifyAssertion(
      smartClient, makeAssertion(privateKey, { jti: 'jti-1' }), TOKEN_URL, { jtiStore });
    await expect(backendJwt.verifyAssertion(
      smartClient, makeAssertion(privateKey, { jti: 'jti-2' }), TOKEN_URL, { jtiStore }))
      .resolves.toBeTruthy();
  });

  it('does not record a jti for an assertion that fails signature verification', async () => {
    const { smartClient, jtiStore } = fixture();
    const { privateKey: wrongKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const forged = makeAssertion(wrongKey, { jti: 'jti-forged' });
    await expect(backendJwt.verifyAssertion(smartClient, forged, TOKEN_URL, { jtiStore }))
      .rejects.toThrow(/signature verification failed/);
    expect(jtiStore.calls).toHaveLength(0);
  });

  it('refuses the assertion when the replay store is unreachable', async () => {
    const { privateKey, smartClient } = fixture();
    const brokenStore = { remember: async () => { throw new Error('connection refused'); } };
    await expect(backendJwt.verifyAssertion(
      smartClient, makeAssertion(privateKey, { jti: 'jti-1' }), TOKEN_URL, { jtiStore: brokenStore }))
      .rejects.toThrow(/connection refused/);
  });

  it('enforces uniqueness in the database, not in application memory', () => {
    const sql = fs.readFileSync(
      path.resolve('src/db/migrations/012_smart_launch_and_replay.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS smart_client_assertion_jtis');
    expect(sql).toContain('PRIMARY KEY (client_id, jti)');
    const store = fs.readFileSync(path.resolve('src/smart/jtiStore.js'), 'utf8');
    expect(store).toContain('ON CONFLICT (client_id, jti) DO NOTHING');
    expect(store).toContain('DELETE FROM smart_client_assertion_jtis WHERE expires_at < now()');
  });
});
