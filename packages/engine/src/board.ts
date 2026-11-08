/**
 * Board construction, the serialized form, collision, rows and garbage insertion (source spec §3.1).
 * A Board is 20 strings of 10 characters; every function returns a new frozen array and never mutates.
 */
import { BOARD_HEIGHT, BOARD_WIDTH } from './config.js';
import type { Board, Cell, CellKind } from './types.js';

export const EMPTY_ROW: string = '.'.repeat(BOARD_WIDTH);

const ROW_PATTERN = new RegExp(`^[.IOTSZJLG]{${String(BOARD_WIDTH)}}$`);

function freezeRows(rows: string[]): Board {
  return Object.freeze(rows);
}

function inBounds(x: number, y: number): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    x < BOARD_WIDTH &&
    y >= 0 &&
    y < BOARD_HEIGHT
  );
}

export function emptyBoard(): Board {
  return freezeRows(Array.from({ length: BOARD_HEIGHT }, () => EMPTY_ROW));
}

/** Validates 20 rows × 10 chars of '.IOTSZJLG'; throws RangeError otherwise. Returns a frozen copy. */
export function parseBoard(rows: readonly string[]): Board {
  if (rows.length !== BOARD_HEIGHT) {
    throw new RangeError(`A board has ${String(BOARD_HEIGHT)} rows, got ${String(rows.length)}.`);
  }
  rows.forEach((row, y) => {
    if (!ROW_PATTERN.test(row)) {
      throw new RangeError(
        `Row ${String(y)} must be ${String(BOARD_WIDTH)} characters of '.IOTSZJLG'.`,
      );
    }
  });
  return freezeRows([...rows]);
}

/** A fresh mutable copy: the wire and fixture form. */
export function serializeBoard(board: Board): string[] {
  return [...board];
}

/** The kind at (x, y); null when empty or out of bounds. */
export function cellAt(board: Board, x: number, y: number): CellKind | null {
  if (!inBounds(x, y)) return null;
  const char = board[y]?.charAt(x);
  return char === undefined || char === '' || char === '.' ? null : (char as CellKind);
}

/** Filled or out of bounds (REQ-001: no hidden rows; x < 0, x > 9, y < 0 and y > 19 all collide). */
export function isBlocked(board: Board, x: number, y: number): boolean {
  return !inBounds(x, y) || board[y]?.charAt(x) !== '.';
}

export function collides(board: Board, cells: readonly Cell[]): boolean {
  return cells.some(({ x, y }) => isBlocked(board, x, y));
}

/** Writes `kind` at every cell. Throws RangeError for a cell outside the board. */
export function writeCells(board: Board, cells: readonly Cell[], kind: CellKind): Board {
  const rows = [...board];
  for (const { x, y } of cells) {
    const row = rows[y];
    if (!inBounds(x, y) || row === undefined) {
      throw new RangeError(`Cell (${String(x)}, ${String(y)}) is outside the board.`);
    }
    rows[y] = row.slice(0, x) + kind + row.slice(x + 1);
  }
  return freezeRows(rows);
}

/** y of every full row, ascending. */
export function fullRows(board: Board): number[] {
  return board.flatMap((row, y) => (row.includes('.') ? [] : [y]));
}

/** Removes the rows; everything above shifts down and empty rows are added on top. */
export function removeRows(board: Board, rows: readonly number[]): Board {
  if (rows.length === 0) return board;
  const removed = new Set(rows);
  const kept = board.filter((_, y) => !removed.has(y));
  const fill = Array.from({ length: BOARD_HEIGHT - kept.length }, () => EMPTY_ROW);
  return freezeRows([...fill, ...kept]);
}

/**
 * Pushes the stack up by `rows` and adds rows of 9 'G' and one '.' at `holeColumn` at the bottom.
 * `overflow` is true when a filled cell (or a garbage row) is pushed above row 0; the board keeps
 * its bottom 20 rows either way.
 */
export function insertGarbage(
  board: Board,
  rows: number,
  holeColumn: number,
): { board: Board; overflow: boolean } {
  if (!Number.isInteger(rows) || rows < 0) {
    throw new RangeError(`Garbage rows must be a non-negative integer, got ${String(rows)}.`);
  }
  if (!Number.isInteger(holeColumn) || holeColumn < 0 || holeColumn >= BOARD_WIDTH) {
    throw new RangeError(
      `Hole column must be 0..${String(BOARD_WIDTH - 1)}, got ${String(holeColumn)}.`,
    );
  }
  if (rows === 0) return { board, overflow: false };
  const garbageRow = 'G'.repeat(holeColumn) + '.' + 'G'.repeat(BOARD_WIDTH - 1 - holeColumn);
  const overflow = rows > BOARD_HEIGHT || board.slice(0, rows).some((row) => row !== EMPTY_ROW);
  const next = [...board, ...Array.from({ length: rows }, () => garbageRow)].slice(-BOARD_HEIGHT);
  return { board: freezeRows(next), overflow };
}

/**
 * Rows from the floor to the highest filled cell, 0..20 (0 = empty). Locked cells only.
 * Used by the report samples (REQ-090) and the danger pulse (REQ-088).
 */
export function stackHeight(board: Board): number {
  const top = board.findIndex((row) => row !== EMPTY_ROW);
  return top === -1 ? 0 : board.length - top;
}
