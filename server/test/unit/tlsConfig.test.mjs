import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('TLS fail-closed config', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Minimal required env
    process.env.JWT_SECRET = 'test-secret-must-be-at-least-32-bytes!!';
    process.env.DATABASE_URL = 'postgres://localhost/test';
  });

  afterEach(() => {
    process.env = originalEnv;
    // Clear module cache so config.load() re-reads env
    const keys = Object.keys(require.cache);
    for (const k of keys) {
      if (k.includes('config.js')) delete require.cache[k];
    }
  });

  it('rejects PGSSL=disable in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.PGSSL = 'disable';
    const { load } = require('../../src/config.js');
    expect(() => load()).toThrow('PGSSL=disable is not allowed in production');
  });

  it('allows PGSSL=require in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.PGSSL = 'require';
    const { load } = require('../../src/config.js');
    const cfg = load();
    expect(cfg.PGSSL).toBe('require');
  });

  it('allows PGSSL=verify-full in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.PGSSL = 'verify-full';
    const { load } = require('../../src/config.js');
    const cfg = load();
    expect(cfg.PGSSL).toBe('verify-full');
  });

  it('allows PGSSL=disable in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.PGSSL = 'disable';
    const { load } = require('../../src/config.js');
    const cfg = load();
    expect(cfg.PGSSL).toBe('disable');
  });

  it('defaults REQUIRE_TLS_TERMINATION to true', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.REQUIRE_TLS_TERMINATION;
    const { load } = require('../../src/config.js');
    const cfg = load();
    expect(cfg.REQUIRE_TLS_TERMINATION).toBe(true);
  });

  it('defaults ALLOW_INSECURE_HTTP to false', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ALLOW_INSECURE_HTTP;
    const { load } = require('../../src/config.js');
    const cfg = load();
    expect(cfg.ALLOW_INSECURE_HTTP).toBe(false);
  });
});
