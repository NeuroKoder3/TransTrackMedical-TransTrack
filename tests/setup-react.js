/**
 * Vitest setup file for React component tests.
 * Adds jest-dom matchers and mocks browser / Electron APIs.
 */
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// jsdom polyfills for browser APIs that Radix UI primitives depend on
// (ResizeObserver, IntersectionObserver, matchMedia, scrollIntoView,
// PointerEvent capture). Without these, Radix Select / Checkbox / Dialog
// throw "ResizeObserver is not defined" inside test runs.
// ---------------------------------------------------------------------------
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class IntersectionObserver {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

if (typeof window !== 'undefined' && !window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = function noop() {};
}

if (typeof window !== 'undefined' && !window.HTMLElement.prototype.hasPointerCapture) {
  window.HTMLElement.prototype.hasPointerCapture = function noop() { return false; };
  window.HTMLElement.prototype.releasePointerCapture = function noop() {};
  window.HTMLElement.prototype.setPointerCapture = function noop() {};
}

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
