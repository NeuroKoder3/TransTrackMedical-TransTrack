/**
 * TransTrack - Disaster Recovery and Business Continuity
 * 
 * Provides backup, restore, and failover capabilities for
 * business continuity in healthcare environments.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { getDatabase, getDatabasePath } = require('../database/init.cjs');
const { v4: uuidv4 } = require('uuid');

// Recovery configuration
const RECOVERY_CONFIG = {
  autoBackupIntervalHours: 24,
  maxAutoBackups: 30,
  backupEncryption: true,
  checksumAlgorithm: 'sha256',
};

/**
 * Get backup directory path
 */
function getBackupDir() {
  const backupDir = path.join(app.getPath('userData'), 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  return backupDir;
}

/**
 * Generate checksum for file
 */
function generateChecksum(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash(RECOVERY_CONFIG.checksumAlgorithm);
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

/**
 * Create backup with metadata
 */
async function createBackup(options = {}) {
  const db = getDatabase();
  const dbPath = getDatabasePath();
  const backupDir = getBackupDir();
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupId = uuidv4();
  const backupFileName = `transtrack-backup-${timestamp}.db`;
  const backupPath = path.join(backupDir, backupFileName);
  const metadataPath = path.join(backupDir, `${backupFileName}.meta.json`);
  
  // Get database stats
  const patientCount = db.prepare('SELECT COUNT(*) as count FROM patients').get().count;
  const auditCount = db.prepare('SELECT COUNT(*) as count FROM audit_logs').get().count;
  
  // Create backup using SQLite backup API
  await db.backup(backupPath);
  
  // Generate checksum
  const checksum = generateChecksum(backupPath);
  
  // Create metadata
  const metadata = {
    id: backupId,
    fileName: backupFileName,
    createdAt: new Date().toISOString(),
    type: options.type || 'manual',
    description: options.description || 'Manual backup',
    version: '1.0.0',
    checksum,
    checksumAlgorithm: RECOVERY_CONFIG.checksumAlgorithm,
    stats: {
      patientCount,
      auditCount,
      fileSizeBytes: fs.statSync(backupPath).size,
    },
    createdBy: options.createdBy || 'system',
  };
  
  // Save metadata
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  
  // Log backup in audit trail
  const defaultOrg = db.prepare('SELECT id FROM organizations WHERE status = ? LIMIT 1').get('ACTIVE');
  db.prepare(`
    INSERT INTO audit_logs (id, org_id, action, entity_type, details, user_email, user_role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    defaultOrg?.id || 'SYSTEM',
    'backup_created',
    'System',
    `Backup created: ${backupFileName} (${patientCount} patients, checksum: ${checksum.substring(0, 16)}...)`,
    options.createdBy || 'system',
    'system',
    new Date().toISOString()
  );
  
  // Cleanup old backups if auto-backup
  if (options.type === 'auto') {
    await cleanupOldBackups();
  }
  
  return metadata;
}

/**
 * List available backups
 */
function listBackups() {
  const backupDir = getBackupDir();
  const files = fs.readdirSync(backupDir);
  
  const backups = [];
  
  for (const file of files) {
    if (file.endsWith('.meta.json')) {
      try {
        const metadataPath = path.join(backupDir, file);
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        const backupPath = path.join(backupDir, metadata.fileName);
        
        // Check if backup file exists
        if (fs.existsSync(backupPath)) {
          metadata.exists = true;
          metadata.currentSize = fs.statSync(backupPath).size;
        } else {
          metadata.exists = false;
        }
        
        backups.push(metadata);
      } catch (e) {
        console.error('Error reading backup metadata:', file, e);
      }
    }
  }
  
  // Sort by date, newest first
  backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  return backups;
}

/**
 * Verify backup integrity with actual restore test.
 * Goes beyond checksum: opens the database, runs integrity check,
 * and verifies critical tables exist with data.
 */
function verifyBackup(backupId, options = {}) {
  const Database = require('better-sqlite3-multiple-ciphers');
  const backups = listBackups();
  const backup = backups.find(b => b.id === backupId);
  
  if (!backup) {
    return { valid: false, error: 'Backup not found' };
  }
  
  const backupDir = getBackupDir();
  const backupPath = path.join(backupDir, backup.fileName);
  
  if (!fs.existsSync(backupPath)) {
    return { valid: false, error: 'Backup file missing' };
  }
  
  // Step 1: Verify checksum
  const currentChecksum = generateChecksum(backupPath);
  
  if (currentChecksum !== backup.checksum) {
    return {
      valid: false,
      error: 'Checksum mismatch - backup may be corrupted',
      expectedChecksum: backup.checksum,
      actualChecksum: currentChecksum,
    };
  }
  
  // Step 2: Attempt actual database open and read (restore test)
  let testDb = null;
  try {
    testDb = new Database(backupPath, { readonly: true, verbose: null });

    // Apply encryption if key is available
    const keyPath = path.join(app.getPath('userData'), '.transtrack-key');
    if (fs.existsSync(keyPath)) {
      const encryptionKey = fs.readFileSync(keyPath, 'utf8').trim();
      if (/^[a-fA-F0-9]{64}$/.test(encryptionKey)) {
        testDb.pragma(`cipher = 'sqlcipher'`);
        testDb.pragma(`legacy = 4`);
        testDb.pragma(`key = "x'${encryptionKey}'"`);
      }
    }

    // Step 3: SQLite integrity check
    const integrityResult = testDb.pragma('integrity_check');
    const isIntact = integrityResult[0]?.integrity_check === 'ok';
    if (!isIntact) {
      testDb.close();
      return { valid: false, error: 'SQLite integrity check failed', details: integrityResult };
    }

    // Step 4: Verify critical tables exist
    const tables = testDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map(t => t.name);

    const requiredTables = ['patients', 'users', 'audit_logs', 'organizations'];
    const missingTables = requiredTables.filter(t => !tables.includes(t));
    if (missingTables.length > 0) {
      testDb.close();
      return { valid: false, error: `Missing required tables: ${missingTables.join(', ')}` };
    }

    // Step 5: Verify data is readable (actual SELECT queries)
    const stats = {};
    for (const table of requiredTables) {
      try {
        const count = testDb.prepare(`SELECT COUNT(*) as count FROM "${table}"`).get();
        stats[table] = count.count;
      } catch (e) {
        testDb.close();
        return { valid: false, error: `Cannot read table '${table}': ${e.message}` };
      }
    }

    testDb.close();
    testDb = null;

    return {
      valid: true,
      backup,
      verifiedAt: new Date().toISOString(),
      checksumVerified: true,
      integrityCheckPassed: true,
      restoreTestPassed: true,
      stats,
    };
  } catch (error) {
    if (testDb) {
      try { testDb.close(); } catch (_) { /* ignore */ }
    }
    return {
      valid: false,
      error: `Restore test failed: ${error.message}`,
      checksumVerified: true,
      restoreTestPassed: false,
    };
  }
}

/**
 * Restore from backup
 */
async function restoreFromBackup(backupId, options = {}) {
  const db = getDatabase();
  
  // Verify backup first
  const verification = verifyBackup(backupId);
  if (!verification.valid) {
    throw new Error(`Backup verification failed: ${verification.error}`);
  }
  
  const backup = verification.backup;
  const backupDir = getBackupDir();
  const backupPath = path.join(backupDir, backup.fileName);
  const dbPath = getDatabasePath();
  
  // Create pre-restore backup
  const preRestoreBackup = await createBackup({
    type: 'pre-restore',
    description: `Auto-backup before restoring from ${backup.fileName}`,
    createdBy: options.restoredBy || 'system',
  });
  
  // Log restore attempt
  const defaultOrgRestore = db.prepare('SELECT id FROM organizations WHERE status = ? LIMIT 1').get('ACTIVE');
  db.prepare(`
    INSERT INTO audit_logs (id, org_id, action, entity_type, details, user_email, user_role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    defaultOrgRestore?.id || 'SYSTEM',
    'restore_initiated',
    'System',
    `Restore initiated from: ${backup.fileName}`,
    options.restoredBy || 'system',
    'system',
    new Date().toISOString()
  );
  
  // Close current database
  db.close();
  
  // Replace database with backup
  fs.copyFileSync(backupPath, dbPath);
  
  return {
    success: true,
    restoredFrom: backup,
    preRestoreBackup,
    restoredAt: new Date().toISOString(),
    requiresRestart: true,
  };
}

/**
 * Cleanup old automatic backups
 */
async function cleanupOldBackups() {
  const backups = listBackups();
  const autoBackups = backups.filter(b => b.type === 'auto');
  
  if (autoBackups.length > RECOVERY_CONFIG.maxAutoBackups) {
    const toDelete = autoBackups.slice(RECOVERY_CONFIG.maxAutoBackups);
    const backupDir = getBackupDir();
    
    for (const backup of toDelete) {
      try {
        const backupPath = path.join(backupDir, backup.fileName);
        const metadataPath = path.join(backupDir, `${backup.fileName}.meta.json`);
        
        if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
        if (fs.existsSync(metadataPath)) fs.unlinkSync(metadataPath);
      } catch (e) {
        console.error('Error deleting old backup:', backup.fileName, e);
      }
    }
    
    return toDelete.length;
  }
  
  return 0;
}

/**
 * Get recovery status
 */
function getRecoveryStatus() {
  const backups = listBackups();
  const latestBackup = backups[0];
  
  let hoursSinceLastBackup = null;
  if (latestBackup) {
    const lastBackupTime = new Date(latestBackup.createdAt);
    hoursSinceLastBackup = Math.floor((new Date() - lastBackupTime) / (1000 * 60 * 60));
  }
  
  return {
    backupCount: backups.length,
    latestBackup: latestBackup || null,
    hoursSinceLastBackup,
    backupOverdue: hoursSinceLastBackup > RECOVERY_CONFIG.autoBackupIntervalHours,
    storageUsedBytes: backups.reduce((sum, b) => sum + (b.stats?.fileSizeBytes || 0), 0),
    config: RECOVERY_CONFIG,
  };
}

/**
 * Export data for external backup
 */
async function exportForExternalBackup() {
  const db = getDatabase();
  
  const exportData = {
    exportedAt: new Date().toISOString(),
    version: '1.0.0',
    tables: {},
  };
  
  // Export all tables
  const tables = ['patients', 'donor_organs', 'matches', 'notifications', 
                  'priority_weights', 'audit_logs', 'users'];
  
  for (const table of tables) {
    try {
      exportData.tables[table] = db.prepare(`SELECT * FROM ${table}`).all();
    } catch (e) {
      console.error(`Error exporting table ${table}:`, e);
    }
  }
  
  return exportData;
}

module.exports = {
  RECOVERY_CONFIG,
  getBackupDir,
  createBackup,
  listBackups,
  verifyBackup,
  restoreFromBackup,
  cleanupOldBackups,
  getRecoveryStatus,
  exportForExternalBackup,
};
