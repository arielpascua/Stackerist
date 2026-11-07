import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../src/index.js';

describe('protocol scaffold', () => {
  it('exports an integer protocol version', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
  });
});
