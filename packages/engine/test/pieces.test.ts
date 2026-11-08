import { describe, expect, it } from 'vitest';
import {
  PIECES,
  PIECE_KINDS,
  createPlayerState,
  pieceCells,
  rotateBoxCells,
  spawnPiece,
  type PieceKind,
} from '../src/index.js';
import { activeCells, byRow, cells } from './helpers.js';

/** Source spec §3.2, transcribed: box size, spawn cells in the box, box origin on the board. */
const TABLE: readonly {
  kind: PieceKind;
  size: number;
  box: [number, number][];
  origin: [number, number];
  board: [number, number][];
}[] = [
  {
    kind: 'I',
    size: 4,
    box: [
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ],
    origin: [3, -1],
    board: [
      [3, 0],
      [4, 0],
      [5, 0],
      [6, 0],
    ],
  },
  {
    kind: 'O',
    size: 2,
    box: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
    origin: [4, 0],
    board: [
      [4, 0],
      [5, 0],
      [4, 1],
      [5, 1],
    ],
  },
  {
    kind: 'T',
    size: 3,
    box: [
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    origin: [3, 0],
    board: [
      [4, 0],
      [3, 1],
      [4, 1],
      [5, 1],
    ],
  },
  {
    kind: 'S',
    size: 3,
    box: [
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
    ],
    origin: [3, 0],
    board: [
      [4, 0],
      [5, 0],
      [3, 1],
      [4, 1],
    ],
  },
  {
    kind: 'Z',
    size: 3,
    box: [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
    origin: [3, 0],
    board: [
      [3, 0],
      [4, 0],
      [4, 1],
      [5, 1],
    ],
  },
  {
    kind: 'J',
    size: 3,
    box: [
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    origin: [3, 0],
    board: [
      [3, 0],
      [3, 1],
      [4, 1],
      [5, 1],
    ],
  },
  {
    kind: 'L',
    size: 3,
    box: [
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    origin: [3, 0],
    board: [
      [5, 0],
      [3, 1],
      [4, 1],
      [5, 1],
    ],
  },
];

describe('REQ-063 source spec §8.1 — pieces and spawning', () => {
  it('REQ-002 provides exactly the seven pieces I, O, T, S, Z, J, L', () => {
    expect(PIECE_KINDS).toEqual(['I', 'O', 'T', 'S', 'Z', 'J', 'L']);
    expect(Object.keys(PIECES).sort()).toEqual(['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
  });

  it.each(TABLE)(
    'REQ-002 #27 $kind has the box, spawn cells and spawn origin of source spec §3.2',
    ({ kind, size, box, origin, board }) => {
      const def = PIECES[kind];
      expect(def.size).toBe(size);
      expect(byRow(def.cells)).toEqual(cells(...box));
      expect([def.spawnX, def.spawnY]).toEqual(origin);
      const piece = spawnPiece(kind);
      expect(piece).toEqual({ kind, rotation: 0, x: origin[0], y: origin[1] });
      expect(byRow(pieceCells(piece))).toEqual(cells(...board));
    },
  );

  it.each(TABLE)(
    'REQ-002 #27 $kind spawns at its §3.2 position when it comes off the queue',
    ({ kind, board }) => {
      const state = createPlayerState({ queue: [kind] });
      expect(state.active).toEqual(spawnPiece(kind));
      expect(activeCells(state)).toEqual(cells(...board));
      expect(activeCells(state).every((c) => c.y >= 0)).toBe(true);
    },
  );

  it('REQ-002 rotateBoxCells maps (x, y) to (n - 1 - y, x) per clockwise turn', () => {
    const t = PIECES.T.cells;
    expect(rotateBoxCells(t, 3, 0)).toEqual(t);
    expect(byRow(rotateBoxCells(t, 3, 1))).toEqual(
      cells([1, 0], [1, 1], [2, 1], [1, 2]), // T, state R: pointing right
    );
    expect(byRow(rotateBoxCells(t, 3, 2))).toEqual(cells([0, 1], [1, 1], [2, 1], [1, 2]));
    expect(byRow(rotateBoxCells(t, 3, 3))).toEqual(cells([1, 0], [0, 1], [1, 1], [1, 2]));
    expect(byRow(rotateBoxCells(PIECES.I.cells, 4, 1))).toEqual(
      cells([2, 0], [2, 1], [2, 2], [2, 3]), // I, state R: box column 2
    );
    expect(byRow(rotateBoxCells(PIECES.I.cells, 4, 3))).toEqual(
      cells([1, 0], [1, 1], [1, 2], [1, 3]), // I, state L: box column 1
    );
  });

  it('REQ-002 pieceCells offsets the rotated box cells by the box origin', () => {
    expect(byRow(pieceCells({ kind: 'S', rotation: 1, x: 5, y: 10 }))).toEqual(
      cells([6, 10], [6, 11], [7, 11], [7, 12]),
    );
    expect(byRow(pieceCells({ kind: 'I', rotation: 1, x: -2, y: 0 }))).toEqual(
      cells([0, 0], [0, 1], [0, 2], [0, 3]),
    );
  });
});
