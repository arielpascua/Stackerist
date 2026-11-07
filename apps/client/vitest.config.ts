import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      name: 'client',
      environment: 'node',
      include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
      // Client unit tests arrive with the client milestone.
      passWithNoTests: true,
    },
  }),
);
