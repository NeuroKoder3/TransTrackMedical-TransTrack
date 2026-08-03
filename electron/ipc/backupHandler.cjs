/**
 * TransTrack - Backup Integrity Verification
 *
 * Creates database backups and verifies they are restorable.
 * HIPAA requires tested backup/restore procedures.
 */

'use strict';

const { ipcMain } = require('electron');
const Database = require('better-sqlite3-multiple-ciphers');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  getDatabase,
  getDatabasePath,
  backupDatabase,
  getDatabaseEncryptionKey,
  applyCipherPragmas,
} = require('../database/init.cjs');
const { createLogger } = require('./errorLogger.cjs');
const pathConfinement = require('./pathConfinement.cjs');
const shared = require('./shared.cjs');

const log = createLogger('backup');

/**
 * File types a verified backup may be written as — see the note on
 * BACKUP_EXTENSIONS in handlers/operations.cjs: backupDatabase() wipes the
 * existing target, so an unconstrained destination inside the application data
 * directory is a way to destroy key material, not just to misfile a copy.
 */
const BACKUP_EXTENSIONS = ['.db', '.sqlite', '.bak'];

/**
 * Compute SHA-256 checksum of a file for integrity verification.
 */
function computeFileChecksum(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

/**
 * Verify a backup file can be opened and read.
 */
function verifyBackupIntegrity(backupPath, encryptionKey) {
  let testDb = null;
  try {
    testDb = new Database(backupPath, { readonly: true, verbose: null });

    // The same profile the live database is opened with, from the one
    // definition in database/init.cjs, so a backup can never be verified under
    // a weaker configuration than the data it came from (finding M-7).
    if (encryptionKey) {
      applyCipherPragmas(testDb, encryptionKey);
    }

    // Run integrity check
    const integrityResult = testDb.pragma('integrity_check');
    const isIntact = integrityResult[0]?.integrity_check === 'ok';

    if (!isIntact) {
      return { valid: false, error: 'Integrity check failed', details: integrityResult };
    }

    // Verify critical tables exist and have data
    const tables = testDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map(t => t.name);

    const requiredTables = ['patients', 'users', 'audit_logs', 'organizations'];
    const missingTables = requiredTables.filter(t => !tables.includes(t));

    if (missingTables.length > 0) {
      return {
        valid: false,
        error: `Missing required tables: ${missingTables.join(', ')}`,
      };
    }

    // Count records in key tables
    const tableCounts = {};
    for (const table of tables) {
      try {
        const count = testDb.prepare(`SELECT COUNT(*) as count FROM "${table}"`).get();
        tableCounts[table] = count.count;
      } catch (_) {
        tableCounts[table] = -1;
      }
    }

    testDb.close();
    testDb = null;

    return {
      valid: true,
      tables: tables.length,
      tableCounts,
      fileSize: fs.statSync(backupPath).size,
    };
  } catch (error) {
    if (testDb) {
      try { testDb.close(); } catch (_) { /* ignore */ }
    }
    return { valid: false, error: error.message };
  }
}

function register() {
  ipcMain.handle('backup:create-and-verify', async (_event, options = {}) => {
    shared.requireAdmin('backup operations');

    if (!options.targetPath) {
      throw new Error('Backup target path is required');
    }

    // Confined before anything touches the filesystem, so a traversal or a
    // symlinked destination fails before the live database is checkpointed and
    // copied (finding L-5).
    const targetPath = pathConfinement.resolveConfinedPath(options.targetPath, {
      purpose: 'creating a verified backup',
      extensions: BACKUP_EXTENSIONS,
    });

    const startTime = Date.now();

    try {
      // Step 1: Create backup
      log.info('Creating backup', { target: targetPath });
      await backupDatabase(targetPath);

      // Step 2: Compute checksum
      const checksum = computeFileChecksum(targetPath);

      // Step 3: Verify backup integrity
      log.info('Verifying backup integrity', { target: targetPath });
      let encryptionKey = null;
      try { encryptionKey = getDatabaseEncryptionKey(); } catch { /* key unavailable */ }

      const verification = verifyBackupIntegrity(targetPath, encryptionKey);

      const result = {
        success: verification.valid,
        backupPath: targetPath,
        checksum,
        verification,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };

      if (verification.valid) {
        log.info('Backup verified successfully', {
          checksum,
          tables: verification.tables,
          fileSize: verification.fileSize,
          duration_ms: result.durationMs,
        });
      } else {
        log.error('Backup verification FAILED', new Error(verification.error), {
          target: targetPath,
        });
      }

      return result;
    } catch (error) {
      log.error('Backup creation failed', error);
      throw error;
    }
  });
}

module.exports = { register, verifyBackupIntegrity, computeFileChecksum };
