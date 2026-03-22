/**
 * TransTrack - Request Context Tracing
 *
 * Provides request-scoped context (request ID, org, user) that flows
 * through all IPC handler calls and into audit logs, enabling end-to-end
 * tracing of related operations.
 */

'use strict';

const crypto = require('crypto');

const activeContexts = new Map();
let contextCounter = 0;

class RequestContext {
  constructor(options = {}) {
    this.requestId = options.requestId || crypto.randomUUID();
    this.orgId = options.orgId || null;
    this.userId = options.userId || null;
    this.userEmail = options.userEmail || null;
    this.userRole = options.userRole || null;
    this.startedAt = Date.now();
    this.parentRequestId = options.parentRequestId || null;
    this._seq = ++contextCounter;
  }

  get elapsedMs() {
    return Date.now() - this.startedAt;
  }

  toJSON() {
    return {
      requestId: this.requestId,
      orgId: this.orgId,
      userId: this.userId,
      userEmail: this.userEmail,
      startedAt: new Date(this.startedAt).toISOString(),
      elapsedMs: this.elapsedMs,
      parentRequestId: this.parentRequestId,
    };
  }
}

function createContext(options = {}) {
  const ctx = new RequestContext(options);
  activeContexts.set(ctx.requestId, ctx);
  return ctx;
}

function getContext(requestId) {
  return activeContexts.get(requestId) || null;
}

function getOrCreateContext(purpose, options = {}) {
  if (options.requestId && activeContexts.has(options.requestId)) {
    return activeContexts.get(options.requestId);
  }
  return createContext(options);
}

function endContext(requestId) {
  activeContexts.delete(requestId);
}

/**
 * Wrap an IPC handler so every invocation gets a fresh RequestContext.
 * The context is passed as `_requestContext` on the params object when
 * the handler accepts a second argument, or attached to `event._ctx`.
 */
function withRequestContext(handlerName, handler, sessionAccessor) {
  return async (event, ...args) => {
    let session = {};
    try {
      if (typeof sessionAccessor === 'function') {
        session = sessionAccessor() || {};
      }
    } catch { /* no session yet */ }

    const ctx = createContext({
      orgId: session.org_id || null,
      userId: session.id || null,
      userEmail: session.email || null,
      userRole: session.role || null,
    });

    try {
      event._requestContext = ctx;
      const result = await handler(event, ...args);
      return result;
    } finally {
      endContext(ctx.requestId);
    }
  };
}

function getActiveContextCount() {
  return activeContexts.size;
}

module.exports = {
  RequestContext,
  createContext,
  getContext,
  getOrCreateContext,
  endContext,
  withRequestContext,
  getActiveContextCount,
};
