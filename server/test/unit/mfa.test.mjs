import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mfa = require('../../src/auth/mfa');
const { authenticator } = require('otplib');

const MASTER = 'unit-test-master-aaaaaaaaaaaaaaaaa';

describe('mfa', () => {
  it('encrypts then decrypts a TOTP secret', () => {
    const secret = mfa.generateSecret();
    const enc = mfa.encryptSecret(secret, MASTER);
    const dec = mfa.decryptSecret(enc, MASTER);
    expect(dec).toBe(secret);
  });

  it('verifies a current TOTP code', () => {
    const secret = mfa.generateSecret();
    const code = authenticator.generate(secret);
    expect(mfa.verifyCode(secret, code)).toBe(true);
  });

  it('rejects a bad code', () => {
    const secret = mfa.generateSecret();
    expect(mfa.verifyCode(secret, '000000')).toBe(false);
  });

  it('generates 10 distinct recovery codes', () => {
    const codes = mfa.generateRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
  });
});
