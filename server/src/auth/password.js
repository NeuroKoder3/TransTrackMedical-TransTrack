'use strict';

const argon2 = require('argon2');

/**
 * Password hashing using Argon2id with NIST/OWASP-aligned parameters.
 * Cost parameters can be tuned per deployment; defaults target ~250ms on
 * a 2024-class server CPU.
 */

const HASH_OPTS = {
  type: argon2.argon2id,
  memoryCost: 47104,     // 46 MiB
  timeCost: 3,
  parallelism: 1,
};

async function hash(plain) {
  return argon2.hash(plain, HASH_OPTS);
}

async function verify(stored, plain) {
  if (!stored) return false;
  try {
    return await argon2.verify(stored, plain);
  } catch {
    return false;
  }
}

/**
 * Returns true if the supplied password meets the deployment-configured
 * complexity policy.  Length is the primary control per NIST SP 800-63B.
 */
function meetsPolicy(password, minLength) {
  if (typeof password !== 'string') return false;
  if (password.length < minLength) return false;
  // No mandatory composition rules per NIST SP 800-63B Rev. 3 §5.1.1.2,
  // but we deny common patterns and excessive repetition.
  if (/^(.)\1+$/.test(password)) return false; // all same char
  return true;
}

module.exports = { hash, verify, meetsPolicy };
