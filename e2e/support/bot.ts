/**
 * A small greedy stacker, used to make a real line clear happen in a real browser. It reads the
 * falling piece from the board canvas's `data-active` hook (`kind:rotation:x:y`), tracks its own
 * locked cells with the engine's pure board functions, and drives the game with the keyboard only.
 */
import type { Page } from '@playwright/test';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  collides,
  fullRows,
  pieceCells,
  removeRows,
  writeCells,
  type ActivePiece,
  type Board,
  type Rotation,
} from '../../packages/engine/src/index.ts';
import { DATA_HOOKS, TEST_IDS, ownStat, COPY, sleep } from './app.ts';

const ROTATIONS: readonly Rotation[] = [0, 1, 2, 3];

/** Parses the `data-active` hook; null for '' (no piece) or anything malformed. */
export function parseActive(value: string | null): ActivePiece | null {
  if (value === null || value === '') return null;
  const [kind, rotation, x, y] = value.split(':');
  if (kind === undefined || rotation === undefined || x === undefined || y === undefined) {
    return null;
  }
  if (!/^[IOTSZJL]$/.test(kind)) return null;
  const rot = Number(rotation);
  if (rot !== 0 && rot !== 1 && rot !== 2 && rot !== 3) return null;
  return { kind: kind as ActivePiece['kind'], rotation: rot, x: Number(x), y: Number(y) };
}

interface Landing {
  readonly board: Board;
  readonly lines: number;
}

/** The piece hard-dropped from where it is; null when it does not fit where it stands. */
function land(board: Board, piece: ActivePiece): Landing | null {
  if (collides(board, pieceCells(piece))) return null;
  let current = piece;
  for (;;) {
    const lower = { ...current, y: current.y + 1 };
    if (collides(board, pieceCells(lower))) break;
    current = lower;
  }
  const written = writeCells(board, pieceCells(current), current.kind);
  const rows = fullRows(written);
  return { board: removeRows(written, rows), lines: rows.length };
}

function score(landing: Landing): number {
  const heights = Array.from({ length: BOARD_WIDTH }, () => 0);
  let holes = 0;
  for (let x = 0; x < BOARD_WIDTH; x += 1) {
    let seenTop = false;
    for (let y = 0; y < BOARD_HEIGHT; y += 1) {
      const filled = landing.board[y]?.charAt(x) !== '.';
      if (filled && !seenTop) {
        seenTop = true;
        heights[x] = BOARD_HEIGHT - y;
      } else if (!filled && seenTop) {
        holes += 1;
      }
    }
  }
  let bumpiness = 0;
  for (let x = 1; x < BOARD_WIDTH; x += 1) {
    bumpiness += Math.abs((heights[x] ?? 0) - (heights[x - 1] ?? 0));
  }
  const total = heights.reduce((sum, h) => sum + h, 0);
  return landing.lines * 1000 - holes * 60 - total - bumpiness * 3;
}

export interface Plan {
  readonly rotation: Rotation;
  readonly x: number;
  readonly after: Board;
}

/** The best rotation and column for a piece at its spawn, or null when nothing fits. */
export function plan(board: Board, piece: ActivePiece): Plan | null {
  let best: { plan: Plan; value: number } | null = null;
  for (const rotation of ROTATIONS) {
    for (let x = -3; x < BOARD_WIDTH; x += 1) {
      const landing = land(board, { ...piece, rotation, x });
      if (landing === null) continue;
      const value = score(landing);
      if (best === null || value > best.value) {
        best = { plan: { rotation, x, after: landing.board }, value };
      }
    }
  }
  return best?.plan ?? null;
}

async function readActive(page: Page): Promise<ActivePiece | null> {
  const value = await page.getByTestId(TEST_IDS.game.ownCanvas).getAttribute(DATA_HOOKS.active);
  return parseActive(value);
}

/**
 * Places the falling piece where `plan` says, then hard-drops it and waits for the piece counter to
 * move on. Returns the new locked board, or null when the round is no longer being played.
 */
export async function placeOnePiece(page: Page, board: Board): Promise<Board | null> {
  const piecesBefore = await ownStat(page, COPY.game.pieces);
  const spawned = await readActive(page);
  if (spawned === null) return null;
  const target = plan(board, spawned);
  if (target === null) return null;

  for (let step = 0; step < 24; step += 1) {
    const current = await readActive(page);
    if (current?.kind !== spawned.kind) return null;
    let key: string | null = null;
    if (current.rotation !== target.rotation) key = 'ArrowUp';
    else if (current.x < target.x) key = 'ArrowRight';
    else if (current.x > target.x) key = 'ArrowLeft';
    if (key === null) break;
    await page.keyboard.press(key);
    await sleep(25);
  }
  await page.keyboard.press('Space');
  for (let i = 0; i < 80; i += 1) {
    if ((await ownStat(page, COPY.game.pieces)) > piecesBefore) return target.after;
    await sleep(25);
  }
  return null;
}
