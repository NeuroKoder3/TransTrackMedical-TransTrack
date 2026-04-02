/**
 * TransTrack - Enhanced Access Control with Audit Justification
 * 
 * Implements role-based access control (RBAC) with required
 * justification for sensitive data access.
 */

const { getDatabase } = require('../database/init.cjs');
const { v4: uuidv4 } = require('uuid');

// Permission definitions
const PERMISSIONS = {
  // Patient permissions
  PATIENT_VIEW: 'patient:view',
  PATIENT_VIEW_PHI: 'patient:view_phi',
  PATIENT_CREATE: 'patient:create',
  PATIENT_UPDATE: 'patient:update',
  PATIENT_DELETE: 'patient:delete',
  
  // Donor permissions
  DONOR_VIEW: 'donor:view',
  DONOR_CREATE: 'donor:create',
  DONOR_UPDATE: 'donor:update',
  DONOR_DELETE: 'donor:delete',
  
  // Match permissions
  MATCH_VIEW: 'match:view',
  MATCH_CREATE: 'match:create',
  MATCH_UPDATE: 'match:update',
  MATCH_APPROVE: 'match:approve',
  
  // Admin permissions
  USER_MANAGE: 'user:manage',
  SETTINGS_MANAGE: 'settings:manage',
  AUDIT_VIEW: 'audit:view',
  AUDIT_EXPORT: 'audit:export',
  REPORT_GENERATE: 'report:generate',
  REPORT_EXPORT: 'report:export',
  
  // Compliance permissions
  COMPLIANCE_VIEW: 'compliance:view',
  COMPLIANCE_REGULATOR: 'compliance:regulator',
  
  // Risk permissions
  RISK_VIEW: 'risk:view',
  RISK_CONFIGURE: 'risk:configure',
  
  // System permissions
  SYSTEM_BACKUP: 'system:backup',
  SYSTEM_RESTORE: 'system:restore',
  SYSTEM_CONFIGURE: 'system:configure',
};

// Role definitions with permissions
const ROLES = {
  admin: {
    name: 'Administrator',
    description: 'Full system access',
    permissions: Object.values(PERMISSIONS),
  },
  coordinator: {
    name: 'Transplant Coordinator',
    description: 'Manage patients and matches',
    permissions: [
      PERMISSIONS.PATIENT_VIEW,
      PERMISSIONS.PATIENT_VIEW_PHI,
      PERMISSIONS.PATIENT_CREATE,
      PERMISSIONS.PATIENT_UPDATE,
      PERMISSIONS.DONOR_VIEW,
      PERMISSIONS.DONOR_CREATE,
      PERMISSIONS.DONOR_UPDATE,
      PERMISSIONS.MATCH_VIEW,
      PERMISSIONS.MATCH_CREATE,
      PERMISSIONS.MATCH_UPDATE,
      PERMISSIONS.REPORT_GENERATE,
      PERMISSIONS.RISK_VIEW,
    ],
  },
  physician: {
    name: 'Physician',
    description: 'View and approve matches',
    permissions: [
      PERMISSIONS.PATIENT_VIEW,
      PERMISSIONS.PATIENT_VIEW_PHI,
      PERMISSIONS.PATIENT_UPDATE,
      PERMISSIONS.DONOR_VIEW,
      PERMISSIONS.MATCH_VIEW,
      PERMISSIONS.MATCH_APPROVE,
      PERMISSIONS.REPORT_GENERATE,
      PERMISSIONS.RISK_VIEW,
    ],
  },
  user: {
    name: 'Standard User',
    description: 'Basic access',
    permissions: [
      PERMISSIONS.PATIENT_VIEW,
      PERMISSIONS.PATIENT_CREATE,
      PERMISSIONS.PATIENT_UPDATE,
      PERMISSIONS.DONOR_VIEW,
      PERMISSIONS.MATCH_VIEW,
    ],
  },
  viewer: {
    name: 'Viewer',
    description: 'Read-only access',
    permissions: [
      PERMISSIONS.PATIENT_VIEW,
      PERMISSIONS.DONOR_VIEW,
      PERMISSIONS.MATCH_VIEW,
    ],
  },
  regulator: {
    name: 'Regulator/Auditor',
    description: 'Read-only compliance access',
    permissions: [
      PERMISSIONS.PATIENT_VIEW,
      PERMISSIONS.DONOR_VIEW,
      PERMISSIONS.MATCH_VIEW,
      PERMISSIONS.AUDIT_VIEW,
      PERMISSIONS.COMPLIANCE_VIEW,
      PERMISSIONS.COMPLIANCE_REGULATOR,
      PERMISSIONS.REPORT_GENERATE,
    ],
  },
};

// Sensitive operations requiring justification
const JUSTIFICATION_REQUIRED = [
  PERMISSIONS.PATIENT_VIEW_PHI,
  PERMISSIONS.PATIENT_DELETE,
  PERMISSIONS.DONOR_DELETE,
  PERMISSIONS.MATCH_APPROVE,
  PERMISSIONS.AUDIT_EXPORT,
  PERMISSIONS.REPORT_EXPORT,
  PERMISSIONS.SYSTEM_RESTORE,
];

// Predefined justification reasons
const JUSTIFICATION_REASONS = [
  { id: 'treatment', label: 'Direct patient treatment' },
  { id: 'care_coordination', label: 'Care coordination' },
  { id: 'quality_review', label: 'Quality assurance review' },
  { id: 'audit_request', label: 'Audit or compliance request' },
  { id: 'legal_request', label: 'Legal or regulatory request' },
  { id: 'emergency', label: 'Emergency access' },
  { id: 'other', label: 'Other (specify)' },
];

/**
 * Check if user has permission
 */
function hasPermission(userRole, permission) {
  const role = ROLES[userRole];
  if (!role) return false;
  return role.permissions.includes(permission);
}

/**
 * Check if permission requires justification
 */
function requiresJustification(permission) {
  return JUSTIFICATION_REQUIRED.includes(permission);
}

/**
 * Log access with justification
 */
function logAccessWithJustification(db, userId, userEmail, userRole, permission, entityType, entityId, justification) {
  const id = uuidv4();
  const orgId = db.prepare('SELECT org_id FROM users WHERE id = ?').get(userId)?.org_id || 'SYSTEM';
  
  db.prepare(`
    INSERT INTO access_justification_logs (
      id, org_id, user_id, user_email, user_role, permission, entity_type, entity_id,
      justification_reason, justification_details, access_time
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    id, orgId, userId, userEmail, userRole, permission, entityType, entityId,
    justification.reason, justification.details || null
  );
  
  return id;
}

/**
 * Validate access request
 */
function validateAccessRequest(userRole, permission, justification = null) {
  // Check permission
  if (!hasPermission(userRole, permission)) {
    return {
      allowed: false,
      reason: 'Permission denied',
    };
  }
  
  // Check justification if required
  if (requiresJustification(permission)) {
    if (!justification || !justification.reason) {
      return {
        allowed: false,
        reason: 'Justification required for this action',
        requiresJustification: true,
        justificationReasons: JUSTIFICATION_REASONS,
      };
    }
    
    // Validate justification reason
    const validReason = JUSTIFICATION_REASONS.find(r => r.id === justification.reason);
    if (!validReason) {
      return {
        allowed: false,
        reason: 'Invalid justification reason',
      };
    }
    
    // "Other" requires details
    if (justification.reason === 'other' && !justification.details) {
      return {
        allowed: false,
        reason: 'Details required for "Other" justification',
      };
    }
  }
  
  return {
    allowed: true,
    justificationLogged: requiresJustification(permission),
  };
}

/**
 * Get role permissions
 */
function getRolePermissions(role) {
  return ROLES[role] || null;
}

/**
 * Get all roles
 */
function getAllRoles() {
  return Object.entries(ROLES).map(([id, role]) => ({
    id,
    ...role,
    permissionCount: role.permissions.length,
  }));
}

module.exports = {
  PERMISSIONS,
  ROLES,
  JUSTIFICATION_REQUIRED,
  JUSTIFICATION_REASONS,
  hasPermission,
  requiresJustification,
  logAccessWithJustification,
  validateAccessRequest,
  getRolePermissions,
  getAllRoles,
};
