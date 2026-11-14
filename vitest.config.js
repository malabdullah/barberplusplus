import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Keep UI and workbook suites from exhausting memory alongside device QA.
    maxWorkers: 2,
    include: ['src/**/*.test.{js,jsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
