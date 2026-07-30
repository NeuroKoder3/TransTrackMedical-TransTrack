'use strict';

function parseMs(envValue, defaultMs) {
  if (!envValue) return defaultMs;
  const n = parseInt(envValue, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultMs;
}

const IDLE_TIMEOUT_MS = parseMs(
  process.env.TRANSTRACK_IDLE_TIMEOUT_MS,
  15 * 60 * 1000
);

const SESSION_ABSOLUTE_MS = parseMs(
  process.env.TRANSTRACK_SESSION_ABSOLUTE_MS,
  8 * 60 * 60 * 1000
);

const WARNING_BEFORE_MS = parseMs(
  process.env.TRANSTRACK_WARNING_BEFORE_MS,
  2 * 60 * 1000
);

module.exports = {
  IDLE_TIMEOUT_MS,
  SESSION_ABSOLUTE_MS,
  WARNING_BEFORE_MS,
};
