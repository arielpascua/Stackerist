import { describe, expect, it } from 'vitest';
import {
  LOCK_DELAY_TICKS,
  MAX_LOCK_RESETS,
  SOFT_DROP_TICKS_PER_ROW,
  applyAction,
  createPlayerState,
  ghostPosition,
  pieceCells,
  tick,
  type ActionType,
} from '../src/index.js';
import { act, activeCells, boardOf, bottom, cells, must, ticks, types } from './helpers.js';

describe('REQ-063 source spec §8.1 — drops and locking', () => {
  it('REQ-010 #13 hard drop lands at the ghost position and locks immediately', () => {
    const board = boardOf('..........', '...GG.....', 'G..GGG...G');
    const start = createPlayerState({ board, queue: ['T', 'O'] });
    const ghost = must(ghostPosition(start));
    expect(ghost).toEqual({ kind: 'T', rotation: 0, x: 3, y: 16 });

    const { state, events } = applyAction(start, { type: 'hardDrop' });
    expect(events[0]).toEqual({ type: 'locked', kind: 'T', cells: pieceCells(ghost) });
    expect(types(events)).toEqual(['locked', 'spawned']);
    expect(bottom(state.board, 4)).toEqual([
      '....T.....',
      '...TTT....',
      '...GG.....',
      'G..GGG...G',
    ]);
    expect(state.active).toEqual({ kind: 'O', rotation: 0, x: 4, y: 0 });
    expect(state.piecesPlaced).toBe(1);
    expect(state.tick).toBe(start.tick); // actions never advance the tick
  });

  it('REQ-010 #13 the ghost is the lowest non-colliding drop of the active piece', () => {
    const start = createPlayerState({ queue: ['I'] });
    expect(ghostPosition(start)).toEqual({ kind: 'I', rotation: 0, x: 3, y: 18 });
    const grounded = createPlayerState({ active: { kind: 'O', rotation: 0, x: 0, y: 18 } });
    expect(ghostPosition(grounded)).toEqual(grounded.active);
    expect(ghostPosition(createPlayerState())).toBeNull();
  });

  it('REQ-010 #14 soft drop falls one row every SOFT_DROP_TICKS_PER_ROW ticks', () => {
    expect(SOFT_DROP_TICKS_PER_ROW).toBe(2);
    const start = applyAction(createPlayerState({ queue: ['T'] }), { type: 'softDropStart' }).state;
    expect(ticks(start, 1, 0).state.active?.y).toBe(0);
    expect(ticks(start, 2, 0).state.active?.y).toBe(1);
    expect(ticks(start, 10, 0).state.active?.y).toBe(5);
    // When gravity is already faster (level 12: 1 tick per row), soft drop does not slow it down.
    expect(ticks(start, 6, 12).state.active?.y).toBe(6);
    // Releasing restores the gravity interval.
    const released = applyAction(ticks(start, 2, 0).state, { type: 'softDropStop' }).state;
    expect(ticks(released, 59, 0).state.active?.y).toBe(1);
    expect(ticks(released, 60, 0).state.active?.y).toBe(2);
  });

  it('REQ-010 #14 soft drop does not bypass lock delay', () => {
    const start = applyAction(
      createPlayerState({ active: { kind: 'O', rotation: 0, x: 4, y: 17 }, queue: ['T'] }),
      { type: 'softDropStart' },
    ).state;
    const landed = ticks(start, 2, 0).state; // one row down: grounded on the floor
    expect(landed.active?.y).toBe(18);
    expect(landed.lockCounter).toBe(1);
    expect(types(ticks(landed, LOCK_DELAY_TICKS - 2, 0).events)).not.toContain('locked');
    expect(types(ticks(landed, LOCK_DELAY_TICKS - 1, 0).events)).toContain('locked');
  });

  it('REQ-010 #15 a grounded piece locks after exactly LOCK_DELAY_TICKS ticks', () => {
    const start = createPlayerState({
      active: { kind: 'T', rotation: 0, x: 3, y: 18 },
      queue: ['O'],
    });
    const almost = ticks(start, LOCK_DELAY_TICKS - 1, 0);
    expect(types(almost.events)).not.toContain('locked');
    expect(almost.state.lockCounter).toBe(LOCK_DELAY_TICKS - 1);
    expect(almost.state.active).toEqual(start.active);

    const locked = tick(almost.state, 0);
    expect(types(locked.events)).toEqual(['locked', 'spawned']);
    expect(bottom(locked.state.board, 2)).toEqual(['....T.....', '...TTT....']);
    expect(locked.state.tick).toBe(start.tick + LOCK_DELAY_TICKS);
  });

  it('REQ-010 #15 the landing tick counts as grounded tick 1', () => {
    const start = createPlayerState({
      active: { kind: 'T', rotation: 0, x: 3, y: 17 },
      queue: ['O'],
    });
    const landed = tick(start, 12).state;
    expect(landed.active?.y).toBe(18);
    expect(landed.lockCounter).toBe(1);
    expect(types(ticks(start, LOCK_DELAY_TICKS - 1, 12).events)).not.toContain('locked');
    expect(types(ticks(start, LOCK_DELAY_TICKS, 12).events)).toContain('locked');
  });

  it('REQ-010 #16 moving while grounded resets lock delay, at most MAX_LOCK_RESETS times', () => {
    let state = createPlayerState({
      active: { kind: 'T', rotation: 0, x: 3, y: 18 },
      queue: ['O'],
    });
    const moves: ActionType[] = ['moveLeft', 'moveRight'];
    for (let reset = 1; reset <= MAX_LOCK_RESETS; reset += 1) {
      state = ticks(state, 10, 0).state;
      expect(state.lockCounter).toBe(10);
      state = act(state, must(moves[reset % 2])).state;
      expect(state.lockCounter).toBe(0);
      expect(state.lockResets).toBe(reset);
    }
    // The 16th grounded move still moves, but no longer resets the lock delay.
    state = ticks(state, 10, 0).state;
    const sixteenth = applyAction(state, { type: 'moveLeft' });
    expect(sixteenth.events).toEqual([{ type: 'moved', dx: -1 }]);
    expect(sixteenth.state.lockCounter).toBe(10);
    expect(sixteenth.state.lockResets).toBe(MAX_LOCK_RESETS);
    // So the piece locks 20 ticks later, after 30 grounded ticks since the last reset.
    expect(types(ticks(sixteenth.state, 19, 0).events)).not.toContain('locked');
    expect(types(ticks(sixteenth.state, 20, 0).events)).toContain('locked');
  });

  it('REQ-010 #16 rotating while grounded resets lock delay; a kick upward keeps lowestY', () => {
    const start = ticks(
      createPlayerState({ active: { kind: 'T', rotation: 0, x: 3, y: 18 }, queue: ['O'] }),
      10,
      0,
    ).state;
    expect(start.lowestY).toBe(18);
    const rotated = applyAction(start, { type: 'rotateCW' });
    expect(rotated.events).toEqual([{ type: 'rotated', rotation: 1, kickIndex: 2 }]);
    expect(rotated.state.active).toEqual({ kind: 'T', rotation: 1, x: 2, y: 17 });
    expect(rotated.state.lockCounter).toBe(0);
    expect(rotated.state.lockResets).toBe(1);
    expect(rotated.state.lowestY).toBe(18);
  });

  it('REQ-010 #16 reaching a new lowest row resets the lock-reset count', () => {
    const board = boardOf('..GG......', '..GG......');
    let state = createPlayerState({ board, active: { kind: 'O', rotation: 0, x: 2, y: 16 } });
    expect(state.lowestY).toBe(16);
    state = ticks(state, 5, 0).state;
    state = act(state, 'moveRight', 'moveRight').state; // both moves start grounded on the ledge
    expect(state.lockResets).toBe(2);
    expect(activeCells(state)).toEqual(cells([4, 16], [5, 16], [4, 17], [5, 17]));
    state = ticks(state, 2, 12).state; // falls off the ledge to the floor
    expect(state.active?.y).toBe(18);
    expect(state.lowestY).toBe(18);
    expect(state.lockResets).toBe(0);
  });

  it('REQ-010 moving off a ledge (no longer grounded) still counts as a reset because it started grounded', () => {
    const board = boardOf('..GG......', '..GG......');
    const start = ticks(
      createPlayerState({ board, active: { kind: 'O', rotation: 0, x: 3, y: 16 } }),
      12,
      0,
    ).state;
    expect(start.lockCounter).toBe(12);
    const moved = applyAction(start, { type: 'moveRight' }).state;
    expect(moved.lockCounter).toBe(0);
    expect(moved.lockResets).toBe(1);
    // Airborne ticks do not count towards the lock.
    const airborne = ticks(moved, 5, 0).state;
    expect(airborne.lockCounter).toBe(0);
  });
});
