/**
 * Pure helpers behind `FrameModel` (architecture §5.2, §5.5): the standoff timeline, the danger test and
 * which seat sits on which side. Every duration comes from the protocol (COUNTDOWN_MS) or the motion
 * tokens; nothing here reads a clock.
 */
import { stackHeight, type Board } from '@stackerist/engine';
import { COUNTDOWN_MS, type Seat } from '@stackerist/protocol';
import { danger, motion } from '../../../../design/tokens/tokens.ts';
import type { CountdownInfo, Role, StandoffPhase } from './contract.ts';

/** The numerals shown before DUEL!, in order: each holds a third of the countdown. */
const NUMERALS = ['3', '2', '1'] as const;

/** How long DUEL! stays on screen after the go instant (DESIGN.md Standoff countdown). */
export function duelVisibleMs(reducedMotion: boolean): number {
  const exit = reducedMotion ? motion.reducedMs : motion.duelOutMs;
  return motion.duelSlamMs + motion.duelHoldMs + exit;
}

/**
 * The standoff phase at `nowMs` (performance.now()). T0 = goAt − COUNTDOWN_MS: before it 'dim', then
 * '3', '2', '1', and 'duel' from the go instant (the same instant input goes live) until DUEL! is gone.
 */
export function standoffPhase(
  countdown: CountdownInfo | null,
  nowMs: number,
  reducedMotion: boolean,
): StandoffPhase {
  if (countdown === null) return null;
  const sinceGo = nowMs - countdown.goAtMs;
  if (sinceGo >= 0) return sinceGo < duelVisibleMs(reducedMotion) ? 'duel' : null;
  const sinceT0 = sinceGo + COUNTDOWN_MS;
  if (sinceT0 < 0) return 'dim';
  const index = Math.floor(sinceT0 / (COUNTDOWN_MS / NUMERALS.length));
  return NUMERALS[Math.min(index, NUMERALS.length - 1)] ?? null;
}

/** REQ-088's condition: stack height + pending garbage ≥ the danger threshold (rows). */
export function isDanger(board: Board, pendingRows: number): boolean {
  return stackHeight(board) + pendingRows >= danger.rows;
}

export function otherSeat(seat: Seat): Seat {
  return seat === 'A' ? 'B' : 'A';
}

/** [left, right] seats: players see themselves on the left; spectators see A left and B right. */
export function sideSeats(role: Role | null): readonly [Seat | null, Seat | null] {
  if (role === null) return [null, null];
  if (role === 'spectator') return ['A', 'B'];
  return [role, otherSeat(role)];
}
