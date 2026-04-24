/**
 * Password history & expiration policy.
 *
 * Per SRS TT-R005 / TT-R006.
 *   - Refuses re-use of the last N passwords (default 10).
 *   - Tracks `password_changed_at` and exposes a helper to mark passwords
 *     as expired after a configurable age (default 90 days).
 */

'use strict';

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../database/init.cjs');

const DEFAULT_HISTORY_DEPTH = 10;
const DEFAULT_MAX_AGE_DAYS = 90;

/**
 * Check whether the new password matches any of the last N hashed passwords
 * for this user. Returns true if reused (and therefore disallowed).
 */
function hasReusedPassword(userId, newPasswordPlain, depth = DEFAULT_HISTORY_DEPTH) {
  if (!userId || !newPasswordPlain) return false;
  const rows = getDatabase().prepare(`
    SELECT password_hash FROM user_password_history
    WHERE user_id = ?
    ORDER BY changed_at DESC
    LIMIT ?
  `).all(userId, depth);
  for (const r of rows) {
    if (bcrypt.compareSync(newPasswordPlain, r.password_hash)) return true;
  }
  return false;
}

/**
 * Record a password (already hashed) into the user's history table.
 * Caller is responsible for also updating users.password_hash.
 */
function recordPassword(userId, hashedPassword) {
  if (!userId || !hashedPassword) return;
  const db = getDatabase();
  db.prepare(`
    INSERT INTO user_password_history (id, user_id, password_hash, changed_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(uuidv4(), userId, hashedPassword);
  db.prepare(`
    UPDATE users SET password_changed_at = datetime('now') WHERE id = ?
  `).run(userId);
}

/**
 * Returns true if the password is older than maxAgeDays.
 * If password_changed_at is null we treat it as expired (forces enrollment).
 */
function isPasswordExpired(userRow, maxAgeDays = DEFAULT_MAX_AGE_DAYS) {
  if (!userRow) return false;
  if (!userRow.password_changed_at) return true;
  const changed = new Date(userRow.password_changed_at).getTime();
  if (Number.isNaN(changed)) return true;
  const ageDays = (Date.now() - changed) / (24 * 60 * 60 * 1000);
  return ageDays >= maxAgeDays;
}

module.exports = {
  hasReusedPassword,
  recordPassword,
  isPasswordExpired,
  DEFAULT_HISTORY_DEPTH,
  DEFAULT_MAX_AGE_DAYS,
};
