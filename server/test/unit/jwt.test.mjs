import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const jwt = require('../../src/auth/jwt');

const SECRET = 'test-secret-32-bytes-aaaaaaaaaaaaa';

describe('jwt', () => {
  it('round-trips claims', () => {
    const t = jwt.sign({ sub: 'u1', org: 'o1', role: 'admin' }, SECRET, {
      issuer: 'transtrack', audience: 'api', ttlSeconds: 60,
    });
    const c = jwt.verify(t, SECRET, { issuer: 'transtrack', audience: 'api' });
    expect(c.sub).toBe('u1');
    expect(c.org).toBe('o1');
    expect(c.role).toBe('admin');
  });

  it('rejects tampered signature', () => {
    const t = jwt.sign({ sub: 'u1' }, SECRET);
    const tampered = t.split('.').slice(0, 2).join('.') + '.' + 'X'.repeat(43);
    expect(() => jwt.verify(tampered, SECRET)).toThrow();
  });

  it('rejects expired token', () => {
    const t = jwt.sign({ sub: 'u1' }, SECRET, { ttlSeconds: -10 });
    expect(() => jwt.verify(t, SECRET)).toThrow(/expired/);
  });

  it('rejects wrong issuer', () => {
    const t = jwt.sign({ sub: 'u1' }, SECRET, { issuer: 'a' });
    expect(() => jwt.verify(t, SECRET, { issuer: 'b' })).toThrow(/issuer/);
  });
});
