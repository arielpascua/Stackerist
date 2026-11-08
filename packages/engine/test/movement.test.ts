import { describe, expect, it } from 'vitest';
import {
  GRAVITY_TABLE,
  applyAction,
  createPlayerState,
  isGrounded,
  tick,
  type ActionType,
} from '../src/index.js';
import { act, activeCells, boardOf, cells, must, ticks } from './helpers.js';

describe('REQ-063 source spec §8.1 — movement and collision', () => {
  it('REQ-003 #1 a piece moves left and right one column on an empty board', () => {
    const start = createPlayerState({ queue: ['T'] });
    const left = applyAction(start, { type: 'moveLeft' });
    expect(left.events).toEqual([{ type: 'moved', dx: -1 }]);
    expect(left.state.active).toEqual({ kind: 'T', rotation: 0, x: 2, y: 0 });
    expect(activeCells(left.state)).toEqual(cells([3, 0], [2, 1], [3, 1], [4, 1]));

    const right = applyAction(start, { type: 'moveRight' });
    expect(right.events).toEqual([{ type: 'moved', dx: 1 }]);
    expect(right.state.active).toEqual({ kind: 'T', rotation: 0, x: 4, y: 0 });

    expect(applyAction(left.state, { type: 'moveRight' }).state.active).toEqual(start.active);
    expect(left.state.tick).toBe(start.tick);
  });

  it('REQ-003 #2 a piece cannot move through the left wall, the right wall or the floor', () => {
    const start = createPlayerState({ queue: ['T'] });

    const atLeft = act(start, 'moveLeft', 'moveLeft', 'moveLeft').state;
    expect(activeCells(atLeft)).toEqual(cells([1, 0], [0, 1], [1, 1], [2, 1]));
    const blockedLeft = applyAction(atLeft, { type: 'moveLeft' });
    expect(blockedLeft.state).toBe(atLeft);
    expect(blockedLeft.events).toEqual([]);

    const atRight = act(start, 'moveRight', 'moveRight', 'moveRight', 'moveRight').state;
    expect(activeCells(atRight)).toEqual(cells([8, 0], [7, 1], [8, 1], [9, 1]));
    const blockedRight = applyAction(atRight, { type: 'moveRight' });
    expect(blockedRight.state).toBe(atRight);
    expect(blockedRight.events).toEqual([]);

    // Floor: a T resting on row 19 never falls further, however long gravity runs.
    const onFloor = createPlayerState({ active: { kind: 'T', rotation: 0, x: 3, y: 18 } });
    expect(isGrounded(onFloor.board, must(onFloor.active))).toBe(true);
    const after = tick(onFloor, 12).state;
    expect(after.active).toEqual(onFloor.active);
  });

  it('REQ-003 #3 a piece cannot move into an occupied cell to the left, right or below', () => {
    const board = boardOf(
      '..........', // row 17: the T's nub
      '..G...G...', // row 18: blocks left and right of the T's arms
      '....G.....', // row 19: blocks the T's centre from below
    );
    const start = createPlayerState({ board, active: { kind: 'T', rotation: 0, x: 3, y: 17 } });
    expect(activeCells(start)).toEqual(cells([4, 17], [3, 18], [4, 18], [5, 18]));
    for (const type of ['moveLeft', 'moveRight'] as const satisfies readonly ActionType[]) {
      const result = applyAction(start, { type });
      expect(result.state).toBe(start);
      expect(result.events).toEqual([]);
    }
    expect(isGrounded(board, must(start.active))).toBe(true);
    // A gravity step (level 12: every tick) cannot move it down either.
    const fell = tick(start, 12).state;
    expect(fell.active).toEqual(start.active);
    expect(fell.gravityCounter).toBe(0);
    expect(GRAVITY_TABLE[12]).toBe(1);
  });

  it('REQ-003 #4 gravity moves the piece down one row after the configured number of ticks', () => {
    const start = createPlayerState({ queue: ['T'] });
    // Level 0: 60 ticks per row.
    expect(ticks(start, 59, 0).state.active?.y).toBe(0);
    expect(ticks(start, 60, 0).state.active?.y).toBe(1);
    expect(ticks(start, 120, 0).state.active?.y).toBe(2);
    // Level 5: 16 ticks per row.
    expect(ticks(start, 15, 5).state.active?.y).toBe(0);
    expect(ticks(start, 16, 5).state.active?.y).toBe(1);
    // Level 12: one row every tick.
    expect(ticks(start, 3, 12).state.active?.y).toBe(3);
    // Gravity advances the tick and counts towards the next row.
    const one = tick(start, 0).state;
    expect(one.tick).toBe(start.tick + 1);
    expect(one.gravityCounter).toBe(1);
  });

  it('REQ-003 soft drop start and stop toggle the flag; repeating one leaves the state unchanged', () => {
    const start = createPlayerState({ queue: ['T'] });
    const on = applyAction(start, { type: 'softDropStart' });
    expect(on.state.softDrop).toBe(true);
    expect(on.events).toEqual([]);
    expect(applyAction(on.state, { type: 'softDropStart' }).state).toBe(on.state);
    const off = applyAction(on.state, { type: 'softDropStop' });
    expect(off.state.softDrop).toBe(false);
    expect(applyAction(off.state, { type: 'softDropStop' }).state).toBe(off.state);
  });
});
