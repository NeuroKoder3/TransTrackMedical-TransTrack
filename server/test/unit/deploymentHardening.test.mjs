/**
 * M-13 / M-14 / M-15 / M-16 / L-8 regression suite — deployment posture.
 *
 *   M-13  PGSSL=require no longer means "encrypt but trust anything".
 *   M-14  CORS never reflects an arbitrary origin alongside credentials.
 *   M-15  no usable default secret ships, and known placeholders are refused
 *         in production.
 *   M-16  the process logs and drains on unhandled rejections/exceptions.
 *   L-8   internal database detail stays in the log.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const { buildSslOptions } = require('../../src/db/pool.js');
const { resolveAllowedOrigins, makeOriginChecker } = require('../../src/util/cors.js');
const { isPredictableSecret } = require('../../src/config.js');

// ---------------------------------------------------------------------------
// M-13
// ---------------------------------------------------------------------------

describe('PostgreSQL TLS verifies the server certificate (M-13)', () => {
  it('disables TLS only for PGSSL=disable', () => {
    expect(buildSslOptions({ PGSSL: 'disable' })).toBe(false);
  });

  it('verifies the chain for PGSSL=require', () => {
    const ssl = buildSslOptions({ PGSSL: 'require' });
    expect(ssl.rejectUnauthorized).toBe(true);
  });

  it('verifies chain and hostname for PGSSL=verify-full', () => {
    const ssl = buildSslOptions({ PGSSL: 'verify-full' });
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.checkServerIdentity).toBeUndefined();
  });

  it('relaxes only the hostname check for PGSSL=require', () => {
    const ssl = buildSslOptions({ PGSSL: 'require' });
    expect(typeof ssl.checkServerIdentity).toBe('function');
    expect(ssl.checkServerIdentity()).toBeUndefined();
  });

  it('loads a CA bundle when one is supplied', () => {
    const caFile = path.join(process.cwd(), 'node_modules', '.tmp-pg-ca-test.pem');
    fs.mkdirSync(path.dirname(caFile), { recursive: true });
    fs.writeFileSync(caFile, '-----BEGIN CERTIFICATE-----\nnot-a-real-cert\n-----END CERTIFICATE-----\n');
    try {
      const ssl = buildSslOptions({ PGSSL: 'verify-full', PGSSL_CA_FILE: caFile });
      expect(ssl.ca).toContain('BEGIN CERTIFICATE');
      expect(ssl.rejectUnauthorized).toBe(true);
    } finally {
      fs.rmSync(caFile, { force: true });
    }
  });

  it('skips verification only for the explicitly named setting', () => {
    const ssl = buildSslOptions({ PGSSL: 'require', PGSSL_ALLOW_UNVERIFIED: true });
    expect(ssl.rejectUnauthorized).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// M-14
// ---------------------------------------------------------------------------

describe('CORS never reflects an arbitrary origin (M-14)', () => {
  const HOSTILE = 'https://evil.example.com';

  function allows(config, origin) {
    return new Promise((resolve) => {
      makeOriginChecker(config)(origin, (err, ok) => resolve(!err && ok === true));
    });
  }

  it('falls back to a fixed localhost allowlist in development', async () => {
    const config = { NODE_ENV: 'development', CORS_ALLOWED_ORIGINS: '' };
    expect(resolveAllowedOrigins(config)).toContain('http://localhost:5173');
    expect(await allows(config, 'http://localhost:5173')).toBe(true);
  });

  it('rejects a hostile origin in development rather than reflecting it', async () => {
    const config = { NODE_ENV: 'development', CORS_ALLOWED_ORIGINS: '' };
    expect(resolveAllowedOrigins(config)).not.toContain(HOSTILE);
    expect(await allows(config, HOSTILE)).toBe(false);
  });

  it('allows no cross-origin request when production leaves the list empty', async () => {
    const config = { NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: '' };
    expect(resolveAllowedOrigins(config)).toEqual([]);
    expect(await allows(config, HOSTILE)).toBe(false);
    expect(await allows(config, 'http://localhost:5173')).toBe(false);
  });

  it('honours an explicit allowlist exactly', async () => {
    const config = { NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://app.example.org, https://ehr.example.org' };
    expect(await allows(config, 'https://app.example.org')).toBe(true);
    expect(await allows(config, 'https://app.example.org.evil.com')).toBe(false);
    expect(await allows(config, HOSTILE)).toBe(false);
  });

  it('leaves requests without an Origin header alone', async () => {
    expect(await allows({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: '' }, undefined)).toBe(true);
  });

  it('is wired into the server with credentials, and never as a boolean', () => {
    const source = fs.readFileSync(path.resolve('src/index.js'), 'utf8');
    expect(source).toContain('origin: makeOriginChecker(config)');
    expect(source).not.toContain("config.NODE_ENV === 'development',\n    credentials: true");
  });
});

// ---------------------------------------------------------------------------
// M-15
// ---------------------------------------------------------------------------

describe('shipped configuration carries no usable secret (M-15)', () => {
  const envExample = fs.readFileSync(path.resolve('.env.example'), 'utf8');
  const compose = fs.readFileSync(path.resolve('../docker/docker-compose.yml'), 'utf8');

  it('.env.example holds a placeholder that fails the config schema', () => {
    const match = envExample.match(/^JWT_SECRET=(.*)$/m);
    expect(match).not.toBeNull();
    const value = match[1].trim();
    expect(value.length).toBeLessThan(32);
    expect(value).not.toMatch(/aaaaaaaa/);
  });

  it('.env.example no longer ships a working database password', () => {
    expect(envExample).not.toContain('postgres://transtrack:transtrack@');
  });

  it('docker-compose requires the operator to supply both secrets', () => {
    expect(compose).not.toContain('dev-jwt-secret-change-me');
    expect(compose).not.toMatch(/POSTGRES_PASSWORD:\s*transtrack\s*$/m);
    expect(compose).toMatch(/JWT_SECRET:\s*\$\{JWT_SECRET:\?/);
    expect(compose).toMatch(/POSTGRES_PASSWORD:\s*\$\{POSTGRES_PASSWORD:\?/);
  });

  it('docker-compose publishes every port on loopback only', () => {
    const published = [...compose.matchAll(/^\s+- "([^"]+)"\s*(?:#.*)?$/gm)]
      .map((m) => m[1])
      .filter((s) => /^[\d.:]+$/.test(s) && s.includes(':'));
    expect(published.length).toBeGreaterThan(0);
    for (const mapping of published) {
      expect(mapping.startsWith('127.0.0.1:')).toBe(true);
    }
    expect(compose).toContain('127.0.0.1:2575:2575');
  });

  it('docker-compose states the MLLP security expectation', () => {
    expect(compose).toMatch(/HL7_MLLP_TLS_CERT_FILE/);
    expect(compose).toMatch(/mutual TLS/i);
    expect(compose).toMatch(/plaintext and unauthenticated/i);
  });

  it('recognises the secrets that used to ship', () => {
    expect(isPredictableSecret('change-me-32-bytes-minimum-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
    expect(isPredictableSecret('dev-jwt-secret-change-me-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
    expect(isPredictableSecret('REPLACE_ME')).toBe(true);
    expect(isPredictableSecret('')).toBe(true);
  });

  it('accepts a genuinely random secret', () => {
    const generated = require('crypto').randomBytes(48).toString('base64');
    expect(isPredictableSecret(generated)).toBe(false);
  });

  describe('production startup', () => {
    let originalEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
      process.env.NODE_ENV = 'production';
      process.env.PGSSL = 'verify-full';
      process.env.DATABASE_URL = 'postgres://localhost/test';
    });

    afterEach(() => {
      process.env = originalEnv;
      for (const k of Object.keys(require.cache)) {
        if (k.includes('config.js')) delete require.cache[k];
      }
    });

    it('refuses a placeholder JWT_SECRET', () => {
      process.env.JWT_SECRET = 'change-me-32-bytes-minimum-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const { load } = require('../../src/config.js');
      expect(() => load()).toThrow(/known placeholder or otherwise predictable/);
    });

    it('refuses the docker-compose default JWT_SECRET', () => {
      process.env.JWT_SECRET = 'dev-jwt-secret-change-me-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const { load } = require('../../src/config.js');
      expect(() => load()).toThrow(/known placeholder or otherwise predictable/);
    });

    it('refuses PGSSL_ALLOW_UNVERIFIED', () => {
      process.env.JWT_SECRET = require('crypto').randomBytes(48).toString('base64');
      process.env.PGSSL_ALLOW_UNVERIFIED = '1';
      const { load } = require('../../src/config.js');
      expect(() => load()).toThrow(/PGSSL_ALLOW_UNVERIFIED is not allowed in production/);
    });

    it('starts on a real secret', () => {
      process.env.JWT_SECRET = require('crypto').randomBytes(48).toString('base64');
      delete process.env.PGSSL_ALLOW_UNVERIFIED;
      const { load } = require('../../src/config.js');
      expect(load().NODE_ENV).toBe('production');
    });
  });
});

// ---------------------------------------------------------------------------
// M-16 / L-8
// ---------------------------------------------------------------------------

describe('process failure handling and error disclosure', () => {
  const indexSource = fs.readFileSync(path.resolve('src/index.js'), 'utf8');

  it('registers unhandledRejection and uncaughtException handlers (M-16)', () => {
    expect(indexSource).toContain("process.on('unhandledRejection'");
    expect(indexSource).toContain("process.on('uncaughtException'");
  });

  it('drains the server and exits non-zero on those handlers (M-16)', () => {
    expect(indexSource).toContain("shutdown('unhandledRejection', 1)");
    expect(indexSource).toContain("shutdown('uncaughtException', 1)");
    expect(indexSource).toContain('await app.close()');
  });

  it('does not return the PostgreSQL detail on a unique violation (L-8)', () => {
    expect(indexSource).not.toContain('message: err.detail');
    expect(indexSource).toContain("message: 'Conflict'");
    expect(indexSource).toContain("'unique violation'");
  });

  it('does not return the driver error message from /ready (L-8)', async () => {
    const healthSource = fs.readFileSync(path.resolve('src/routes/health.js'), 'utf8');
    expect(healthSource).not.toContain('error: e.message');

    const { loadWithStubs, restoreModules, fakeApp, fakeReply } =
      await import('./helpers/routeHarness.mjs');
    const logged = [];
    const routes = loadWithStubs('src/routes/health.js', {
      'src/db/pool.js': {
        getPool: () => ({
          query: async () => {
            throw new Error('connect ECONNREFUSED 10.1.2.3:5432 (database "transtrack", user "svc")');
          },
        }),
      },
    });
    const app = fakeApp();
    await routes(app);
    const reply = fakeReply();
    const body = await app.call('GET /ready', {
      log: { error: (...a) => logged.push(a) },
    }, reply);
    expect(reply.statusCode).toBe(503);
    expect(JSON.stringify(body)).not.toContain('10.1.2.3');
    expect(JSON.stringify(body)).not.toContain('svc');
    expect(body.status).toBe('not_ready');
    // ...but the operator still gets it.
    expect(logged).toHaveLength(1);
    expect(logged[0][0].err.message).toContain('10.1.2.3');
    restoreModules();
  });
});
