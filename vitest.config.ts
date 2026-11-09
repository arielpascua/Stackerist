import { defineConfig } from 'vitest/config';

// `pnpm test` runs every package's own vitest.config.ts as a project in one run.
// Engine coverage (90% lines, REQ-067): `pnpm test:coverage`.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*', 'tools'],
  },
});
