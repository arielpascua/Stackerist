/**
 * Number and time formatting for the HUD and the result card. Times shown to players come from
 * ticks (decision 31), never from wall clocks.
 */
import { TICK_RATE } from '@stackerist/engine';

function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n);
}

/** mm:ss from milliseconds; negative and non-finite values show 00:00. */
export function formatClock(ms: number): string {
  const totalSeconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const minutes = Math.floor(totalSeconds / 60);
  return `${pad2(minutes)}:${pad2(totalSeconds % 60)}`;
}

/** Match ticks to milliseconds (60 ticks per second). */
export function ticksToMs(ticks: number): number {
  return (ticks * 1000) / TICK_RATE;
}

/** mm:ss for a duration in ticks. */
export function formatTicks(ticks: number): string {
  return formatClock(ticksToMs(ticks));
}

/** Whole seconds left until `endMs` (rounded up, never negative). */
export function secondsLeft(endMs: number, nowMs: number): number {
  const left = Math.ceil((endMs - nowMs) / 1000);
  return Number.isFinite(left) && left > 0 ? left : 0;
}
