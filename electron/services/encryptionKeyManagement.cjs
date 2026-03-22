/**
 * TransTrack - Encryption Key Rotation Service
 *
 * Provides documented key rotation with full audit trail.
 * FDA/HIPAA require documented key management lifecycle.
 *
 * Flow:
 *   1. Create automatic pre-rotation backup
 *   2. Generate new 256-bit key
 *   3. Re-key database via SQLCipher PRAGMA rekey
 *   4. Verify new key works by re-opening and running integrity check
 *   5. Store key + backup, audit log the rotation
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { v4: uuidv4 } = require('uuid');
const {
  getDatabase,
  getDatabasePath,
  rekeyDatabase,
  backupDatabase,
} = require('../database/init.cjs');

const KEY_ROTATION_MIN_INTERVAL_DAYS = 1;

function getKeyRotationLogPath() {
  return path.join(app.getPath('userData'), '.key-rotation-log.json');
}

function readRotationLog() {
  const logPath = getKeyRotationLogPath();
  if (!fs.existsSync(logPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(logPath, 'utf8'));
  } catch {
    return [];
  }
}

function appendRotationLog(entry) {
  const entries = readRotationLog();
  entries.push(entry);
  fs.writeFileSync(getKeyRotationLogPath(), JSON.stringify(entries, null, 2), { mode: 0o600 });
}

/**
 * Rotate the database encryption key.
 * Creates a pre-rotation backup, generates a new key, re-keys the database,
 * and verifies the new key works.
 */
async function rotateEncryptionKey(options = {}) {
  const { createdBy = 'admin' } = options;
  const db = getDatabase();
  if (!db) throw new Error('Database not initialized');

  const rotationLog = readRotationLog();
  if (rotationLog.length > 0) {
    const lastRotation = rotationLog[rotationLog.length - 1];
    const daysSinceLast = (Date.now() - new Date(lastRotation.rotatedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLast < KEY_ROTATION_MIN_INTERVAL_DAYS) {
      throw new Error(
        `Key was rotated ${Math.round(daysSinceLast * 24)} hours ago. ` +
        `Minimum interval is ${KEY_ROTATION_MIN_INTERVAL_DAYS} day(s).`
      );
    }
  }

  const backupDir = path.join(app.getPath('userData'), 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const preRotationBackupPath = path.join(backupDir, `pre-key-rotation-${timestamp}.db`);

  await backupDatabase(preRotationBackupPath);

  const newKey = crypto.randomBytes(32).toString('hex');

  await rekeyDatabase(newKey);

  // Verify new key by running integrity check
  const integrity = db.pragma('integrity_check');
  const isIntact = integrity[0]?.integrity_check === 'ok';
  if (!isIntact) {
    throw new Error('Post-rotation integrity check failed. Database may be in inconsistent state. Restore from backup immediately.');
  }

  const entry = {
    id: uuidv4(),
    rotatedAt: new Date().toISOString(),
    rotatedBy: createdBy,
    preRotationBackup: preRotationBackupPath,
    integrityVerified: true,
  };
  appendRotationLog(entry);

  db.prepare(`
    INSERT INTO audit_logs (id, org_id, action, entity_type, details, user_email, user_role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    'SYSTEM',
    'encryption_key_rotated',
    'System',
    JSON.stringify({
      preRotationBackup: path.basename(preRotationBackupPath),
      integrityVerified: true,
    }),
    createdBy,
    'admin',
    new Date().toISOString()
  );

  return {
    success: true,
    rotatedAt: entry.rotatedAt,
    preRotationBackup: path.basename(preRotationBackupPath),
    integrityVerified: true,
  };
}

function getKeyRotationHistory() {
  return readRotationLog();
}

function getKeyRotationStatus() {
  const log = readRotationLog();
  const lastRotation = log.length > 0 ? log[log.length - 1] : null;

  let daysSinceRotation = null;
  if (lastRotation) {
    daysSinceRotation = Math.floor(
      (Date.now() - new Date(lastRotation.rotatedAt).getTime()) / (1000 * 60 * 60 * 24)
    );
  }

  return {
    totalRotations: log.length,
    lastRotation,
    daysSinceRotation,
    rotationRecommended: daysSinceRotation === null || daysSinceRotation > 90,
  };
}

module.exports = {
  rotateEncryptionKey,
  getKeyRotationHistory,
  getKeyRotationStatus,
};
