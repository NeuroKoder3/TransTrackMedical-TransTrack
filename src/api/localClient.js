/**
 * TransTrack - Local API Client
 * 
 * Provides the API interface using Electron IPC for local database operations.
 */

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI;

// Create a mock client for development in browser
const mockClient = {
  auth: {
    login: async () => ({ user: { id: '1', email: 'admin@transtrack.local', role: 'admin', full_name: 'Admin' } }),
    logout: async () => ({}),
    me: async () => ({ id: '1', email: 'admin@transtrack.local', role: 'admin', full_name: 'Admin' }),
    isAuthenticated: async () => true,
    redirectToLogin: () => console.log('Redirect to login'),
  },
  entities: {},
  functions: {
    invoke: async (name, params) => {
      console.log('Mock function invoke:', name, params);
      return { success: true };
    },
  },
  // Mock license client for development
  license: {
    getInfo: async () => ({
      buildVersion: 'enterprise',
      isLicensed: false,
      isEvaluation: true,
      tier: 'evaluation',
      tierName: 'Evaluation',
      evaluationDaysRemaining: 14,
      evaluationExpired: false,
      evaluationInGracePeriod: false,
      orgId: 'ORG-DEV12345',
      orgName: 'Development Organization',
      limits: { maxPatients: 50, maxDonors: 5, maxUsers: 1 },
      features: [],
      canActivate: true,
      upgradeRequired: true,
    }),
    activate: async (key, info) => ({ success: true, tier: 'starter' }),
    renewMaintenance: async () => ({ success: true }),
    isValid: async () => true,
    getTier: async () => 'evaluation',
    getLimits: async () => ({ maxPatients: 50, maxDonors: 5, maxUsers: 1 }),
    checkFeature: async (feature) => ({ allowed: true }),
    checkLimit: async (limitType, count) => ({ allowed: true }),
    getAllFeatures: async () => [],
    checkFullAccess: async () => ({ allowed: true }),
    getAppState: async () => ({ usable: true }),
    isEvaluationBuild: async () => false,
    getEvaluationStatus: async () => ({ isEvaluation: true, daysRemaining: 14, expired: false, inGracePeriod: false }),
    getOrganization: async () => ({ id: 'ORG-DEV12345', name: 'Development Organization', createdAt: new Date().toISOString() }),
    updateOrganization: async (updates) => updates,
    getMaintenanceStatus: async () => ({ active: true, expired: false, daysRemaining: 365 }),
    getPaymentOptions: async () => ({
      tiers: [
        { tier: 'starter', tierName: 'Starter', price: 2499, currency: 'USD' },
        { tier: 'professional', tierName: 'Professional', price: 7499, currency: 'USD' },
        { tier: 'enterprise', tierName: 'Enterprise', price: 24999, currency: 'USD' },
      ],
      paypalEmail: 'lilnicole0383@gmail.com',
      contactEmail: 'Trans_Track@outlook.com',
    }),
    getPaymentInfo: async (tier) => ({
      tier,
      tierName: tier.charAt(0).toUpperCase() + tier.slice(1),
      price: { starter: 2499, professional: 7499, enterprise: 24999 }[tier],
      currency: 'USD',
    }),
    getAuditHistory: async () => [],
  },
  // Mock encryption client for development
  encryption: {
    getStatus: async () => ({
      enabled: true,
      algorithm: 'AES-256-CBC',
      keyDerivation: 'PBKDF2-HMAC-SHA512',
      keyIterations: 256000,
      hmacAlgorithm: 'SHA512',
      pageSize: 4096,
      compliant: true,
      standard: 'HIPAA'
    }),
    verifyIntegrity: async () => ({
      valid: true,
      encrypted: true,
      cipher: { cipher: 'sqlcipher', cipherVersion: '4.5.6' },
      integrityCheck: 'ok'
    }),
    isEnabled: async () => true,
  },
  // Mock aHHQ client for development
  ahhq: {
    getStatuses: async () => ({
      COMPLETE: 'complete',
      INCOMPLETE: 'incomplete',
      PENDING_UPDATE: 'pending_update',
      EXPIRED: 'expired',
    }),
    getIssues: async () => ({
      MISSING_SECTIONS: { value: 'MISSING_SECTIONS', label: 'Missing sections' },
      OUTDATED_INFORMATION: { value: 'OUTDATED_INFORMATION', label: 'Outdated information' },
      FOLLOW_UP_REQUIRED: { value: 'FOLLOW_UP_REQUIRED', label: 'Follow-up required' },
      DOCUMENTATION_PENDING: { value: 'DOCUMENTATION_PENDING', label: 'Documentation pending' },
    }),
    getOwningRoles: async () => ({
      COORDINATOR: { value: 'coordinator', label: 'Transplant Coordinator' },
      SOCIAL_WORK: { value: 'social_work', label: 'Social Work' },
      CLINICAL: { value: 'clinical', label: 'Clinical Staff' },
      OTHER: { value: 'other', label: 'Other' },
    }),
    create: async (data) => ({ id: Date.now().toString(), ...data }),
    getById: async (id) => null,
    getByPatient: async (patientId) => null,
    getPatientSummary: async (patientId) => ({ exists: false, needsAttention: true, riskLevel: 'high' }),
    getAll: async () => [],
    getExpiring: async () => [],
    getExpired: async () => [],
    getIncomplete: async () => [],
    update: async (id, data) => ({ id, ...data }),
    markComplete: async (id) => ({ id, status: 'complete' }),
    markFollowUpRequired: async (id) => ({ id, status: 'pending_update' }),
    delete: async (id) => ({ success: true }),
    getDashboard: async () => ({
      totalPatients: 0,
      patientsWithAHHQ: 0,
      patientsWithoutAHHQ: 0,
      completeCount: 0,
      incompleteCount: 0,
      expiringCount: 0,
      expiredCount: 0,
      patientsNeedingAttention: 0,
      patientsNeedingAttentionPercentage: '0.0',
      byStatus: {},
      byOwningRole: {},
      warningThresholdDays: 30,
    }),
    getPatientsWithIssues: async () => [],
    getAuditHistory: async () => [],
  },
  barriers: {
    getTypes: async () => ({
      PENDING_TESTING: { value: 'PENDING_TESTING', label: 'Pending testing' },
      INSURANCE_CLEARANCE: { value: 'INSURANCE_CLEARANCE', label: 'Insurance clearance' },
      TRANSPORTATION_PLAN: { value: 'TRANSPORTATION_PLAN', label: 'Transportation plan' },
      CAREGIVER_SUPPORT: { value: 'CAREGIVER_SUPPORT', label: 'Caregiver support' },
      HOUSING_DISTANCE: { value: 'HOUSING_DISTANCE', label: 'Housing/distance' },
      PSYCHOSOCIAL_FOLLOWUP: { value: 'PSYCHOSOCIAL_FOLLOWUP', label: 'Psychosocial follow-up' },
      FINANCIAL_CLEARANCE: { value: 'FINANCIAL_CLEARANCE', label: 'Financial clearance' },
      OTHER_NON_CLINICAL: { value: 'OTHER_NON_CLINICAL', label: 'Other (non-clinical)' },
    }),
    getStatuses: async () => ({
      OPEN: { value: 'open', label: 'Open', color: 'red' },
      IN_PROGRESS: { value: 'in_progress', label: 'In Progress', color: 'yellow' },
      RESOLVED: { value: 'resolved', label: 'Resolved', color: 'green' },
    }),
    getRiskLevels: async () => ({
      LOW: { value: 'low', label: 'Low', color: 'blue' },
      MODERATE: { value: 'moderate', label: 'Moderate', color: 'yellow' },
      HIGH: { value: 'high', label: 'High', color: 'red' },
    }),
    getOwningRoles: async () => ({
      SOCIAL_WORK: { value: 'social_work', label: 'Social Work' },
      FINANCIAL: { value: 'financial', label: 'Financial Services' },
      COORDINATOR: { value: 'coordinator', label: 'Transplant Coordinator' },
      OTHER: { value: 'other', label: 'Other' },
    }),
    create: async (data) => ({ id: Date.now().toString(), ...data }),
    update: async (id, data) => ({ id, ...data }),
    resolve: async (id) => ({ id, status: 'resolved' }),
    delete: async (id) => ({ success: true }),
    getByPatient: async () => [],
    getPatientSummary: async () => ({ totalOpen: 0, byStatus: {}, byRiskLevel: {}, highestRiskLevel: 'none', barriers: [] }),
    getAllOpen: async () => [],
    getDashboard: async () => ({
      totalActivePatients: 0,
      patientsWithBarriers: 0,
      patientsWithBarriersPercentage: '0.0',
      totalOpenBarriers: 0,
      byType: {},
      byRiskLevel: {},
      byStatus: {},
      byOwningRole: {},
      topBarrierPatients: [],
    }),
    getAuditHistory: async () => [],
  },
  // Mock labs client for development (Documentation tracking only - non-clinical)
  labs: {
    getCodes: async () => [
      { code: 'CREAT', name: 'Creatinine', category: 'Kidney' },
      { code: 'BUN', name: 'Blood Urea Nitrogen', category: 'Kidney' },
      { code: 'EGFR', name: 'eGFR', category: 'Kidney' },
      { code: 'K', name: 'Potassium', category: 'Kidney' },
      { code: 'HGB', name: 'Hemoglobin', category: 'CBC' },
      { code: 'INR', name: 'INR', category: 'Liver' },
      { code: 'BILI', name: 'Bilirubin', category: 'Liver' },
    ],
    getSources: async () => ({ MANUAL: 'MANUAL', FHIR_IMPORT: 'FHIR_IMPORT' }),
    create: async (data) => ({ id: Date.now().toString(), ...data, source: 'MANUAL' }),
    get: async (id) => null,
    getByPatient: async () => [],
    getLatestByPatient: async () => ({}),
    update: async (id, data) => ({ id, ...data }),
    delete: async (id) => ({ success: true }),
    getPatientStatus: async () => ({
      patientId: null,
      disclaimer: 'This is OPERATIONAL documentation tracking only.',
      totalRequired: 0,
      documented: 0,
      missing: 0,
      expired: 0,
      current: 0,
      labs: [],
      missingLabs: [],
      expiredLabs: [],
      documentationRiskLevel: 'low',
    }),
    getDashboard: async () => ({
      disclaimer: 'Lab tracking is NON-CLINICAL operational documentation only.',
      totalActivePatients: 0,
      patientsWithMissingLabs: 0,
      patientsWithExpiredLabs: 0,
      patientsWithCurrentLabs: 0,
      totalMissingLabs: 0,
      totalExpiredLabs: 0,
      patientsNeedingAttention: [],
      byTestType: {},
    }),
    getRequiredTypes: async () => [],
  },
  // Mock Transplant Clock client for development
  // The Transplant Clock provides real-time operational awareness
  clock: {
    getData: async () => ({
      timeSinceLastUpdate: { hours: 2.5, lastUpdate: new Date(Date.now() - 2.5 * 60 * 60 * 1000).toISOString() },
      averageResolutionTime: { hours: 6.4, sampleSize: 12 },
      nextExpiration: { days: 2, type: 'aHHQ', date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString() },
      tasks: { open: 12, overdue: 4, barriers: { open: 8, overdue: 2 }, ahhq: { incomplete: 4, expired: 2 } },
      coordinatorLoad: { ratio: 4.0, level: 'moderate', label: 'Moderate', staffCount: 3, taskCount: 12 },
      pulseRate: 1.3,
      pulsePeriod: 769,
      statusColor: 'green',
      thresholds: { GREEN: 24, YELLOW: 72 },
      generatedAt: new Date().toISOString(),
      disclaimer: 'Operational metrics only. Non-clinical, non-allocative.',
    }),
    getTimeSinceLastUpdate: async () => ({ hours: 2.5, lastUpdate: new Date(Date.now() - 2.5 * 60 * 60 * 1000).toISOString() }),
    getAverageResolutionTime: async () => ({ hours: 6.4, sampleSize: 12 }),
    getNextExpiration: async () => ({ days: 2, type: 'aHHQ', date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString() }),
    getTaskCounts: async () => ({ open: 12, overdue: 4, barriers: { open: 8, overdue: 2 }, ahhq: { incomplete: 4, expired: 2 } }),
    getCoordinatorLoad: async () => ({ ratio: 4.0, level: 'moderate', label: 'Moderate', staffCount: 3, taskCount: 12 }),
  },
};

// Create entity proxy for mock client
const entityNames = [
  'Patient', 'DonorOrgan', 'Match', 'Notification', 'NotificationRule',
  'PriorityWeights', 'EHRIntegration', 'EHRImport', 'EHRSyncLog',
  'EHRValidationRule', 'AuditLog', 'User', 'ReadinessBarrier'
];

for (const name of entityNames) {
  mockClient.entities[name] = {
    create: async (data) => ({ id: Date.now().toString(), ...data }),
    get: async (id) => ({ id }),
    update: async (id, data) => ({ id, ...data }),
    delete: async (id) => ({ success: true }),
    list: async () => [],
    filter: async () => [],
  };
}

// Create the Electron-based client
const createElectronClient = () => {
  const api = window.electronAPI;
  
  return {
    auth: {
      login: async (credentials) => {
        const result = await api.auth.login(credentials);
        return result.user;
      },
      logout: async () => {
        await api.auth.logout();
      },
      me: async () => {
        return await api.auth.me();
      },
      isAuthenticated: async () => {
        return await api.auth.isAuthenticated();
      },
      redirectToLogin: () => {
        // In Electron, we navigate to the login page
        window.location.hash = '#/login';
      },
      register: async (userData) => {
        return await api.auth.register(userData);
      },
      changePassword: async (data) => {
        return await api.auth.changePassword(data);
      },
    },
    entities: new Proxy({}, {
      get: (target, entityName) => {
        if (entityName === 'User') {
          return {
            create: async (data) => await api.auth.createUser(data),
            get: async (id) => await api.entities.get(entityName, id),
            update: async (id, data) => await api.auth.updateUser(id, data),
            delete: async (id) => await api.auth.deleteUser(id),
            list: async (orderBy, limit) => await api.auth.listUsers(orderBy, limit),
            filter: async (filters, orderBy, limit) => await api.entities.filter(entityName, filters, orderBy, limit),
          };
        }
        
        // Check if entity exists in preload
        if (api.entities[entityName]) {
          return api.entities[entityName];
        }
        
        // Default entity operations
        return {
          create: async (data) => await api.entities.create(entityName, data),
          get: async (id) => await api.entities.get(entityName, id),
          update: async (id, data) => await api.entities.update(entityName, id, data),
          delete: async (id) => await api.entities.delete(entityName, id),
          list: async (orderBy, limit) => await api.entities.list(entityName, orderBy, limit),
          filter: async (filters, orderBy, limit) => await api.entities.filter(entityName, filters, orderBy, limit),
        };
      }
    }),
    functions: {
      invoke: async (functionName, params) => {
        return await api.functions.invoke(functionName, params);
      },
    },
    // Readiness Barriers (Non-Clinical Operational Tracking)
    // NOTE: This feature is strictly NON-CLINICAL, NON-ALLOCATIVE, and designed for
    // operational workflow visibility only.
    barriers: {
      getTypes: async () => await window.electronAPI.barriers.getTypes(),
      getStatuses: async () => await window.electronAPI.barriers.getStatuses(),
      getRiskLevels: async () => await window.electronAPI.barriers.getRiskLevels(),
      getOwningRoles: async () => await window.electronAPI.barriers.getOwningRoles(),
      create: async (data) => await window.electronAPI.barriers.create(data),
      update: async (id, data) => await window.electronAPI.barriers.update(id, data),
      resolve: async (id) => await window.electronAPI.barriers.resolve(id),
      delete: async (id) => await window.electronAPI.barriers.delete(id),
      getByPatient: async (patientId, includeResolved = false) => 
        await window.electronAPI.barriers.getByPatient(patientId, includeResolved),
      getPatientSummary: async (patientId) => await window.electronAPI.barriers.getPatientSummary(patientId),
      getAllOpen: async () => await window.electronAPI.barriers.getAllOpen(),
      getDashboard: async () => await window.electronAPI.barriers.getDashboard(),
      getAuditHistory: async (patientId, startDate, endDate) => 
        await window.electronAPI.barriers.getAuditHistory(patientId, startDate, endDate),
    },
    // Lab Results (Non-Clinical Documentation Tracking)
    // NOTE: This feature is strictly NON-CLINICAL and NON-ALLOCATIVE.
    // Lab results are stored for DOCUMENTATION COMPLETENESS purposes only.
    // The system does NOT interpret lab values or provide clinical assessments.
    labs: {
      getCodes: async () => await window.electronAPI.labs.getCodes(),
      getSources: async () => await window.electronAPI.labs.getSources(),
      create: async (data) => await window.electronAPI.labs.create(data),
      get: async (id) => await window.electronAPI.labs.get(id),
      getByPatient: async (patientId, options) => 
        await window.electronAPI.labs.getByPatient(patientId, options),
      getLatestByPatient: async (patientId) => 
        await window.electronAPI.labs.getLatestByPatient(patientId),
      update: async (id, data) => await window.electronAPI.labs.update(id, data),
      delete: async (id) => await window.electronAPI.labs.delete(id),
      getPatientStatus: async (patientId) => 
        await window.electronAPI.labs.getPatientStatus(patientId),
      getDashboard: async () => await window.electronAPI.labs.getDashboard(),
      getRequiredTypes: async (organType) => 
        await window.electronAPI.labs.getRequiredTypes(organType),
    },
    // Transplant Clock (Operational Activity Rhythm)
    // Real-time operational awareness for transplant coordination teams.
    // 100% computed locally from the encrypted SQLite database.
    clock: {
      getData: async () => await window.electronAPI.clock.getData(),
      getTimeSinceLastUpdate: async () => await window.electronAPI.clock.getTimeSinceLastUpdate(),
      getAverageResolutionTime: async () => await window.electronAPI.clock.getAverageResolutionTime(),
      getNextExpiration: async () => await window.electronAPI.clock.getNextExpiration(),
      getTaskCounts: async () => await window.electronAPI.clock.getTaskCounts(),
      getCoordinatorLoad: async () => await window.electronAPI.clock.getCoordinatorLoad(),
    },
    // Alias for service role operations (same as regular in local mode)
    asServiceRole: {
      entities: new Proxy({}, {
        get: (target, entityName) => ({
          create: async (data) => await api.entities.create(entityName, data),
          get: async (id) => await api.entities.get(entityName, id),
          update: async (id, data) => await api.entities.update(entityName, id, data),
          delete: async (id) => await api.entities.delete(entityName, id),
          list: async (orderBy, limit) => await api.entities.list(entityName, orderBy, limit),
          filter: async (filters, orderBy, limit) => await api.entities.filter(entityName, filters, orderBy, limit),
        })
      }),
    },
    // File integrations
    integrations: {
      Core: {
        UploadFile: async (file) => {
          // Local file handling - store reference
          return { url: URL.createObjectURL(file), name: file.name };
        },
      },
    },
    // Database Encryption (HIPAA Compliance)
    encryption: {
      getStatus: async () => await window.electronAPI.encryption.getStatus(),
      verifyIntegrity: async () => await window.electronAPI.encryption.verifyIntegrity(),
      isEnabled: async () => await window.electronAPI.encryption.isEnabled(),
    },
  };
};

// Export the appropriate client
export const localClient = isElectron ? createElectronClient() : mockClient;

// Default export for compatibility
export default localClient;
