/**
 * Player state, actions, the per-tick step and the lock sequence (architecture §2.5, design §5.1).
 * Everything is pure: every function returns a new state (or the input itself when nothing changed)
 * and never mutates its arguments.
 */
import { drawPiece } from './bag.js';
import {
  collides,
  emptyBoard,
  fullRows,
  insertGarbage,
  parseBoard,
  removeRows,
  writeCells,
} from './board.js';
import { LOCK_DELAY_TICKS, MAX_LOCK_RESETS, PREVIEW_COUNT, fallInterval } from './config.js';
import { attackFor, cancelGarbage } from './garbage.js';
import { pieceCells, spawnPiece } from './pieces.js';
import { tryRotate } from './srs.js';
import type {
  Action,
  ActivePiece,
  BagState,
  BestMoment,
  Board,
  EngineEvent,
  GarbageAttack,
  PieceKind,
  PlayerState,
  PlayerStats,
  StepResult,
} from './types.js';

export interface CreatePlayerOptions {
  /** Server: createBag(pieceSeed). Tests and prediction: null (the default). */
  readonly bag?: BagState | null;
  /** Drawn before the bag; the first one spawns unless `active` is given. */
  readonly queue?: readonly PieceKind[];
  /** Default emptyBoard(). Validated with parseBoard. */
  readonly board?: Board;
  /** Tests: place a piece directly (no spawn). */
  readonly active?: ActivePiece | null;
  readonly pendingGarbage?: readonly GarbageAttack[];
  /** Default 0. */
  readonly tick?: number;
}

function unchanged(state: PlayerState): StepResult {
  return { state, events: [] };
}

/** Draws from the bag until the queue holds at least `size` pieces. */
function topUp(
  queue: readonly PieceKind[],
  bag: BagState,
  size: number,
): { queue: readonly PieceKind[]; bag: BagState } {
  if (queue.length >= size) return { queue, bag };
  const next = [...queue];
  let current = bag;
  while (next.length < size) {
    const drawn = drawPiece(current);
    next.push(drawn.piece);
    current = drawn.bag;
  }
  return { queue: next, bag: current };
}

export function createPlayerState(options: CreatePlayerOptions = {}): PlayerState {
  const tick = options.tick ?? 0;
  if (!Number.isInteger(tick) || tick < 0) {
    throw new RangeError(`tick must be an integer ≥ 0, got ${String(tick)}.`);
  }
  const base: PlayerState = {
    tick,
    board: options.board === undefined ? emptyBoard() : parseBoard(options.board),
    active: null,
    queue: [...(options.queue ?? [])],
    bag: options.bag ?? null,
    pendingGarbage: (options.pendingGarbage ?? []).map(({ rows, holeColumn }) => ({
      rows,
      holeColumn,
    })),
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
  };
  if (options.active === undefined) return spawnNext(base, []);
  const filled =
    base.bag === null ? base : { ...base, ...topUp(base.queue, base.bag, PREVIEW_COUNT) };
  return { ...filled, active: options.active, lowestY: options.active?.y ?? 0 };
}

/** collides at y + 1. */
export function isGrounded(board: Board, piece: ActivePiece): boolean {
  return collides(board, pieceCells({ ...piece, y: piece.y + 1 }));
}

function dropToFloor(board: Board, piece: ActivePiece): ActivePiece {
  let y = piece.y;
  while (!collides(board, pieceCells({ ...piece, y: y + 1 }))) y += 1;
  return y === piece.y ? piece : { ...piece, y };
}

/** Where a hard drop would land the active piece; null when there is none. */
export function ghostPosition(state: PlayerState): ActivePiece | null {
  return state.active === null ? null : dropToFloor(state.board, state.active);
}

export function playerStats(state: PlayerState): PlayerStats {
  return {
    linesCleared: state.linesCleared,
    garbageSent: state.garbageSent,
    garbageCancelled: state.garbageCancelled,
    piecesPlaced: state.piecesPlaced,
    bestCombo: state.bestCombo,
    bestMoment: state.bestMoment,
  };
}

/**
 * Spawn step of the lock sequence (also used by createPlayerState). Pushes its events.
 * Empty queue (bag null) → active null + `starved`. Blocked spawn → top-out, SPAWN_BLOCKED.
 */
function spawnNext(state: PlayerState, events: EngineEvent[]): PlayerState {
  let { queue, bag } = state;
  if (bag !== null) ({ queue, bag } = topUp(queue, bag, 1));
  const kind = queue[0];
  if (kind === undefined) {
    events.push({ type: 'starved' });
    return { ...state, active: null };
  }
  queue = queue.slice(1);
  if (bag !== null) ({ queue, bag } = topUp(queue, bag, PREVIEW_COUNT));
  const piece = spawnPiece(kind);
  const next: PlayerState = {
    ...state,
    queue,
    bag,
    gravityCounter: 0,
    lockCounter: 0,
    lockResets: 0,
    lowestY: piece.y,
  };
  if (collides(next.board, pieceCells(piece))) {
    events.push({ type: 'toppedOut', reason: 'SPAWN_BLOCKED' });
    return { ...next, active: null, toppedOut: true };
  }
  events.push({ type: 'spawned', kind });
  return { ...next, active: piece };
}

/** The lock sequence (design §5.1, architecture §2.5). The order of steps and events is exact. */
function lockPiece(state: PlayerState, piece: ActivePiece): StepResult {
  const events: EngineEvent[] = [];

  // 1. Write the cells.
  const cells = Object.freeze(pieceCells(piece));
  const written = writeCells(state.board, cells, piece.kind);
  events.push({ type: 'locked', kind: piece.kind, cells });
  let next: PlayerState = {
    ...state,
    board: written,
    active: null,
    piecesPlaced: state.piecesPlaced + 1,
  };

  // 2. Find and remove full rows (the best-moment candidate board is `written`).
  const rows = Object.freeze(fullRows(written));
  const lines = rows.length;
  if (lines > 0) {
    next = { ...next, board: removeRows(written, rows), linesCleared: next.linesCleared + lines };
    events.push({ type: 'linesCleared', count: lines, rows });

    // 3. Clearing lock: combo, attack, cancelling, best moment. Pending garbage is not inserted.
    const combo = next.combo + 1;
    events.push({ type: 'combo', count: combo });
    const attack = attackFor(lines, combo);
    const spent = cancelGarbage(next.pendingGarbage, attack);
    if (spent.cancelled > 0) events.push({ type: 'garbageCancelled', rows: spent.cancelled });
    if (spent.leftover > 0) events.push({ type: 'attack', rows: spent.leftover });
    const best = next.bestMoment;
    const replace =
      best === null || combo > best.combo || (combo === best.combo && attack > best.attack);
    const candidate: BestMoment = {
      board: written,
      clearedRows: rows,
      pieceCells: cells,
      combo,
      linesCleared: lines,
      attack,
      sent: spent.leftover,
      cancelled: spent.cancelled,
      tick: state.tick,
    };
    next = {
      ...next,
      combo,
      bestCombo: Math.max(next.bestCombo, combo),
      pendingGarbage: spent.pending,
      garbageSent: next.garbageSent + spent.leftover,
      garbageCancelled: next.garbageCancelled + spent.cancelled,
      bestMoment: replace ? candidate : best,
    };
  } else {
    // 4. Non-clearing lock: combo resets; all pending garbage goes in, oldest first (newest lowest).
    next = { ...next, combo: 0 };
    if (next.pendingGarbage.length > 0) {
      let board = next.board;
      let overflow = false;
      let inserted = 0;
      for (const attack of next.pendingGarbage) {
        const result = insertGarbage(board, attack.rows, attack.holeColumn);
        board = result.board;
        overflow = overflow || result.overflow;
        inserted += attack.rows;
      }
      next = {
        ...next,
        board,
        pendingGarbage: [],
        garbageInserted: next.garbageInserted + inserted,
      };
      events.push({ type: 'garbageInserted', rows: inserted });
      if (overflow) {
        events.push({ type: 'toppedOut', reason: 'GARBAGE_OVERFLOW' });
        return { state: { ...next, toppedOut: true }, events };
      }
    }
  }

  // 5. Spawn.
  return { state: spawnNext(next, events), events };
}

/** Shared bookkeeping after a successful move or rotation (architecture §2.5, steps 2–4). */
function afterShift(state: PlayerState, before: ActivePiece, after: ActivePiece): PlayerState {
  let { lockCounter, lockResets, lowestY } = state;
  if (isGrounded(state.board, before) && lockResets < MAX_LOCK_RESETS) {
    lockCounter = 0;
    lockResets += 1;
  }
  if (after.y > lowestY) {
    lowestY = after.y;
    lockResets = 0;
  }
  return { ...state, active: after, lockCounter, lockResets, lowestY };
}

function move(state: PlayerState, piece: ActivePiece, dx: -1 | 1): StepResult {
  const moved: ActivePiece = { ...piece, x: piece.x + dx };
  if (collides(state.board, pieceCells(moved))) return unchanged(state);
  return { state: afterShift(state, piece, moved), events: [{ type: 'moved', dx }] };
}

function rotate(state: PlayerState, piece: ActivePiece, direction: 1 | -1): StepResult {
  const result = tryRotate(state.board, piece, direction);
  if (result === null) return unchanged(state);
  return {
    state: afterShift(state, piece, result.piece),
    events: [{ type: 'rotated', rotation: result.piece.rotation, kickIndex: result.kickIndex }],
  };
}

function setSoftDrop(state: PlayerState, softDrop: boolean): StepResult {
  return state.softDrop === softDrop
    ? unchanged(state)
    : { state: { ...state, softDrop }, events: [] };
}

/** Pure; never advances the tick. Unchanged input → the same state reference and no events. */
export function applyAction(state: PlayerState, action: Action): StepResult {
  const piece = state.active;
  if (state.toppedOut || piece === null) return unchanged(state);
  switch (action.type) {
    case 'moveLeft':
      return move(state, piece, -1);
    case 'moveRight':
      return move(state, piece, 1);
    case 'rotateCW':
      return rotate(state, piece, 1);
    case 'rotateCCW':
      return rotate(state, piece, -1);
    case 'softDropStart':
      return setSoftDrop(state, true);
    case 'softDropStop':
      return setSoftDrop(state, false);
    case 'hardDrop': {
      const landed = dropToFloor(state.board, piece);
      return lockPiece({ ...state, active: landed }, landed);
    }
    default:
      // Unreachable for a typed Action; a malformed one from outside is ignored, never thrown.
      return unchanged(state);
  }
}

/**
 * Processes tick `state.tick` at `level`: gravity, then lock delay; then tick += 1 (also after a lock or
 * a top-out on this tick). A topped-out or starved state is returned unchanged and the tick does not advance.
 */
export function tick(state: PlayerState, level: number): StepResult {
  const piece = state.active;
  if (state.toppedOut || piece === null) return unchanged(state);

  let { gravityCounter, lockCounter, lockResets, lowestY } = state;
  let active = piece;
  gravityCounter += 1;
  if (gravityCounter >= fallInterval(level, state.softDrop)) {
    gravityCounter = 0;
    const down: ActivePiece = { ...active, y: active.y + 1 };
    if (!collides(state.board, pieceCells(down))) {
      active = down;
      lockCounter = 0;
      if (down.y > lowestY) {
        lowestY = down.y;
        lockResets = 0;
      }
    }
  }

  let next: PlayerState = { ...state, active, gravityCounter, lockCounter, lockResets, lowestY };
  let events: readonly EngineEvent[] = [];
  if (isGrounded(state.board, active)) {
    lockCounter += 1;
    next = { ...next, lockCounter };
    if (lockCounter >= LOCK_DELAY_TICKS) ({ state: next, events } = lockPiece(next, active));
  }
  return { state: { ...next, tick: state.tick + 1 }, events };
}
