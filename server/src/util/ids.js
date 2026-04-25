'use strict';

const { randomUUID, randomBytes, createHash } = require('crypto');

function newId() {
  return randomUUID();
}

function newToken(bytes = 48) {
  return randomBytes(bytes).toString('base64url');
}

function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

module.exports = { newId, newToken, sha256 };
