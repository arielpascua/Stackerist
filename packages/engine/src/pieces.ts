/**
 * Piece table, spawn positions and cell maths (source spec §3.2).
 */
import type { ActivePiece, Cell, PieceKind, Rotation } from './types.js';

/** The bag's base order. Fixed, because the shuffle starts from it (determinism). */
export const PIECE_KINDS: readonly PieceKind[] = Object.freeze(['I', 'O', 'T', 'S', 'Z', 'J', 'L']);

export interface PieceDef {
  /** Bounding box size n. */
  readonly size: 2 | 3 | 4;
  /** Cells in box coordinates, rotation 0 (source spec §3.2). */
  readonly cells: readonly Cell[];
  /** Box origin on the board: 3 (O: 4). */
  readonly spawnX: number;
  /** I: -1, others: 0. */
  readonly spawnY: number;
}

function definePiece(
  size: PieceDef['size'],
  boxCells: readonly (readonly [number, number])[],
  spawnX: number,
  spawnY: number,
): PieceDef {
  const cells = Object.freeze(boxCells.map(([x, y]) => Object.freeze({ x, y })));
  return Object.freeze({ size, cells, spawnX, spawnY });
}

export const PIECES: Readonly<Record<PieceKind, PieceDef>> = Object.freeze({
  I: definePiece(
    4,
    [
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ],
    3,
    -1,
  ),
  O: definePiece(
    2,
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
    4,
    0,
  ),
  T: definePiece(
    3,
    [
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    3,
    0,
  ),
  S: definePiece(
    3,
    [
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
    ],
    3,
    0,
  ),
  Z: definePiece(
    3,
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
    3,
    0,
  ),
  J: definePiece(
    3,
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    3,
    0,
  ),
  L: definePiece(
    3,
    [
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    3,
    0,
  ),
});

/** The piece at rotation 0 on its spawn origin. */
export function spawnPiece(kind: PieceKind): ActivePiece {
  const def = PIECES[kind];
  return { kind, rotation: 0, x: def.spawnX, y: def.spawnY };
}

/** Rotates box cells clockwise `turnsCW` times: (x, y) → (n − 1 − y, x) per turn. Order is preserved. */
export function rotateBoxCells(cells: readonly Cell[], size: number, turnsCW: Rotation): Cell[] {
  let out = cells.map(({ x, y }) => ({ x, y }));
  for (let turn = 0; turn < turnsCW; turn += 1) {
    out = out.map(({ x, y }) => ({ x: size - 1 - y, y: x }));
  }
  return out;
}

type RotationCells = readonly [readonly Cell[], readonly Cell[], readonly Cell[], readonly Cell[]];

function readingOrder(a: Cell, b: Cell): number {
  return a.y - b.y || a.x - b.x;
}

function rotationsOf(def: PieceDef): RotationCells {
  const at = (turns: Rotation): readonly Cell[] =>
    Object.freeze(
      rotateBoxCells(def.cells, def.size, turns)
        .sort(readingOrder)
        .map((cell) => Object.freeze(cell)),
    );
  return [at(0), at(1), at(2), at(3)];
}

/** Box cells per kind and rotation, precomputed, in reading order (top row first, then left to right). */
const ROTATED: Readonly<Record<PieceKind, RotationCells>> = Object.freeze({
  I: rotationsOf(PIECES.I),
  O: rotationsOf(PIECES.O),
  T: rotationsOf(PIECES.T),
  S: rotationsOf(PIECES.S),
  Z: rotationsOf(PIECES.Z),
  J: rotationsOf(PIECES.J),
  L: rotationsOf(PIECES.L),
});

/** The piece's 4 cells in board coordinates, in reading order. */
export function pieceCells(piece: ActivePiece): Cell[] {
  return ROTATED[piece.kind][piece.rotation].map(({ x, y }) => ({
    x: piece.x + x,
    y: piece.y + y,
  }));
}
