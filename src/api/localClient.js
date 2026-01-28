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
};

// Create entity proxy for mock client
const entityNames = [
  'Patient', 'DonorOrgan', 'Match', 'Notification', 'NotificationRule',
  'PriorityWeights', 'EHRIntegration', 'EHRImport', 'EHRSyncLog',
  'EHRValidationRule', 'AuditLog', 'User'
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
