/**
 * TransTrack — SSO callback finalizer.
 *
 * Called by the main-process protocol handler (electron/main.cjs) after
 * the OIDC token exchange has returned a verified identity. Responsible
 * for:
 *   1. Looking up the matching local user (by email, sso_enabled=1)
 *   2. Refusing if no such user exists, the user is inactive, or the
 *      user is not provisioned for SSO
 *   3. Minting a TransTrack session row + activating it in shared.cjs
 *
 * This is intentionally NOT exposed as a renderer-accessible IPC channel
 * — the renderer cannot fabricate an OIDC identity to bypass password
 * auth. The only callers are the protocol handler and the SSO test
 * harness.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../../database/init.cjs');
const shared = require('../shared.cjs');

/**
 * Mint a session from a verified OIDC identity.
 *
 * @param {object} identity         from electron/auth/oidcDesktop.cjs completeFlow()
 * @param {string} identity.email
 * @param {string} identity.name
 * @param {string} identity.sub     OIDC subject claim
 * @returns {{success: true, user, sessionId}}  on success
 * @throws on any policy violation
 */
async function finalizeSso(identity) {
  if (!identity || !identity.email) throw new Error('SSO identity missing email claim');
  const db = getDatabase();

  const user = db.prepare(
    "SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND is_active = 1 AND sso_enabled = 1"
  ).get(identity.email);

  if (!user) {
    throw new Error(
      'No SSO-enabled local account for ' + identity.email +
      '. Ask your administrator to provision the user with sso_enabled=1.'
    );
  }

  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id);
  if (!org || org.status !== 'ACTIVE') throw new Error('Organization is not active');

  // Update the OIDC subject claim on the user row if we haven't recorded
  // it yet, so we can correlate it for audit purposes.
  if (identity.sub) {
    db.prepare(
      "UPDATE users SET sso_subject = ?, last_login = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(String(identity.sub), user.id);
  } else {
    db.prepare("UPDATE users SET last_login = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(user.id);
  }

  const sessionId = uuidv4();
  const expiresAtDate = new Date(Date.now() + shared.SESSION_DURATION_MS);
  db.prepare('INSERT INTO sessions (id, user_id, org_id, expires_at) VALUES (?, ?, ?, ?)').run(
    sessionId, user.id, user.org_id, expiresAtDate.toISOString()
  );

  const currentUser = {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    org_id: user.org_id,
    org_name: org.name,
    must_change_password: false,   // SSO users never see local password prompt
    mfa_required: false,            // IdP is responsible for MFA
    mfa_enrolled: false,
    sso: true,
  };

  shared.setSessionState(sessionId, currentUser, expiresAtDate.getTime(), null);
  shared.logAudit('login', 'User', user.id, null,
    `SSO login via OIDC (subject=${(identity.sub || '').slice(0, 24)})`,
    user.email, user.role);

  return { success: true, user: currentUser, sessionId };
}

module.exports = { finalizeSso };
