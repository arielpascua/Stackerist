import { describe, expect, it } from 'vitest';
import {
  I_KICKS,
  JLSTZ_KICKS,
  PIECE_KINDS,
  applyAction,
  collides,
  createPlayerState,
  emptyBoard,
  kickOffsets,
  pieceCells,
  tryRotate,
  type ActionType,
  type ActivePiece,
  type KickTable,
  type PlayerState,
} from '../src/index.js';
import { act, activeCells, boardOf, bottom, cells, must, picture } from './helpers.js';

/** Source spec §3.3, transcribed verbatim (SRS convention: +y is UP). */
const SPEC_JLSTZ: KickTable = {
  '0>1': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  '1>0': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  '1>2': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  '2>1': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  '2>3': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
  '3>2': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  '3>0': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  '0>3': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
};

const SPEC_I: KickTable = {
  '0>1': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ],
  '1>0': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ],
  '1>2': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ],
  '2>1': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ],
  '2>3': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ],
  '3>2': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ],
  '3>0': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ],
  '0>3': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ],
};

function stateWith(piece: ActivePiece, board = emptyBoard()): PlayerState {
  return createPlayerState({ board, active: piece });
}

describe('REQ-063 source spec §8.1 — rotation', () => {
  it('REQ-004 kick tables are source spec §3.3 verbatim (+y up)', () => {
    expect(JLSTZ_KICKS).toEqual(SPEC_JLSTZ);
    expect(I_KICKS).toEqual(SPEC_I);
    for (const table of [JLSTZ_KICKS, I_KICKS]) {
      expect(Object.isFrozen(table)).toBe(true);
      expect(Object.isFrozen(table['0>1'])).toBe(true);
      expect(Object.isFrozen(table['0>1'][1])).toBe(true);
    }
  });

  it('REQ-004 kickOffsets applies each SRS offset as (dx, −dy) in board space', () => {
    expect(kickOffsets('T', 0, 1)).toEqual([
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: -1, y: -1 },
      { x: 0, y: 2 },
      { x: -1, y: 2 },
    ]);
    expect(kickOffsets('I', 1, 2)).toEqual([
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: 2, y: 0 },
      { x: -1, y: -2 },
      { x: 2, y: 1 },
    ]);
    expect(kickOffsets('O', 0, 1)).toEqual([]);
    expect(kickOffsets('T', 0, 2)).toEqual([]);
    for (const kind of ['J', 'L', 'S', 'Z'] as const) {
      expect(kickOffsets(kind, 3, 0)).toEqual(kickOffsets('T', 3, 0));
    }
  });

  it.each(PIECE_KINDS)(
    'REQ-004 #5 %s returns to its original cells after four CW rotations',
    (kind) => {
      const start = stateWith({ kind, rotation: 0, x: 3, y: 8 });
      const turned = act(start, 'rotateCW', 'rotateCW', 'rotateCW', 'rotateCW').state;
      expect(activeCells(turned)).toEqual(activeCells(start));
      expect(must(turned.active).rotation).toBe(0);
    },
  );

  it.each(PIECE_KINDS)(
    'REQ-004 #6 %s: CW followed by CCW returns to the original state',
    (kind) => {
      for (const rotation of [0, 1, 2, 3] as const) {
        const start = stateWith({ kind, rotation, x: 3, y: 8 });
        const back = act(start, 'rotateCW', 'rotateCCW').state;
        expect(back.active).toEqual(start.active);
        expect(back.board).toBe(start.board);
      }
    },
  );

  it('REQ-005 #7 rotating the O piece leaves the state unchanged (same reference, no events)', () => {
    const start = stateWith({ kind: 'O', rotation: 0, x: 4, y: 5 });
    for (const type of ['rotateCW', 'rotateCCW'] as const) {
      const result = applyAction(start, { type });
      expect(result.state).toBe(start);
      expect(result.events).toEqual([]);
    }
    expect(tryRotate(start.board, must(start.active), 1)).toBeNull();
  });

  it('REQ-004 #8 a T against the left wall rotates with a kick (kick index and final cells)', () => {
    // T in state R with its stem flush on the left wall: box x = -1.
    const start = stateWith({ kind: 'T', rotation: 1, x: -1, y: 10 });
    expect(activeCells(start)).toEqual(cells([0, 10], [0, 11], [1, 11], [0, 12]));

    const cw = applyAction(start, { type: 'rotateCW' });
    expect(cw.events).toEqual([{ type: 'rotated', rotation: 2, kickIndex: 1 }]);
    expect(cw.state.active).toEqual({ kind: 'T', rotation: 2, x: 0, y: 10 });
    expect(activeCells(cw.state)).toEqual(cells([0, 11], [1, 11], [2, 11], [1, 12]));

    const ccw = applyAction(start, { type: 'rotateCCW' });
    expect(ccw.events).toEqual([{ type: 'rotated', rotation: 0, kickIndex: 1 }]);
    expect(activeCells(ccw.state)).toEqual(cells([1, 10], [0, 11], [1, 11], [2, 11]));
  });

  it('REQ-004 #9 a vertical I against the right wall rotates to horizontal via the I kick table', () => {
    // I in state R occupies box column 2; box x = 7 puts it in board column 9.
    const start = stateWith({ kind: 'I', rotation: 1, x: 7, y: 10 });
    expect(activeCells(start)).toEqual(cells([9, 10], [9, 11], [9, 12], [9, 13]));

    const cw = applyAction(start, { type: 'rotateCW' });
    expect(cw.events).toEqual([{ type: 'rotated', rotation: 2, kickIndex: 1 }]);
    expect(activeCells(cw.state)).toEqual(cells([6, 12], [7, 12], [8, 12], [9, 12]));

    const ccw = applyAction(start, { type: 'rotateCCW' });
    expect(ccw.events).toEqual([{ type: 'rotated', rotation: 0, kickIndex: 2 }]);
    expect(activeCells(ccw.state)).toEqual(cells([6, 11], [7, 11], [8, 11], [9, 11]));
  });

  it('REQ-004 #10 a rotation that fails all 5 kicks leaves the state unchanged', () => {
    // A vertical I deep in a one-wide well: no horizontal placement fits anywhere the kicks reach.
    const well = boardOf(...Array.from({ length: 10 }, () => 'GGGG.GGGGG'));
    const start = stateWith({ kind: 'I', rotation: 1, x: 2, y: 12 }, well);
    for (const [type, to] of [
      ['rotateCW', 2],
      ['rotateCCW', 0],
    ] as const) {
      const piece = must(start.active);
      for (const kick of kickOffsets('I', 1, to)) {
        const moved = { ...piece, rotation: to, x: piece.x + kick.x, y: piece.y + kick.y };
        expect(collides(well, pieceCells(moved))).toBe(true);
      }
      const result = applyAction(start, { type });
      expect(result.state).toBe(start);
      expect(result.events).toEqual([]);
    }
  });

  it('REQ-004 #11 a known kick into a T-spin slot lands in the expected cells', () => {
    const board = boardOf(
      'GGGG......', // row 14: the overhang above the slot
      'GGG...GGGG', // row 15: the T starts here, pointing up
      'GGG.GGGGGG', // row 16
      'GGG..GGGGG', // row 17
      'GGG.GGGGGG', // row 18
      'GGGGGGGGG.', // row 19
    );
    const start = stateWith({ kind: 'T', rotation: 0, x: 3, y: 14 }, board);
    expect(activeCells(start)).toEqual(cells([4, 14], [3, 15], [4, 15], [5, 15]));

    const spun = applyAction(start, { type: 'rotateCW' });
    // 0→R tests (0,0) (−1,0) (−1,+1) (0,−2) all collide; test 5 (−1,−2) → board (−1, +2) fits.
    expect(spun.events).toEqual([{ type: 'rotated', rotation: 1, kickIndex: 4 }]);
    expect(spun.state.active).toEqual({ kind: 'T', rotation: 1, x: 2, y: 16 });
    expect(activeCells(spun.state)).toEqual(cells([3, 16], [3, 17], [4, 17], [3, 18]));

    const locked = applyAction(spun.state, { type: 'hardDrop' });
    expect(locked.events).toContainEqual({ type: 'linesCleared', count: 3, rows: [16, 17, 18] });
    // Rows 16–18 cleared; rows 14–15 drop three rows; row 19 stays.
    expect(bottom(locked.state.board, 4)).toEqual([
      '..........',
      'GGGG......',
      'GGG...GGGG',
      'GGGGGGGGG.',
    ]);
  });

  it('REQ-004 #12 rotation never places a cell above row 0', () => {
    // From spawn (row 0) the I's first three 0→R tests reach y = −1; test 4 (−2,−1) → (−2,+1) fits.
    const spawned = createPlayerState({ queue: ['I'] });
    const cw = applyAction(spawned, { type: 'rotateCW' });
    expect(cw.events).toEqual([{ type: 'rotated', rotation: 1, kickIndex: 3 }]);
    expect(activeCells(cw.state)).toEqual(cells([3, 0], [3, 1], [3, 2], [3, 3]));
    const ccw = applyAction(spawned, { type: 'rotateCCW' });
    expect(ccw.events).toEqual([{ type: 'rotated', rotation: 3, kickIndex: 4 }]);
    expect(activeCells(ccw.state)).toEqual(cells([6, 0], [6, 1], [6, 2], [6, 3]));

    // Block that kick with a cell at (3, 2): the only test left clear of the stack is (+1,+2), which
    // would put the I at y = −3..0 — above row 0, so the rotation is rejected.
    const tight = createPlayerState({
      queue: ['I'],
      board: [
        '..........',
        '..........',
        '...G......',
        ...Array.from({ length: 17 }, () => '..........'),
      ],
    });
    const result = applyAction(tight, { type: 'rotateCW' });
    expect(result.state).toBe(tight);
    expect(result.events).toEqual([]);
  });

  it('REQ-004 #12 no sequence of rotations from spawn reaches above row 0 (every piece, 4 deep)', () => {
    const turns: ActionType[] = ['rotateCW', 'rotateCCW'];
    for (const kind of PIECE_KINDS) {
      let frontier = [createPlayerState({ queue: [kind] })];
      for (let depth = 0; depth < 4; depth += 1) {
        frontier = frontier.flatMap((state) =>
          turns.map((type) => applyAction(state, { type }).state),
        );
        for (const state of frontier) {
          for (const cell of activeCells(state)) expect(cell.y).toBeGreaterThanOrEqual(0);
          expect(picture(state).join('')).toContain('#');
        }
      }
    }
  });

  it('REQ-004 tryRotate returns the first non-colliding kick or null', () => {
    const piece: ActivePiece = { kind: 'T', rotation: 1, x: -1, y: 10 };
    expect(tryRotate(emptyBoard(), piece, 1)).toEqual({
      piece: { kind: 'T', rotation: 2, x: 0, y: 10 },
      kickIndex: 1,
    });
    expect(tryRotate(emptyBoard(), { kind: 'J', rotation: 3, x: 4, y: 4 }, -1)).toEqual({
      piece: { kind: 'J', rotation: 2, x: 4, y: 4 },
      kickIndex: 0,
    });
  });
});
