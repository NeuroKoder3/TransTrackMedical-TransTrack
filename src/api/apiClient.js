/**
 * TransTrack - API Client
 * 
 * This file maintains backward compatibility by exporting the local client
 * as 'api' so existing imports don't need to change their variable names.
 * 
 * All api cloud references have been removed for offline operation.
 */

import { localClient } from './localClient';

// Export local client as 'api' for backward compatibility with existing code
export const api = localClient;

// Default export
export default localClient;
