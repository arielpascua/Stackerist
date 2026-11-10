import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// Workspace packages (@stackerist/engine, @stackerist/protocol) resolve to their TypeScript sources via
// the "@stackerist/source" export condition, so tests never need a prebuild. vite.config.ts sets it for
// the browser build; the node test environment resolves through `ssr.resolve.conditions`, like the
// engine, protocol and server configs.
const conditions = ['@stackerist/source', 'module', 'node', 'development|production'];

export default mergeConfig(
  viteConfig,
  defineConfig({
    resolve: { conditions },
    ssr: { resolve: { conditions } },
    test: {
      name: 'client',
      environment: 'node',
      include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
      // Client unit tests arrive with the client milestone.
      passWithNoTests: true,
    },
  }),
);
