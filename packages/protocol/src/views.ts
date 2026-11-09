/**
 * The information-hiding boundary (architecture §3.8, REQ-028). The server builds every view through
 * these functions; the client rebuilds its own predictable state with `ownViewToPlayerState`.
 *
 * Each function copies named fields and fresh arrays only. `bag` (the RNG state and the rest of the
 * 7-bag), the queue beyond the visible slice, and every seed are unreachable from the output, and the
 * output never aliases engine state.
 */
import {
  PREVIEW_COUNT,
  pendingTotal,
  type ActivePiece,
  type BestMoment,
  type GarbageAttack,
  type PlayerState,
} from '@stackerist/engine';
import { PUBLIC_PREVIEW_COUNT } from './constants.js';
import type {
  LiveStats,
  OwnView,
  PlayerStats,
  PublicView,
  WireActivePiece,
  WireBestMoment,
  WireGarbageAttack,
} from './messages.js';

function copyActive(piece: ActivePiece | null): WireActivePiece | null {
  return piece === null
    ? null
    : { kind: piece.kind, rotation: piece.rotation, x: piece.x, y: piece.y };
}

function copyAttack(attack: GarbageAttack): WireGarbageAttack {
  return { rows: attack.rows, holeColumn: attack.holeColumn };
}

function toLiveStats(state: PlayerState): LiveStats {
  return {
    linesCleared: state.linesCleared,
    garbageSent: state.garbageSent,
    garbageCancelled: state.garbageCancelled,
    garbageReceived: state.garbageReceived,
    garbageInserted: state.garbageInserted,
    piecesPlaced: state.piecesPlaced,
    bestCombo: state.bestCombo,
  };
}

/** Opponents and spectators: next = the first PUBLIC_PREVIEW_COUNT (1) pieces; pending = total rows. */
export function toPublicView(state: PlayerState): PublicView {
  return {
    board: [...state.board],
    active: copyActive(state.active),
    next: state.queue.slice(0, PUBLIC_PREVIEW_COUNT),
    pendingGarbage: pendingTotal(state.pendingGarbage),
    combo: state.combo,
    stats: toLiveStats(state),
    toppedOut: state.toppedOut,
  };
}

/**
 * The board's owner: next = the first PREVIEW_COUNT (5) pieces, pending attacks with hole columns, and
 * the piece timers prediction needs. `lastAckSeq` (≥ 0, 0 = nothing acknowledged) comes from the server.
 */
export function toOwnView(state: PlayerState, lastAckSeq: number): OwnView {
  return {
    board: [...state.board],
    active: copyActive(state.active),
    next: state.queue.slice(0, PREVIEW_COUNT),
    pendingGarbage: state.pendingGarbage.map(copyAttack),
    lastAckSeq,
    combo: state.combo,
    stats: toLiveStats(state),
    toppedOut: state.toppedOut,
    softDrop: state.softDrop,
    gravityCounter: state.gravityCounter,
    lockCounter: state.lockCounter,
    lockResets: state.lockResets,
    lowestY: state.lowestY,
  };
}

export function toWireBestMoment(moment: BestMoment): WireBestMoment {
  return {
    board: [...moment.board],
    clearedRows: [...moment.clearedRows],
    pieceCells: moment.pieceCells.map((cell) => ({ x: cell.x, y: cell.y })),
    combo: moment.combo,
    linesCleared: moment.linesCleared,
    attack: moment.attack,
    sent: moment.sent,
    cancelled: moment.cancelled,
    tick: moment.tick,
  };
}

/** The gameOver stats for one seat (design §6, REQ-046). */
export function toPlayerStats(state: PlayerState): PlayerStats {
  return {
    linesCleared: state.linesCleared,
    garbageSent: state.garbageSent,
    garbageCancelled: state.garbageCancelled,
    piecesPlaced: state.piecesPlaced,
    bestCombo: state.bestCombo,
    bestMoment: state.bestMoment === null ? null : toWireBestMoment(state.bestMoment),
  };
}

/**
 * Rebuild a predictable engine state from the owner's view: `bag` null, `queue` = `view.next`,
 * `bestMoment` null, and `tick` = the snapshot's tick (a match tick). Everything else comes from the view.
 */
export function ownViewToPlayerState(view: OwnView, tick: number): PlayerState {
  return {
    tick,
    board: [...view.board],
    active: copyActive(view.active),
    queue: [...view.next],
    bag: null,
    pendingGarbage: view.pendingGarbage.map(copyAttack),
    softDrop: view.softDrop,
    gravityCounter: view.gravityCounter,
    lockCounter: view.lockCounter,
    lockResets: view.lockResets,
    lowestY: view.lowestY,
    combo: view.combo,
    bestCombo: view.stats.bestCombo,
    linesCleared: view.stats.linesCleared,
    garbageSent: view.stats.garbageSent,
    garbageCancelled: view.stats.garbageCancelled,
    garbageReceived: view.stats.garbageReceived,
    garbageInserted: view.stats.garbageInserted,
    piecesPlaced: view.stats.piecesPlaced,
    bestMoment: null,
    toppedOut: view.toppedOut,
  };
}
