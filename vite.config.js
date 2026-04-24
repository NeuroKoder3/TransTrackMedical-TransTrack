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
    },
  },
});
