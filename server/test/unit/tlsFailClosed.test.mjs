/**
 * TransTrack — TLS fail-closed tests for production HL7 and PG SSL.
 *
 * Validates that production configurations reject plaintext connections
 * and enforce TLS 1.2+.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('HL7 MLLP TLS fail-closed', () => {
  const serverSource = fs.readFileSync(
    path.resolve('src/hl7/server.js'), 'utf8'
  );

  it('refuses plaintext in production unless HL7_ALLOW_PLAINTEXT is set', () => {
    expect(serverSource).toContain("config.NODE_ENV === 'production'");
    expect(serverSource).toContain('HL7_ALLOW_PLAINTEXT');
    expect(serverSource).toContain('throw new Error');
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

  // M-13: `require` used to mean rejectUnauthorized:false. Both TLS modes now
  // verify the server certificate; only the explicitly-named, production-
  // refused PGSSL_ALLOW_UNVERIFIED turns verification off.
  it('defaults ssl to disabled and verifies the certificate in both TLS modes', () => {
    expect(poolSource).toContain("config.PGSSL === 'disable'");
    expect(poolSource).toContain("config.PGSSL === 'require'");
    expect(poolSource).toContain('rejectUnauthorized: true');
    expect(poolSource).toContain('PGSSL_CA_FILE');
  });

  it('only skips verification behind PGSSL_ALLOW_UNVERIFIED', () => {
    expect(poolSource).toContain('PGSSL_ALLOW_UNVERIFIED');
    const configSource = fs.readFileSync(path.resolve('src/config.js'), 'utf8');
    expect(configSource).toContain('PGSSL_ALLOW_UNVERIFIED is not allowed in production');
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
