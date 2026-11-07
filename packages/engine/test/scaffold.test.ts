import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../src/index.js';

describe('engine scaffold', () => {
  it('exports a version string', () => {
    expect(ENGINE_VERSION).toBe('0.0.0');
  });
});
