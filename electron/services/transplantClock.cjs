/**
 * TransTrack - Transplant Clock Service
 * 
 * Provides real-time operational awareness metrics for transplant coordination teams.
 * The Transplant Clock is a visual heartbeat of the program showing activity rhythm,
 * expirations, and workflow tempo.
 * 
 * IMPORTANT:
 * This is 100% computed locally from the encrypted SQLite database.
 * No cloud, API, or AI inference required. Zero external data dependencies.
 * 
 * SECURITY:
 * All functions require org_id for organization isolation.
 * Queries always include org_id filtering to prevent cross-org access.
 */

const { getDatabase } = require('../database/init.cjs');

// =============================================================================
// ORG ISOLATION HELPERS
// =============================================================================

/**
 * Validate org_id is present - FAIL CLOSED
 */
function requireOrgId(orgId) {
  if (!orgId) {
    throw new Error('Organization context required for clock operations');
  }
  return orgId;
}

// =============================================================================
// CLOCK STATUS THRESHOLDS
// =============================================================================

// Time thresholds for status colors (in hours)
const STATUS_THRESHOLDS = {
  GREEN: 24,    // < 24h = green (healthy)
  YELLOW: 72,   // < 72h = yellow (warning)
  // >= 72h = red (critical)
};

// Pulse rate calculation (Hz based on open tasks)
const PULSE_RATES = {
  BASE: 0.5,          // Base pulse rate (Hz) - calm
  PER_TASK: 0.15,     // Additional Hz per open task
  MAX: 3.0,           // Maximum pulse rate
};

// =============================================================================
// CORE CLOCK METRICS
// =============================================================================

/**
 * Get the time since the last readiness update (hours)
 * Checks: readiness_barriers, adult_health_history_questionnaires, patients
 */
function getTimeSinceLastUpdate(orgId) {
  requireOrgId(orgId);
  const db = getDatabase();
  
  // Find the most recent update timestamp across relevant tables
  const timestamps = [];
  
  // Check readiness_barriers
  const barrierUpdate = db.prepare(`
    SELECT MAX(updated_at) as latest FROM readiness_barriers WHERE org_id = ?
  `).get(orgId);
  if (barrierUpdate?.latest) timestamps.push(new Date(barrierUpdate.latest));
  
  // Check aHHQ updates
  const ahhqUpdate = db.prepare(`
    SELECT MAX(updated_at) as latest FROM adult_health_history_questionnaires WHERE org_id = ?
  `).get(orgId);
  if (ahhqUpdate?.latest) timestamps.push(new Date(ahhqUpdate.latest));
  
  // Check patient updates
  const patientUpdate = db.prepare(`
    SELECT MAX(updated_at) as latest FROM patients WHERE org_id = ? AND waitlist_status = 'active'
  `).get(orgId);
  if (patientUpdate?.latest) timestamps.push(new Date(patientUpdate.latest));
  
  // Check lab results
  const labUpdate = db.prepare(`
    SELECT MAX(updated_at) as latest FROM lab_results WHERE org_id = ?
  `).get(orgId);
  if (labUpdate?.latest) timestamps.push(new Date(labUpdate.latest));
  
  if (timestamps.length === 0) {
    return { hours: 0, lastUpdate: null };
  }
  
  const latestUpdate = new Date(Math.max(...timestamps));
  const now = new Date();
  const diffMs = now - latestUpdate;
  const diffHours = diffMs / (1000 * 60 * 60);
  
  return {
    hours: Math.round(diffHours * 10) / 10,
    lastUpdate: latestUpdate.toISOString(),
  };
}

/**
 * Calculate average task resolution time (hours)
 * Based on resolved barriers (creation to resolution)
 */
function getAverageResolutionTime(orgId) {
  requireOrgId(orgId);
  const db = getDatabase();
  
  // Get resolved barriers with both created_at and resolved_date
  const resolvedBarriers = db.prepare(`
    SELECT created_at, resolved_date 
    FROM readiness_barriers 
    WHERE org_id = ? 
      AND status = 'resolved' 
      AND resolved_date IS NOT NULL
      AND created_at IS NOT NULL
    ORDER BY resolved_date DESC
    LIMIT 100
  `).all(orgId);
  
  if (resolvedBarriers.length === 0) {
    return { hours: 0, sampleSize: 0 };
  }
  
  let totalHours = 0;
  let validCount = 0;
  
  for (const barrier of resolvedBarriers) {
    const created = new Date(barrier.created_at);
    const resolved = new Date(barrier.resolved_date);
    const diffMs = resolved - created;
    
    if (diffMs > 0) {
      totalHours += diffMs / (1000 * 60 * 60);
      validCount++;
    }
  }
  
  const avgHours = validCount > 0 ? totalHours / validCount : 0;
  
  return {
    hours: Math.round(avgHours * 10) / 10,
    sampleSize: validCount,
  };
}

/**
 * Get the next expiration countdown (days)
 * Checks: aHHQ expirations, patient evaluation dates
 */
function getNextExpiration(orgId) {
  requireOrgId(orgId);
  const db = getDatabase();
  const now = new Date();
  const nowStr = now.toISOString();
  
  const expirations = [];
  
  // Check aHHQ expirations
  const ahhqExpiring = db.prepare(`
    SELECT MIN(expiration_date) as next_expiration 
    FROM adult_health_history_questionnaires 
    WHERE org_id = ? 
      AND expiration_date > ?
      AND status != 'expired'
  `).get(orgId, nowStr);
  if (ahhqExpiring?.next_expiration) {
    expirations.push({
      date: new Date(ahhqExpiring.next_expiration),
      type: 'aHHQ',
    });
  }
  
  // Check patient evaluation dates (using last_evaluation_date + 365 days as expiration)
  const patientEvalExpiring = db.prepare(`
    SELECT MIN(DATE(last_evaluation_date, '+365 days')) as next_expiration
    FROM patients 
    WHERE org_id = ? 
      AND waitlist_status = 'active'
      AND last_evaluation_date IS NOT NULL
      AND DATE(last_evaluation_date, '+365 days') > DATE('now')
  `).get(orgId);
  if (patientEvalExpiring?.next_expiration) {
    expirations.push({
      date: new Date(patientEvalExpiring.next_expiration),
      type: 'Evaluation',
    });
  }
  
  // Check barrier target resolution dates
  const barrierTarget = db.prepare(`
    SELECT MIN(target_resolution_date) as next_target
    FROM readiness_barriers
    WHERE org_id = ?
      AND status IN ('open', 'in_progress')
      AND target_resolution_date > ?
  `).get(orgId, nowStr);
  if (barrierTarget?.next_target) {
    expirations.push({
      date: new Date(barrierTarget.next_target),
      type: 'Barrier Target',
    });
  }
  
  if (expirations.length === 0) {
    return { days: null, type: null, date: null };
  }
  
  // Find the soonest expiration
  expirations.sort((a, b) => a.date - b.date);
  const soonest = expirations[0];
  
  const diffMs = soonest.date - now;
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  
  return {
    days: Math.max(0, diffDays),
    type: soonest.type,
    date: soonest.date.toISOString(),
  };
}

/**
 * Get open and overdue task counts
 */
function getTaskCounts(orgId) {
  requireOrgId(orgId);
  const db = getDatabase();
  const nowStr = new Date().toISOString();
  
  // Count open barriers
  const openBarriers = db.prepare(`
    SELECT COUNT(*) as count 
    FROM readiness_barriers 
    WHERE org_id = ? AND status IN ('open', 'in_progress')
  `).get(orgId);
  
  // Count overdue barriers
  const overdueBarriers = db.prepare(`
    SELECT COUNT(*) as count 
    FROM readiness_barriers 
    WHERE org_id = ? 
      AND status IN ('open', 'in_progress')
      AND target_resolution_date < ?
      AND target_resolution_date IS NOT NULL
  `).get(orgId, nowStr);
  
  // Count incomplete aHHQs
  const incompleteAhhq = db.prepare(`
    SELECT COUNT(*) as count 
    FROM adult_health_history_questionnaires 
    WHERE org_id = ? AND status IN ('incomplete', 'pending_update', 'expired')
  `).get(orgId);
  
  // Count expired aHHQs
  const expiredAhhq = db.prepare(`
    SELECT COUNT(*) as count 
    FROM adult_health_history_questionnaires 
    WHERE org_id = ? AND expiration_date < ?
  `).get(orgId, nowStr);
  
  const openTasks = (openBarriers?.count || 0) + (incompleteAhhq?.count || 0);
  const overdueTasks = (overdueBarriers?.count || 0) + (expiredAhhq?.count || 0);
  
  return {
    open: openTasks,
    overdue: overdueTasks,
    barriers: {
      open: openBarriers?.count || 0,
      overdue: overdueBarriers?.count || 0,
    },
    ahhq: {
      incomplete: incompleteAhhq?.count || 0,
      expired: expiredAhhq?.count || 0,
    },
  };
}

/**
 * Calculate coordinator workload indicator
 * Based on active tasks per active staff ratio
 */
function getCoordinatorLoad(orgId) {
  requireOrgId(orgId);
  const db = getDatabase();
  
  // Get active users with coordinator/admin roles
  const activeStaff = db.prepare(`
    SELECT COUNT(*) as count 
    FROM users 
    WHERE org_id = ? 
      AND is_active = 1
      AND role IN ('admin', 'coordinator', 'physician')
  `).get(orgId);
  
  // Get total open tasks
  const taskCounts = getTaskCounts(orgId);
  
  const staffCount = Math.max(1, activeStaff?.count || 1); // Prevent division by zero
  const ratio = taskCounts.open / staffCount;
  
  // Determine load level
  let level = 'low';
  let label = 'Light';
  
  if (ratio >= 15) {
    level = 'critical';
    label = 'Critical';
  } else if (ratio >= 10) {
    level = 'high';
    label = 'Heavy';
  } else if (ratio >= 5) {
    level = 'moderate';
    label = 'Moderate';
  }
  
  return {
    ratio: Math.round(ratio * 10) / 10,
    level,
    label,
    staffCount,
    taskCount: taskCounts.open,
  };
}

/**
 * Calculate the system pulse rate (Hz)
 * Increases with more open/overdue tasks
 */
function calculatePulseRate(openTasks, overdueTasks) {
  // Base rate + additional for each task
  let rate = PULSE_RATES.BASE;
  rate += openTasks * PULSE_RATES.PER_TASK;
  rate += overdueTasks * PULSE_RATES.PER_TASK * 2; // Overdue tasks increase pulse more
  
  // Cap at maximum
  return Math.min(rate, PULSE_RATES.MAX);
}

/**
 * Determine operational status color based on hours since last update
 */
function getStatusColor(hoursSinceUpdate) {
  if (hoursSinceUpdate < STATUS_THRESHOLDS.GREEN) {
    return 'green';
  } else if (hoursSinceUpdate < STATUS_THRESHOLDS.YELLOW) {
    return 'yellow';
  }
  return 'red';
}

// =============================================================================
// MAIN CLOCK DATA FUNCTION
// =============================================================================

/**
 * Get all Transplant Clock data (org-scoped)
 * Returns a comprehensive snapshot of operational activity rhythm
 */
function getTransplantClockData(orgId) {
  requireOrgId(orgId);
  
  const lastUpdate = getTimeSinceLastUpdate(orgId);
  const avgResolution = getAverageResolutionTime(orgId);
  const nextExpiration = getNextExpiration(orgId);
  const taskCounts = getTaskCounts(orgId);
  const coordinatorLoad = getCoordinatorLoad(orgId);
  
  const pulseRate = calculatePulseRate(taskCounts.open, taskCounts.overdue);
  const statusColor = getStatusColor(lastUpdate.hours);
  
  return {
    // Core metrics
    timeSinceLastUpdate: lastUpdate,
    averageResolutionTime: avgResolution,
    nextExpiration,
    
    // Task counts
    tasks: taskCounts,
    
    // Coordinator workload
    coordinatorLoad,
    
    // Visual indicators
    pulseRate: Math.round(pulseRate * 100) / 100, // Hz
    pulsePeriod: Math.round(1000 / pulseRate), // ms between pulses
    statusColor,
    
    // Thresholds (for UI reference)
    thresholds: STATUS_THRESHOLDS,
    
    // Timestamp
    generatedAt: new Date().toISOString(),
    
    // Non-clinical disclaimer
    disclaimer: 'Operational metrics only. Non-clinical, non-allocative.',
  };
}

module.exports = {
  // Main function
  getTransplantClockData,
  
  // Individual metric functions (for testing/granular access)
  getTimeSinceLastUpdate,
  getAverageResolutionTime,
  getNextExpiration,
  getTaskCounts,
  getCoordinatorLoad,
  calculatePulseRate,
  getStatusColor,
  
  // Constants
  STATUS_THRESHOLDS,
  PULSE_RATES,
};
