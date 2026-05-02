import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-tabs'],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup-react.js'],
    include: ['tests/components/**/*.test.{js,jsx}'],
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/components/ui/**',
        'src/main.jsx',
        // IPC-bound integration pages — exercised by the Playwright e2e job
        // rather than by JSDom component tests.
        'src/pages/AccountSecurity.jsx',
        'src/pages/OrganOffers.jsx',
        'src/pages/PostTransplant.jsx',
        'src/pages/LivingDonors.jsx',
        'src/pages/Hl7Inbox.jsx',
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
