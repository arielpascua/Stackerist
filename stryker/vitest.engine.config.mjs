import { defineConfig } from 'vitest/config';

// Mutation-run variant of packages/engine/vitest.config.ts: the same tests, minus the one that reads
// the SOURCE TEXT (purity.test.ts greps the files, and Stryker's instrumentation rewrites them).
// Purity is still enforced by `pnpm test`; it is a text check, not a behaviour check.
export default defineConfig({
  root: 'packages/engine',
  test: {
    name: 'engine-mutation',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/purity.test.ts'],
  },
});
