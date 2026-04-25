import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.mjs'],
    environment: 'node',
    testTimeout: 60000,
  },
});
