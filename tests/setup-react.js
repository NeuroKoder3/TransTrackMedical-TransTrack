/**
 * Vitest setup file for React component tests.
 * Adds jest-dom matchers and mocks browser / Electron APIs.
 */
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Mock window.electronAPI so components that reference it don't crash
// ---------------------------------------------------------------------------
window.electronAPI = {
  auth: {
    login: vi.fn(),
    logout: vi.fn(),
    isAuthenticated: vi.fn().mockResolvedValue(false),
    me: vi.fn(),
  },
  license: {
    getInfo: vi.fn().mockResolvedValue({
      buildVersion: 'enterprise',
      isLicensed: true,
      isEvaluation: false,
      tier: 'enterprise',
      tierName: 'Enterprise',
    }),
    isValid: vi.fn().mockResolvedValue(true),
    activate: vi.fn(),
    getOrganization: vi.fn().mockResolvedValue({ id: 'ORG-TEST', name: 'Test Org' }),
  },
  functions: {
    invoke: vi.fn(),
  },
  entities: {
    Patient: { list: vi.fn().mockResolvedValue([]) },
  },
};

// Silence CSS parse warnings that jsdom can't handle
const originalError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('Not implemented: HTMLCanvasElement.prototype.getContext')) {
    return;
  }
  originalError(...args);
};
