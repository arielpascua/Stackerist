import {
  BOARD_HEIGHT,
  EMPTY_ROW,
  applyAction,
  parseBoard,
  pieceCells,
  tick,
  type ActionType,
  type ActivePiece,
  type Board,
  type Cell,
  type EngineEvent,
  type PlayerState,
  type StepResult,
} from '../src/index.js';

/** Recursively freezes a value, so any write inside the engine throws (ES modules run in strict mode). */
export function deepFreeze<T>(value: T): T {
  const seen = new WeakSet<object>();
  const visit = (node: unknown): void => {
    if (typeof node !== 'object' || node === null || seen.has(node)) return;
    seen.add(node);
    for (const child of Object.values(node)) visit(child);
    Object.freeze(node);
  };
  visit(value);
  return value;
}

/** A full 20-row board from its bottom rows; every row above them is empty. */
export function boardOf(...bottomRows: string[]): Board {
  const blank = Array.from({ length: BOARD_HEIGHT - bottomRows.length }, () => EMPTY_ROW);
  return parseBoard([...blank, ...bottomRows]);
}

export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

/** Cells in reading order (top row first, then left to right). */
export function byRow(cells: readonly Cell[]): Cell[] {
  return [...cells].sort((a, b) => a.y - b.y || a.x - b.x);
}

export function cells(...pairs: (readonly [number, number])[]): Cell[] {
  return byRow(pairs.map(([x, y]) => ({ x, y })));
}

export function activeCells(state: PlayerState): Cell[] {
  return byRow(pieceCells(must(state.active)));
}

/** Applies the actions in order and concatenates their events. */
export function act(state: PlayerState, ...types: ActionType[]): StepResult {
  let current = state;
  const events: EngineEvent[] = [];
  for (const type of types) {
    const result = applyAction(current, { type });
    current = result.state;
    events.push(...result.events);
  }
  return { state: current, events };
}

/** Runs `n` ticks at `level` and concatenates their events. */
export function ticks(state: PlayerState, n: number, level = 0): StepResult {
  let current = state;
  const events: EngineEvent[] = [];
  for (let i = 0; i < n; i += 1) {
    const result = tick(current, level);
    current = result.state;
    events.push(...result.events);
  }
  return { state: current, events };
}

export function types(events: readonly EngineEvent[]): string[] {
  return events.map((event) => event.type);
}

/**
 * Test shortcut for steering: puts `piece` in play where a player could have moved it, then hard-drops.
 * Everything after that (lock, clears, combo, garbage, spawn) is the real lock sequence.
 */
export function dropAt(state: PlayerState, piece: ActivePiece): StepResult {
  return applyAction({ ...state, active: piece }, { type: 'hardDrop' });
}

/** The board as strings with the active piece drawn as '#', for picture-style assertions. */
export function picture(state: PlayerState): string[] {
  const rows = [...state.board];
  if (state.active === null) return rows;
  for (const { x, y } of pieceCells(state.active)) {
    const row = must(rows[y]);
    rows[y] = row.slice(0, x) + '#' + row.slice(x + 1);
  }
  return rows;
}

/** The last `n` rows of a board (the readable part of a bottom-heavy fixture). */
export function bottom(board: Board | readonly string[], n: number): string[] {
  return board.slice(BOARD_HEIGHT - n);
}

/** Horizontal I dropped straight down columns 6..9 (the "single machine" fixtures). */
export const I_FLAT_RIGHT: ActivePiece = { kind: 'I', rotation: 0, x: 6, y: -1 };
/** Vertical I (state R, box column 2) in column 0. */
export const I_UP_COL0: ActivePiece = { kind: 'I', rotation: 1, x: -2, y: 0 };
/** Vertical I (state R, box column 2) in column 9. */
export const I_UP_COL9: ActivePiece = { kind: 'I', rotation: 1, x: 7, y: 0 };
/** O at columns `x`, `x + 1`, dropped from the top. */
export function oAt(x: number): ActivePiece {
  return { kind: 'O', rotation: 0, x, y: 0 };
}

/** n rows of `GGGGGG....`: each horizontal I dropped into columns 6..9 clears exactly one row. */
export function singleMachine(n: number): string[] {
  return Array.from({ length: n }, () => 'GGGGGG....');
}
