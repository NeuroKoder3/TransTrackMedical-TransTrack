/**
 * TransTrack - Readiness Barriers Service
 * 
 * Non-Clinical Operational Tracking for Transplant Readiness
 * 
 * IMPORTANT DISCLAIMER:
 * This feature is strictly NON-CLINICAL, NON-ALLOCATIVE, and designed for
 * operational workflow visibility only. It does NOT perform allocation decisions,
 * listing authority functions, or replace UNOS/OPTN systems.
 * 
 * Purpose:
 * Track non-clinical barriers that may affect a patient's operational readiness
 * for transplant coordination. These are administrative and logistical factors
 * that support care team coordination.
 * 
 * Barrier Types:
 * - Pending testing (scheduling, not results)
 * - Insurance clearance status
 * - Transportation planning
 * - Caregiver/support availability
 * - Housing/distance considerations
 * - Psychosocial follow-up flags (no clinical detail)
 * - Financial clearance status
 */

const { getDatabase } = require('../database/init.cjs');
const { v4: uuidv4 } = require('uuid');

// Barrier type definitions with display labels
const BARRIER_TYPES = {
  PENDING_TESTING: {
    value: 'PENDING_TESTING',
    label: 'Pending testing',
    description: 'Testing appointments need to be scheduled or completed',
  },
  INSURANCE_CLEARANCE: {
    value: 'INSURANCE_CLEARANCE',
    label: 'Insurance clearance',
    description: 'Insurance authorization or coverage verification needed',
  },
  TRANSPORTATION_PLAN: {
    value: 'TRANSPORTATION_PLAN',
    label: 'Transportation plan',
    description: 'Post-surgery transportation arrangements needed',
  },
  CAREGIVER_SUPPORT: {
    value: 'CAREGIVER_SUPPORT',
    label: 'Caregiver support',
    description: 'Caregiver or support partner availability confirmation needed',
  },
  HOUSING_DISTANCE: {
    value: 'HOUSING_DISTANCE',
    label: 'Housing/distance',
    description: 'Housing arrangements or distance-related logistics needed',
  },
  PSYCHOSOCIAL_FOLLOWUP: {
    value: 'PSYCHOSOCIAL_FOLLOWUP',
    label: 'Psychosocial follow-up',
    description: 'Psychosocial follow-up scheduling needed (flag only)',
  },
  FINANCIAL_CLEARANCE: {
    value: 'FINANCIAL_CLEARANCE',
    label: 'Financial clearance',
    description: 'Financial assistance or payment plan arrangements needed',
  },
  OTHER_NON_CLINICAL: {
    value: 'OTHER_NON_CLINICAL',
    label: 'Other (non-clinical)',
    description: 'Other non-clinical administrative barrier',
  },
};

// Status definitions
const BARRIER_STATUS = {
  OPEN: { value: 'open', label: 'Open', color: 'red' },
  IN_PROGRESS: { value: 'in_progress', label: 'In Progress', color: 'yellow' },
  RESOLVED: { value: 'resolved', label: 'Resolved', color: 'green' },
};

// Risk level definitions
const BARRIER_RISK_LEVEL = {
  LOW: { value: 'low', label: 'Low', color: 'blue', weight: 1 },
  MODERATE: { value: 'moderate', label: 'Moderate', color: 'yellow', weight: 2 },
  HIGH: { value: 'high', label: 'High', color: 'red', weight: 3 },
};

// Owning role definitions
const OWNING_ROLES = {
  SOCIAL_WORK: { value: 'social_work', label: 'Social Work' },
  FINANCIAL: { value: 'financial', label: 'Financial Services' },
  COORDINATOR: { value: 'coordinator', label: 'Transplant Coordinator' },
  OTHER: { value: 'other', label: 'Other' },
};

/**
 * Create a new readiness barrier
 */
function createBarrier(data, userId) {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO readiness_barriers (
      id, patient_id, barrier_type, status, risk_level, owning_role,
      identified_date, target_resolution_date, notes, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    id,
    data.patient_id,
    data.barrier_type,
    data.status || 'open',
    data.risk_level || 'low',
    data.owning_role,
    data.identified_date || now,
    data.target_resolution_date || null,
    data.notes || null,
    userId,
    now,
    now
  );
  
  return getBarrierById(id);
}

/**
 * Get barrier by ID
 */
function getBarrierById(id) {
  const db = getDatabase();
  return db.prepare('SELECT * FROM readiness_barriers WHERE id = ?').get(id);
}

/**
 * Get all barriers for a patient
 */
function getBarriersByPatientId(patientId, includeResolved = false) {
  const db = getDatabase();
  
  let query = 'SELECT * FROM readiness_barriers WHERE patient_id = ?';
  if (!includeResolved) {
    query += " AND status != 'resolved'";
  }
  query += ' ORDER BY risk_level DESC, created_at DESC';
  
  return db.prepare(query).all(patientId);
}

/**
 * Get all open barriers across all patients
 */
function getAllOpenBarriers() {
  const db = getDatabase();
  
  const query = `
    SELECT rb.*, p.first_name, p.last_name, p.patient_id as mrn
    FROM readiness_barriers rb
    JOIN patients p ON rb.patient_id = p.id
    WHERE rb.status IN ('open', 'in_progress')
    ORDER BY rb.risk_level DESC, rb.created_at DESC
  `;
  
  return db.prepare(query).all();
}

/**
 * Update a barrier
 */
function updateBarrier(id, data, userId) {
  const db = getDatabase();
  const now = new Date().toISOString();
  
  const existing = getBarrierById(id);
  if (!existing) {
    throw new Error('Barrier not found');
  }
  
  // If resolving, set resolved_date
  let resolvedDate = existing.resolved_date;
  if (data.status === 'resolved' && existing.status !== 'resolved') {
    resolvedDate = now;
  } else if (data.status !== 'resolved') {
    resolvedDate = null;
  }
  
  const stmt = db.prepare(`
    UPDATE readiness_barriers SET
      barrier_type = COALESCE(?, barrier_type),
      status = COALESCE(?, status),
      risk_level = COALESCE(?, risk_level),
      owning_role = COALESCE(?, owning_role),
      target_resolution_date = ?,
      resolved_date = ?,
      notes = ?,
      updated_at = ?,
      updated_by = ?
    WHERE id = ?
  `);
  
  stmt.run(
    data.barrier_type || null,
    data.status || null,
    data.risk_level || null,
    data.owning_role || null,
    data.target_resolution_date !== undefined ? data.target_resolution_date : existing.target_resolution_date,
    resolvedDate,
    data.notes !== undefined ? data.notes : existing.notes,
    now,
    userId,
    id
  );
  
  return getBarrierById(id);
}

/**
 * Delete a barrier (soft delete via status or hard delete)
 * For audit compliance, prefer updating status to 'resolved' rather than deleting
 */
function deleteBarrier(id) {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM readiness_barriers WHERE id = ?');
  return stmt.run(id);
}

/**
 * Get barrier summary for a patient
 */
function getPatientBarrierSummary(patientId) {
  const db = getDatabase();
  
  const barriers = getBarriersByPatientId(patientId, false);
  
  const summary = {
    patientId,
    totalOpen: barriers.length,
    byStatus: {
      open: barriers.filter(b => b.status === 'open').length,
      in_progress: barriers.filter(b => b.status === 'in_progress').length,
    },
    byRiskLevel: {
      high: barriers.filter(b => b.risk_level === 'high').length,
      moderate: barriers.filter(b => b.risk_level === 'moderate').length,
      low: barriers.filter(b => b.risk_level === 'low').length,
    },
    highestRiskLevel: 'none',
    barriers: barriers,
  };
  
  // Determine highest risk level
  if (summary.byRiskLevel.high > 0) {
    summary.highestRiskLevel = 'high';
  } else if (summary.byRiskLevel.moderate > 0) {
    summary.highestRiskLevel = 'moderate';
  } else if (summary.totalOpen > 0) {
    summary.highestRiskLevel = 'low';
  }
  
  return summary;
}

/**
 * Get barriers dashboard metrics
 */
function getBarriersDashboard() {
  const db = getDatabase();
  
  // Get all open/in-progress barriers
  const allBarriers = getAllOpenBarriers();
  
  // Get count of active patients
  const activePatients = db.prepare(
    "SELECT COUNT(*) as count FROM patients WHERE waitlist_status = 'active'"
  ).get();
  
  // Get unique patients with barriers
  const patientsWithBarriers = new Set(allBarriers.map(b => b.patient_id));
  
  // Count by type
  const byType = {};
  for (const type of Object.keys(BARRIER_TYPES)) {
    byType[type] = allBarriers.filter(b => b.barrier_type === type).length;
  }
  
  // Count by risk level
  const byRiskLevel = {
    high: allBarriers.filter(b => b.risk_level === 'high').length,
    moderate: allBarriers.filter(b => b.risk_level === 'moderate').length,
    low: allBarriers.filter(b => b.risk_level === 'low').length,
  };
  
  // Count by status
  const byStatus = {
    open: allBarriers.filter(b => b.status === 'open').length,
    in_progress: allBarriers.filter(b => b.status === 'in_progress').length,
  };
  
  // Count by owning role
  const byOwningRole = {};
  for (const role of Object.keys(OWNING_ROLES)) {
    const roleValue = OWNING_ROLES[role].value;
    byOwningRole[roleValue] = allBarriers.filter(b => b.owning_role === roleValue).length;
  }
  
  // Patients with multiple barriers
  const patientBarrierCounts = {};
  for (const barrier of allBarriers) {
    patientBarrierCounts[barrier.patient_id] = (patientBarrierCounts[barrier.patient_id] || 0) + 1;
  }
  const patientsWithMultipleBarriers = Object.values(patientBarrierCounts).filter(c => c > 1).length;
  
  // Overdue barriers (past target resolution date)
  const now = new Date();
  const overdueBarriers = allBarriers.filter(b => {
    if (!b.target_resolution_date) return false;
    return new Date(b.target_resolution_date) < now;
  });
  
  return {
    totalActivePatients: activePatients.count,
    patientsWithBarriers: patientsWithBarriers.size,
    patientsWithBarriersPercentage: activePatients.count > 0 
      ? ((patientsWithBarriers.size / activePatients.count) * 100).toFixed(1)
      : '0.0',
    patientsWithMultipleBarriers,
    totalOpenBarriers: allBarriers.length,
    overdueBarriers: overdueBarriers.length,
    byType,
    byRiskLevel,
    byStatus,
    byOwningRole,
    topBarrierPatients: getTopBarrierPatients(allBarriers),
    generatedAt: now.toISOString(),
  };
}

/**
 * Get patients with most barriers
 */
function getTopBarrierPatients(allBarriers) {
  const patientData = {};
  
  for (const barrier of allBarriers) {
    if (!patientData[barrier.patient_id]) {
      patientData[barrier.patient_id] = {
        patientId: barrier.patient_id,
        patientName: `${barrier.first_name} ${barrier.last_name}`,
        mrn: barrier.mrn,
        barrierCount: 0,
        highRiskCount: 0,
        barriers: [],
      };
    }
    
    patientData[barrier.patient_id].barrierCount++;
    if (barrier.risk_level === 'high') {
      patientData[barrier.patient_id].highRiskCount++;
    }
    patientData[barrier.patient_id].barriers.push({
      type: barrier.barrier_type,
      typeLabel: BARRIER_TYPES[barrier.barrier_type]?.label || barrier.barrier_type,
      status: barrier.status,
      riskLevel: barrier.risk_level,
    });
  }
  
  // Sort by high risk count, then barrier count
  return Object.values(patientData)
    .sort((a, b) => {
      if (b.highRiskCount !== a.highRiskCount) {
        return b.highRiskCount - a.highRiskCount;
      }
      return b.barrierCount - a.barrierCount;
    })
    .slice(0, 10);
}

/**
 * Get audit history for barriers (for compliance views)
 */
function getBarrierAuditHistory(patientId = null, startDate = null, endDate = null) {
  const db = getDatabase();
  
  let query = `
    SELECT al.* 
    FROM audit_logs al
    WHERE al.entity_type = 'ReadinessBarrier'
  `;
  
  const params = [];
  
  if (patientId) {
    // Filter by patient - need to check details JSON
    query += ` AND al.details LIKE ?`;
    params.push(`%"patient_id":"${patientId}"%`);
  }
  
  if (startDate) {
    query += ` AND al.created_date >= ?`;
    params.push(startDate);
  }
  
  if (endDate) {
    query += ` AND al.created_date <= ?`;
    params.push(endDate);
  }
  
  query += ' ORDER BY al.created_date DESC LIMIT 500';
  
  return db.prepare(query).all(...params);
}

module.exports = {
  // Constants
  BARRIER_TYPES,
  BARRIER_STATUS,
  BARRIER_RISK_LEVEL,
  OWNING_ROLES,
  
  // CRUD operations
  createBarrier,
  getBarrierById,
  getBarriersByPatientId,
  getAllOpenBarriers,
  updateBarrier,
  deleteBarrier,
  
  // Summaries and dashboards
  getPatientBarrierSummary,
  getBarriersDashboard,
  
  // Audit
  getBarrierAuditHistory,
};
