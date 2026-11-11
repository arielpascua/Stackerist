/**
 * The one client store (architecture §5.2–5.4): server messages → `ClientState` for the React UI, and
 * the per-frame `FrameModel` for the canvas and the `subscribeFrame` listeners.
 *
 * - Session (REQ-021): seat tokens go to sessionStorage on `created`/`joined`; `resume(code)` and every
 *   socket reopen send `rejoin` with the stored token; a refused rejoin clears the token.
 * - Input (REQ-053/054): keys reach the server only while the latest frame has `inputLive`. Each input
 *   is stamped with `TickEstimator.targetTick`, sent, then handed to the protocol `Predictor`.
 * - Prediction (REQ-054): the own board is `Predictor.display(targetTick)`; each own snapshot rebases
 *   it and drops acknowledged inputs; the opponent and spectator boards come straight from snapshots.
 * - Effects fire once: own flashes and nudges from `display().newEvents` only; the opponent's nudges
 *   from `stats.garbageInserted` going up; projectiles and bursts from snapshot events.
 */
import {
  PREVIEW_COUNT,
  ghostPosition,
  pendingTotal,
  type Action,
  type PlayerState,
  type TickedEvent,
} from '@stackerist/engine';
import {
  ErrorCodeSchema,
  isLiveStatus,
  normalizeRoomCode,
  TICK_MS,
  toLocalMs,
  type ClientMessage,
  type CloseCodeName,
  type CountdownMessage,
  type ErrorCode,
  type ErrorMessage,
  type LiveStats,
  type OwnView,
  type PausedMessage,
  type Predictor,
  type PublicView,
  type ResumedMessage,
  type RoomCode,
  type Seat,
  type ServerMessage,
  type SnapshotMessage,
  type TickEstimator,
} from '@stackerist/protocol';
import { clearToken, loadToken, saveToken, type TokenStorage } from '../net/session.ts';
import { recoverableCloseCode, type GameSocketEvents } from '../net/socket.ts';
import type {
  BoardModel,
  ClientState,
  ConnectionStatus,
  FrameModel,
  FxEvent,
  GameStore,
  HudSide,
  Role,
  Side,
} from './contract.ts';
import { registerFrameDriver, type FrameDriver } from './driver.ts';
import { isDanger, sideSeats, standoffPhase } from './frame.ts';
import { InputController } from './input.ts';
import type { Timers } from './timers.ts';

/** The §3.10 Predictor surface the store drives (the real class in production). */
export type PredictorPort = Pick<Predictor, 'onOwnSnapshot' | 'addInput' | 'clear' | 'display'>;
/** The §3.9 TickEstimator surface the store drives. */
export type EstimatorPort = Pick<
  TickEstimator,
  | 'anchor'
  | 'observeSnapshot'
  | 'setRtt'
  | 'freeze'
  | 'serverTick'
  | 'targetTick'
  | 'goAtLocalMs'
  | 'rttMs'
>;

/** The socket as the store sees it (`GameSocket` in production). */
export interface Transport {
  connect(): void;
  send(msg: ClientMessage): boolean;
  close(): void;
}

export interface StoreOptions {
  createTransport(events: GameSocketEvents): Transport;
  readonly storage: TokenStorage | null;
  readonly predictor: PredictorPort;
  readonly estimator: EstimatorPort;
  readonly timers: Timers;
  /** performance.now(): the same clock as the rAF timestamps. */
  now(): number;
  /** Where protocol errors that are never shown go (DESIGN.md error catalogue). */
  log?(message: string, detail: unknown): void;
}

/**
 * Which error codes the UI shows. BAD_MESSAGE, BAD_TICK, NOT_PLAYING and NOT_A_PLAYER only come from
 * a bug or a cheat: logged, never shown (DESIGN.md error catalogue). Keyed by every ErrorCode, so a new
 * protocol code fails to compile until it is classified here.
 */
const ERROR_SHOWN: Readonly<Record<ErrorCode, boolean>> = {
  BAD_MESSAGE: false,
  ROOM_NOT_FOUND: true,
  BAD_TOKEN: true,
  ROOM_FULL: true,
  NOT_A_PLAYER: false,
  NOT_PLAYING: false,
  BAD_SEQ: true,
  BAD_TICK: false,
  ALREADY_IN_ROOM: true,
  NOT_IN_ROOM: true,
  NOT_FINISHED: true,
  TOO_MANY_CREATES: true,
  TOO_MANY_JOINS: true,
  SERVER_BUSY: true,
  INTERNAL_ERROR: true,
};
const CODES = ErrorCodeSchema.enum;
/** A refused rejoin: the seat or the room is gone. */
const REJOIN_REFUSED: ReadonlySet<ErrorCode> = new Set([CODES.ROOM_NOT_FOUND, CODES.BAD_TOKEN]);

/** The first play tick of a round in production (architecture §3.2); used when a rejoin missed it. */
const PRODUCTION_START_TICK = 0;

const ZERO_STATS: LiveStats = Object.freeze({
  linesCleared: 0,
  garbageSent: 0,
  garbageCancelled: 0,
  garbageReceived: 0,
  garbageInserted: 0,
  piecesPlaced: 0,
  bestCombo: 0,
});

interface Chain {
  readonly sent: number;
  readonly cancelled: number;
}
const NO_CHAIN: Chain = Object.freeze({ sent: 0, cancelled: 0 });

const INITIAL_STATE: ClientState = Object.freeze({
  connection: 'connecting',
  closedBy: null,
  code: null,
  role: null,
  room: null,
  countdown: null,
  paused: null,
  level: 0,
  roundStartTick: null,
  hud: Object.freeze({ left: null, right: null }),
  result: null,
  ready: Object.freeze({ A: false, B: false }),
  rttMs: null,
  recoverableClose: null,
  error: null,
});

type BindKind = 'create' | 'join' | 'rejoin';

function isSeat(role: Role | null): role is Seat {
  return role === 'A' || role === 'B';
}

function sameStats(a: LiveStats, b: LiveStats): boolean {
  return (
    a.linesCleared === b.linesCleared &&
    a.garbageSent === b.garbageSent &&
    a.garbageCancelled === b.garbageCancelled &&
    a.garbageReceived === b.garbageReceived &&
    a.garbageInserted === b.garbageInserted &&
    a.piecesPlaced === b.piecesPlaced &&
    a.bestCombo === b.bestCombo
  );
}

function sameHudSide(a: HudSide | null, b: HudSide | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.seat === b.seat &&
    a.name === b.name &&
    a.connected === b.connected &&
    a.pendingGarbage === b.pendingGarbage &&
    sameStats(a.stats, b.stats)
  );
}

export class CoreStore implements GameStore, FrameDriver {
  readonly #options: StoreOptions;
  readonly #transport: Transport;
  readonly #input: InputController;
  #state: ClientState = INITIAL_STATE;
  readonly #listeners = new Set<() => void>();
  readonly #frameListeners = new Set<(frame: FrameModel) => void>();

  /** A create/join/rejoin waiting for the socket to open. */
  #pendingBind: ClientMessage | null = null;
  /** The bind request in flight: re-sent if the socket drops before it is answered. */
  #bind: {
    readonly kind: BindKind;
    readonly code: string | null;
    readonly msg: ClientMessage;
  } | null = null;
  #nextSeq = 1;
  #inputLive = false;
  /** The latest own snapshot: the prediction base, kept so a clear() can be re-seeded. */
  #lastOwn: { readonly view: OwnView; readonly tick: number } | null = null;
  #publics: SnapshotMessage['players'] = {};
  #chains: Record<Seat, Chain> = { A: NO_CHAIN, B: NO_CHAIN };
  /** Snapshot-driven effects waiting for the next frame. */
  #fxQueue: FxEvent[] = [];
  /** True once the estimator has an anchor or a snapshot sample (the match clock is meaningful). */
  #clockKnown = false;
  #ownMemo: {
    readonly state: PlayerState;
    readonly chain: Chain;
    readonly model: BoardModel;
  } | null = null;
  #publicMemo: Partial<
    Record<Seat, { readonly view: PublicView; readonly chain: Chain; readonly model: BoardModel }>
  > = {};

  constructor(options: StoreOptions) {
    this.#options = options;
    this.#input = new InputController({
      emit: (action) => {
        this.#sendAction(action);
      },
      timers: options.timers,
    });
    this.#transport = options.createTransport({
      onOpen: () => {
        this.#onOpen();
      },
      onMessage: (msg) => {
        this.#onMessage(msg);
      },
      onDropped: (code) => {
        this.#onDropped(code);
      },
      onStatus: (status, closedBy) => {
        this.#onStatus(status, closedBy);
      },
    });
    registerFrameDriver(this, this);
  }

  // ---- GameStore (the UI contract) ----

  getState(): ClientState {
    return this.#state;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  subscribeFrame(listener: (frame: FrameModel) => void): () => void {
    this.#frameListeners.add(listener);
    return () => {
      this.#frameListeners.delete(listener);
    };
  }

  connect(): void {
    this.#transport.connect();
  }

  create(name: string): void {
    this.#request({ type: 'create', name }, 'create', null);
  }

  join(code: RoomCode, name: string | null, asSpectator: boolean): void {
    const msg: ClientMessage = {
      type: 'join',
      code,
      ...(name === null ? {} : { name }),
      ...(asSpectator ? { asSpectator: true } : {}),
    };
    this.#request(msg, 'join', code);
  }

  resume(code: RoomCode): boolean {
    const { code: bound, role } = this.#state;
    // Already seated in this room (the UI navigates to /g/<CODE> right after created/joined).
    if (role !== null && bound !== null && bound === normalizeRoomCode(code)) return true;
    const token = loadToken(this.#options.storage, code);
    if (token === null) return false;
    this.#request({ type: 'rejoin', code, token }, 'rejoin', code);
    return true;
  }

  leave(): void {
    const { code } = this.#state;
    this.#transport.send({ type: 'leave' });
    if (code !== null) clearToken(this.#options.storage, code);
    this.#pendingBind = null;
    this.#bind = null;
    this.#unbind();
  }

  ready(): void {
    this.#transport.send({ type: 'rematch' });
  }

  clearError(): void {
    if (this.#state.error !== null) this.#patch({ error: null });
  }

  matchElapsedMs(nowMs: number): number | null {
    const state = this.#state;
    if (state.role === null) return null;
    const start = state.roundStartTick ?? PRODUCTION_START_TICK;
    if (state.result !== null) return Math.max(0, (state.result.tick - start) * TICK_MS);
    if (!this.#clockKnown) return null;
    return Math.max(0, (this.#options.estimator.serverTick(nowMs) - start) * TICK_MS);
  }

  // ---- CORE-internal: keyboard and arena ----

  /** The input core the window keyboard binding feeds (CORE-internal). */
  get input(): InputController {
    return this.#input;
  }

  /** True while this player's round is on screen: game keys are captured and never reach buttons. */
  capturingGameKeys(): boolean {
    const { role, room, result, connection } = this.#state;
    // Reconnecting has given up: the overlay's Try again and Back to home buttons need Space and Enter.
    if (!isSeat(role) || room === null || result !== null || connection === 'closed') return false;
    return isLiveStatus(room.status);
  }

  role(): Role | null {
    return this.#state.role;
  }

  computeFrame(nowMs: number, reducedMotion: boolean): FrameModel {
    const live = this.#isLive(nowMs);
    this.#setLive(live);
    const fx = this.#fxQueue;
    this.#fxQueue = [];
    const { role, countdown, paused, result, level } = this.#state;
    const [leftSeat, rightSeat] = sideSeats(role);
    const left = isSeat(role)
      ? this.#ownModel(role, nowMs, live, fx)
      : leftSeat === null
        ? null
        : this.#publicModel(leftSeat);
    const right = rightSeat === null ? null : this.#publicModel(rightSeat);
    const standoff =
      paused === null && result === null ? standoffPhase(countdown, nowMs, reducedMotion) : null;
    return { nowMs, left, right, fx, level, standoff, inputLive: live };
  }

  publishFrame(frame: FrameModel): void {
    for (const listener of this.#frameListeners) {
      try {
        listener(frame);
      } catch (error) {
        this.#log('subscribeFrame listener threw', error);
      }
    }
  }

  stopFrames(): void {
    this.#setLive(false);
  }

  // ---- Sending ----

  #request(msg: ClientMessage, kind: BindKind, code: string | null): void {
    this.#bind = { kind, code, msg };
    if (!this.#transport.send(msg)) {
      this.#pendingBind = msg;
      this.#transport.connect();
    }
  }

  #sendAction(action: Action): void {
    // A bind/rejoin in flight resets the seq space on `joined`: an input sent now would carry a stale seq.
    if (!this.#inputLive || this.#bind !== null) return;
    const tick = this.#options.estimator.targetTick(this.#options.now());
    const seq = this.#nextSeq;
    this.#nextSeq += 1;
    if (!this.#transport.send({ type: 'input', seq, tick, action })) return;
    this.#options.predictor.addInput({ seq, tick, action });
  }

  // ---- Socket events ----

  #onOpen(): void {
    const pending = this.#pendingBind;
    this.#pendingBind = null;
    if (pending !== null) {
      this.#transport.send(pending);
      return;
    }
    const { code, role } = this.#state;
    if (code === null || role === null) {
      // A create/join/rejoin the old socket never answered: ask again on the new one.
      if (this.#bind !== null) this.#transport.send(this.#bind.msg);
      return;
    }
    if (role === 'spectator') {
      this.#request({ type: 'join', code, asSpectator: true }, 'join', code);
      return;
    }
    const token = loadToken(this.#options.storage, code);
    if (token === null) {
      this.#unbind();
      return;
    }
    this.#request({ type: 'rejoin', code, token }, 'rejoin', code);
  }

  /**
   * A recoverable close (slow consumer, try again later) is remembered so the UI can say why it is
   * reconnecting. A later unnamed drop during the same recovery (a failed retry) keeps it.
   */
  #onDropped(code: number): void {
    const recoverableClose = recoverableCloseCode(code);
    if (recoverableClose !== null && recoverableClose !== this.#state.recoverableClose) {
      this.#patch({ recoverableClose });
    }
  }

  #onStatus(connection: ConnectionStatus, closedBy: CloseCodeName | null): void {
    if (connection !== 'open') this.#setLive(false);
    // The retries ran out (or the socket was closed on purpose): the notice would be stale.
    const stale = connection === 'closed' && this.#state.recoverableClose !== null;
    // The last ping belongs to the connection that just went away: the HUD reads "— ms" until the next one.
    const staleRtt = connection !== 'open' && this.#state.rttMs !== null;
    if (
      connection !== this.#state.connection ||
      closedBy !== this.#state.closedBy ||
      stale ||
      staleRtt
    ) {
      this.#patch({
        connection,
        closedBy,
        ...(stale ? { recoverableClose: null } : {}),
        ...(staleRtt ? { rttMs: null } : {}),
      });
    }
  }

  #onMessage(msg: ServerMessage): void {
    const now = this.#options.now();
    switch (msg.type) {
      case 'created':
        this.#bound(msg.code, msg.seat, msg.token);
        break;
      case 'joined':
        this.#bound(msg.code, msg.seat, msg.token);
        break;
      case 'room':
        this.#publishRoom(msg);
        break;
      case 'countdown':
        this.#onCountdown(msg, now);
        break;
      case 'resumed':
        this.#onResumed(msg, now);
        break;
      case 'snapshot':
        this.#onSnapshot(msg, now);
        break;
      case 'paused':
        this.#onPaused(msg, now);
        break;
      case 'gameOver':
        this.#setLive(false);
        // A grace expiry forfeits the round while a pause is still recorded: the pause ends with it.
        this.#patch({ result: msg, paused: null });
        break;
      case 'rematchStatus':
        this.#patch({ ready: { A: msg.A, B: msg.B } });
        break;
      case 'error':
        this.#onError(msg);
        break;
      case 'ping':
        this.#options.estimator.setRtt(msg.rtt);
        if (msg.rtt !== null && msg.rtt !== this.#state.rttMs) this.#patch({ rttMs: msg.rtt });
        break;
    }
  }

  #bound(code: RoomCode, role: Role, token: string | undefined): void {
    if (token !== undefined) saveToken(this.#options.storage, code, token);
    this.#bind = null;
    this.#nextSeq = 1;
    this.#options.predictor.clear();
    this.#lastOwn = null;
    this.#ownMemo = null;
    // A rejoin is answered by `joined`: the recovery is over, so the slow-connection notice goes.
    this.#patch({
      code,
      role,
      error: null,
      closedBy: null,
      recoverableClose: null,
      hud: this.#buildHud(role),
    });
  }

  #publishRoom(room: Extract<ServerMessage, { type: 'room' }>): void {
    this.#state = { ...this.#state, room };
    // A finished round or series has no pause (REQ-031: the disconnect overlay never outlives it).
    const over = room.status === 'roundOver' || room.status === 'seriesOver';
    // No round is coming: a forfeit with no `gameOver` (REQ-089) must not leave a countdown that would
    // go live at its would-be DUEL! instant. The next round's `countdown` message sets a new one.
    const idle = over || room.status === 'waiting';
    this.#patch({
      hud: this.#buildHud(this.#state.role),
      ...(over && this.#state.paused !== null ? { paused: null } : {}),
      ...(idle && this.#state.countdown !== null ? { countdown: null } : {}),
    });
  }

  #onCountdown(msg: CountdownMessage, now: number): void {
    const { estimator } = this.#options;
    estimator.anchor(msg, now);
    this.#clockKnown = true;
    this.#nextSeq = 1;
    this.#reseedPredictor();
    this.#chains = { A: NO_CHAIN, B: NO_CHAIN };
    this.#setLive(false);
    this.#input.newRound();
    this.#patch({
      countdown: { kind: 'start', goAtMs: estimator.goAtLocalMs() ?? now, tick: msg.tick },
      roundStartTick: msg.tick,
      result: null,
      paused: null,
      ready: { A: false, B: false },
    });
  }

  #onResumed(msg: ResumedMessage, now: number): void {
    const { estimator } = this.#options;
    estimator.anchor(msg, now);
    this.#clockKnown = true;
    this.#reseedPredictor();
    this.#setLive(false);
    this.#patch({
      countdown: { kind: 'resume', goAtMs: estimator.goAtLocalMs() ?? now, tick: msg.tick },
      paused: null,
    });
  }

  #onPaused(msg: PausedMessage, now: number): void {
    const { estimator } = this.#options;
    estimator.freeze(now);
    this.#reseedPredictor();
    this.#setLive(false);
    const graceEndsAtMs = toLocalMs(msg.graceEndsAt, msg.serverNow, now, estimator.rttMs);
    this.#patch({ paused: { seat: msg.seat, graceEndsAtMs, pausesLeft: msg.pausesLeft } });
  }

  #onSnapshot(msg: SnapshotMessage, now: number): void {
    const { estimator, predictor } = this.#options;
    estimator.observeSnapshot(msg.tick, now);
    this.#clockKnown = true;
    const { role } = this.#state;
    if (msg.you !== undefined && isSeat(role)) {
      this.#lastOwn = { view: msg.you, tick: msg.tick };
      predictor.onOwnSnapshot(msg.you, msg.tick);
    }
    this.#trackChainsAndFx(msg, role);
    this.#publics = msg.players;
    const level = msg.level;
    const hud = this.#buildHud(role);
    if (level !== this.#state.level || hud !== this.#state.hud) this.#patch({ level, hud });
  }

  #onError(msg: ErrorMessage): void {
    const bind = this.#bind;
    if (bind?.kind === 'rejoin' && REJOIN_REFUSED.has(msg.code)) {
      // The seat or the room is gone: forget the token; the UI shows "That game has ended or your seat
      // expired…", which it maps from BAD_TOKEN (a refused rejoin reports BAD_TOKEN either way).
      if (bind.code !== null) clearToken(this.#options.storage, bind.code);
      this.#bind = null;
      this.#unbind();
      this.#patch({ error: { code: CODES.BAD_TOKEN, message: msg.message } });
      return;
    }
    if (bind !== null && bind.kind !== 'rejoin') this.#bind = null;
    if (!ERROR_SHOWN[msg.code]) {
      this.#log(`server error ${msg.code}`, msg.message);
      return;
    }
    this.#patch({ error: { code: msg.code, message: msg.message } });
  }

  // ---- Snapshot bookkeeping ----

  #sideOf(seat: Seat, role: Role | null): Side {
    const [left] = sideSeats(role);
    return seat === left ? 'left' : 'right';
  }

  #trackChainsAndFx(msg: SnapshotMessage, role: Role | null): void {
    const chains = { ...this.#chains };
    for (const seat of ['A', 'B'] as const) {
      const before = this.#publics[seat];
      const after = msg.players[seat];
      if (after === undefined) continue;
      const comboBefore = before?.combo ?? 0;
      if (after.combo > 0 && (comboBefore === 0 || after.combo < comboBefore)) {
        chains[seat] = NO_CHAIN;
      }
      // Own board nudges come from prediction; everyone else's from the snapshot stats.
      const inserted = after.stats.garbageInserted - (before?.stats.garbageInserted ?? 0);
      if (seat !== role && before !== undefined && inserted > 0) {
        this.#fxQueue.push({ kind: 'nudge', side: this.#sideOf(seat, role), rows: inserted });
      }
    }
    // The server hands each event to exactly one snapshot (takeSnapshotEvents clears; catch-up sends []),
    // so every listed event plays, even two equal ones from one tick (REQ-087).
    for (const event of msg.events) {
      if (event.type === 'attack') {
        const chain = chains[event.from];
        chains[event.from] = { sent: chain.sent + event.rows, cancelled: chain.cancelled };
        this.#fxQueue.push({
          kind: 'projectile',
          from: this.#sideOf(event.from, role),
          rows: event.rows,
          originRow: null,
        });
      } else {
        const chain = chains[event.seat];
        chains[event.seat] = { sent: chain.sent, cancelled: chain.cancelled + event.rows };
        this.#fxQueue.push({
          kind: 'burst',
          side: this.#sideOf(event.seat, role),
          rows: event.rows,
        });
      }
    }
    this.#chains = chains;
  }

  /**
   * Predictor.clear() on countdown / resumed / paused, then re-seed the base from the latest own
   * snapshot (the countdown's initial snapshot arrives just before it), so the own board stays drawn
   * under the standoff and the pause overlay. The re-seed acknowledges nothing: the seq space restarts.
   */
  #reseedPredictor(): void {
    const { predictor } = this.#options;
    predictor.clear();
    this.#ownMemo = null;
    const own = this.#lastOwn;
    if (own !== null) predictor.onOwnSnapshot({ ...own.view, lastAckSeq: 0 }, own.tick);
  }

  // ---- Frame models ----

  #isLive(nowMs: number): boolean {
    const { role, connection, countdown, paused, result, room } = this.#state;
    return (
      isSeat(role) &&
      // 'paused' is the room status through the resume countdown too; a real pause is `paused !== null`.
      room !== null &&
      isLiveStatus(room.status) &&
      connection === 'open' &&
      this.#bind === null &&
      countdown !== null &&
      nowMs >= countdown.goAtMs &&
      paused === null &&
      result === null &&
      this.#lastOwn?.view.toppedOut !== true
    );
  }

  #setLive(live: boolean): void {
    if (live === this.#inputLive) return;
    this.#inputLive = live;
    this.#input.setEnabled(live);
  }

  #ownModel(seat: Seat, nowMs: number, live: boolean, fx: FxEvent[]): BoardModel | null {
    const own = this.#lastOwn;
    const display =
      own === null
        ? null
        : this.#options.predictor.display(
            live ? this.#options.estimator.targetTick(nowMs) : own.tick,
          );
    if (display === null) return this.#publicModel(seat);
    this.#collectOwnFx(display.newEvents, fx);
    const { state } = display;
    const chain = this.#chains[seat];
    const memo = this.#ownMemo;
    if (memo !== null && memo.state === state && memo.chain === chain) return memo.model;
    const pending = pendingTotal(state.pendingGarbage);
    const model: BoardModel = {
      seat,
      board: state.board,
      active: state.active,
      ghost: ghostPosition(state),
      next: state.queue.slice(0, PREVIEW_COUNT),
      pendingGarbage: pending,
      combo: state.combo,
      chain,
      danger: isDanger(state.board, pending),
      toppedOut: state.toppedOut,
    };
    this.#ownMemo = { state, chain, model };
    return model;
  }

  #collectOwnFx(events: readonly TickedEvent[], fx: FxEvent[]): void {
    for (const { event } of events) {
      if (event.type === 'linesCleared') {
        fx.push({ kind: 'flash', side: 'left', rows: event.rows });
      } else if (event.type === 'garbageInserted') {
        fx.push({ kind: 'nudge', side: 'left', rows: event.rows });
      }
    }
  }

  #publicModel(seat: Seat): BoardModel | null {
    const view = this.#publics[seat];
    if (view === undefined) return null;
    const chain = this.#chains[seat];
    const memo = this.#publicMemo[seat];
    if (memo !== undefined && memo.view === view && memo.chain === chain) return memo.model;
    const model: BoardModel = {
      seat,
      board: view.board,
      active: view.active,
      ghost: null,
      next: view.next,
      pendingGarbage: view.pendingGarbage,
      combo: view.combo,
      chain,
      danger: isDanger(view.board, view.pendingGarbage),
      toppedOut: view.toppedOut,
    };
    this.#publicMemo = { ...this.#publicMemo, [seat]: { view, chain, model } };
    return model;
  }

  // ---- HUD ----

  #buildHud(role: Role | null): ClientState['hud'] {
    const [leftSeat, rightSeat] = sideSeats(role);
    const left = leftSeat === null ? null : this.#hudSide(leftSeat);
    const right = rightSeat === null ? null : this.#hudSide(rightSeat);
    const previous = this.#state.hud;
    const keptLeft = sameHudSide(previous.left, left) ? previous.left : left;
    const keptRight = sameHudSide(previous.right, right) ? previous.right : right;
    return keptLeft === previous.left && keptRight === previous.right
      ? previous
      : { left: keptLeft, right: keptRight };
  }

  #hudSide(seat: Seat): HudSide | null {
    const info = this.#state.room?.players[seat];
    if (info === undefined) return null;
    const view = this.#publics[seat];
    return {
      seat,
      name: info.name,
      connected: info.connected,
      stats: view?.stats ?? ZERO_STATS,
      pendingGarbage: view?.pendingGarbage ?? 0,
    };
  }

  // ---- State plumbing ----

  #unbind(): void {
    this.#options.predictor.clear();
    this.#lastOwn = null;
    this.#ownMemo = null;
    this.#publicMemo = {};
    this.#publics = {};
    this.#chains = { A: NO_CHAIN, B: NO_CHAIN };
    this.#fxQueue = [];
    this.#nextSeq = 1;
    this.#clockKnown = false;
    this.#setLive(false);
    this.#input.blur();
    this.#patch({
      code: null,
      role: null,
      room: null,
      countdown: null,
      paused: null,
      level: 0,
      roundStartTick: null,
      hud: INITIAL_STATE.hud,
      result: null,
      ready: INITIAL_STATE.ready,
      recoverableClose: null,
    });
  }

  #patch(patch: Partial<ClientState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch (error) {
        this.#log('store listener threw', error);
      }
    }
  }

  #log(message: string, detail: unknown): void {
    this.#options.log?.(message, detail);
  }
}
