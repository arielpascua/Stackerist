import { defineConfig } from 'vitest/config';

// Mutation-run variant of packages/protocol/vitest.config.ts (same conditions, same tests).
const conditions = ['@stackerist/source', 'module', 'node', 'development|production'];

export default defineConfig({
  root: 'packages/protocol',
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    name: 'protocol-mutation',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
