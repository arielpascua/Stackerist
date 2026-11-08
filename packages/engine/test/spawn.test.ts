import { describe, expect, it } from 'vitest';
import {
  PREVIEW_COUNT,
  applyAction,
  createBag,
  createPlayerState,
  drawPieces,
  receiveGarbage,
  spawnPiece,
  tick,
  type ActionType,
} from '../src/index.js';
import { boardOf, dropAt, oAt, ticks, types } from './helpers.js';

const ALL_ACTIONS: readonly ActionType[] = [
  'moveLeft',
  'moveRight',
  'rotateCW',
  'rotateCCW',
  'softDropStart',
  'softDropStop',
  'hardDrop',
];

describe('REQ-063 source spec §8.1 — spawning and loss', () => {
  it('REQ-007 #28 spawn blocked by the stack tops the player out; further actions and ticks are no-ops', () => {
    // Column 4 is filled from row 1 down, so the next T's cell (4, 1) is taken.
    const board = boardOf(...Array.from({ length: 19 }, () => '....G.....'));
    const start = createPlayerState({ board, active: oAt(0), queue: ['T', 'S'] });
    const { state, events } = applyAction(start, { type: 'hardDrop' });
    expect(types(events)).toEqual(['locked', 'toppedOut']);
    expect(events[1]).toEqual({ type: 'toppedOut', reason: 'SPAWN_BLOCKED' });
    expect(state.toppedOut).toBe(true);
    expect(state.active).toBeNull();
    // The blocked piece is not placed.
    expect(state.board.join('')).not.toContain('T');

    for (const type of ALL_ACTIONS) {
      const result = applyAction(state, { type });
      expect(result.state).toBe(state);
      expect(result.events).toEqual([]);
    }
    const ticked = tick(state, 12);
    expect(ticked.state).toBe(state);
    expect(ticked.state.tick).toBe(state.tick); // the tick is not advanced
    expect(ticked.events).toEqual([]);
    expect(receiveGarbage(state, { rows: 2, holeColumn: 3 })).toBe(state);
  });

  it('REQ-007 a fresh state whose first spawn is blocked starts topped out', () => {
    const board = boardOf(...Array.from({ length: 20 }, () => '....G.....'));
    const state = createPlayerState({ board, queue: ['O'] });
    expect(state.toppedOut).toBe(true);
    expect(state.active).toBeNull();
  });

  it('REQ-007 the next piece comes off the queue at its spawn position with fresh piece timers', () => {
    const grounded = createPlayerState({
      active: { kind: 'T', rotation: 0, x: 3, y: 18 },
      queue: ['I', 'Z'],
    });
    const moved = applyAction(ticks(grounded, 20, 0).state, { type: 'moveLeft' }).state;
    const start = ticks(moved, 5, 0).state;
    expect(start).toMatchObject({ gravityCounter: 25, lockCounter: 5, lockResets: 1, lowestY: 18 });
    const { state, events } = applyAction(start, { type: 'hardDrop' });
    expect(events.at(-1)).toEqual({ type: 'spawned', kind: 'I' });
    expect(state.active).toEqual(spawnPiece('I'));
    expect(state.queue).toEqual(['Z']);
    expect(state).toMatchObject({ gravityCounter: 0, lockCounter: 0, lockResets: 0, lowestY: -1 });
  });

  it('REQ-007 with a bag the queue is refilled to exactly PREVIEW_COUNT after every spawn', () => {
    const bag = createBag(31);
    const sequence = drawPieces(bag, 12).pieces;
    let state = createPlayerState({ bag });
    expect(state.active?.kind).toBe(sequence[0]);
    expect(state.queue).toEqual(sequence.slice(1, 1 + PREVIEW_COUNT));
    for (let i = 1; i <= 5; i += 1) {
      state = dropAt(state, oAt(2 * ((i - 1) % 5))).state;
      expect(state.active?.kind).toBe(sequence[i]);
      expect(state.queue).toEqual(sequence.slice(i + 1, i + 1 + PREVIEW_COUNT));
    }
  });

  it('REQ-007 a given queue is drawn before the bag; an explicit active piece does not spawn', () => {
    const fromQueue = createPlayerState({ queue: ['S', 'Z'], bag: createBag(5) });
    expect(fromQueue.active).toEqual(spawnPiece('S'));
    expect(fromQueue.queue).toHaveLength(PREVIEW_COUNT);
    expect(fromQueue.queue[0]).toBe('Z');
    expect(fromQueue.queue.slice(1)).toEqual(drawPieces(createBag(5), 4).pieces);

    const placed = createPlayerState({ active: oAt(2), queue: ['L'] });
    expect(placed.active).toEqual(oAt(2));
    expect(placed.queue).toEqual(['L']);
    expect(placed.lowestY).toBe(0);
  });

  it('REQ-007 a prediction state whose queue runs dry stops with starved, not a top-out', () => {
    const start = createPlayerState({ queue: ['O'] }); // bag null: prediction
    expect(start.bag).toBeNull();
    const { state, events } = applyAction(start, { type: 'hardDrop' });
    expect(types(events)).toEqual(['locked', 'starved']);
    expect(state.active).toBeNull();
    expect(state.toppedOut).toBe(false);
    expect(applyAction(state, { type: 'moveLeft' }).state).toBe(state);
    expect(tick(state, 0).state).toBe(state);
    // Garbage can still arrive while starved.
    expect(receiveGarbage(state, { rows: 1, holeColumn: 0 }).pendingGarbage).toHaveLength(1);
    expect(createPlayerState().active).toBeNull();
  });

  it('REQ-007 createPlayerState defaults: empty board, tick 0, all counters and stats at zero', () => {
    const state = createPlayerState({ queue: ['T'] });
    expect(state).toEqual({
      tick: 0,
      board: boardOf(),
      active: spawnPiece('T'),
      queue: [],
      bag: null,
      pendingGarbage: [],
      softDrop: false,
      gravityCounter: 0,
      lockCounter: 0,
      lockResets: 0,
      lowestY: 0,
      combo: 0,
      bestCombo: 0,
      linesCleared: 0,
      garbageSent: 0,
      garbageCancelled: 0,
      garbageReceived: 0,
      garbageInserted: 0,
      piecesPlaced: 0,
      bestMoment: null,
      toppedOut: false,
    });
    expect(createPlayerState({ tick: 21_600 }).tick).toBe(21_600);
    expect(() => createPlayerState({ tick: -1 })).toThrow(RangeError);
    expect(() => createPlayerState({ tick: 1.5 })).toThrow(RangeError);
    expect(() => createPlayerState({ board: ['..........'] })).toThrow(RangeError);
  });
});
