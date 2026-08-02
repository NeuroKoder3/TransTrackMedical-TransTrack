import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const vendorModules = ['react', 'react-dom', 'react-router-dom'];
          const uiModules = [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-tabs',
          ];

          if (vendorModules.some((m) => id.includes(`/node_modules/${m}/`))) {
            return 'vendor';
          }
          if (uiModules.some((m) => id.includes(`/node_modules/${m}/`))) {
            return 'ui';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin proxy so Electron CSP (default-src 'self') never blocks
    // login/API calls to :8080. Renderer uses http://localhost:5173/__api/...
    proxy: {
      '/__api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/__api/, ''),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup-react.js'],
    include: ['tests/components/**/*.test.{js,jsx}'],
    css: true,
    // Keep component tests on the offline desktop client. Remote API mode
    // is opt-in via VITE_TRANSTRACK_API_URL / window.transtrackConfig.
    env: {
      VITE_TRANSTRACK_API_URL: '',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{js,jsx}'],
      // Only two exclusions remain, and neither hides application logic:
      //
      //   • src/components/ui/** are unmodified shadcn/ui primitives (button,
      //     dialog, input, …). They are vendored presentation wrappers around
      //     Radix with no TransTrack behaviour in them; the components that use
      //     them are measured, so a break in a primitive shows up there.
      //   • src/main.jsx is the four-line ReactDOM.createRoot bootstrap. It has
      //     no branches, and tests/buildEntryIntegrity.test.mjs pins the Vite
      //     entry point it wires up.
      //
      // The five IPC-bound PHI pages (AccountSecurity, OrganOffers,
      // PostTransplant, LivingDonors, Hl7Inbox) used to be excluded here on the
      // grounds that the Playwright job covered them (finding H-8). It does not:
      // the e2e specs never navigate to any of them. They are now measured and
      // covered by tests/components/.
      exclude: [
        'src/components/ui/**',
        'src/main.jsx',
      ],
      // Per-file coverage gates for PHI-touching screens. These five
      // components ingest patient, donor, lab, AHHQ, or barrier data
      // and therefore are the most regression-sensitive UI paths.
      // The 60% lines threshold is the production-readiness bar
      // captured in the project evaluation report (see commit log).
      thresholds: {
        'src/components/patients/PatientForm.jsx':       { lines: 60, statements: 60, branches: 60, functions: 35 },
        'src/components/donor/DonorForm.jsx':            { lines: 60, statements: 60, branches: 60, functions: 50 },
        'src/components/barriers/ReadinessBarrierForm.jsx': { lines: 60, statements: 60, branches: 60, functions: 60 },
        'src/components/labs/LabForm.jsx':               { lines: 60, statements: 60, branches: 60, functions: 60 },
        'src/components/ahhq/AHHQForm.jsx':              { lines: 60, statements: 60, branches: 60, functions: 60 },
      },
    },
  },
});
