import { defineConfig } from 'vitest/config';

// Workspace packages (@stackerist/engine, @stackerist/protocol) resolve to their TypeScript
// sources via the "@stackerist/source" export condition, so tests never need a prebuild.
const conditions = ['@stackerist/source', 'module', 'node', 'development|production'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    name: 'server',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
