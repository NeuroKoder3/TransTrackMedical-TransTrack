'use strict';

const { createHmac, timingSafeEqual } = require('crypto');

/**
 * Minimal HS256 JWT helpers.  Avoids extra dependency surface.
 */

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload, secret, opts = {}) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = {
    iat: now,
    exp: now + (opts.ttlSeconds || 3600),
    iss: opts.issuer,
    aud: opts.audience,
    ...payload,
  };
  const head = b64url(JSON.stringify(header));
  const data = b64url(JSON.stringify(body));
  const sig = createHmac('sha256', secret)
    .update(`${head}.${data}`)
    .digest('base64url');
  return `${head}.${data}.${sig}`;
}

function verify(token, secret, opts = {}) {
  if (typeof token !== 'string') throw new Error('invalid token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [head, data, sig] = parts;
  const expected = createHmac('sha256', secret)
    .update(`${head}.${data}`)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('signature mismatch');
  }
  const body = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (body.exp && now >= body.exp) throw new Error('token expired');
  if (opts.issuer && body.iss !== opts.issuer) throw new Error('issuer mismatch');
  if (opts.audience && body.aud !== opts.audience) throw new Error('audience mismatch');
  return body;
}

module.exports = { sign, verify };
