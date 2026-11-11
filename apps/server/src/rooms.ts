/**
 * Rooms and the room/series state machine (architecture §4.4). Row ids (C1, J1…X3) refer to the
 * transition table. Every timer callback re-checks its own guard when it fires (deleted, status, seat
 * still disconnected), so a terminal state never falls into another: roundOver, seriesOver, a forfeit
 * and an abandoned/deleted room are each gated separately, and a forfeited series never resumes.
 */
import { levelForTick, type PlayerState } from '@stackerist/engine';
import {
  CLOSE_CODES,
  COUNTDOWN_MS,
  GRACE_MS,
  MAX_PAUSES_PER_SERIES,
  otherSeat,
  SEAT_HOLD_MS,
  toOwnView,
  toPublicView,
  type CountdownMessage,
  type ErrorCode,
  type GameOverMessage,
  type GameOverReason,
  type InputMessage,
  type PausedMessage,
  type PublicView,
  type RematchStatusMessage,
  type ResumedMessage,
  type RoomCode,
  type RoomMessage,
  type RoomStatus,
  type Seat,
  type SeriesView,
  type ServerMessage,
  type SnapshotEvent,
  type SnapshotMessage,
} from '@stackerist/protocol';
import type { Clock, TimerId } from './clock.js';
import {
  CLOSE,
  ERR,
  ERROR_TEXT,
  generateRoomCode,
  generateSeatToken,
  tokenMatches,
} from './codes.js';
import type { Limits } from './config.js';
import type { Connection } from './connection.js';
import type { EventLog, RoomClosedReason } from './log.js';
import type { GameLoop, LoopRoom } from './loop.js';
import { Match, type MatchSeeds, type RoundOutcome } from './match.js';
import { safeCall } from './safe.js';
import {
  applyForfeit,
  applyRoundResult,
  newSeries,
  nextRound,
  toSeriesView,
  type ForfeitReason,
  type SeriesState,
} from './series.js';

const SEATS: readonly Seat[] = ['A', 'B'];

export interface RoomDeps {
  readonly clock: Clock;
  readonly log: EventLog;
  readonly limits: Limits;
  readonly loop: GameLoop;
  readonly seedProvider: () => MatchSeeds;
  readonly holeRngFactory: (holeSeed: number) => () => number;
  /** First play tick of every round (0 in production). */
  readonly startTick: number;
}

interface SeatSlot {
  readonly token: Buffer;
  /** Shown to the room on the wire; never logged. */
  readonly name: string;
  conn: Connection | null;
  holdTimer: TimerId | null;
  graceTimer: TimerId | null;
  /** Grace expiry for the wire, epoch ms. */
  graceEndsAt: number | null;
  /** Grace expiry for decisions, monotonic ms. */
  graceDeadline: number | null;
  /** Per series (REQ-032). */
  pausesUsed: number;
  ready: boolean;
  /** Dropped inputs, per series (REQ-038, owner ruling OQ-5). */
  drops: number;
}

export interface SeatInspection {
  readonly connected: boolean;
  readonly pausesUsed: number;
  readonly ready: boolean;
  readonly bufferLength: number;
  readonly drops: number;
}

export interface RoomInspection {
  readonly status: RoomStatus;
  readonly tick: number | null;
  readonly players: { readonly A?: PlayerState; readonly B?: PlayerState };
  readonly series: SeriesView;
  readonly seats: { readonly A?: SeatInspection; readonly B?: SeatInspection };
  readonly spectators: number;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

export class Room implements LoopRoom {
  readonly code: RoomCode;
  status: RoomStatus = 'waiting';
  everStarted = false;
  deleted = false;
  readonly seats: Record<Seat, SeatSlot | null> = { A: null, B: null };
  readonly spectators = new Set<Connection>();
  series: SeriesState = newSeries();
  match: Match | null = null;
  readonly #deps: RoomDeps;
  readonly #onDeleted: (room: Room) => void;
  #countdownTimer: TimerId | null = null;
  #countdownStartsAt: number | null = null;
  #resumeTimer: TimerId | null = null;
  #resumeAt: number | null = null;
  #lastGameOver: GameOverMessage | null = null;
  #emptyTimer: TimerId | null = null;
  #waitingTtlTimer: TimerId | null = null;
  #ageTimer: TimerId | null = null;
  #idleTimer: TimerId | null = null;
  /** Monotonic ms of the last thing a person did in the room (the idle TTL of a finished room, F2). */
  #lastActivityAt: number;

  constructor(code: RoomCode, deps: RoomDeps, onDeleted: (room: Room) => void) {
    this.code = code;
    this.#deps = deps;
    this.#onDeleted = onDeleted;
    this.#lastActivityAt = deps.clock.monotonicMs();
  }

  // ---------------------------------------------------------------- queries

  /** True while at least one player socket is bound (an abandoned room is only on its 2-minute TTL). */
  hasConnectedPlayer(): boolean {
    return this.#connectedPlayers() > 0;
  }

  allSeatsConnected(): boolean {
    return this.seats.A?.conn != null && this.seats.B?.conn != null;
  }

  #connectedPlayers(): number {
    return (this.seats.A?.conn != null ? 1 : 0) + (this.seats.B?.conn != null ? 1 : 0);
  }

  /** J1 vs J3: a player seat only in a waiting room that never started and has a free seat. */
  joinRole(asSpectator: boolean): Seat | 'spectator' {
    if (asSpectator || this.status !== 'waiting' || this.everStarted) return 'spectator';
    if (this.seats.B === null) return 'B';
    if (this.seats.A === null) return 'A';
    return 'spectator';
  }

  spectatorsFull(): boolean {
    return this.spectators.size >= this.#deps.limits.maxSpectatorsPerRoom;
  }

  /** The seat whose token `candidate` is. Both seats are compared on every call (no short-circuit). */
  matchToken(candidate: string): Seat | null {
    const a = tokenMatches(this.seats.A?.token ?? null, candidate);
    const b = tokenMatches(this.seats.B?.token ?? null, candidate);
    if (a) return 'A';
    if (b) return 'B';
    return null;
  }

  inspect(): RoomInspection {
    const match = this.match;
    const seat = (s: Seat): SeatInspection | undefined => {
      const slot = this.seats[s];
      if (slot === null) return undefined;
      return {
        connected: slot.conn !== null,
        pausesUsed: slot.pausesUsed,
        ready: slot.ready,
        bufferLength: match?.bufferLength(s) ?? 0,
        drops: slot.drops,
      };
    };
    const seatA = seat('A');
    const seatB = seat('B');
    return deepFreeze({
      status: this.status,
      tick: match?.tick ?? null,
      players: match === null ? {} : structuredClone({ A: match.states.A, B: match.states.B }),
      series: toSeriesView(this.series),
      seats: { ...(seatA ? { A: seatA } : {}), ...(seatB ? { B: seatB } : {}) },
      spectators: this.spectators.size,
    });
  }

  // ---------------------------------------------------------------- C1 / J1 / J3 / R1

  /** C1: the creator takes seat A. */
  start(conn: Connection, name: string): void {
    const token = this.#newSlot('A', name);
    this.#bindSeat('A', conn);
    conn.send({ type: 'created', code: this.code, token, seat: 'A' });
    this.#sendRoom();
    this.#waitingTtlTimer = this.#timer(this.#deps.limits.waitingRoomTtlMs, () => {
      this.#onWaitingTtl();
    });
    this.#ageTimer = this.#timer(this.#deps.limits.maxRoomAgeMs, () => {
      this.#onMaxAge();
    });
    this.#deps.log.info('room.created', { room: this.code, conn: conn.id, seat: 'A' });
  }

  /** J1: a player takes a free seat in a waiting room. */
  addPlayer(conn: Connection, seat: Seat, name: string): void {
    const token = this.#newSlot(seat, name);
    this.#bindSeat(seat, conn);
    conn.send({ type: 'joined', code: this.code, seat, token });
    this.#sendRoom();
    this.#deps.log.info('room.joined', { room: this.code, conn: conn.id, seat });
    this.#maybeStartCountdown();
  }

  /** J3: a spectator (the caller has checked the cap). */
  addSpectator(conn: Connection): void {
    this.#touch();
    this.spectators.add(conn);
    conn.room = this;
    conn.role = 'spectator';
    conn.send({ type: 'joined', code: this.code, seat: 'spectator' });
    this.#sendRoom();
    this.#catchUp(conn);
    this.#deps.log.info('room.joined', { room: this.code, conn: conn.id, seat: 'spectator' });
  }

  /** R1–R4: a valid token rebinds its seat, replacing any older socket (REQ-035). */
  rejoin(conn: Connection, seat: Seat): void {
    const slot = this.seats[seat];
    if (slot === null) return;
    this.#touch();
    const old = slot.conn;
    if (old !== null) {
      old.replaced = true;
      this.#unbind(old);
      old.close(CLOSE_CODES.REPLACED, CLOSE.REPLACED);
    }
    this.#bindSeat(seat, conn);
    this.match?.resetSeatSequence(seat);
    conn.send({ type: 'joined', code: this.code, seat });
    this.#sendRoom();
    this.#deps.log.info('room.rejoined', { room: this.code, conn: conn.id, seat });
    switch (this.status) {
      case 'waiting':
        this.#maybeStartCountdown(); // J2 after R1
        return;
      case 'paused':
        if (old === null && this.allSeatsConnected())
          this.#startResume(); // R2
        else this.#catchUp(conn); // R3, or a replace while paused
        return;
      default:
        this.#catchUp(conn); // countdown (G4), playing, R4
    }
  }

  // ---------------------------------------------------------------- player messages

  onInput(conn: Connection, seat: Seat, msg: InputMessage): void {
    const match = this.match;
    const slot = this.seats[seat];
    if (match === null || slot === null) return;
    const { log, limits, clock } = this.#deps;
    const verdict = match.receiveInput(seat, msg, clock.monotonicMs());
    const fields = { conn: conn.id, room: this.code, seat };
    switch (verdict) {
      case 'accepted':
        return;
      case 'badSeq':
        this.#sendError(conn, ERR.BAD_SEQ);
        log.anticheat(ERR.BAD_SEQ, fields);
        return;
      case 'badTick':
        this.#sendError(conn, ERR.BAD_TICK);
        log.anticheat(ERR.BAD_TICK, fields);
        return;
      case 'rateLimited':
      case 'queueFull':
        slot.drops += 1;
        log.anticheat(verdict === 'queueFull' ? 'QUEUE_FULL' : 'RATE_LIMIT_DROP', fields);
        if (slot.drops >= limits.maxDropsPerSeries) {
          log.anticheat('RATE_LIMITED_KICK', fields);
          conn.close(CLOSE_CODES.RATE_LIMITED, CLOSE.RATE_LIMITED);
          this.onConnectionClosed(conn);
        }
        return;
    }
  }

  /** L1–L3 (and a spectator leaving). */
  onLeave(conn: Connection): void {
    const role = conn.role;
    if (role === null) return;
    this.#touch();
    this.#deps.log.info('room.left', { room: this.code, conn: conn.id, seat: role });
    if (role === 'spectator') {
      this.spectators.delete(conn);
      this.#unbind(conn);
      this.#sendRoom();
      return;
    }
    if ((this.status === 'waiting' || this.status === 'countdown') && !this.everStarted) {
      if (this.status === 'countdown') this.#returnToWaiting(); // L1
      this.#freeSeat(role);
      this.#sendRoom();
      return;
    }
    if (this.status === 'seriesOver') {
      this.#freeSeat(role); // L3
      this.#sendRoom();
      return;
    }
    this.#forfeit(role, 'OPPONENT_LEFT', true); // L2
  }

  /** N1–N3 (the caller has checked roundOver/seriesOver). */
  onRematch(seat: Seat): void {
    const slot = this.seats[seat];
    if (slot === null) return;
    this.#touch();
    slot.ready = true;
    this.#broadcast(this.#rematchStatus());
    const a = this.seats.A;
    const b = this.seats.B;
    if (a === null || b === null || !a.ready || !b.ready || !this.allSeatsConnected()) return;
    if (this.status === 'roundOver') {
      this.series = nextRound(this.series); // N2
    } else if (this.status === 'seriesOver') {
      this.series = newSeries(); // N3
      for (const s of [a, b]) {
        s.pausesUsed = 0;
        s.drops = 0;
      }
    } else {
      return;
    }
    this.#lastGameOver = null;
    this.#startCountdown();
  }

  /** D1, D3–D6, or a spectator going away. Also called for server-initiated closes. */
  onConnectionClosed(conn: Connection): void {
    const role = conn.role;
    if (this.deleted || role === null) return;
    this.#touch();
    if (role === 'spectator') {
      if (this.spectators.delete(conn)) {
        this.#unbind(conn);
        this.#sendRoom();
      }
      return;
    }
    const slot = this.seats[role];
    this.#unbind(conn);
    if (slot === null || slot.conn !== conn) return;
    slot.conn = null;
    this.#updateEmptyTimer();
    switch (this.status) {
      case 'waiting':
      case 'countdown':
        this.#returnToWaiting(); // D1
        this.#hold(role);
        this.#sendRoom();
        return;
      case 'playing':
      case 'paused':
        if (slot.pausesUsed >= MAX_PAUSES_PER_SERIES) {
          this.#deps.log.anticheat('PAUSE_LIMIT_FORFEIT', {
            conn: conn.id,
            room: this.code,
            seat: role,
          });
          this.#forfeit(role, 'OPPONENT_DISCONNECTED', false); // D4
        } else {
          this.#pause(role); // D3 / D5
        }
        return;
      case 'roundOver':
      case 'seriesOver':
        slot.ready = false; // D6: no pause, no grace
        this.#hold(role);
        this.#sendRoom();
        this.#broadcast(this.#rematchStatus());
        return;
    }
  }

  // ---------------------------------------------------------------- ticking (E1–E3)

  stepSafely(): void {
    safeCall(
      this.#deps.log,
      { room: this.code, tick: this.match?.tick ?? 0 },
      () => {
        this.step();
      },
      () => {
        this.abort();
      },
    );
  }

  step(): void {
    const match = this.match;
    if (this.deleted || this.status !== 'playing' || match === null) return;
    const result = match.step();
    if (result.snapshotDue) this.#broadcastSnapshot();
    if (result.outcome !== null) this.#endRound(match, result.outcome);
  }

  #endRound(match: Match, outcome: RoundOutcome): void {
    const { loop, log } = this.#deps;
    loop.remove(this);
    const { round, replay } = this.series;
    this.series = applyRoundResult(this.series, {
      winner: outcome.winner,
      reason: outcome.reason,
      durationTicks: match.durationTicks,
    });
    this.status = this.series.over ? 'seriesOver' : 'roundOver'; // E2 : E1 / E3
    for (const slot of this.#slots()) slot.ready = false;
    const gameOver = this.#gameOver(match, round, replay, outcome.winner, outcome.reason);
    this.#lastGameOver = gameOver;
    this.#broadcast(gameOver);
    this.#sendRoom();
    log.info('match.ended', {
      room: this.code,
      round,
      tick: match.tick,
      winner: outcome.winner,
      reason: outcome.reason,
    });
    if (this.series.over) {
      log.info('series.ended', { room: this.code, winner: this.series.winner, reason: 'TWO_WINS' });
    }
    this.#armIdle();
  }

  // ---------------------------------------------------------------- X3 / deletion

  /** X3: a handler or step threw for this room. Other rooms are unaffected. */
  abort(): void {
    if (this.deleted) return;
    this.#broadcast({
      type: 'error',
      code: ERR.INTERNAL_ERROR,
      message: ERROR_TEXT.INTERNAL_ERROR,
    });
    this.#destroy('ABORTED');
  }

  /** Server shutdown: stop every timer; the server closes the sockets with SERVER_SHUTDOWN. */
  shutdown(): void {
    if (this.deleted) return;
    this.deleted = true;
    this.#cancelAllTimers();
    this.#deps.loop.remove(this);
  }

  #destroy(reason: RoomClosedReason): void {
    if (this.deleted) return;
    this.deleted = true;
    this.#cancelAllTimers();
    this.#deps.loop.remove(this);
    const conns = this.#recipients();
    for (const slot of this.#slots()) slot.conn = null;
    this.spectators.clear();
    for (const conn of conns) {
      this.#unbind(conn);
      conn.close(CLOSE_CODES.ROOM_CLOSED, CLOSE.ROOM_CLOSED);
    }
    this.#onDeleted(this);
    if (reason === 'ABORTED') this.#deps.log.warn('room.aborted', { room: this.code });
    else this.#deps.log.info('room.closed', { room: this.code, reason });
  }

  // ---------------------------------------------------------------- transitions (internal)

  #newSlot(seat: Seat, name: string): string {
    const token = generateSeatToken();
    this.seats[seat] = {
      token: token.bytes,
      name,
      conn: null,
      holdTimer: null,
      graceTimer: null,
      graceEndsAt: null,
      graceDeadline: null,
      pausesUsed: 0,
      ready: false,
      drops: 0,
    };
    return token.text;
  }

  #bindSeat(seat: Seat, conn: Connection): void {
    const slot = this.seats[seat];
    if (slot === null) return;
    slot.conn = conn;
    conn.room = this;
    conn.role = seat;
    this.#cancelTimer(slot.holdTimer);
    this.#cancelTimer(slot.graceTimer);
    slot.holdTimer = null;
    slot.graceTimer = null;
    slot.graceEndsAt = null;
    slot.graceDeadline = null;
    this.#updateEmptyTimer();
  }

  #unbind(conn: Connection): void {
    if (conn.room === this) {
      conn.room = null;
      conn.role = null;
    }
  }

  #freeSeat(seat: Seat): void {
    const slot = this.seats[seat];
    if (slot === null) return;
    this.#cancelTimer(slot.holdTimer);
    this.#cancelTimer(slot.graceTimer);
    if (slot.conn !== null) this.#unbind(slot.conn);
    this.seats[seat] = null;
    this.#updateEmptyTimer();
  }

  /** J2 */
  #maybeStartCountdown(): void {
    if (this.status === 'waiting' && this.allSeatsConnected()) this.#startCountdown();
  }

  /** J2 / N2 / N3: new seeds, initial snapshot, the standoff countdown (REQ-025). */
  #startCountdown(): void {
    const { clock, limits, seedProvider, holeRngFactory, startTick } = this.#deps;
    const seeds = seedProvider();
    const match = new Match({
      seeds,
      startTick,
      holeRng: holeRngFactory(seeds.holeSeed),
      limits,
      nowMs: clock.monotonicMs(),
    });
    this.match = match;
    this.status = 'countdown';
    for (const slot of this.#slots()) slot.ready = false;
    this.#sendRoom();
    this.#broadcastSnapshot();
    const now = clock.nowEpochMs();
    this.#countdownStartsAt = now + COUNTDOWN_MS;
    this.#broadcast(this.#countdownMessage(match, now));
    this.#countdownTimer = this.#timer(COUNTDOWN_MS, () => {
      this.#onCountdownEnd();
    });
  }

  /** T1 */
  #onCountdownEnd(): void {
    this.#countdownTimer = null;
    if (this.deleted || this.status !== 'countdown' || this.match === null) return;
    this.#countdownStartsAt = null;
    this.status = 'playing';
    this.everStarted = true;
    this.#cancelTimer(this.#waitingTtlTimer);
    this.#waitingTtlTimer = null;
    this.#deps.loop.add(this);
    this.#sendRoom();
    this.#deps.log.info('match.started', { room: this.code, round: this.series.round });
  }

  /** D1 / L1: a countdown that hasn't started play goes back to waiting; its prepared match is dropped. */
  #returnToWaiting(): void {
    if (this.status !== 'countdown') return;
    this.#cancelTimer(this.#countdownTimer);
    this.#countdownTimer = null;
    this.#countdownStartsAt = null;
    this.match = null;
    this.status = 'waiting';
  }

  /** D3 / D5 */
  #pause(seat: Seat): void {
    const slot = this.seats[seat];
    if (slot === null) return;
    const { clock, loop, log } = this.#deps;
    slot.pausesUsed += 1;
    this.#clearResume();
    loop.remove(this);
    this.status = 'paused';
    this.match?.clearBuffers();
    slot.graceEndsAt = clock.nowEpochMs() + GRACE_MS;
    slot.graceDeadline = clock.monotonicMs() + GRACE_MS;
    this.#cancelTimer(slot.graceTimer);
    slot.graceTimer = this.#timer(GRACE_MS, () => {
      this.#onGraceExpired(seat);
    });
    const paused = this.#pausedMessage(seat, slot);
    if (paused !== null) this.#broadcast(paused);
    this.#sendRoom();
    log.info('match.paused', {
      room: this.code,
      seat,
      round: this.series.round,
      tick: this.match?.tick ?? 0,
      count: slot.pausesUsed,
    });
  }

  /** G1 / G2 */
  #onGraceExpired(seat: Seat): void {
    const slot = this.seats[seat];
    if (slot === null) return;
    slot.graceTimer = null;
    if (this.deleted || this.status !== 'paused' || slot.conn !== null) return;
    const other = this.seats[otherSeat(seat)];
    const now = this.#deps.clock.monotonicMs();
    if (
      other !== null &&
      other.conn === null &&
      other.graceDeadline !== null &&
      other.graceDeadline <= now
    ) {
      this.#destroy('ABANDONED'); // G2
      return;
    }
    this.#forfeit(seat, 'OPPONENT_DISCONNECTED', false); // G1
  }

  /** R2: the snapshot, then the resume countdown anchor. */
  #startResume(): void {
    const match = this.match;
    if (match === null) return;
    this.#broadcastSnapshot();
    const now = this.#deps.clock.nowEpochMs();
    this.#resumeAt = now + COUNTDOWN_MS;
    this.#broadcast(this.#resumedMessage(match, this.#resumeAt, now));
    this.#resumeTimer = this.#timer(COUNTDOWN_MS, () => {
      this.#onResumeEnd();
    });
  }

  /** T2 */
  #onResumeEnd(): void {
    this.#resumeTimer = null;
    if (
      this.deleted ||
      this.status !== 'paused' ||
      this.#resumeAt === null ||
      this.match === null ||
      !this.allSeatsConnected()
    ) {
      return;
    }
    this.#resumeAt = null;
    this.status = 'playing';
    this.#deps.loop.add(this); // a fresh accumulator
    this.#sendRoom();
    this.#deps.log.info('match.resumed', {
      room: this.code,
      round: this.series.round,
      tick: this.match.tick,
    });
  }

  #clearResume(): void {
    this.#cancelTimer(this.#resumeTimer);
    this.#resumeTimer = null;
    this.#resumeAt = null;
  }

  /**
   * Forfeit X (§4.4): the whole series goes to the other seat with no added win. A round in progress
   * ends with a final snapshot and gameOver; between rounds only `room` is sent (G1). Disconnected
   * seats keep a 2-minute hold (D6 semantics); the loser's seat is freed when `freeLoser`.
   */
  #forfeit(loser: Seat, reason: ForfeitReason, freeLoser: boolean): void {
    if (this.deleted || this.series.over) return;
    const { loop, log } = this.#deps;
    const match = this.match;
    const inProgress = (this.status === 'playing' || this.status === 'paused') && match !== null;
    loop.remove(this);
    this.#clearResume();
    this.#returnToWaiting();
    const { round, replay } = this.series;
    const winner = otherSeat(loser);
    this.series = applyForfeit(this.series, loser, reason, inProgress ? match.durationTicks : null);
    this.status = 'seriesOver';
    for (const slot of this.#slots()) {
      slot.ready = false;
      this.#cancelTimer(slot.graceTimer);
      slot.graceTimer = null;
      slot.graceEndsAt = null;
      slot.graceDeadline = null;
    }
    if (inProgress) {
      this.#broadcastSnapshot();
      const gameOver = this.#gameOver(match, round, replay, winner, reason);
      this.#lastGameOver = gameOver;
      this.#broadcast(gameOver);
      log.info('match.ended', { room: this.code, round, tick: match.tick, winner, reason });
    }
    if (freeLoser) this.#freeSeat(loser);
    for (const seat of SEATS) {
      const slot = this.seats[seat];
      if (slot !== null && slot.conn === null && slot.holdTimer === null) this.#hold(seat);
    }
    this.#sendRoom();
    log.info('series.ended', { room: this.code, winner, reason });
    this.#armIdle();
  }

  #hold(seat: Seat): void {
    const slot = this.seats[seat];
    if (slot === null) return;
    this.#cancelTimer(slot.holdTimer);
    slot.holdTimer = this.#timer(SEAT_HOLD_MS, () => {
      this.#onHoldExpired(seat);
    });
  }

  /** D2 / D7 / D8 */
  #onHoldExpired(seat: Seat): void {
    const slot = this.seats[seat];
    if (slot === null) return;
    slot.holdTimer = null;
    if (this.deleted || slot.conn !== null) return;
    switch (this.status) {
      case 'waiting':
        if (this.everStarted) {
          // Between rounds of a started series (REQ-034): the series goes to the opponent.
          this.#forfeit(seat, 'OPPONENT_DISCONNECTED', true);
        } else {
          this.#freeSeat(seat); // D2
          this.#sendRoom();
        }
        return;
      case 'roundOver':
        this.#forfeit(seat, 'OPPONENT_DISCONNECTED', true); // D7
        return;
      case 'seriesOver':
        this.#freeSeat(seat); // D8
        this.#sendRoom();
        return;
      default:
        return; // no hold outlives these statuses; ignore rather than guess
    }
  }

  /** X1 */
  #updateEmptyTimer(): void {
    if (this.deleted) return;
    if (this.#connectedPlayers() > 0) {
      this.#cancelTimer(this.#emptyTimer);
      this.#emptyTimer = null;
      return;
    }
    if (this.#emptyTimer !== null) return;
    this.#emptyTimer = this.#timer(this.#deps.limits.emptyRoomTtlMs, () => {
      this.#emptyTimer = null;
      if (!this.deleted && this.#connectedPlayers() === 0) this.#destroy('EMPTY');
    });
  }

  /** X2 */
  #onWaitingTtl(): void {
    this.#waitingTtlTimer = null;
    if (this.deleted || this.everStarted) return;
    if (this.status === 'countdown') {
      // About to start: check again once the countdown has resolved one way or the other.
      this.#waitingTtlTimer = this.#timer(COUNTDOWN_MS, () => {
        this.#onWaitingTtl();
      });
      return;
    }
    if (this.status === 'waiting') this.#destroy('WAITING_EXPIRED');
  }

  /**
   * N5: the room reached the maximum age. A match in progress (countdown, playing, or paused with a
   * player still connected) is never closed by age: look again shortly, and close once the round is over.
   * Waiting, roundOver, seriesOver and rooms with no connected player close now.
   */
  #onMaxAge(): void {
    this.#ageTimer = null;
    if (this.deleted) return;
    const inProgress =
      (this.status === 'countdown' || this.status === 'playing' || this.status === 'paused') &&
      this.hasConnectedPlayer();
    if (inProgress) {
      this.#ageTimer = this.#timer(this.#deps.limits.maxRoomAgeRecheckMs, () => {
        this.#onMaxAge();
      });
      return;
    }
    this.#destroy('MAX_AGE');
  }

  /** A person did something in the room: the finished-room idle clock restarts. */
  #touch(): void {
    this.#lastActivityAt = this.#deps.clock.monotonicMs();
  }

  /** F2: the room just reached roundOver or seriesOver. Idle from now unless someone acts. */
  #armIdle(): void {
    this.#touch();
    if (this.#idleTimer !== null) return;
    this.#idleTimer = this.#timer(this.#deps.limits.idleFinishedRoomTtlMs, () => {
      this.#onIdle();
    });
  }

  /** F2: deleted only while finished and untouched for the whole TTL; otherwise wait out the rest. */
  #onIdle(): void {
    this.#idleTimer = null;
    if (this.deleted || (this.status !== 'roundOver' && this.status !== 'seriesOver')) return;
    const { clock, limits } = this.#deps;
    const remaining = this.#lastActivityAt + limits.idleFinishedRoomTtlMs - clock.monotonicMs();
    if (remaining > 0) {
      this.#idleTimer = this.#timer(remaining, () => {
        this.#onIdle();
      });
      return;
    }
    this.#destroy('IDLE');
  }

  // ---------------------------------------------------------------- messages

  #slots(): SeatSlot[] {
    return SEATS.flatMap((s) => {
      const slot = this.seats[s];
      return slot === null ? [] : [slot];
    });
  }

  #recipients(): Connection[] {
    const out: Connection[] = [];
    for (const slot of this.#slots()) if (slot.conn !== null) out.push(slot.conn);
    for (const spectator of this.spectators) out.push(spectator);
    return out;
  }

  #broadcast(msg: ServerMessage): void {
    const text = JSON.stringify(msg);
    for (const conn of this.#recipients()) conn.sendText(text);
  }

  #sendError(conn: Connection, code: ErrorCode): void {
    conn.send({ type: 'error', code, message: ERROR_TEXT[code] });
  }

  #roomMessage(): RoomMessage {
    const players: RoomMessage['players'] = {};
    for (const seat of SEATS) {
      const slot = this.seats[seat];
      if (slot !== null) players[seat] = { name: slot.name, connected: slot.conn !== null };
    }
    return {
      type: 'room',
      code: this.code,
      status: this.status,
      players,
      spectators: this.spectators.size,
      series: toSeriesView(this.series),
    };
  }

  #sendRoom(): void {
    this.#broadcast(this.#roomMessage());
  }

  #rematchStatus(): RematchStatusMessage {
    return {
      type: 'rematchStatus',
      A: this.seats.A?.ready ?? false,
      B: this.seats.B?.ready ?? false,
    };
  }

  #countdownMessage(match: Match, serverNow: number): CountdownMessage {
    return {
      type: 'countdown',
      startsAt: this.#countdownStartsAt ?? serverNow,
      serverNow,
      tick: match.startTick,
    };
  }

  #resumedMessage(match: Match, startsAt: number, serverNow: number): ResumedMessage {
    return { type: 'resumed', startsAt, serverNow, tick: match.tick };
  }

  #pausedMessage(seat: Seat, slot: SeatSlot): PausedMessage | null {
    if (slot.graceEndsAt === null) return null;
    return {
      type: 'paused',
      seat,
      graceEndsAt: slot.graceEndsAt,
      serverNow: this.#deps.clock.nowEpochMs(),
      pausesLeft: Math.max(0, MAX_PAUSES_PER_SERIES - slot.pausesUsed),
    };
  }

  #gameOver(
    match: Match,
    round: number,
    replay: boolean,
    winner: Seat | null,
    reason: GameOverReason,
  ): GameOverMessage {
    return {
      type: 'gameOver',
      round,
      replay,
      winner,
      reason,
      tick: match.tick,
      series: toSeriesView(this.series),
      stats: { A: match.stats('A'), B: match.stats('B') },
      report: { A: match.report('A'), B: match.report('B') },
    };
  }

  #publicPlayers(match: Match): { A?: PublicView; B?: PublicView } {
    const players: { A?: PublicView; B?: PublicView } = {};
    for (const seat of SEATS) {
      if (this.seats[seat] !== null) players[seat] = toPublicView(match.states[seat]);
    }
    return players;
  }

  #snapshotFor(
    match: Match,
    seat: Seat | null,
    players: { A?: PublicView; B?: PublicView },
    events: SnapshotEvent[],
  ): SnapshotMessage {
    const base: SnapshotMessage = {
      type: 'snapshot',
      tick: match.tick,
      level: levelForTick(match.tick),
      players,
      events,
    };
    if (seat === null || this.seats[seat] === null) return base;
    return { ...base, you: toOwnView(match.states[seat], match.lastAckSeq(seat)) };
  }

  /** One broadcast snapshot (REQ-027/028): public views built once, an own view per seated player. */
  #broadcastSnapshot(): void {
    const match = this.match;
    if (match === null) return;
    const events = match.takeSnapshotEvents();
    const players = this.#publicPlayers(match);
    for (const seat of SEATS) {
      const conn = this.seats[seat]?.conn;
      if (conn != null) conn.send(this.#snapshotFor(match, seat, players, events));
    }
    if (this.spectators.size > 0) {
      const text = JSON.stringify(this.#snapshotFor(match, null, players, events));
      for (const spectator of this.spectators) spectator.sendText(text);
    }
  }

  #sendSnapshotTo(conn: Connection): void {
    const match = this.match;
    if (match === null) return;
    const seat = conn.role === 'A' || conn.role === 'B' ? conn.role : null;
    conn.send(this.#snapshotFor(match, seat, this.#publicPlayers(match), []));
  }

  /** Catch-up after a bind (§3.6 ordering; gap ruling G4: countdown/resume anchors included). */
  #catchUp(conn: Connection): void {
    const match = this.match;
    const now = this.#deps.clock.nowEpochMs();
    switch (this.status) {
      case 'waiting':
        return;
      case 'countdown':
        if (match === null) return;
        this.#sendSnapshotTo(conn);
        conn.send(this.#countdownMessage(match, now));
        return;
      case 'playing':
        this.#sendSnapshotTo(conn);
        // A fresh page rejoining a live round has no clock anchor (the old socket never closed, so no
        // pause and no `resumed`): give a seat one that starts now, so its input goes live (REQ-021).
        if (match !== null && (conn.role === 'A' || conn.role === 'B')) {
          conn.send(this.#resumedMessage(match, now, now));
        }
        return;
      case 'paused':
        this.#sendSnapshotTo(conn);
        for (const seat of SEATS) {
          const slot = this.seats[seat];
          if (slot === null || slot.conn !== null) continue;
          const paused = this.#pausedMessage(seat, slot);
          if (paused !== null) conn.send(paused);
        }
        if (match !== null && this.#resumeAt !== null) {
          conn.send(this.#resumedMessage(match, this.#resumeAt, now));
        }
        return;
      case 'roundOver':
      case 'seriesOver':
        this.#sendSnapshotTo(conn);
        if (this.#lastGameOver !== null) conn.send(this.#lastGameOver);
        conn.send(this.#rematchStatus());
        return;
    }
  }

  // ---------------------------------------------------------------- timers

  /** Every room timer is wrapped: a throw is logged and aborts this room only (X3). */
  #timer(ms: number, fn: () => void): TimerId {
    return this.#deps.clock.setTimeout(() => {
      safeCall(this.#deps.log, { room: this.code }, fn, () => {
        this.abort();
      });
    }, ms);
  }

  #cancelTimer(id: TimerId | null): void {
    if (id !== null) this.#deps.clock.clearTimeout(id);
  }

  #cancelAllTimers(): void {
    for (const id of [
      this.#countdownTimer,
      this.#resumeTimer,
      this.#emptyTimer,
      this.#waitingTtlTimer,
      this.#ageTimer,
      this.#idleTimer,
    ]) {
      this.#cancelTimer(id);
    }
    this.#countdownTimer = null;
    this.#resumeTimer = null;
    this.#emptyTimer = null;
    this.#waitingTtlTimer = null;
    this.#ageTimer = null;
    this.#idleTimer = null;
    for (const slot of this.#slots()) {
      this.#cancelTimer(slot.holdTimer);
      this.#cancelTimer(slot.graceTimer);
      slot.holdTimer = null;
      slot.graceTimer = null;
    }
  }
}

/** One less room under `key`; the entry disappears at zero so the map never grows past the live rooms. */
function release(counts: Map<string, number>, key: string): void {
  const left = (counts.get(key) ?? 1) - 1;
  if (left > 0) counts.set(key, left);
  else counts.delete(key);
}

/** Live rooms by canonical code. A room is added only after every create gate has passed. */
export class RoomRegistry {
  readonly #rooms = new Map<RoomCode, Room>();
  /** Undeleted rooms per creator IP key (N1). Kept in memory only, never logged. */
  readonly #perIp = new Map<string, number>();
  /** Undeleted rooms per creator network key, the IPv6 /48 (N2). */
  readonly #perNetwork = new Map<string, number>();
  readonly #deps: RoomDeps;

  constructor(deps: RoomDeps) {
    this.#deps = deps;
  }

  get size(): number {
    return this.#rooms.size;
  }

  /**
   * Rooms the client key `ip` created and that are not deleted yet, connected players or not (N1). A
   * room whose players all left stays charged to its creator for its whole 2-minute empty TTL, so
   * creating and abandoning rooms cannot park more than the cap; the slot returns when it is deleted.
   */
  liveRoomsOf(ip: string): number {
    return this.#perIp.get(ip) ?? 0;
  }

  /** The same for every /64 key inside one network key (the IPv6 /48; for IPv4 the address, N2). */
  liveRoomsOfNetwork(network: string): number {
    return this.#perNetwork.get(network) ?? 0;
  }

  /** `code` must already be canonical (normalizeRoomCode). */
  get(code: RoomCode): Room | undefined {
    return this.#rooms.get(code);
  }

  /** The creator is charged one slot, on its `ip` key and its `network` key, until the room is deleted. */
  create(owner: { readonly ip: string; readonly network: string }): Room {
    const code = generateRoomCode((c) => this.#rooms.has(c));
    const room = new Room(code, this.#deps, (r) => {
      if (this.#rooms.get(r.code) !== r) return;
      this.#rooms.delete(r.code);
      release(this.#perIp, owner.ip);
      release(this.#perNetwork, owner.network);
    });
    this.#rooms.set(code, room);
    this.#perIp.set(owner.ip, (this.#perIp.get(owner.ip) ?? 0) + 1);
    this.#perNetwork.set(owner.network, (this.#perNetwork.get(owner.network) ?? 0) + 1);
    return room;
  }

  shutdown(): void {
    for (const room of this.#rooms.values()) room.shutdown();
    this.#rooms.clear();
    this.#perIp.clear();
    this.#perNetwork.clear();
  }
}
