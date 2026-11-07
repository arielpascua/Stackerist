// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/dist/',
    '**/coverage/',
    '**/node_modules/',
    'playwright-report/',
    'test-results/',
    'reports/',
    '.stryker-tmp/',
    '.claude/',
    'docs/',
    'design/',
  ]),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Typed linting through each package's tsconfig (solution-style tsconfig.json files).
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // A dropped promise is how one bad message crashes every live match (REQ-072).
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },

  // Plain JS config files: no type information.
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },

  // Engine + protocol: stricter type-aware rules, no `any` in any form (REQ-070).
  {
    files: ['packages/engine/**/*.ts', 'packages/protocol/**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
    },
  },

  // Engine purity (REQ-011): no wall clock, no Math.random, no I/O imports in engine sources.
  {
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Engine is pure: time is integer ticks.' },
        { name: 'performance', message: 'Engine is pure: time is integer ticks.' },
        { name: 'setTimeout', message: 'Engine is pure: no timers.' },
        { name: 'setInterval', message: 'Engine is pure: no timers.' },
        { name: 'process', message: 'Engine is pure: no process access.' },
        { name: 'crypto', message: 'Engine is pure: randomness comes from the seeded PRNG.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded PRNG (REQ-008).' },
      ],
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['node:*'], message: 'Engine is pure: no Node built-ins.' }] },
      ],
    },
  },

  // Node code.
  {
    files: ['apps/server/**/*.ts', 'e2e/**/*.ts', '**/*.config.ts'],
    languageOptions: { globals: globals.node },
  },

  // Browser code.
  {
    files: ['apps/client/src/**/*.{ts,tsx}', 'apps/client/test/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
);
