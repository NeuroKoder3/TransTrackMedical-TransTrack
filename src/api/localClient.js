/**
 * TransTrack - Local API Client
 * 
 * Provides the API interface using Electron IPC for local database operations.
 */

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI;

// mock client for browser dev — keeps hot-reload working without electron
const mockClient = {
  auth: {
    login: async () => ({ user: { id: '1', email: 'admin@transtrack.local', role: 'admin', full_name: 'Admin' } }),
    loginMfa: async () => ({ user: { id: '1', email: 'admin@transtrack.local', role: 'admin', full_name: 'Admin' } }),
    logout: async () => ({}),
    me: async () => ({ id: '1', email: 'admin@transtrack.local', role: 'admin', full_name: 'Admin' }),
    isAuthenticated: async () => true,
    redirectToLogin: () => console.log('Redirect to login'),
  },
  mfa: {
    status: async () => ({ enrolled: false, backup_codes_remaining: 0 }),
    beginEnrollment: async () => ({ secret_base32: 'JBSWY3DPEHPK3PXP', otpauth_url: 'otpauth://totp/Mock?secret=JBSWY3DPEHPK3PXP', backup_codes: [] }),
    confirmEnrollment: async () => ({ ok: true, backup_codes: ['1111-2222','3333-4444'] }),
    verifyChallenge: async () => ({ ok: true, method: 'totp' }),
    regenerateBackupCodes: async () => ({ backup_codes: ['1111-2222','3333-4444'] }),
    disable: async () => ({ ok: true }),
    isRequired: async () => false,
  },
  organOffers: {
    getStatuses: async () => ({}),
    getDeclineReasons: async () => ({}),
    create: async (data) => ({ id: '1', ...data, status: 'PENDING' }),
    get: async () => null,
    list: async () => [],
    transition: async (params) => ({ id: params.id, status: params.to_status }),
    expireDue: async () => ({ expiredCount: 0, expired: [] }),
    getEvents: async () => [],
  },
  postTx: {
    createEvent: async (data) => ({ id: '1', ...data }),
    updateEvent: async ({ id, fields }) => ({ id, ...fields }),
    listEventsByPatient: async () => [],
    createImmuno: async (data) => ({ id: '1', ...data }),
    listImmunoByPatient: async () => [],
    createRejection: async (data) => ({ id: '1', ...data }),
    listRejectionsByPatient: async () => [],
    createBiopsy: async (data) => ({ id: '1', ...data }),
    listBiopsiesByPatient: async () => [],
    createReadmission: async (data) => ({ id: '1', ...data }),
    listReadmissionsByPatient: async () => [],
    getPatientSummary: async () => ({ transplant_events: [], counts: {} }),
  },
  livingDonor: {
    getStatuses: async () => ({}),
    getMilestones: async () => [6, 12, 24],
    create: async (data) => ({ id: '1', ...data, status: 'INQUIRY' }),
    get: async () => null,
    list: async () => [],
    transition: async (params) => ({ id: params.id, status: params.to_status }),
    addEvalStep: async (data) => ({ id: '1', ...data, status: 'PENDING' }),
    updateEvalStep: async ({ id, ...rest }) => ({ id, ...rest }),
    listEvals: async () => [],
    listFollowups: async () => [],
    updateFollowup: async ({ id, ...rest }) => ({ id, ...rest }),
    markOverdue: async () => ({ overdueCount: 0 }),
    summary: async () => null,
  },
  hl7: {
    parse: async () => ({ message_type: null, supported: false, patient: null, observations: [], orders: [], warnings: [] }),
    buildAck: async () => ({ ack: 'MSH|^~\\&|TT|TT|||...||ACK|...|P|2.5\rMSA|AA|...|' }),
    supportedEvents: async () => ['A01','A03','A04','A08','R01'],
    ingest: async () => ({ ok: true, patient: null, labs: { inserted: 0, skipped: 0, ids: [] }, warnings: [] }),
  },
  integrations: {
    epic: {
      status: async () => ({
        enabled: false,
        reason: 'Local/offline mode - configure VITE_TRANSTRACK_API_URL to enable Epic on FHIR import.',
        modes: [],
      }),
      import: async () => {
        throw new Error(
          'Epic on FHIR import requires server (remote) mode. Set VITE_TRANSTRACK_API_URL or window.transtrackConfig.apiBaseUrl.',
        );
      },
    },
  },
  optn: {
    exportTCR: async () => ({ csv: '', count: 0 }),
    exportTRR: async () => ({ csv: '', count: 0 }),
    exportTRF: async () => ({ csv: '', count: 0 }),
  },
  adminSecurity: {
    lockoutReport: async () => ({ locked: [], elevated: [] }),
    unlockAccount: async () => ({ ok: true }),
  },
  calculators: {
    meld: async () => ({ value: 15, components: {} }),
    meldNa: async () => ({ value: 18, components: {} }),
    meld3: async () => ({ value: 17, components: {} }),
    peld: async () => ({ value: 12, components: {} }),
    las: async () => ({ value: 35, components: {} }),
    kdpi: async () => ({ value: 50, components: {} }),
    epts: async () => ({ value: 40, components: {} }),
    listFormulas: async () => ['MELD','MELD-Na','MELD-3.0','PELD','LAS','KDPI','EPTS'],
  },
  entities: {},
  functions: {
    invoke: async (name, params) => {
      console.log('Mock function invoke:', name, params);
      return { success: true };
    },
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
  risk: {
    getDashboard: async () => ({ riskScore: 0, patients: [], alerts: [] }),
    getFullReport: async () => ({ report: {} }),
    assessPatient: async () => ({ riskLevel: 'low' }),
  },
  outcomes: {
    getDashboard: async () => ({ outcomes: [] }),
    saveSnapshot: async () => ({ success: true }),
  },
  compliance: {
    getSummary: async () => ({ score: 100, items: [] }),
    getValidationReport: async () => ({ valid: true, issues: [] }),
    getDataCompleteness: async () => ({ completeness: 100 }),
    getAuditTrail: async () => [],
  },
  predictions: {
    getDashboard: async () => ({ predictions: [] }),
    runAll: async () => ({ success: true }),
  },
  tasks: {
    getDashboard: async () => ({ total: 0, tasks: [] }),
    getAll: async () => [],
    generateAuto: async () => ({ generated: 0 }),
    processEscalations: async () => ({ processed: 0 }),
    update: async () => ({ success: true }),
  },
  srtr: {
    getDashboard: async () => ({ readiness: {} }),
    saveSnapshot: async () => ({ success: true }),
  },
  recovery: {
    getStatus: async () => ({ healthy: true }),
    listBackups: async () => [],
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
      // Returns either { user, mustChangePassword, mfaEnrollmentRequired }
      // OR { mfa_required: true, challenge_token } when the account has TOTP
      // enrolled. Callers must handle both shapes.
      login: async (credentials) => {
        const result = await api.auth.login(credentials);
        if (result?.mfa_required) {
          return {
            mfa_required: true,
            challenge_token: result.challenge_token,
          };
        }
        return {
          user: result.user,
          mustChangePassword: !!result.mustChangePassword,
          mfaEnrollmentRequired: !!result.mfaEnrollmentRequired,
        };
      },
      loginMfa: async ({ challenge_token, code }) => {
        const result = await api.auth.loginMfa({ challenge_token, code });
        return {
          user: result.user,
          mustChangePassword: !!result.mustChangePassword,
        };
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
        window.location.hash = '#/login';
      },
      register: async (userData) => {
        return await api.auth.register(userData);
      },
      changePassword: async (data) => {
        return await api.auth.changePassword(data);
      },
    },
    mfa: {
      status: () => api.mfa.status(),
      beginEnrollment: () => api.mfa.beginEnrollment(),
      confirmEnrollment: (params) => api.mfa.confirmEnrollment(params),
      verifyChallenge: (params) => api.mfa.verifyChallenge(params),
      regenerateBackupCodes: () => api.mfa.regenerateBackupCodes(),
      disable: (params) => api.mfa.disable(params),
      isRequired: (userId) => api.mfa.isRequired(userId),
    },
    organOffers: {
      getStatuses: () => api.organOffers.getStatuses(),
      getDeclineReasons: () => api.organOffers.getDeclineReasons(),
      create: (data) => api.organOffers.create(data),
      get: (id) => api.organOffers.get(id),
      list: (filters) => api.organOffers.list(filters),
      transition: (params) => api.organOffers.transition(params),
      expireDue: () => api.organOffers.expireDue(),
      getEvents: (offerId) => api.organOffers.getEvents(offerId),
    },
    postTx: {
      createEvent: (data) => api.postTx.createEvent(data),
      updateEvent: (params) => api.postTx.updateEvent(params),
      listEventsByPatient: (patientId) => api.postTx.listEventsByPatient(patientId),
      createImmuno: (data) => api.postTx.createImmuno(data),
      listImmunoByPatient: (patientId) => api.postTx.listImmunoByPatient(patientId),
      createRejection: (data) => api.postTx.createRejection(data),
      listRejectionsByPatient: (patientId) => api.postTx.listRejectionsByPatient(patientId),
      createBiopsy: (data) => api.postTx.createBiopsy(data),
      listBiopsiesByPatient: (patientId) => api.postTx.listBiopsiesByPatient(patientId),
      createReadmission: (data) => api.postTx.createReadmission(data),
      listReadmissionsByPatient: (patientId) => api.postTx.listReadmissionsByPatient(patientId),
      getPatientSummary: (patientId) => api.postTx.getPatientSummary(patientId),
    },
    livingDonor: {
      getStatuses: () => api.livingDonor.getStatuses(),
      getMilestones: () => api.livingDonor.getMilestones(),
      create: (data) => api.livingDonor.create(data),
      get: (id) => api.livingDonor.get(id),
      list: (filters) => api.livingDonor.list(filters),
      transition: (params) => api.livingDonor.transition(params),
      addEvalStep: (data) => api.livingDonor.addEvalStep(data),
      updateEvalStep: (data) => api.livingDonor.updateEvalStep(data),
      listEvals: (livingDonorId) => api.livingDonor.listEvals(livingDonorId),
      listFollowups: (livingDonorId) => api.livingDonor.listFollowups(livingDonorId),
      updateFollowup: (data) => api.livingDonor.updateFollowup(data),
      markOverdue: () => api.livingDonor.markOverdue(),
      summary: (donorId) => api.livingDonor.summary(donorId),
    },
    hl7: {
      parse: (raw) => api.hl7.parse(raw),
      buildAck: (params) => api.hl7.buildAck(params),
      supportedEvents: () => api.hl7.supportedEvents(),
      ingest: (params) => api.hl7.ingest(params),
    },
    optn: {
      exportTCR: (params) => api.optn.exportTCR(params),
      exportTRR: (params) => api.optn.exportTRR(params),
      exportTRF: () => api.optn.exportTRF(),
    },
    adminSecurity: {
      lockoutReport: () => api.adminSecurity.lockoutReport(),
      unlockAccount: (email) => api.adminSecurity.unlockAccount(email),
    },
    calculators: {
      meld: (inputs) => api.calculators.meld(inputs),
      meldNa: (inputs) => api.calculators.meldNa(inputs),
      meld3: (inputs) => api.calculators.meld3(inputs),
      peld: (inputs) => api.calculators.peld(inputs),
      las: (inputs) => api.calculators.las(inputs),
      kdpi: (inputs) => api.calculators.kdpi(inputs),
      epts: (inputs) => api.calculators.epts(inputs),
      listFormulas: () => api.calculators.listFormulas(),
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
        const result = await api.functions.invoke(functionName, params);
        if (result && result.data !== undefined) return result;
        return { data: result };
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
    // Risk Intelligence
    risk: {
      getDashboard: async () => await window.electronAPI.risk.getDashboard(),
      getFullReport: async () => await window.electronAPI.risk.getFullReport(),
      assessPatient: async (patientId) => await window.electronAPI.risk.assessPatient(patientId),
    },
    // Outcomes Dashboard
    outcomes: {
      getDashboard: async () => await window.electronAPI.outcomes.getDashboard(),
      saveSnapshot: async (data) => await window.electronAPI.outcomes.saveSnapshot(data),
    },
    // Compliance Center
    compliance: {
      getSummary: async () => await window.electronAPI.compliance.getSummary(),
      getValidationReport: async () => await window.electronAPI.compliance.getValidationReport(),
      getDataCompleteness: async () => await window.electronAPI.compliance.getDataCompleteness(),
      getAuditTrail: async (filters) => await window.electronAPI.compliance.getAuditTrail(filters),
    },
    // Predictive Risk
    predictions: {
      getDashboard: async () => await window.electronAPI.predictions.getDashboard(),
      runAll: async () => await window.electronAPI.predictions.runAll(),
    },
    // Task Center
    tasks: {
      getDashboard: async () => await window.electronAPI.tasks.getDashboard(),
      getAll: async (filters) => await window.electronAPI.tasks.getAll(filters),
      generateAuto: async () => await window.electronAPI.tasks.generateAuto(),
      processEscalations: async () => await window.electronAPI.tasks.processEscalations(),
      update: async (taskId, updates) => await window.electronAPI.tasks.update(taskId, updates),
    },
    // CMS/SRTR Readiness
    srtr: {
      getDashboard: async () => await window.electronAPI.srtr.getDashboard(),
      saveSnapshot: async () => await window.electronAPI.srtr.saveSnapshot(),
    },
    // Disaster Recovery
    recovery: {
      getStatus: async () => await window.electronAPI.recovery.getStatus(),
      listBackups: async () => await window.electronAPI.recovery.listBackups(),
    },
    // aHHQ (extends mock's ahhq with direct calls)
    ahhq: {
      ...(() => {
        const base = {};
        const ahhqApi = window.electronAPI.ahhq;
        if (ahhqApi) {
          for (const key of Object.keys(ahhqApi)) {
            base[key] = async (...args) => await ahhqApi[key](...args);
          }
        }
        return base;
      })(),
    },
  };
};

// Export the appropriate client
export const localClient = isElectron ? createElectronClient() : mockClient;

// Default export for compatibility
export default localClient;
