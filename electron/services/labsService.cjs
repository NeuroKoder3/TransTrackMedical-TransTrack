/**
 * TransTrack - Lab Results Service
 * 
 * Manages lab result tracking for OPERATIONAL documentation purposes only.
 * 
 * IMPORTANT DISCLAIMER:
 * This feature is strictly NON-CLINICAL and NON-ALLOCATIVE.
 * - Lab results are stored for documentation completeness only
 * - The system does NOT interpret lab values as normal/abnormal
 * - The system does NOT provide clinical recommendations
 * - The system does NOT make allocation-related decisions
 * - Values are stored as strings to prevent any clinical interpretation
 * 
 * The only operational signals this system provides are:
 * - Lab is MISSING (required lab not documented)
 * - Lab is EXPIRED (lab exceeds configured max age)
 * - Lab is STALE (no recent labs recorded)
 * 
 * These are purely administrative/documentation signals, NOT clinical assessments.
 */

const { getDatabase } = require('../database/init.cjs');
const { v4: uuidv4 } = require('uuid');

// =========================================================================
// Constants
// =========================================================================

// Default required labs for operational tracking (test_code -> display info)
// These are common labs tracked for documentation completeness
const DEFAULT_REQUIRED_LABS = {
  // Kidney-relevant labs
  CREAT: { name: 'Creatinine', organs: ['kidney', 'kidney_pancreas'], maxAgeDays: 30 },
  BUN: { name: 'BUN', organs: ['kidney', 'kidney_pancreas'], maxAgeDays: 30 },
  EGFR: { name: 'eGFR', organs: ['kidney', 'kidney_pancreas'], maxAgeDays: 30 },
  K: { name: 'Potassium', organs: ['kidney', 'kidney_pancreas'], maxAgeDays: 30 },
  
  // Liver-relevant labs
  INR: { name: 'INR', organs: ['liver'], maxAgeDays: 30 },
  BILI: { name: 'Bilirubin', organs: ['liver'], maxAgeDays: 30 },
  NA: { name: 'Sodium', organs: ['liver'], maxAgeDays: 30 },
  
  // Cross-organ common labs
  HGB: { name: 'Hemoglobin', organs: null, maxAgeDays: 30 }, // null = all organs
  ABO: { name: 'ABO Confirmation', organs: null, maxAgeDays: 365 },
  
  // Serology (tracked for currency only)
  CMV: { name: 'CMV Status', organs: null, maxAgeDays: 365 },
  EBV: { name: 'EBV Status', organs: null, maxAgeDays: 365 },
};

// Source types for lab data
const LAB_SOURCES = {
  MANUAL: 'MANUAL',
  FHIR_IMPORT: 'FHIR_IMPORT',
};

// =========================================================================
// Lab Result CRUD Operations
// =========================================================================

/**
 * Create a new lab result
 * @param {Object} data - Lab result data
 * @param {string} orgId - Organization ID
 * @param {string} userId - User ID creating the record
 * @param {string} userEmail - User email for audit
 * @returns {Object} Created lab result
 */
function createLabResult(data, orgId, userId, userEmail) {
  const db = getDatabase();
  
  // Validate required fields
  if (!data.patient_id) throw new Error('Patient ID is required');
  if (!data.test_code) throw new Error('Test code is required');
  if (!data.test_name) throw new Error('Test name is required');
  if (!data.value) throw new Error('Value is required');
  if (!data.collected_at) throw new Error('Collection date is required');
  
  // Verify patient belongs to this org
  const patient = db.prepare('SELECT id, first_name, last_name FROM patients WHERE id = ? AND org_id = ?')
    .get(data.patient_id, orgId);
  if (!patient) {
    throw new Error('Patient not found or access denied');
  }
  
  const id = uuidv4();
  const now = new Date().toISOString();
  
  db.prepare(`
    INSERT INTO lab_results (
      id, org_id, patient_id, test_code, test_name, value, units,
      reference_range, collected_at, resulted_at, source, ordering_service,
      entered_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    orgId,
    data.patient_id,
    data.test_code.toUpperCase(),
    data.test_name,
    data.value, // Stored as string
    data.units || null,
    data.reference_range || null,
    data.collected_at,
    data.resulted_at || null,
    data.source || LAB_SOURCES.MANUAL,
    data.ordering_service || null,
    userId,
    now,
    now
  );
  
  // Log audit entry
  logLabAudit('lab_result_created', id, patient, data, userEmail, orgId);
  
  return getLabResultById(id, orgId);
}

/**
 * Get a lab result by ID
 * @param {string} id - Lab result ID
 * @param {string} orgId - Organization ID
 * @returns {Object|null} Lab result or null
 */
function getLabResultById(id, orgId) {
  const db = getDatabase();
  return db.prepare('SELECT * FROM lab_results WHERE id = ? AND org_id = ?').get(id, orgId);
}

/**
 * Get all lab results for a patient
 * @param {string} patientId - Patient ID
 * @param {string} orgId - Organization ID
 * @param {Object} options - Query options
 * @returns {Array} Lab results
 */
function getLabResultsByPatient(patientId, orgId, options = {}) {
  const db = getDatabase();
  
  let query = 'SELECT * FROM lab_results WHERE patient_id = ? AND org_id = ?';
  const params = [patientId, orgId];
  
  // Filter by test code if specified
  if (options.testCode) {
    query += ' AND test_code = ?';
    params.push(options.testCode.toUpperCase());
  }
  
  // Order by collection date descending by default
  query += ' ORDER BY collected_at DESC';
  
  // Limit results
  if (options.limit) {
    query += ' LIMIT ?';
    params.push(options.limit);
  }
  
  return db.prepare(query).all(...params);
}

/**
 * Get the most recent lab result for each test type for a patient
 * @param {string} patientId - Patient ID
 * @param {string} orgId - Organization ID
 * @returns {Object} Map of test_code -> most recent lab result
 */
function getLatestLabsByPatient(patientId, orgId) {
  const db = getDatabase();
  
  // Get all labs for patient, ordered by collection date descending
  const labs = db.prepare(`
    SELECT * FROM lab_results 
    WHERE patient_id = ? AND org_id = ?
    ORDER BY test_code, collected_at DESC
  `).all(patientId, orgId);
  
  // Group by test code and take the most recent
  const latestLabs = {};
  for (const lab of labs) {
    if (!latestLabs[lab.test_code]) {
      latestLabs[lab.test_code] = lab;
    }
  }
  
  return latestLabs;
}

/**
 * Update a lab result
 * @param {string} id - Lab result ID
 * @param {Object} data - Updated data
 * @param {string} orgId - Organization ID
 * @param {string} userId - User ID making the update
 * @param {string} userEmail - User email for audit
 * @returns {Object} Updated lab result
 */
function updateLabResult(id, data, orgId, userId, userEmail) {
  const db = getDatabase();
  
  // Verify lab result exists and belongs to this org
  const existing = getLabResultById(id, orgId);
  if (!existing) {
    throw new Error('Lab result not found or access denied');
  }
  
  // Get patient for audit
  const patient = db.prepare('SELECT id, first_name, last_name FROM patients WHERE id = ?')
    .get(existing.patient_id);
  
  // Only allow updating certain fields (not id, org_id, patient_id, entered_by, created_at)
  const allowedFields = ['test_code', 'test_name', 'value', 'units', 'reference_range', 
                         'collected_at', 'resulted_at', 'ordering_service'];
  
  const updates = [];
  const params = [];
  
  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(field === 'test_code' ? data[field].toUpperCase() : data[field]);
    }
  }
  
  if (updates.length === 0) {
    return existing;
  }
  
  // Add updated_at and updated_by
  updates.push('updated_at = ?', 'updated_by = ?');
  params.push(new Date().toISOString(), userId);
  
  // Add WHERE clause params
  params.push(id, orgId);
  
  db.prepare(`UPDATE lab_results SET ${updates.join(', ')} WHERE id = ? AND org_id = ?`)
    .run(...params);
  
  // Log audit entry
  logLabAudit('lab_result_updated', id, patient, data, userEmail, orgId);
  
  return getLabResultById(id, orgId);
}

/**
 * Delete a lab result
 * @param {string} id - Lab result ID
 * @param {string} orgId - Organization ID
 * @param {string} userEmail - User email for audit
 * @returns {boolean} Success
 */
function deleteLabResult(id, orgId, userEmail) {
  const db = getDatabase();
  
  // Get existing for audit
  const existing = getLabResultById(id, orgId);
  if (!existing) {
    throw new Error('Lab result not found or access denied');
  }
  
  // Get patient for audit
  const patient = db.prepare('SELECT id, first_name, last_name FROM patients WHERE id = ?')
    .get(existing.patient_id);
  
  db.prepare('DELETE FROM lab_results WHERE id = ? AND org_id = ?').run(id, orgId);
  
  // Log audit entry
  logLabAudit('lab_result_deleted', id, patient, existing, userEmail, orgId);
  
  return true;
}

// =========================================================================
// Required Lab Types Configuration
// =========================================================================

/**
 * Get required lab types for an organization
 * @param {string} orgId - Organization ID
 * @param {string} organType - Optional organ type filter
 * @returns {Array} Required lab types
 */
function getRequiredLabTypes(orgId, organType = null) {
  const db = getDatabase();
  
  let query = 'SELECT * FROM required_lab_types WHERE org_id = ? AND is_active = 1';
  const params = [orgId];
  
  if (organType) {
    query += ' AND (organ_type IS NULL OR organ_type = ?)';
    params.push(organType);
  }
  
  query += ' ORDER BY test_name';
  
  const configured = db.prepare(query).all(...params);
  
  // If no configured types, return defaults
  if (configured.length === 0 && organType) {
    return Object.entries(DEFAULT_REQUIRED_LABS)
      .filter(([_, info]) => info.organs === null || info.organs.includes(organType))
      .map(([code, info]) => ({
        test_code: code,
        test_name: info.name,
        organ_type: organType,
        max_age_days: info.maxAgeDays,
        is_active: 1,
      }));
  }
  
  return configured;
}

/**
 * Initialize default required lab types for an organization
 * @param {string} orgId - Organization ID
 * @param {string} userId - User ID creating the records
 */
function initializeDefaultLabTypes(orgId, userId) {
  const db = getDatabase();
  const now = new Date().toISOString();
  
  const insert = db.prepare(`
    INSERT OR IGNORE INTO required_lab_types 
    (id, org_id, test_code, test_name, organ_type, max_age_days, is_active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `);
  
  for (const [code, info] of Object.entries(DEFAULT_REQUIRED_LABS)) {
    // If lab applies to specific organs, create one entry per organ
    if (info.organs) {
      for (const organ of info.organs) {
        insert.run(uuidv4(), orgId, code, info.name, organ, info.maxAgeDays, userId, now, now);
      }
    } else {
      // Lab applies to all organs
      insert.run(uuidv4(), orgId, code, info.name, null, info.maxAgeDays, userId, now, now);
    }
  }
}

// =========================================================================
// Operational Risk Assessment (Non-Clinical)
// =========================================================================

/**
 * Get lab status summary for a patient (operational readiness signals only)
 * 
 * IMPORTANT: This function only returns DOCUMENTATION signals:
 * - Missing labs (required lab not documented)
 * - Expired labs (lab exceeds max age)
 * - Stale labs (no recent labs)
 * 
 * It does NOT interpret lab values or provide clinical assessments.
 * 
 * @param {string} patientId - Patient ID
 * @param {string} orgId - Organization ID
 * @returns {Object} Lab status summary
 */
function getPatientLabStatus(patientId, orgId) {
  const db = getDatabase();
  const now = new Date();
  
  // Get patient to determine organ type
  const patient = db.prepare('SELECT organ_needed FROM patients WHERE id = ? AND org_id = ?')
    .get(patientId, orgId);
  
  if (!patient) {
    return null;
  }
  
  // Get required labs for this organ type
  const requiredLabs = getRequiredLabTypes(orgId, patient.organ_needed);
  
  // Get latest lab for each test type
  const latestLabs = getLatestLabsByPatient(patientId, orgId);
  
  const status = {
    patientId,
    organType: patient.organ_needed,
    assessedAt: now.toISOString(),
    disclaimer: 'This is OPERATIONAL documentation tracking only. It does NOT interpret lab values or provide clinical assessments.',
    
    // Counts
    totalRequired: requiredLabs.length,
    documented: 0,
    missing: 0,
    expired: 0,
    current: 0,
    
    // Details
    labs: [],
    missingLabs: [],
    expiredLabs: [],
    
    // Risk level for operational tracking (NOT clinical risk)
    documentationRiskLevel: 'low',
  };
  
  for (const required of requiredLabs) {
    const latestLab = latestLabs[required.test_code];
    
    if (!latestLab) {
      // Lab is missing
      status.missing++;
      status.missingLabs.push({
        test_code: required.test_code,
        test_name: required.test_name,
        status: 'MISSING',
        message: 'Required lab not documented',
      });
    } else {
      status.documented++;
      
      // Check if lab is expired based on max_age_days
      const collectedDate = new Date(latestLab.collected_at);
      const daysSinceCollection = Math.floor((now - collectedDate) / (1000 * 60 * 60 * 24));
      const maxAgeDays = required.max_age_days || 30;
      
      const labStatus = {
        test_code: required.test_code,
        test_name: required.test_name,
        lab_id: latestLab.id,
        value: latestLab.value,
        units: latestLab.units,
        collected_at: latestLab.collected_at,
        days_since_collection: daysSinceCollection,
        max_age_days: maxAgeDays,
      };
      
      if (daysSinceCollection > maxAgeDays) {
        status.expired++;
        labStatus.status = 'EXPIRED';
        labStatus.message = `Lab is ${daysSinceCollection} days old (max: ${maxAgeDays} days)`;
        status.expiredLabs.push(labStatus);
      } else {
        status.current++;
        labStatus.status = 'CURRENT';
        labStatus.message = null;
      }
      
      status.labs.push(labStatus);
    }
  }
  
  // Calculate documentation risk level (purely operational)
  if (status.missing > 0 || status.expired >= 3) {
    status.documentationRiskLevel = 'high';
  } else if (status.expired > 0) {
    status.documentationRiskLevel = 'medium';
  } else {
    status.documentationRiskLevel = 'low';
  }
  
  return status;
}

/**
 * Get lab dashboard metrics for the organization
 * @param {string} orgId - Organization ID
 * @returns {Object} Dashboard metrics
 */
function getLabsDashboard(orgId) {
  const db = getDatabase();
  const now = new Date();
  
  // Get all active patients
  const patients = db.prepare(`
    SELECT id, first_name, last_name, patient_id as mrn, organ_needed 
    FROM patients 
    WHERE org_id = ? AND waitlist_status = 'active'
  `).all(orgId);
  
  const dashboard = {
    disclaimer: 'Lab tracking is NON-CLINICAL operational documentation only. It tracks lab currency, not clinical interpretation.',
    generatedAt: now.toISOString(),
    totalActivePatients: patients.length,
    patientsWithMissingLabs: 0,
    patientsWithExpiredLabs: 0,
    patientsWithCurrentLabs: 0,
    totalMissingLabs: 0,
    totalExpiredLabs: 0,
    
    // Top patients needing attention
    patientsNeedingAttention: [],
    
    // By test type
    byTestType: {},
  };
  
  for (const patient of patients) {
    const status = getPatientLabStatus(patient.id, orgId);
    
    if (!status) continue;
    
    if (status.missing > 0) {
      dashboard.patientsWithMissingLabs++;
      dashboard.totalMissingLabs += status.missing;
    }
    
    if (status.expired > 0) {
      dashboard.patientsWithExpiredLabs++;
      dashboard.totalExpiredLabs += status.expired;
    }
    
    if (status.missing === 0 && status.expired === 0 && status.current > 0) {
      dashboard.patientsWithCurrentLabs++;
    }
    
    // Track by test type
    for (const lab of [...status.missingLabs, ...status.expiredLabs]) {
      if (!dashboard.byTestType[lab.test_code]) {
        dashboard.byTestType[lab.test_code] = {
          test_code: lab.test_code,
          test_name: lab.test_name,
          missing: 0,
          expired: 0,
        };
      }
      if (lab.status === 'MISSING') {
        dashboard.byTestType[lab.test_code].missing++;
      } else if (lab.status === 'EXPIRED') {
        dashboard.byTestType[lab.test_code].expired++;
      }
    }
    
    // Add to attention list if has issues
    if (status.documentationRiskLevel !== 'low') {
      dashboard.patientsNeedingAttention.push({
        patientId: patient.id,
        patientName: `${patient.first_name} ${patient.last_name}`,
        mrn: patient.mrn,
        missingCount: status.missing,
        expiredCount: status.expired,
        riskLevel: status.documentationRiskLevel,
      });
    }
  }
  
  // Sort by risk level and counts
  dashboard.patientsNeedingAttention.sort((a, b) => {
    if (a.riskLevel !== b.riskLevel) {
      return a.riskLevel === 'high' ? -1 : 1;
    }
    return (b.missingCount + b.expiredCount) - (a.missingCount + a.expiredCount);
  });
  
  // Limit to top 10
  dashboard.patientsNeedingAttention = dashboard.patientsNeedingAttention.slice(0, 10);
  
  // Calculate percentages
  if (patients.length > 0) {
    dashboard.patientsWithMissingLabsPercentage = 
      ((dashboard.patientsWithMissingLabs / patients.length) * 100).toFixed(1);
    dashboard.patientsWithExpiredLabsPercentage = 
      ((dashboard.patientsWithExpiredLabs / patients.length) * 100).toFixed(1);
    dashboard.patientsWithCurrentLabsPercentage = 
      ((dashboard.patientsWithCurrentLabs / patients.length) * 100).toFixed(1);
  } else {
    dashboard.patientsWithMissingLabsPercentage = '0.0';
    dashboard.patientsWithExpiredLabsPercentage = '0.0';
    dashboard.patientsWithCurrentLabsPercentage = '0.0';
  }
  
  return dashboard;
}

// =========================================================================
// Audit Logging
// =========================================================================

/**
 * Log lab-related audit entry
 */
function logLabAudit(action, labId, patient, data, userEmail, orgId) {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  
  const patientName = patient ? `${patient.first_name} ${patient.last_name}` : null;
  const details = `${action.replace(/_/g, ' ')}: ${data.test_name || data.test_code || 'Lab Result'}`;
  
  db.prepare(`
    INSERT INTO audit_logs (id, org_id, action, entity_type, entity_id, patient_name, details, user_email, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, orgId, action, 'LabResult', labId, patientName, details, userEmail, now);
}

// =========================================================================
// Common Lab Test Codes (Reference)
// =========================================================================

const COMMON_LAB_CODES = [
  { code: 'CREAT', name: 'Creatinine', category: 'Kidney' },
  { code: 'BUN', name: 'Blood Urea Nitrogen', category: 'Kidney' },
  { code: 'EGFR', name: 'eGFR (Estimated GFR)', category: 'Kidney' },
  { code: 'K', name: 'Potassium', category: 'Kidney' },
  { code: 'NA', name: 'Sodium', category: 'Electrolytes' },
  { code: 'HGB', name: 'Hemoglobin', category: 'CBC' },
  { code: 'HCT', name: 'Hematocrit', category: 'CBC' },
  { code: 'WBC', name: 'White Blood Cells', category: 'CBC' },
  { code: 'PLT', name: 'Platelets', category: 'CBC' },
  { code: 'INR', name: 'INR', category: 'Liver/Coagulation' },
  { code: 'BILI', name: 'Bilirubin (Total)', category: 'Liver' },
  { code: 'ALT', name: 'ALT (SGPT)', category: 'Liver' },
  { code: 'AST', name: 'AST (SGOT)', category: 'Liver' },
  { code: 'ALB', name: 'Albumin', category: 'Liver' },
  { code: 'ABO', name: 'ABO Blood Type', category: 'Typing' },
  { code: 'PRA', name: 'Panel Reactive Antibodies', category: 'Immunology' },
  { code: 'CPRA', name: 'Calculated PRA', category: 'Immunology' },
  { code: 'CMV', name: 'CMV IgG', category: 'Serology' },
  { code: 'EBV', name: 'EBV IgG', category: 'Serology' },
  { code: 'HIV', name: 'HIV Screen', category: 'Serology' },
  { code: 'HBSAG', name: 'Hepatitis B Surface Antigen', category: 'Serology' },
  { code: 'HBCAB', name: 'Hepatitis B Core Antibody', category: 'Serology' },
  { code: 'HCVAB', name: 'Hepatitis C Antibody', category: 'Serology' },
];

// =========================================================================
// Exports
// =========================================================================

module.exports = {
  // Constants
  LAB_SOURCES,
  DEFAULT_REQUIRED_LABS,
  COMMON_LAB_CODES,
  
  // CRUD Operations
  createLabResult,
  getLabResultById,
  getLabResultsByPatient,
  getLatestLabsByPatient,
  updateLabResult,
  deleteLabResult,
  
  // Required Lab Types
  getRequiredLabTypes,
  initializeDefaultLabTypes,
  
  // Operational Risk Assessment
  getPatientLabStatus,
  getLabsDashboard,
};
