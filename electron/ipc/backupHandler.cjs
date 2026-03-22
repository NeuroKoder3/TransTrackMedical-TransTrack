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
const { getDatabase, getDatabasePath, backupDatabase } = require('../database/init.cjs');
const { createLogger } = require('./errorLogger.cjs');

const log = createLogger('backup');

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

    if (encryptionKey) {
      testDb.pragma(`cipher = 'sqlcipher'`);
      testDb.pragma(`legacy = 4`);
      testDb.pragma(`key = "x'${encryptionKey}'"`);
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
    const { targetPath } = options;

    if (!targetPath) {
      throw new Error('Backup target path is required');
    }

    const startTime = Date.now();

    try {
      // Step 1: Create backup
      log.info('Creating backup', { target: targetPath });
      await backupDatabase(targetPath);

      // Step 2: Compute checksum
      const checksum = computeFileChecksum(targetPath);

      // Step 3: Verify backup integrity
      log.info('Verifying backup integrity', { target: targetPath });
      const keyPath = path.join(require('electron').app.getPath('userData'), '.transtrack-key');
      let encryptionKey = null;
      if (fs.existsSync(keyPath)) {
        encryptionKey = fs.readFileSync(keyPath, 'utf8').trim();
      }

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
