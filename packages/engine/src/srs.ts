/**
 * SRS rotation with wall kicks (source spec §3.3). Tables are verbatim in the SRS convention (+y is UP);
 * kickOffsets converts each offset to board space as (dx, −dy).
 */
import { collides } from './board.js';
import { pieceCells } from './pieces.js';
import type { ActivePiece, Board, Cell, PieceKind, Rotation } from './types.js';

export type KickKey = '0>1' | '1>0' | '1>2' | '2>1' | '2>3' | '3>2' | '3>0' | '0>3';
export type KickTable = Readonly<Record<KickKey, readonly (readonly [dx: number, dy: number])[]>>;

/** Deep-freezes a kick table, so no consumer can change rotation behaviour at runtime. */
function freezeTable(table: KickTable): KickTable {
  for (const tests of Object.values(table)) {
    for (const offset of tests) Object.freeze(offset);
    Object.freeze(tests);
  }
  return Object.freeze(table);
}

/** J, L, S, T, Z. Rotation states 0, R = 1, 2, L = 3. */
export const JLSTZ_KICKS: KickTable = freezeTable({
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
});

export const I_KICKS: KickTable = freezeTable({
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
});

function kickKey(from: Rotation, to: Rotation): KickKey | null {
  const step = (to - from + 4) % 4;
  if (step !== 1 && step !== 3) return null;
  return `${String(from)}>${String(to)}` as KickKey;
}

/** The 5 offsets converted to board space (dx, −dy). O, or a non-adjacent pair of states → []. */
export function kickOffsets(kind: PieceKind, from: Rotation, to: Rotation): readonly Cell[] {
  const key = kickKey(from, to);
  if (kind === 'O' || key === null) return [];
  const table = kind === 'I' ? I_KICKS : JLSTZ_KICKS;
  // `0 - dy` (not `-dy`) so a zero offset stays +0.
  return table[key].map(([dx, dy]) => ({ x: dx, y: 0 - dy }));
}

function turn(rotation: Rotation, direction: 1 | -1): Rotation {
  return ((rotation + direction + 4) % 4) as Rotation;
}

/** First non-colliding kick, or null (state then unchanged). direction: 1 = CW, −1 = CCW. */
export function tryRotate(
  board: Board,
  piece: ActivePiece,
  direction: 1 | -1,
): { piece: ActivePiece; kickIndex: number } | null {
  if (piece.kind === 'O') return null;
  const rotation = turn(piece.rotation, direction);
  const offsets = kickOffsets(piece.kind, piece.rotation, rotation);
  for (const [kickIndex, offset] of offsets.entries()) {
    const candidate: ActivePiece = {
      kind: piece.kind,
      rotation,
      x: piece.x + offset.x,
      y: piece.y + offset.y,
    };
    if (!collides(board, pieceCells(candidate))) return { piece: candidate, kickIndex };
  }
  return null;
}
