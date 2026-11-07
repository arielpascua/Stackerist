import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'engine',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      // REQ-067: engine line coverage must stay at or above 90%.
      thresholds: { lines: 90 },
    },
  },
});
