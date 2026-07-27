import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { requireRole } = require('../../src/middleware/auth');

describe('requireRole', () => {
  it('denies SMART system tokens on native API routes', async () => {
    const handler = requireRole('admin', 'coordinator');
    const req = { auth: { role: 'smart_system', tokenType: 'smart' } };
    await expect(handler(req)).rejects.toMatchObject({ status: 403 });
  });

  it('denies SMART user tokens on native API routes', async () => {
    const handler = requireRole('admin', 'coordinator');
    const req = { auth: { role: 'smart_user', tokenType: 'smart' } };
    await expect(handler(req)).rejects.toMatchObject({ status: 403 });
  });

  it('allows native admin role', async () => {
    const handler = requireRole('admin', 'coordinator');
    const req = { auth: { role: 'admin', tokenType: 'jwt' } };
    await expect(handler(req)).resolves.toBeUndefined();
  });

  it('allows matching native role', async () => {
    const handler = requireRole('coordinator', 'physician');
    const req = { auth: { role: 'coordinator', tokenType: 'jwt' } };
    await expect(handler(req)).resolves.toBeUndefined();
  });
});
