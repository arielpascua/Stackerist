import { emptyBoard, parseBoard } from '@stackerist/engine';
import { COUNTDOWN_MS } from '@stackerist/protocol';
import { describe, expect, it } from 'vitest';
import { danger, motion } from '../../../../design/tokens/tokens.ts';
import type { CountdownInfo } from '../../src/game/contract.ts';
import { duelVisibleMs, isDanger, sideSeats, standoffPhase } from '../../src/game/frame.ts';

const GO = 10_000;
const countdown: CountdownInfo = { kind: 'start', goAtMs: GO, tick: 0 };

describe('REQ-086 frame standoff phase (drives the DOM standoff through subscribeFrame)', () => {
  it('REQ-086 dim before T0, then 3 · 2 · 1 a third of the countdown apart', () => {
    const t0 = GO - COUNTDOWN_MS;
    const step = COUNTDOWN_MS / 3;
    expect(standoffPhase(countdown, t0 - 1, false)).toBe('dim');
    expect(standoffPhase(countdown, t0, false)).toBe('3');
    expect(standoffPhase(countdown, t0 + step - 1, false)).toBe('3');
    expect(standoffPhase(countdown, t0 + step, false)).toBe('2');
    expect(standoffPhase(countdown, t0 + 2 * step, false)).toBe('1');
    expect(standoffPhase(countdown, GO - 1, false)).toBe('1');
  });

  it('REQ-086 DUEL! from the go instant for slam + hold + out, shorter under reduced motion', () => {
    expect(duelVisibleMs(false)).toBe(motion.duelSlamMs + motion.duelHoldMs + motion.duelOutMs);
    expect(duelVisibleMs(true)).toBe(motion.duelSlamMs + motion.duelHoldMs + motion.reducedMs);
    expect(standoffPhase(countdown, GO, false)).toBe('duel');
    expect(standoffPhase(countdown, GO + duelVisibleMs(false) - 1, false)).toBe('duel');
    expect(standoffPhase(countdown, GO + duelVisibleMs(false), false)).toBeNull();
    expect(standoffPhase(countdown, GO + duelVisibleMs(true), true)).toBeNull();
  });

  it('REQ-086 no standoff without a countdown', () => {
    expect(standoffPhase(null, GO, false)).toBeNull();
  });
});

describe('REQ-054 frame model helpers', () => {
  it('REQ-054 players see themselves on the left; spectators see A left, B right', () => {
    expect(sideSeats('A')).toEqual(['A', 'B']);
    expect(sideSeats('B')).toEqual(['B', 'A']);
    expect(sideSeats('spectator')).toEqual(['A', 'B']);
    expect(sideSeats(null)).toEqual([null, null]);
  });

  it('REQ-054 danger when stack height plus pending garbage reaches the token threshold', () => {
    const rows = Array.from({ length: 20 }, (_, y) => (y >= 20 - 10 ? 'GGGGGGGGG.' : '..........'));
    const board = parseBoard(rows);
    expect(isDanger(emptyBoard(), 0)).toBe(false);
    expect(isDanger(board, danger.rows - 10 - 1)).toBe(false);
    expect(isDanger(board, danger.rows - 10)).toBe(true);
  });
});
