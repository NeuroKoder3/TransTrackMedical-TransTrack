/**
 * TransTrack - Offline Degradation and Reconciliation
 * 
 * Handles offline operation scenarios and data reconciliation
 * when connectivity is restored or systems are merged.
 * 
 * Security: All table and field names are validated against whitelists
 * to prevent SQL injection attacks.
 */

const { getDatabase } = require('../database/init.cjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Offline operation modes
const OPERATION_MODE = {
  NORMAL: 'normal',
  DEGRADED: 'degraded',
  OFFLINE: 'offline',
  RECOVERY: 'recovery',
};

// Conflict resolution strategies
const CONFLICT_STRATEGY = {
  LATEST_WINS: 'latest_wins',
  MANUAL_REVIEW: 'manual_review',
  SOURCE_PRIORITY: 'source_priority',
};

// Allowed tables for reconciliation (whitelist to prevent SQL injection)
const ALLOWED_TABLES = [
  'patients',
  'donor_organs',
  'matches',
  'notifications',
  'notification_rules',
  'priority_weights',
  'ehr_integrations',
  'ehr_imports',
  'ehr_sync_logs',
  'ehr_validation_rules',
  'readiness_barriers',
  'adult_health_history_questionnaires',
];

// Allowed fields per table (whitelist to prevent SQL injection)
const ALLOWED_FIELDS = {
  patients: ['id', 'patient_id', 'first_name', 'last_name', 'date_of_birth', 'blood_type', 'organ_needed', 'medical_urgency', 'waitlist_status', 'date_added_to_waitlist', 'priority_score', 'priority_score_breakdown', 'hla_typing', 'pra_percentage', 'cpra_percentage', 'meld_score', 'las_score', 'functional_status', 'prognosis_rating', 'last_evaluation_date', 'comorbidity_score', 'previous_transplants', 'compliance_score', 'weight_kg', 'height_cm', 'phone', 'email', 'contact_phone', 'contact_email', 'address', 'emergency_contact_name', 'emergency_contact_phone', 'diagnosis', 'comorbidities', 'medications', 'donor_preferences', 'psychological_clearance', 'support_system_rating', 'document_urls', 'notes', 'created_date', 'updated_date', 'created_by', 'updated_by'],
  donor_organs: ['id', 'donor_id', 'organ_type', 'blood_type', 'hla_typing', 'donor_age', 'donor_weight_kg', 'donor_height_cm', 'cause_of_death', 'cold_ischemia_time_hours', 'organ_condition', 'organ_quality', 'organ_status', 'status', 'recovery_date', 'procurement_date', 'recovery_hospital', 'location', 'expiration_date', 'notes', 'created_date', 'updated_date', 'created_by', 'updated_by'],
  matches: ['id', 'donor_organ_id', 'patient_id', 'patient_name', 'compatibility_score', 'blood_type_compatible', 'abo_compatible', 'hla_match_score', 'hla_a_match', 'hla_b_match', 'hla_dr_match', 'hla_dq_match', 'size_compatible', 'match_status', 'priority_rank', 'virtual_crossmatch_result', 'physical_crossmatch_result', 'predicted_graft_survival', 'notes', 'created_date', 'updated_date', 'created_by'],
  notifications: ['id', 'recipient_email', 'title', 'message', 'notification_type', 'is_read', 'related_patient_id', 'related_patient_name', 'priority_level', 'action_url', 'metadata', 'created_date', 'read_date'],
  notification_rules: ['id', 'rule_name', 'description', 'trigger_event', 'conditions', 'notification_template', 'priority_level', 'is_active', 'created_date', 'updated_date', 'created_by'],
  priority_weights: ['id', 'name', 'description', 'medical_urgency_weight', 'time_on_waitlist_weight', 'organ_specific_score_weight', 'evaluation_recency_weight', 'blood_type_rarity_weight', 'evaluation_decay_rate', 'is_active', 'created_date', 'updated_date', 'created_by'],
  ehr_integrations: ['id', 'name', 'type', 'base_url', 'api_key_encrypted', 'is_active', 'last_sync_date', 'sync_frequency_minutes', 'created_date', 'updated_date', 'created_by'],
  ehr_imports: ['id', 'integration_id', 'import_type', 'status', 'records_imported', 'records_failed', 'error_details', 'import_data', 'created_date', 'completed_date', 'created_by'],
  ehr_sync_logs: ['id', 'integration_id', 'sync_type', 'direction', 'status', 'records_processed', 'records_failed', 'error_details', 'created_date', 'completed_date'],
  ehr_validation_rules: ['id', 'field_name', 'rule_type', 'rule_value', 'error_message', 'is_active', 'created_date', 'updated_date', 'created_by'],
  readiness_barriers: ['id', 'patient_id', 'barrier_type', 'status', 'risk_level', 'owning_role', 'identified_date', 'target_resolution_date', 'resolved_date', 'notes', 'created_by', 'created_at', 'updated_at', 'updated_by'],
  adult_health_history_questionnaires: ['id', 'patient_id', 'status', 'last_completed_date', 'expiration_date', 'validity_period_days', 'identified_issues', 'owning_role', 'notes', 'created_by', 'created_at', 'updated_at', 'updated_by'],
};

/**
 * Validate table name against whitelist
 * @param {string} table - Table name to validate
 * @returns {boolean}
 */
function isValidTable(table) {
  return ALLOWED_TABLES.includes(table);
}

/**
 * Validate field name against whitelist for a given table
 * @param {string} table - Table name
 * @param {string} field - Field name to validate
 * @returns {boolean}
 */
function isValidField(table, field) {
  const allowedFields = ALLOWED_FIELDS[table];
  if (!allowedFields) return false;
  return allowedFields.includes(field);
}

/**
 * Filter and validate fields from data object
 * @param {string} table - Table name
 * @param {object} data - Data object with fields
 * @returns {object} - Object with only valid fields
 */
function filterValidFields(table, data) {
  const validData = {};
  for (const [key, value] of Object.entries(data)) {
    if (isValidField(table, key)) {
      validData[key] = value;
    }
  }
  return validData;
}

let currentMode = OPERATION_MODE.NORMAL;
let pendingChanges = [];

/**
 * Get pending changes file path
 */
function getPendingChangesPath() {
  return path.join(app.getPath('userData'), 'pending-changes.json');
}

/**
 * Set operation mode
 */
function setOperationMode(mode) {
  const previousMode = currentMode;
  currentMode = mode;
  
  const db = getDatabase();
  db.prepare(`
    INSERT INTO audit_logs (id, action, entity_type, details, user_email, user_role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    'mode_change',
    'System',
    `Operation mode changed: ${previousMode} -> ${mode}`,
    'system',
    'system'
  );
  
  return { previousMode, currentMode: mode };
}

/**
 * Get current operation mode
 */
function getOperationMode() {
  return currentMode;
}

/**
 * Queue change for later reconciliation
 */
function queueChangeForReconciliation(change) {
  const queuedChange = {
    id: uuidv4(),
    ...change,
    queuedAt: new Date().toISOString(),
    status: 'pending',
  };
  
  pendingChanges.push(queuedChange);
  savePendingChanges();
  
  return queuedChange;
}

/**
 * Save pending changes to disk
 */
function savePendingChanges() {
  const filePath = getPendingChangesPath();
  fs.writeFileSync(filePath, JSON.stringify(pendingChanges, null, 2));
}

/**
 * Load pending changes from disk
 */
function loadPendingChanges() {
  const filePath = getPendingChangesPath();
  if (fs.existsSync(filePath)) {
    try {
      pendingChanges = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      pendingChanges = [];
    }
  }
  return pendingChanges;
}

/**
 * Get pending changes count
 */
function getPendingChangesCount() {
  return pendingChanges.filter(c => c.status === 'pending').length;
}

/**
 * Get all pending changes
 */
function getPendingChanges() {
  return pendingChanges;
}

/**
 * Detect conflicts between two records
 */
function detectConflicts(localRecord, remoteRecord) {
  const conflicts = [];
  
  // Compare each field
  const allKeys = new Set([...Object.keys(localRecord), ...Object.keys(remoteRecord)]);
  
  for (const key of allKeys) {
    if (key === 'id' || key === 'created_date') continue;
    
    const localValue = localRecord[key];
    const remoteValue = remoteRecord[key];
    
    if (JSON.stringify(localValue) !== JSON.stringify(remoteValue)) {
      conflicts.push({
        field: key,
        localValue,
        remoteValue,
        localUpdated: localRecord.updated_date,
        remoteUpdated: remoteRecord.updated_date,
      });
    }
  }
  
  return conflicts;
}

/**
 * Resolve conflicts using specified strategy
 */
function resolveConflicts(conflicts, strategy, localRecord, remoteRecord) {
  const resolved = { ...localRecord };
  const resolutionLog = [];
  
  for (const conflict of conflicts) {
    let resolvedValue;
    let resolution;
    
    switch (strategy) {
      case CONFLICT_STRATEGY.LATEST_WINS:
        const localTime = new Date(conflict.localUpdated || 0);
        const remoteTime = new Date(conflict.remoteUpdated || 0);
        
        if (remoteTime > localTime) {
          resolvedValue = conflict.remoteValue;
          resolution = 'remote_newer';
        } else {
          resolvedValue = conflict.localValue;
          resolution = 'local_newer';
        }
        break;
        
      case CONFLICT_STRATEGY.SOURCE_PRIORITY:
        // Local (source) takes priority
        resolvedValue = conflict.localValue;
        resolution = 'source_priority';
        break;
        
      case CONFLICT_STRATEGY.MANUAL_REVIEW:
      default:
        // Keep local but flag for review
        resolvedValue = conflict.localValue;
        resolution = 'pending_review';
        break;
    }
    
    resolved[conflict.field] = resolvedValue;
    resolutionLog.push({
      field: conflict.field,
      resolution,
      chosenValue: resolvedValue,
    });
  }
  
  return { resolved, resolutionLog };
}

/**
 * Reconcile pending changes
 */
async function reconcilePendingChanges(strategy = CONFLICT_STRATEGY.LATEST_WINS) {
  const db = getDatabase();
  const pending = pendingChanges.filter(c => c.status === 'pending');
  
  const results = {
    processed: 0,
    succeeded: 0,
    conflicts: 0,
    failed: 0,
    details: [],
  };
  
  for (const change of pending) {
    try {
      results.processed++;
      
      // Validate table name to prevent SQL injection
      if (!isValidTable(change.table)) {
        throw new Error(`Invalid table name: ${change.table}`);
      }
      
      // Filter and validate fields
      const validData = filterValidFields(change.table, change.data || {});
      
      // Apply the change based on type
      switch (change.type) {
        case 'create':
          if (!validData.id) {
            throw new Error('Missing required id field');
          }
          db.prepare(`INSERT OR IGNORE INTO ${change.table} (id) VALUES (?)`).run(validData.id);
          // Update with full data (only valid fields)
          const createFields = Object.keys(validData).filter(k => k !== 'id');
          if (createFields.length > 0) {
            const createUpdates = createFields.map(k => `${k} = ?`).join(', ');
            db.prepare(`UPDATE ${change.table} SET ${createUpdates} WHERE id = ?`)
              .run(...createFields.map(k => validData[k]), validData.id);
          }
          break;
          
        case 'update':
          const updateFields = Object.keys(validData).filter(k => k !== 'id');
          if (updateFields.length > 0) {
            const updates = updateFields.map(k => `${k} = ?`).join(', ');
            db.prepare(`UPDATE ${change.table} SET ${updates} WHERE id = ?`)
              .run(...updateFields.map(k => validData[k]), change.entityId);
          }
          break;
          
        case 'delete':
          db.prepare(`DELETE FROM ${change.table} WHERE id = ?`).run(change.entityId);
          break;
          
        default:
          throw new Error(`Invalid change type: ${change.type}`);
      }
      
      change.status = 'reconciled';
      change.reconciledAt = new Date().toISOString();
      results.succeeded++;
      
      results.details.push({
        changeId: change.id,
        status: 'success',
        type: change.type,
        table: change.table,
      });
      
    } catch (error) {
      change.status = 'failed';
      change.error = error.message;
      results.failed++;
      
      results.details.push({
        changeId: change.id,
        status: 'failed',
        error: error.message,
      });
    }
  }
  
  savePendingChanges();
  
  // Log reconciliation
  db.prepare(`
    INSERT INTO audit_logs (id, action, entity_type, details, user_email, user_role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    'reconciliation',
    'System',
    `Reconciliation completed: ${results.succeeded} succeeded, ${results.failed} failed`,
    'system',
    'system'
  );
  
  return results;
}

/**
 * Import external data with reconciliation
 */
async function importWithReconciliation(importData, options = {}) {
  const db = getDatabase();
  const strategy = options.strategy || CONFLICT_STRATEGY.LATEST_WINS;
  
  const results = {
    imported: 0,
    updated: 0,
    conflicts: [],
    skipped: 0,
    errors: [],
  };
  
  for (const [table, records] of Object.entries(importData.tables || {})) {
    // Validate table name to prevent SQL injection
    if (!isValidTable(table)) {
      results.errors.push(`Invalid table name: ${table}`);
      continue;
    }
    
    for (const record of records) {
      try {
        // Filter and validate fields
        const validRecord = filterValidFields(table, record);
        
        if (!validRecord.id) {
          results.errors.push(`Record missing required id field in table ${table}`);
          results.skipped++;
          continue;
        }
        
        // Check if record exists
        const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(validRecord.id);
        
        if (existing) {
          // Detect conflicts
          const conflicts = detectConflicts(existing, validRecord);
          
          if (conflicts.length > 0) {
            if (strategy === CONFLICT_STRATEGY.MANUAL_REVIEW) {
              results.conflicts.push({
                table,
                recordId: validRecord.id,
                conflicts,
              });
              results.skipped++;
              continue;
            }
            
            const { resolved } = resolveConflicts(conflicts, strategy, existing, validRecord);
            
            // Filter resolved data again to ensure only valid fields
            const validResolved = filterValidFields(table, resolved);
            
            // Update with resolved data
            const fields = Object.keys(validResolved).filter(k => k !== 'id');
            if (fields.length > 0) {
              const updates = fields.map(k => `${k} = ?`).join(', ');
              db.prepare(`UPDATE ${table} SET ${updates} WHERE id = ?`)
                .run(...fields.map(k => validResolved[k]), validRecord.id);
            }
            
            results.updated++;
          }
        } else {
          // Insert new record (only valid fields)
          const fields = Object.keys(validRecord);
          const placeholders = fields.map(() => '?').join(', ');
          db.prepare(`INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders})`)
            .run(...fields.map(k => validRecord[k]));
          
          results.imported++;
        }
      } catch (error) {
        results.errors.push(`Error processing record in ${table}: ${error.message}`);
        results.skipped++;
      }
    }
  }
  
  return results;
}

/**
 * Get reconciliation status
 */
function getReconciliationStatus() {
  const pending = loadPendingChanges();
  
  return {
    operationMode: currentMode,
    pendingChanges: pending.filter(c => c.status === 'pending').length,
    reconciledChanges: pending.filter(c => c.status === 'reconciled').length,
    failedChanges: pending.filter(c => c.status === 'failed').length,
    lastReconciliation: pending.find(c => c.reconciledAt)?.reconciledAt || null,
  };
}

/**
 * Clear reconciled changes
 */
function clearReconciledChanges() {
  pendingChanges = pendingChanges.filter(c => c.status !== 'reconciled');
  savePendingChanges();
  return pendingChanges.length;
}

module.exports = {
  OPERATION_MODE,
  CONFLICT_STRATEGY,
  ALLOWED_TABLES,
  setOperationMode,
  getOperationMode,
  queueChangeForReconciliation,
  getPendingChangesCount,
  getPendingChanges,
  loadPendingChanges,
  detectConflicts,
  resolveConflicts,
  reconcilePendingChanges,
  importWithReconciliation,
  getReconciliationStatus,
  clearReconciledChanges,
  isValidTable,
  isValidField,
  filterValidFields,
};
