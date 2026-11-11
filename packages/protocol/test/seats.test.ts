import { describe, expect, it } from 'vitest';
import { RoomStatusSchema, isLiveStatus, otherSeat } from '../src/index.js';

describe('shared seat and status helpers', () => {
  it('otherSeat swaps A and B and is its own inverse', () => {
    expect(otherSeat('A')).toBe('B');
    expect(otherSeat('B')).toBe('A');
    expect(otherSeat(otherSeat('A'))).toBe('A');
  });

  it('isLiveStatus is true for exactly the statuses with a round on', () => {
    const live = RoomStatusSchema.options.filter((status) => isLiveStatus(status));
    expect(live).toEqual(['countdown', 'playing', 'paused']);
  });

  it('every room status is either live or one of the three idle statuses', () => {
    const idle = RoomStatusSchema.options.filter((status) => !isLiveStatus(status));
    expect(idle).toEqual(['waiting', 'roundOver', 'seriesOver']);
  });
});
