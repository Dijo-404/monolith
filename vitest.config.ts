import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/**/test/**/*.test.{ts,tsx}', 'packages/**/test/**/*.test.{ts,tsx}', 'tests/**/*.test.mjs'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    clearMocks: true,
    restoreMocks: true,
  },
});
