/**
 * Engine constants (architecture §2.3). All timing in integer ticks at TICK_RATE.
 */
export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 20;
export const TICK_RATE = 60; // ticks per second
export const GRAVITY_TABLE = [60, 48, 37, 28, 21, 16, 11, 8, 6, 4, 3, 2, 1] as const; // ticks per row, by level
export const MAX_LEVEL = 12; // GRAVITY_TABLE.length - 1
export const LEVEL_UP_TICKS = 1800; // 30 s
export const SOFT_DROP_TICKS_PER_ROW = 2;
export const LOCK_DELAY_TICKS = 30;
export const MAX_LOCK_RESETS = 15;
export const PREVIEW_COUNT = 5;
export const LINE_ATTACK = [0, 0, 1, 2, 4] as const; // index = rows cleared
export const COMBO_BONUS_CAP = 4;
export const MAX_ACTIONS_PER_TICK = 10; // server drain AND simulate()
/** min(MAX_LEVEL, floor(max(0, tick) / LEVEL_UP_TICKS)); `tick` is the absolute match tick. */
export function levelForTick(tick: number): number {
  return Math.min(MAX_LEVEL, Math.floor(Math.max(0, tick) / LEVEL_UP_TICKS));
}
/** softDrop ? min(GRAVITY_TABLE[level], SOFT_DROP_TICKS_PER_ROW) : GRAVITY_TABLE[level]; level clamped 0..MAX_LEVEL. */
export function fallInterval(level: number, softDrop: boolean): number {
  const clamped = Math.min(MAX_LEVEL, Math.max(0, level));
  const gravity = GRAVITY_TABLE[clamped] ?? GRAVITY_TABLE[MAX_LEVEL];
  return softDrop ? Math.min(gravity, SOFT_DROP_TICKS_PER_ROW) : gravity;
}
