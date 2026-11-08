import { describe, expect, it } from 'vitest';
import {
  COMBO_BONUS_CAP,
  GRAVITY_TABLE,
  LEVEL_UP_TICKS,
  LINE_ATTACK,
  LOCK_DELAY_TICKS,
  MAX_ACTIONS_PER_TICK,
  MAX_LEVEL,
  MAX_LOCK_RESETS,
  PREVIEW_COUNT,
  SOFT_DROP_TICKS_PER_ROW,
  TICK_RATE,
  fallInterval,
  levelForTick,
} from '../src/index.js';

describe('config', () => {
  it('REQ-009 exports the source spec §3.5 timing constants in integer ticks at 60 per second', () => {
    expect(TICK_RATE).toBe(60);
    expect(GRAVITY_TABLE).toEqual([60, 48, 37, 28, 21, 16, 11, 8, 6, 4, 3, 2, 1]);
    expect(MAX_LEVEL).toBe(GRAVITY_TABLE.length - 1);
    expect(LEVEL_UP_TICKS).toBe(1800);
    expect(LEVEL_UP_TICKS / TICK_RATE).toBe(30);
    expect(SOFT_DROP_TICKS_PER_ROW).toBe(2);
    expect(LOCK_DELAY_TICKS).toBe(30);
    expect(MAX_LOCK_RESETS).toBe(15);
    expect(PREVIEW_COUNT).toBe(5);
    expect(LINE_ATTACK).toEqual([0, 0, 1, 2, 4]);
    expect(COMBO_BONUS_CAP).toBe(4);
    expect(MAX_ACTIONS_PER_TICK).toBe(10);
    for (const value of [
      TICK_RATE,
      ...GRAVITY_TABLE,
      MAX_LEVEL,
      LEVEL_UP_TICKS,
      SOFT_DROP_TICKS_PER_ROW,
      LOCK_DELAY_TICKS,
      MAX_LOCK_RESETS,
      PREVIEW_COUNT,
      ...LINE_ATTACK,
      COMBO_BONUS_CAP,
      MAX_ACTIONS_PER_TICK,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('REQ-009 levelForTick rises every 1800 ticks from the absolute match tick and caps at MAX_LEVEL', () => {
    expect(levelForTick(0)).toBe(0);
    expect(levelForTick(1799)).toBe(0);
    expect(levelForTick(1800)).toBe(1);
    expect(levelForTick(3599)).toBe(1);
    expect(levelForTick(21_599)).toBe(11);
    expect(levelForTick(21_600)).toBe(12);
    expect(levelForTick(1_000_000_000)).toBe(12);
    expect(levelForTick(-5)).toBe(0);
  });

  it('REQ-009 fallInterval is the gravity row time, or min(gravity, 2) while soft dropping', () => {
    GRAVITY_TABLE.forEach((gravity, level) => {
      expect(fallInterval(level, false)).toBe(gravity);
      expect(fallInterval(level, true)).toBe(Math.min(gravity, SOFT_DROP_TICKS_PER_ROW));
    });
    expect(fallInterval(-1, false)).toBe(60);
    expect(fallInterval(99, false)).toBe(1);
    expect(fallInterval(12, true)).toBe(1);
  });
});
