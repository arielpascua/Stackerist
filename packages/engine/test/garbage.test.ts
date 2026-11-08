import { describe, expect, it } from 'vitest';
import {
  LINE_ATTACK,
  applyAction,
  attackFor,
  createBag,
  createPlayerState,
  receiveGarbage,
  tick,
  type EngineEvent,
} from '../src/index.js';
import {
  I_FLAT_RIGHT,
  I_UP_COL0,
  act,
  boardOf,
  bottom,
  dropAt,
  oAt,
  singleMachine,
  ticks,
  types,
} from './helpers.js';

const CLEARS = [
  { lines: 1, rows: ['.GGGGGGGGG'], attack: 0 },
  { lines: 2, rows: ['.GGGGGGGGG', '.GGGGGGGGG'], attack: 1 },
  { lines: 3, rows: ['.GGGGGGGGG', '.GGGGGGGGG', '.GGGGGGGGG'], attack: 2 },
  { lines: 4, rows: ['.GGGGGGGGG', '.GGGGGGGGG', '.GGGGGGGGG', '.GGGGGGGGG'], attack: 4 },
] as const;

function attacks(events: readonly EngineEvent[]): number[] {
  return events.flatMap((event) => (event.type === 'attack' ? [event.rows] : []));
}

describe('REQ-063 source spec §8.1 — garbage', () => {
  it('REQ-014 #21 attack table: 1→0, 2→1, 3→2, 4→4', () => {
    expect(LINE_ATTACK).toEqual([0, 0, 1, 2, 4]);
    for (const { lines, attack } of CLEARS) expect(attackFor(lines, 1)).toBe(attack);
  });

  it.each(CLEARS)(
    'REQ-014 #21 a first clearing lock of $lines line(s) sends $attack row(s)',
    ({ lines, rows, attack }) => {
      const filler = Array.from({ length: 4 - lines }, () => '.G........');
      const start = createPlayerState({ board: boardOf(...filler, ...rows), bag: createBag(1) });
      const { state, events } = dropAt(start, I_UP_COL0);
      expect(events).toContainEqual({ type: 'combo', count: 1 });
      expect(attacks(events)).toEqual(attack > 0 ? [attack] : []);
      expect(state.garbageSent).toBe(attack);
    },
  );

  it('REQ-017 #22 garbage rows insert at the bottom: nine G, the hole at the given column; the stack shifts up', () => {
    const start = createPlayerState({
      board: boardOf('JJJ.......'),
      active: oAt(8),
      pendingGarbage: [{ rows: 2, holeColumn: 7 }],
      queue: ['T'],
    });
    const { state, events } = applyAction(start, { type: 'hardDrop' });
    expect(types(events)).toEqual(['locked', 'garbageInserted', 'spawned']);
    expect(events[1]).toEqual({ type: 'garbageInserted', rows: 2 });
    expect(bottom(state.board, 4)).toEqual([
      '........OO',
      'JJJ.....OO',
      'GGGGGGG.GG',
      'GGGGGGG.GG',
    ]);
    for (const row of bottom(state.board, 2)) {
      expect(row.replaceAll('.', '')).toHaveLength(9);
      expect(row.indexOf('.')).toBe(7);
    }
    expect(state.pendingGarbage).toEqual([]);
    expect(state.garbageInserted).toBe(2);
  });

  it('REQ-017 #23 all rows of one attack share a hole column; two attacks may differ (newest lowest)', () => {
    const start = createPlayerState({
      active: oAt(0),
      pendingGarbage: [
        { rows: 1, holeColumn: 2 },
        { rows: 2, holeColumn: 6 },
      ],
      queue: ['T'],
    });
    const { state, events } = applyAction(start, { type: 'hardDrop' });
    expect(events).toContainEqual({ type: 'garbageInserted', rows: 3 });
    expect(bottom(state.board, 5)).toEqual([
      'OO........',
      'OO........',
      'GG.GGGGGGG', // oldest attack: pushed up by the newer one
      'GGGGGG.GGG', // newest attack ends lowest
      'GGGGGG.GGG',
    ]);
  });

  it('REQ-016 #24 pending garbage is inserted only on a non-clearing lock', () => {
    const pending = [{ rows: 2, holeColumn: 0 }];
    let state = createPlayerState({
      board: boardOf(...singleMachine(2)),
      pendingGarbage: pending,
      bag: createBag(3),
    });
    // Moves, rotations and ticks never insert garbage.
    state = act(state, 'moveLeft', 'rotateCW', 'moveRight', 'softDropStart').state;
    state = ticks(state, 10, 0).state;
    expect(state.pendingGarbage).toEqual(pending);
    expect(bottom(state.board, 2)).toEqual(singleMachine(2));

    // A clearing lock (a single: attack 0, nothing to cancel) does not insert it.
    const clearing = dropAt(state, I_FLAT_RIGHT);
    expect(types(clearing.events)).toEqual(['locked', 'linesCleared', 'combo', 'spawned']);
    expect(clearing.state.pendingGarbage).toEqual(pending);
    expect(bottom(clearing.state.board, 2)).toEqual(['..........', 'GGGGGG....']);

    // The next non-clearing lock does.
    const blocking = dropAt(clearing.state, oAt(0));
    expect(types(blocking.events)).toEqual(['locked', 'garbageInserted', 'spawned']);
    expect(blocking.state.pendingGarbage).toEqual([]);
    expect(bottom(blocking.state.board, 5)).toEqual([
      'OO........',
      'OO........',
      'GGGGGG....',
      '.GGGGGGGGG',
      '.GGGGGGGGG',
    ]);
  });

  it('REQ-016 #24 garbage goes in after the line-clear step and before the next spawn', () => {
    // A tower in column 4 whose top is row 5: 4 garbage rows lift it to row 1, into the T's spawn
    // cells — so the spawn sees the post-garbage board and is blocked (no cell went above row 0).
    const tower = Array.from({ length: 15 }, () => '....G.....');
    const start = createPlayerState({
      board: boardOf(...tower),
      active: oAt(8),
      pendingGarbage: [{ rows: 4, holeColumn: 9 }],
      queue: ['T'],
    });
    const { state, events } = applyAction(start, { type: 'hardDrop' });
    expect(events).toEqual([
      { type: 'locked', kind: 'O', cells: expect.any(Array) as unknown },
      { type: 'garbageInserted', rows: 4 },
      { type: 'toppedOut', reason: 'SPAWN_BLOCKED' },
    ]);
    expect(state.board[1]).toBe('....G.....');
    expect(state.toppedOut).toBe(true);
  });

  it('REQ-017 #25 a garbage row is cleared by filling its hole', () => {
    let state = createPlayerState({
      active: oAt(4),
      pendingGarbage: [{ rows: 2, holeColumn: 0 }],
      bag: createBag(5),
    });
    state = applyAction(state, { type: 'hardDrop' }).state; // non-clearing: the garbage lands
    expect(bottom(state.board, 4)).toEqual([
      '....OO....',
      '....OO....',
      '.GGGGGGGGG',
      '.GGGGGGGGG',
    ]);
    const { state: after, events } = dropAt(state, I_UP_COL0);
    expect(events).toContainEqual({ type: 'linesCleared', count: 2, rows: [18, 19] });
    expect(bottom(after.board, 4)).toEqual([
      '..........',
      '..........',
      'I...OO....',
      'I...OO....',
    ]);
  });

  it('REQ-018 #26 garbage that pushes a filled cell above row 0 tops the player out', () => {
    // Column 9 is filled from row 2 down; 3 garbage rows push (9, 2) above the board.
    const start = createPlayerState({
      board: boardOf(...Array.from({ length: 18 }, () => '.........Z')),
      active: oAt(0),
      pendingGarbage: [{ rows: 3, holeColumn: 4 }],
      queue: ['T'],
    });
    const { state, events } = applyAction(start, { type: 'hardDrop' });
    expect(types(events)).toEqual(['locked', 'garbageInserted', 'toppedOut']);
    expect(events[2]).toEqual({ type: 'toppedOut', reason: 'GARBAGE_OVERFLOW' });
    expect(state.toppedOut).toBe(true);
    expect(state.active).toBeNull();
    expect(state.board).toHaveLength(20);
    expect(bottom(state.board, 3)).toEqual(['GGGG.GGGGG', 'GGGG.GGGGG', 'GGGG.GGGGG']);
    expect(state.queue).toEqual(['T']); // no spawn
    // Topped out: actions, ticks and incoming garbage are all ignored.
    expect(applyAction(state, { type: 'moveLeft' }).state).toBe(state);
    expect(tick(state, 0).state).toBe(state);
    expect(receiveGarbage(state, { rows: 1, holeColumn: 0 })).toBe(state);
  });

  it('REQ-018 #26 exactly filling to row 0 is not an overflow; more than 20 rows always is', () => {
    const fits = createPlayerState({
      board: boardOf(...Array.from({ length: 17 }, () => '.........Z')), // top at row 3
      active: oAt(0),
      pendingGarbage: [{ rows: 3, holeColumn: 4 }],
      queue: ['T'],
    });
    const fitted = applyAction(fits, { type: 'hardDrop' });
    expect(fitted.state.toppedOut).toBe(false);
    expect(fitted.state.board[0]).toBe('.........Z');
    expect(types(fitted.events)).toEqual(['locked', 'garbageInserted', 'spawned']);

    const flood = createPlayerState({
      active: { kind: 'I', rotation: 0, x: 0, y: -1 },
      pendingGarbage: [
        { rows: 11, holeColumn: 1 },
        { rows: 10, holeColumn: 2 },
      ],
      queue: ['T'],
    });
    const flooded = applyAction(flood, { type: 'hardDrop' });
    expect(flooded.events).toContainEqual({ type: 'toppedOut', reason: 'GARBAGE_OVERFLOW' });
    expect(flooded.state.garbageInserted).toBe(21);
  });

  it('REQ-017 receiveGarbage queues an attack, counts it as received and validates it', () => {
    const start = createPlayerState({ queue: ['T'] });
    const attack = { rows: 3, holeColumn: 5 };
    const once = receiveGarbage(start, attack);
    expect(once.pendingGarbage).toEqual([attack]);
    expect(once.pendingGarbage[0]).not.toBe(attack);
    expect(once.garbageReceived).toBe(3);
    const twice = receiveGarbage(once, { rows: 1, holeColumn: 0 });
    expect(twice.pendingGarbage).toEqual([attack, { rows: 1, holeColumn: 0 }]);
    expect(twice.garbageReceived).toBe(4);
    expect(start.pendingGarbage).toEqual([]);
    expect(() => receiveGarbage(start, { rows: 0, holeColumn: 0 })).toThrow(RangeError);
    expect(() => receiveGarbage(start, { rows: 1.5, holeColumn: 0 })).toThrow(RangeError);
    expect(() => receiveGarbage(start, { rows: 1, holeColumn: 10 })).toThrow(RangeError);
    expect(() => receiveGarbage(start, { rows: 1, holeColumn: -1 })).toThrow(RangeError);
  });
});
