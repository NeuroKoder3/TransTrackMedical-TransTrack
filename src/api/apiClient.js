/**
 * TransTrack - API Client
 * 
 * Re-exports the local client for use throughout the application.
 */

import { localClient } from './localClient';

// Export local client as 'api' 
export const api = localClient;

// Default export
export default localClient;
