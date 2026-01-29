/**
 * TransTrack - Local API Client
 * 
 * Provides the API interface using Electron IPC for local database operations.
 */

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI;
console.log('LocalClient: isElectron =', isElectron, 'electronAPI =', !!window?.electronAPI);

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
      getTypes: async () => await api.barriers.getTypes(),
      getStatuses: async () => await api.barriers.getStatuses(),
      getRiskLevels: async () => await api.barriers.getRiskLevels(),
      getOwningRoles: async () => await api.barriers.getOwningRoles(),
      create: async (data) => await api.barriers.create(data),
      update: async (id, data) => await api.barriers.update(id, data),
      resolve: async (id) => await api.barriers.resolve(id),
      delete: async (id) => await api.barriers.delete(id),
      getByPatient: async (patientId, includeResolved = false) => 
        await api.barriers.getByPatient(patientId, includeResolved),
      getPatientSummary: async (patientId) => await api.barriers.getPatientSummary(patientId),
      getAllOpen: async () => await api.barriers.getAllOpen(),
      getDashboard: async () => await api.barriers.getDashboard(),
      getAuditHistory: async (patientId, startDate, endDate) => 
        await api.barriers.getAuditHistory(patientId, startDate, endDate),
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
  };
};

// Export the appropriate client
export const localClient = isElectron ? createElectronClient() : mockClient;

// Default export for compatibility
export default localClient;
