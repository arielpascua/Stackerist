/**
 * Pure 7-bag (source spec §3.4): each bag is a Fisher–Yates shuffle of all seven pieces, driven by
 * mulberry32. Same seed ⇒ identical infinite sequence.
 */
import { PIECE_KINDS } from './pieces.js';
import { rngInt, seedRng } from './rng.js';
import type { BagState, PieceKind } from './types.js';

/** A bag with nothing drawn yet: `remaining` is empty, so the first draw shuffles. */
export function createBag(seed: number): BagState {
  return { rng: seedRng(seed), remaining: [] };
}

/** Fisher–Yates over a copy of PIECE_KINDS, i from 6 down to 1, j = rngInt(state, i + 1). */
function shuffle(rng: number): { readonly pieces: PieceKind[]; readonly rng: number } {
  const pieces = [...PIECE_KINDS];
  let state = rng;
  for (let i = pieces.length - 1; i >= 1; i -= 1) {
    const step = rngInt(state, i + 1);
    state = step.state;
    const atI = pieces[i];
    const atJ = pieces[step.value];
    if (atI !== undefined && atJ !== undefined) {
      pieces[i] = atJ;
      pieces[step.value] = atI;
    }
  }
  return { pieces, rng: state };
}

export function drawPiece(bag: BagState): { readonly piece: PieceKind; readonly bag: BagState } {
  let { rng, remaining } = bag;
  if (remaining.length === 0) ({ pieces: remaining, rng } = shuffle(rng));
  const piece = remaining[0];
  if (piece === undefined) throw new Error('A shuffled bag always holds seven pieces.');
  return { piece, bag: { rng, remaining: remaining.slice(1) } };
}

export function drawPieces(
  bag: BagState,
  n: number,
): { readonly pieces: PieceKind[]; readonly bag: BagState } {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`drawPieces count must be a non-negative integer, got ${String(n)}.`);
  }
  const pieces: PieceKind[] = [];
  let current = bag;
  for (let i = 0; i < n; i += 1) {
    const drawn = drawPiece(current);
    pieces.push(drawn.piece);
    current = drawn.bag;
  }
  return { pieces, bag: current };
}
