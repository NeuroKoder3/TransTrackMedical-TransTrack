/**
 * TransTrack - IPC Rate Limiter
 *
 * Prevents abuse by limiting the number of IPC calls per user per handler.
 * Uses a sliding window approach with configurable limits.
 */

'use strict';

const WINDOW_MS = 60 * 1000; // 1 minute window
const DEFAULT_MAX_CALLS = 100;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Clean up stale entries every 5 min

const rateLimitMap = new Map();

const HANDLER_LIMITS = {
  'entity:create': 50,
  'entity:update': 50,
  'entity:delete': 20,
  'entity:list': 100,
  'entity:filter': 100,
  'entity:get': 200,
  'auth:login': 10,
  'auth:register': 5,
  'auth:changePassword': 5,
  'file:exportCSV': 10,
  'file:exportExcel': 10,
  'file:exportPDF': 10,
  'file:backupDatabase': 3,
  'file:restoreDatabase': 3,
};

function checkRateLimit(userId, handler) {
  const key = `${userId || 'anon'}:${handler}`;
  const now = Date.now();
  const maxCalls = HANDLER_LIMITS[handler] || DEFAULT_MAX_CALLS;

  let calls = rateLimitMap.get(key);
  if (!calls) {
    calls = [];
    rateLimitMap.set(key, calls);
  }

  // Remove calls outside the window
  const windowStart = now - WINDOW_MS;
  while (calls.length > 0 && calls[0] < windowStart) {
    calls.shift();
  }

  if (calls.length >= maxCalls) {
    return {
      allowed: false,
      retryAfterMs: calls[0] + WINDOW_MS - now,
      error: `Rate limit exceeded for ${handler}. Max ${maxCalls} calls per minute.`,
    };
  }

  calls.push(now);
  return { allowed: true };
}

function resetForUser(userId) {
  const keysToDelete = [];
  for (const key of rateLimitMap.keys()) {
    if (key.startsWith(`${userId}:`)) {
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) {
    rateLimitMap.delete(key);
  }
}

// Periodic cleanup of stale entries (unref so it doesn't block process exit)
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  for (const [key, calls] of rateLimitMap.entries()) {
    while (calls.length > 0 && calls[0] < windowStart) {
      calls.shift();
    }
    if (calls.length === 0) {
      rateLimitMap.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS);
if (cleanupTimer.unref) cleanupTimer.unref();

module.exports = {
  checkRateLimit,
  resetForUser,
  HANDLER_LIMITS,
};
