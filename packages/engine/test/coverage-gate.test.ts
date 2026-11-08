import { describe, expect, it } from 'vitest';
import config from '../vitest.config.js';

describe('coverage gate', () => {
  it('REQ-067 engine coverage is v8 over src/**/*.ts with a 90% line threshold (run by pnpm test:coverage)', () => {
    expect(config).toMatchObject({
      test: {
        name: 'engine',
        coverage: { provider: 'v8', include: ['src/**/*.ts'], thresholds: { lines: 90 } },
      },
    });
  });
});
