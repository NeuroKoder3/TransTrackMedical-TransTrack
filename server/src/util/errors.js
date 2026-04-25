'use strict';

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const errors = {
  unauthorized: (msg = 'Unauthorized', code = 'unauthorized') =>
    new HttpError(401, code, msg),
  forbidden: (msg = 'Forbidden', code = 'forbidden') =>
    new HttpError(403, code, msg),
  notFound: (msg = 'Not Found', code = 'not_found') =>
    new HttpError(404, code, msg),
  badRequest: (msg, code = 'bad_request', details) =>
    new HttpError(400, code, msg, details),
  conflict: (msg, code = 'conflict') =>
    new HttpError(409, code, msg),
  tooManyRequests: (msg = 'Too many requests') =>
    new HttpError(429, 'rate_limited', msg),
  internal: (msg = 'Internal error') =>
    new HttpError(500, 'internal_error', msg),
};

module.exports = { HttpError, errors };
