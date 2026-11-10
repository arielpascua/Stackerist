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
    // These tests open real WebSockets and run in parallel files. Each one takes ~0.25 s alone, but the default
    // 5 s limit flakes when the machine is busy (full suite, browsers, other agents). A longer limit, set once,
    // is the fix; retries would hide real slowness. Individual tests keep their own, shorter, assertions.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
