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
  
  // Platform info
  platform: process.platform,
  isElectron: true
});

// Notify that preload is complete
console.log('TransTrack preload script loaded');
