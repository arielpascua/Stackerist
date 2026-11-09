import { defineConfig } from 'vitest/config';

// Repo-level conformance project: parses the real root configs (package.json, Dockerfile,
// .dockerignore, railway.json, CI workflow) and asserts the REQ-074/075/076/077 contracts.
export default defineConfig({
  test: {
    name: 'tools',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
