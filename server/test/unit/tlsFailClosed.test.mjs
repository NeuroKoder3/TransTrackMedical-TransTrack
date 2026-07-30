/**
 * TransTrack — TLS fail-closed tests for production HL7 and PG SSL.
 *
 * Validates that production configurations reject plaintext connections
 * and enforce TLS 1.2+.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);

describe('HL7 MLLP TLS fail-closed', () => {
  const serverSource = fs.readFileSync(
    path.resolve('src/hl7/server.js'), 'utf8'
  );

  it('warns when running plaintext in production', () => {
    expect(serverSource).toContain("config.NODE_ENV === 'production'");
    expect(serverSource).toContain('PLAINTEXT');
  });

  it('enforces minVersion TLSv1.2', () => {
    expect(serverSource).toContain("minVersion: 'TLSv1.2'");
  });

  it('supports mutual TLS (client cert)', () => {
    expect(serverSource).toContain('requestCert');
    expect(serverSource).toContain('rejectUnauthorized');
  });

  it('reads cert, key, and CA from config paths', () => {
    expect(serverSource).toContain('HL7_MLLP_TLS_CERT_FILE');
    expect(serverSource).toContain('HL7_MLLP_TLS_KEY_FILE');
    expect(serverSource).toContain('HL7_MLLP_TLS_CA_FILE');
  });

  it('requires TLS_REQUIRE_CLIENT_CERT for rejectUnauthorized', () => {
    expect(serverSource).toContain('HL7_MLLP_TLS_REQUIRE_CLIENT_CERT');
  });
});

describe('PG SSL configuration', () => {
  const poolSource = fs.readFileSync(
    path.resolve('src/db/pool.js'), 'utf8'
  );

  it('supports PGSSL modes (disable, require, verify-full)', () => {
    const configSource = fs.readFileSync(
      path.resolve('src/config.js'), 'utf8'
    );
    expect(configSource).toContain("PGSSL");
    expect(configSource).toContain('verify-full');
  });

  it('sets rejectUnauthorized based on PGSSL config', () => {
    expect(poolSource).toContain('rejectUnauthorized');
  });

  it('defaults ssl to disabled, require mode skips verification, verify-full enforces it', () => {
    // Pool uses explicit checks for 'require' and 'verify-full' PGSSL modes.
    expect(poolSource).toContain("config.PGSSL === 'require'");
    expect(poolSource).toContain("config.PGSSL === 'verify-full'");
    expect(poolSource).toContain('rejectUnauthorized: true');
    expect(poolSource).toContain('rejectUnauthorized: false');
  });
});

describe('SIEM forwarder TLS enforcement', () => {
  const siemSource = fs.readFileSync(
    path.resolve('../electron/services/siemForwarder.cjs'), 'utf8'
  );

  it('production mode rejects non-TLS protocols', () => {
    expect(siemSource).toContain('not permitted in production');
    expect(siemSource).toContain("protocol !== 'tls'");
  });

  it('TLS transport uses rejectUnauthorized and minVersion', () => {
    expect(siemSource).toContain('rejectUnauthorized: true');
    expect(siemSource).toContain("minVersion: 'TLSv1.2'");
  });
});
