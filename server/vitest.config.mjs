import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.mjs'],
    environment: 'node',
    testTimeout: 10000,
  },
});
