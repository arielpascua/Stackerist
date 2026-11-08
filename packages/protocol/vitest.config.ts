import { defineConfig } from 'vitest/config';

// @stackerist/engine resolves to its TypeScript source via the "@stackerist/source" export
// condition (architecture §1.3), so protocol tests never need an engine prebuild.
const conditions = ['@stackerist/source', 'module', 'node', 'development|production'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    name: 'protocol',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
