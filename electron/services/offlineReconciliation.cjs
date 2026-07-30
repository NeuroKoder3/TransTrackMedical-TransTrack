/**
 * TransTrack - Offline Degradation and Reconciliation
 * 
 * DISABLED: TransTrack is single-workstation offline-first without
 * multi-device sync. Offline reconciliation is not applicable and
 * introduces unnecessary attack surface for PHI leakage via
 * pending-changes files on disk.
 * 
 * All public functions throw when called. IPC registrations return
 * disabled status.
 */

const DISABLED_MSG = 'Offline reconciliation is disabled; TransTrack is single-workstation offline-first without multi-device sync';
const ENABLED = false;

function _disabled() { throw new Error(DISABLED_MSG); }

const OPERATION_MODE = { NORMAL: 'normal', DEGRADED: 'degraded', OFFLINE: 'offline', RECOVERY: 'recovery' };
const CONFLICT_STRATEGY = { LATEST_WINS: 'latest_wins', MANUAL_REVIEW: 'manual_review', SOURCE_PRIORITY: 'source_priority' };
const ALLOWED_TABLES = [];

function setOperationMode() { _disabled(); }
function getOperationMode() { return OPERATION_MODE.NORMAL; }
function queueChangeForReconciliation() { _disabled(); }
function getPendingChangesCount() { return 0; }
function getPendingChanges() { return []; }
function loadPendingChanges() { return []; }
function detectConflicts() { _disabled(); }
function resolveConflicts() { _disabled(); }
async function reconcilePendingChanges() { _disabled(); }
async function importWithReconciliation() { _disabled(); }
function getReconciliationStatus() {
  return { operationMode: 'normal', pendingChanges: 0, reconciledChanges: 0, failedChanges: 0, lastReconciliation: null, disabled: true, disabledReason: DISABLED_MSG };
}
function clearReconciledChanges() { return 0; }
function isValidTable() { return false; }
function isValidField() { return false; }
function filterValidFields() { return {}; }

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
