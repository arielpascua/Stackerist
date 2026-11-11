import { defineConfig } from 'vitest/config';

// Mutation-run variant of apps/server/vitest.config.ts (same conditions, same tests, same timeouts).
const conditions = ['@stackerist/source', 'module', 'node', 'development|production'];

export default defineConfig({
  root: 'apps/server',
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    name: 'server-mutation',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
