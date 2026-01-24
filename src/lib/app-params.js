/**
 * TransTrack - Application Parameters
 * 
 * Configuration for the offline desktop application.
 * No longer requires external cloud parameters.
 */

// Application configuration for offline mode
export const appParams = {
  appId: 'transtrack-local',
  appName: 'TransTrack',
  version: '1.0.0',
  isOffline: true,
  compliance: ['HIPAA', 'FDA 21 CFR Part 11', 'AATB'],
};

// Check if running in Electron
export const isElectron = typeof window !== 'undefined' && window.electronAPI;

// Get app info from Electron if available
export const getAppInfo = async () => {
  if (isElectron) {
    try {
      return await window.electronAPI.getAppInfo();
    } catch (e) {
      return appParams;
    }
  }
  return appParams;
};
