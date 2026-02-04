/**
 * TransTrack - Electron Preload Script
 * 
 * Provides secure bridge between renderer and main process.
 * Follows security best practices for Electron applications.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Secure API exposed to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Application info
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  
  // Authentication
  auth: {
    login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
    logout: () => ipcRenderer.invoke('auth:logout'),
    me: () => ipcRenderer.invoke('auth:me'),
    isAuthenticated: () => ipcRenderer.invoke('auth:isAuthenticated'),
    register: (userData) => ipcRenderer.invoke('auth:register', userData),
    changePassword: (data) => ipcRenderer.invoke('auth:changePassword', data),
    createUser: (userData) => ipcRenderer.invoke('auth:createUser', userData),
    listUsers: () => ipcRenderer.invoke('auth:listUsers'),
    updateUser: (id, userData) => ipcRenderer.invoke('auth:updateUser', id, userData),
    deleteUser: (id) => ipcRenderer.invoke('auth:deleteUser', id)
  },
  
  // Entity CRUD operations
  entities: {
    // Generic entity operations
    create: (entityName, data) => ipcRenderer.invoke('entity:create', entityName, data),
    get: (entityName, id) => ipcRenderer.invoke('entity:get', entityName, id),
    update: (entityName, id, data) => ipcRenderer.invoke('entity:update', entityName, id, data),
    delete: (entityName, id) => ipcRenderer.invoke('entity:delete', entityName, id),
    list: (entityName, orderBy, limit) => ipcRenderer.invoke('entity:list', entityName, orderBy, limit),
    filter: (entityName, filters, orderBy, limit) => ipcRenderer.invoke('entity:filter', entityName, filters, orderBy, limit),
    
    // Specific entity shortcuts
    Patient: {
      create: (data) => ipcRenderer.invoke('entity:create', 'Patient', data),
      get: (id) => ipcRenderer.invoke('entity:get', 'Patient', id),
      update: (id, data) => ipcRenderer.invoke('entity:update', 'Patient', id, data),
      delete: (id) => ipcRenderer.invoke('entity:delete', 'Patient', id),
      list: (orderBy, limit) => ipcRenderer.invoke('entity:list', 'Patient', orderBy, limit),
      filter: (filters, orderBy, limit) => ipcRenderer.invoke('entity:filter', 'Patient', filters, orderBy, limit)
    },
    DonorOrgan: {
      create: (data) => ipcRenderer.invoke('entity:create', 'DonorOrgan', data),
      get: (id) => ipcRenderer.invoke('entity:get', 'DonorOrgan', id),
      update: (id, data) => ipcRenderer.invoke('entity:update', 'DonorOrgan', id, data),
      delete: (id) => ipcRenderer.invoke('entity:delete', 'DonorOrgan', id),
      list: (orderBy, limit) => ipcRenderer.invoke('entity:list', 'DonorOrgan', orderBy, limit),
      filter: (filters, orderBy, limit) => ipcRenderer.invoke('entity:filter', 'DonorOrgan', filters, orderBy, limit)
    },
    Match: {
      create: (data) => ipcRenderer.invoke('entity:create', 'Match', data),
      get: (id) => ipcRenderer.invoke('entity:get', 'Match', id),
      update: (id, data) => ipcRenderer.invoke('entity:update', 'Match', id, data),
      delete: (id) => ipcRenderer.invoke('entity:delete', 'Match', id),
      list: (orderBy, limit) => ipcRenderer.invoke('entity:list', 'Match', orderBy, limit),
      filter: (filters, orderBy, limit) => ipcRenderer.invoke('entity:filter', 'Match', filters, orderBy, limit)
    },
    Notification: {
      create: (data) => ipcRenderer.invoke('entity:create', 'Notification', data),
      get: (id) => ipcRenderer.invoke('entity:get', 'Notification', id),
      update: (id, data) => ipcRenderer.invoke('entity:update', 'Notification', id, data),
      delete: (id) => ipcRenderer.invoke('entity:delete', 'Notification', id),
      list: (orderBy, limit) => ipcRenderer.invoke('entity:list', 'Notification', orderBy, limit),
      filter: (filters, orderBy, limit) => ipcRenderer.invoke('entity:filter', 'Notification', filters, orderBy, limit)
    },
    NotificationRule: {
      create: (data) => ipcRenderer.invoke('entity:create', 'NotificationRule', data),
      get: (id) => ipcRenderer.invoke('entity:get', 'NotificationRule', id),
      update: (id, data) => ipcRenderer.invoke('entity:update', 'NotificationRule', id, data),
      delete: (id) => ipcRenderer.invoke('entity:delete', 'NotificationRule', id),
      list: (orderBy, limit) => ipcRenderer.invoke('entity:list', 'NotificationRule', orderBy, limit),
      filter: (filters, orderBy, limit) => ipcRenderer.invoke('entity:filter', 'NotificationRule', filters, orderBy, limit)
    },
    PriorityWeights: {
      create: (data) => ipcRenderer.invoke('entity:create', 'PriorityWeights', data),
      get: (id) => ipcRenderer.invoke('entity:get', 'PriorityWeights', id),
      update: (id, data) => ipcRenderer.invoke('entity:update', 'PriorityWeights', id, data),
      delete: (id) => ipcRenderer.invoke('entity:delete', 'PriorityWeights', id),
      list: (orderBy, limit) => ipcRenderer.invoke('entity:list', 'PriorityWeights', orderBy, limit),
      filter: (filters, orderBy, limit) => ipcRenderer.invoke('entity:filter', 'PriorityWeights', filters, orderBy, limit)
    },
    EHRIntegration: {
      create: (data) => ipcRenderer.invoke('entity:create', 'EHRIntegration', data),
      get: (id) => ipcRenderer.invoke('entity:get', 'EHRIntegration', id),
      update: (id, data) => ipcRenderer.invoke('entity:update', 'EHRIntegration', id, data),
      delete: (id) => ipcRenderer.invoke('entity:delete', 'EHRIntegration', id),
      list: (orderBy, limit) => ipcRenderer.invoke('entity:list', 'EHRIntegration', orderBy, limit),
      filter: (filters, orderBy, limit) => ipcRenderer.invoke('entity:filter', 'EHRIntegration', filters, orderBy, limit)
    },
    EHRImport: {
      create: (data) => ipcRenderer.invoke('entity:create', 'EHRImport', data),
      get: (id) => ipcRenderer.invoke('entity:get', 'EHRImport', id),
      update: (id, data) => ipcRenderer.invoke('entity:update', 'EHRImport', id, data),
      delete: (id) => ipcRenderer.invoke('entity:delete', 'EHRImport', id),
      list: (orderBy, limit) => ipcRenderer.invoke('entity:list', 'EHRImport', orderBy, limit),
      filter: (filters, orderBy, limit) => ipcRenderer.invoke('entity:filter', 'EHRImport', filters, orderBy, limit)
    },
    EHRSyncLog: {
      create: (data) => ipcRenderer.invoke('entity:create', 'EHRSyncLog', data),
      get: (id) => ipcRenderer.invoke('entity:get', 'EHRSyncLog', id),
      update: (id, data) => ipcRenderer.invoke('entity:update', 'EHRSyncLog', id, data),
      delete: (id) => ipcRenderer.invoke('entity:delete', 'EHRSyncLog', id),
      list: (orderBy, limit) => ipcRenderer.invoke('entity:list', 'EHRSyncLog', orderBy, limit),
      filter: (filters, orderBy, limit) => ipcRenderer.invoke('entity:filter', 'EHRSyncLog', filters, orderBy, limit)
    },
    EHRValidationRule: {
      create: (data) => ipcRenderer.invoke('entity:create', 'EHRValidationRule', data),
      get: (id) => ipcRenderer.invoke('entity:get', 'EHRValidationRule', id),
      update: (id, data) => ipcRenderer.invoke('entity:update', 'EHRValidationRule', id, data),
      delete: (id) => ipcRenderer.invoke('entity:delete', 'EHRValidationRule', id),
      list: (orderBy, limit) => ipcRenderer.invoke('entity:list', 'EHRValidationRule', orderBy, limit),
      filter: (filters, orderBy, limit) => ipcRenderer.invoke('entity:filter', 'EHRValidationRule', filters, orderBy, limit)
    },
    AuditLog: {
      create: (data) => ipcRenderer.invoke('entity:create', 'AuditLog', data),
      get: (id) => ipcRenderer.invoke('entity:get', 'AuditLog', id),
      list: (orderBy, limit) => ipcRenderer.invoke('entity:list', 'AuditLog', orderBy, limit),
      filter: (filters, orderBy, limit) => ipcRenderer.invoke('entity:filter', 'AuditLog', filters, orderBy, limit)
      // Note: AuditLog entries cannot be updated or deleted (HIPAA compliance)
    },
    User: {
      create: (data) => ipcRenderer.invoke('auth:createUser', data),
      get: (id) => ipcRenderer.invoke('entity:get', 'User', id),
      update: (id, data) => ipcRenderer.invoke('auth:updateUser', id, data),
      delete: (id) => ipcRenderer.invoke('auth:deleteUser', id),
      list: (orderBy, limit) => ipcRenderer.invoke('auth:listUsers', orderBy, limit),
      filter: (filters, orderBy, limit) => ipcRenderer.invoke('entity:filter', 'User', filters, orderBy, limit)
    }
  },
  
  // Functions (business logic)
  functions: {
    invoke: (functionName, params) => ipcRenderer.invoke('function:invoke', functionName, params)
  },
  
  // File operations
  files: {
    exportCSV: (data, filename) => ipcRenderer.invoke('file:exportCSV', data, filename),
    exportExcel: (data, filename) => ipcRenderer.invoke('file:exportExcel', data, filename),
    exportPDF: (data, filename) => ipcRenderer.invoke('file:exportPDF', data, filename),
    importFile: (type) => ipcRenderer.invoke('file:import', type),
    backupDatabase: (path) => ipcRenderer.invoke('file:backupDatabase', path),
    restoreDatabase: (path) => ipcRenderer.invoke('file:restoreDatabase', path)
  },
  
  // Settings
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll')
  },
  
  // Database Encryption (HIPAA Compliance)
  encryption: {
    getStatus: () => ipcRenderer.invoke('encryption:getStatus'),
    verifyIntegrity: () => ipcRenderer.invoke('encryption:verifyIntegrity'),
    isEnabled: () => ipcRenderer.invoke('encryption:isEnabled'),
  },
  
  // Organization Management
  organization: {
    getCurrent: () => ipcRenderer.invoke('organization:getCurrent'),
    update: (updates) => ipcRenderer.invoke('organization:update', updates),
  },
  
  // Menu event listeners
  onMenuExport: (callback) => {
    ipcRenderer.on('menu-export', callback);
    return () => ipcRenderer.removeListener('menu-export', callback);
  },
  onMenuImport: (callback) => {
    ipcRenderer.on('menu-import', callback);
    return () => ipcRenderer.removeListener('menu-import', callback);
  },
  onBackupDatabase: (callback) => {
    ipcRenderer.on('backup-database', (event, path) => callback(path));
    return () => ipcRenderer.removeListener('backup-database', callback);
  },
  onViewAuditLogs: (callback) => {
    ipcRenderer.on('view-audit-logs', callback);
    return () => ipcRenderer.removeListener('view-audit-logs', callback);
  },
  
  // License management
  license: {
    // Core license info
    getInfo: () => ipcRenderer.invoke('license:getInfo'),
    activate: (key, customerInfo) => ipcRenderer.invoke('license:activate', key, customerInfo),
    renewMaintenance: (renewalKey, years) => ipcRenderer.invoke('license:renewMaintenance', renewalKey, years),
    isValid: () => ipcRenderer.invoke('license:isValid'),
    getTier: () => ipcRenderer.invoke('license:getTier'),
    getLimits: () => ipcRenderer.invoke('license:getLimits'),
    
    // Feature gating
    checkFeature: (feature) => ipcRenderer.invoke('license:checkFeature', feature),
    checkLimit: (limitType, currentCount) => ipcRenderer.invoke('license:checkLimit', limitType, currentCount),
    getAllFeatures: () => ipcRenderer.invoke('license:getAllFeatures'),
    checkFullAccess: (options) => ipcRenderer.invoke('license:checkFullAccess', options),
    
    // Application state
    getAppState: () => ipcRenderer.invoke('license:getAppState'),
    isEvaluationBuild: () => ipcRenderer.invoke('license:isEvaluationBuild'),
    getEvaluationStatus: () => ipcRenderer.invoke('license:getEvaluationStatus'),
    
    // Organization
    getOrganization: () => ipcRenderer.invoke('license:getOrganization'),
    updateOrganization: (updates) => ipcRenderer.invoke('license:updateOrganization', updates),
    
    // Maintenance
    getMaintenanceStatus: () => ipcRenderer.invoke('license:getMaintenanceStatus'),
    
    // Payment & purchasing
    getPaymentOptions: () => ipcRenderer.invoke('license:getPaymentOptions'),
    getPaymentInfo: (tier) => ipcRenderer.invoke('license:getPaymentInfo', tier),
    
    // Audit
    getAuditHistory: (limit) => ipcRenderer.invoke('license:getAuditHistory', limit),
  },
  
  // Operational Risk Intelligence
  risk: {
    getDashboard: () => ipcRenderer.invoke('risk:getDashboard'),
    getFullReport: () => ipcRenderer.invoke('risk:getFullReport'),
    assessPatient: (patientId) => ipcRenderer.invoke('risk:assessPatient', patientId),
  },
  
  // Readiness Barriers (Non-Clinical Operational Tracking)
  // NOTE: This feature is strictly NON-CLINICAL, NON-ALLOCATIVE, and designed for
  // operational workflow visibility only. It does NOT perform allocation decisions,
  // listing authority functions, or replace UNOS/OPTN systems.
  barriers: {
    getTypes: () => ipcRenderer.invoke('barrier:getTypes'),
    getStatuses: () => ipcRenderer.invoke('barrier:getStatuses'),
    getRiskLevels: () => ipcRenderer.invoke('barrier:getRiskLevels'),
    getOwningRoles: () => ipcRenderer.invoke('barrier:getOwningRoles'),
    create: (data) => ipcRenderer.invoke('barrier:create', data),
    update: (id, data) => ipcRenderer.invoke('barrier:update', id, data),
    resolve: (id) => ipcRenderer.invoke('barrier:resolve', id),
    delete: (id) => ipcRenderer.invoke('barrier:delete', id),
    getByPatient: (patientId, includeResolved) => ipcRenderer.invoke('barrier:getByPatient', patientId, includeResolved),
    getPatientSummary: (patientId) => ipcRenderer.invoke('barrier:getPatientSummary', patientId),
    getAllOpen: () => ipcRenderer.invoke('barrier:getAllOpen'),
    getDashboard: () => ipcRenderer.invoke('barrier:getDashboard'),
    getAuditHistory: (patientId, startDate, endDate) => ipcRenderer.invoke('barrier:getAuditHistory', patientId, startDate, endDate),
  },
  
  // Adult Health History Questionnaire (aHHQ) Tracking
  // NOTE: This feature is strictly NON-CLINICAL, NON-ALLOCATIVE, and designed for
  // OPERATIONAL DOCUMENTATION purposes only. It tracks whether required health history
  // questionnaires are present, complete, and current.
  ahhq: {
    getStatuses: () => ipcRenderer.invoke('ahhq:getStatuses'),
    getIssues: () => ipcRenderer.invoke('ahhq:getIssues'),
    getOwningRoles: () => ipcRenderer.invoke('ahhq:getOwningRoles'),
    create: (data) => ipcRenderer.invoke('ahhq:create', data),
    getById: (id) => ipcRenderer.invoke('ahhq:getById', id),
    getByPatient: (patientId) => ipcRenderer.invoke('ahhq:getByPatient', patientId),
    getPatientSummary: (patientId) => ipcRenderer.invoke('ahhq:getPatientSummary', patientId),
    getAll: (filters) => ipcRenderer.invoke('ahhq:getAll', filters),
    getExpiring: (days) => ipcRenderer.invoke('ahhq:getExpiring', days),
    getExpired: () => ipcRenderer.invoke('ahhq:getExpired'),
    getIncomplete: () => ipcRenderer.invoke('ahhq:getIncomplete'),
    update: (id, data) => ipcRenderer.invoke('ahhq:update', id, data),
    markComplete: (id, completedDate) => ipcRenderer.invoke('ahhq:markComplete', id, completedDate),
    markFollowUpRequired: (id, issues) => ipcRenderer.invoke('ahhq:markFollowUpRequired', id, issues),
    delete: (id) => ipcRenderer.invoke('ahhq:delete', id),
    getDashboard: () => ipcRenderer.invoke('ahhq:getDashboard'),
    getPatientsWithIssues: (limit) => ipcRenderer.invoke('ahhq:getPatientsWithIssues', limit),
    getAuditHistory: (patientId, startDate, endDate) => ipcRenderer.invoke('ahhq:getAuditHistory', patientId, startDate, endDate),
  },
  
  // Lab Results Tracking (Operational Documentation Only)
  // NOTE: This feature is strictly NON-CLINICAL and NON-ALLOCATIVE.
  // Lab results are stored for DOCUMENTATION COMPLETENESS purposes only.
  // The system does NOT interpret lab values, provide clinical recommendations,
  // or make allocation decisions. It only tracks lab currency/completeness.
  labs: {
    // Reference data
    getCodes: () => ipcRenderer.invoke('labs:getCodes'),
    getSources: () => ipcRenderer.invoke('labs:getSources'),
    
    // CRUD operations
    create: (data) => ipcRenderer.invoke('labs:create', data),
    get: (id) => ipcRenderer.invoke('labs:get', id),
    getByPatient: (patientId, options) => ipcRenderer.invoke('labs:getByPatient', patientId, options),
    getLatestByPatient: (patientId) => ipcRenderer.invoke('labs:getLatestByPatient', patientId),
    update: (id, data) => ipcRenderer.invoke('labs:update', id, data),
    delete: (id) => ipcRenderer.invoke('labs:delete', id),
    
    // Operational status (documentation signals only, NOT clinical)
    getPatientStatus: (patientId) => ipcRenderer.invoke('labs:getPatientStatus', patientId),
    getDashboard: () => ipcRenderer.invoke('labs:getDashboard'),
    
    // Configuration
    getRequiredTypes: (organType) => ipcRenderer.invoke('labs:getRequiredTypes', organType),
  },
  
  // Transplant Clock (Operational Activity Rhythm)
  // The Transplant Clock provides real-time operational awareness for transplant
  // coordination teams. It acts as a visual heartbeat of the program.
  // 100% computed locally from the encrypted SQLite database.
  // No cloud, API, or AI inference required.
  clock: {
    getData: () => ipcRenderer.invoke('clock:getData'),
    getTimeSinceLastUpdate: () => ipcRenderer.invoke('clock:getTimeSinceLastUpdate'),
    getAverageResolutionTime: () => ipcRenderer.invoke('clock:getAverageResolutionTime'),
    getNextExpiration: () => ipcRenderer.invoke('clock:getNextExpiration'),
    getTaskCounts: () => ipcRenderer.invoke('clock:getTaskCounts'),
    getCoordinatorLoad: () => ipcRenderer.invoke('clock:getCoordinatorLoad'),
  },
  
  // Access Control with Justification
  accessControl: {
    validateRequest: (permission, justification) => ipcRenderer.invoke('access:validateRequest', permission, justification),
    logJustifiedAccess: (permission, entityType, entityId, justification) => 
      ipcRenderer.invoke('access:logJustifiedAccess', permission, entityType, entityId, justification),
    getRoles: () => ipcRenderer.invoke('access:getRoles'),
    getJustificationReasons: () => ipcRenderer.invoke('access:getJustificationReasons'),
  },
  
  // Disaster Recovery
  recovery: {
    createBackup: (options) => ipcRenderer.invoke('recovery:createBackup', options),
    listBackups: () => ipcRenderer.invoke('recovery:listBackups'),
    verifyBackup: (backupId) => ipcRenderer.invoke('recovery:verifyBackup', backupId),
    restoreBackup: (backupId) => ipcRenderer.invoke('recovery:restoreBackup', backupId),
    getStatus: () => ipcRenderer.invoke('recovery:getStatus'),
  },
  
  // Compliance View
  compliance: {
    getSummary: () => ipcRenderer.invoke('compliance:getSummary'),
    getAuditTrail: (options) => ipcRenderer.invoke('compliance:getAuditTrail', options),
    getDataCompleteness: () => ipcRenderer.invoke('compliance:getDataCompleteness'),
    getValidationReport: () => ipcRenderer.invoke('compliance:getValidationReport'),
    getAccessLogs: (options) => ipcRenderer.invoke('compliance:getAccessLogs', options),
  },
  
  // Offline Reconciliation
  reconciliation: {
    getStatus: () => ipcRenderer.invoke('reconciliation:getStatus'),
    getPendingChanges: () => ipcRenderer.invoke('reconciliation:getPendingChanges'),
    reconcile: (strategy) => ipcRenderer.invoke('reconciliation:reconcile', strategy),
    setMode: (mode) => ipcRenderer.invoke('reconciliation:setMode', mode),
    getMode: () => ipcRenderer.invoke('reconciliation:getMode'),
  },
  
  // Platform info
  platform: process.platform,
  isElectron: true
});
