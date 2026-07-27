import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parseClientCredentials } = require('../../src/smart/clientAuth');

describe('parseClientCredentials', () => {
  it('extracts client_id and secret from Basic auth', () => {
    const secret = Buffer.from('my-client:super-secret').toString('base64');
    const req = { headers: { authorization: `Basic ${secret}` } };
    const creds = parseClientCredentials(req, {});
    expect(creds.clientId).toBe('my-client');
    expect(creds.clientSecret).toBe('super-secret');
  });

  it('prefers body client_id over Basic auth username', () => {
    const basic = Buffer.from('ignored:pw').toString('base64');
    const req = { headers: { authorization: `Basic ${basic}` } };
    const creds = parseClientCredentials(req, { client_id: 'body-client', client_secret: 'body-secret' });
    expect(creds.clientId).toBe('body-client');
    expect(creds.clientSecret).toBe('body-secret');
  });

  it('returns null clientId when no credentials present', () => {
    const creds = parseClientCredentials({ headers: {} }, {});
    expect(creds.clientId).toBeFalsy();
  });
});
