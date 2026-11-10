/**
 * Latency-injection harness for REQ-082 / REQ-069 (architecture §6.4).
 *
 * Everything runs on ONE virtual clock (the server's ManualClock), stepped one millisecond at a time:
 * - the server is the real server (real sockets, real ingress pipeline, manual ticks every TICK_MS of
 *   virtual time);
 * - `LatencyLink` holds every frame for `rttMs / 2` of virtual time in each direction, so the round trip
 *   is exactly `rttMs`, ping/pong included (`ping.rtt` reports it);
 * - `PredictingClient` is the production composition minus React and the DOM: the protocol
 *   `TickEstimator` + `Predictor` (which runs the engine's `simulate`) and the stamp rule `targetTick`,
 *   wired the way `apps/client/src/game/store.ts` wires them. Its clock is the virtual clock plus a fixed
 *   skew, so clock-skew correction is exercised too.
 * - `mode: 'naive'` is the negative control: it does not run ahead (it displays the last own snapshot)
 *   and it stamps inputs with the current server tick estimate instead of `targetTick`.
 *
 * A scripted bot plays the own board from what the client DISPLAYS (it presses keys, then hard drops once
 * the displayed piece is where it wants it). The server's side is read from `testing.inspect` after every
 * tick. `compareRun` lines the two up.
 */
import {
  applyAction,
  ghostPosition,
  pieceCells,
  type Action,
  type Cell,
  type PlayerState,
} from '@stackerist/engine';
import {
  COUNTDOWN_MS,
  Predictor,
  TICK_MS,
  TickEstimator,
  type ClientMessage,
  type OwnView,
  type ServerMessage,
} from '@stackerist/protocol';
import { until, startTestServer, type Harness, type TestClient } from './harness.js';
import { planClear } from './planner.js';

/** The predicting client's clock = server virtual clock + this fixed skew (proves skew correction). */
export const CLIENT_SKEW_MS = 7919;
/** Level 12 (one row per tick) from the first tick of the round. */
export const TOP_SPEED_START_TICK = 21_600;

/**
 * predict: the production client. naive: the negative control (no run-ahead, stamps the current server
 * tick). late-stamp: a second control that does run ahead but stamps the current server tick.
 */
export type ClientMode = 'predict' | 'naive' | 'late-stamp';

// ------------------------------------------------------------------------------------------ the link

interface Timed<T> {
  readonly at: number;
  readonly msg: T;
}

/** `rematch` outside a finished round is answered with one of these and nothing else (the flush barrier). */
function isSentinelReply(code: string): boolean {
  return code === 'NOT_FINISHED' || code === 'NOT_IN_ROOM';
}

/** Wraps one real TestClient: every frame in either direction is delayed by `oneWayMs` of virtual time. */
export class LatencyLink {
  readonly h: Harness;
  readonly client: TestClient;
  readonly oneWayMs: number;
  readonly #outbound: Timed<ClientMessage>[] = [];
  readonly #inbound: Timed<ServerMessage>[] = [];
  #captured = 0;

  constructor(h: Harness, client: TestClient, oneWayMs: number) {
    this.h = h;
    this.client = client;
    this.oneWayMs = oneWayMs;
  }

  /** Queues a frame; it reaches the server `oneWayMs` from now. */
  send(msg: ClientMessage): void {
    this.#outbound.push({ at: this.h.clock.monotonicMs() + this.oneWayMs, msg });
  }

  /** Writes every due frame to the real socket and waits until the server has handled them. */
  async pump(): Promise<ClientMessage[]> {
    const now = this.h.clock.monotonicMs();
    const due: ClientMessage[] = [];
    while (this.#outbound.length > 0 && (this.#outbound[0]?.at ?? Infinity) <= now) {
      const next = this.#outbound.shift();
      if (next !== undefined) due.push(next.msg);
    }
    if (due.length === 0) return due;
    for (const msg of due) this.client.send(msg);
    await this.h.settle();
    return due;
  }

  /**
   * Server → client barrier. `rematch` from a seated player while the round runs is answered with
   * NOT_FINISHED and nothing else, and one socket is ordered, so when that error arrives every frame the
   * server sent before it has arrived too. Everything new is captured and timed from now.
   */
  async flush(): Promise<void> {
    const count = (): number =>
      this.client.all('error').filter((e) => isSentinelReply(e.code)).length;
    const before = count();
    this.client.send({ type: 'rematch' });
    await until(() => count() > before, 'the link flush');
    this.#capture();
  }

  /** After the round ended the barrier no longer works (rematch is a real request): wait for gameOver. */
  async drain(): Promise<void> {
    await until(() => this.client.all('gameOver').length > 0, 'gameOver');
    this.#capture();
  }

  #capture(): void {
    const now = this.h.clock.monotonicMs();
    for (; this.#captured < this.client.received.length; this.#captured += 1) {
      const msg = this.client.received[this.#captured];
      if (msg === undefined) continue;
      if (msg.type === 'error' && isSentinelReply(msg.code)) continue; // the barrier's own reply
      // A ping is stamped with the instant the server sent it, so a late capture cannot stretch the RTT.
      const sentAt = msg.type === 'ping' ? Math.min(now, msg.t) : now;
      this.#inbound.push({ at: sentAt + this.oneWayMs, msg });
    }
  }

  /** Messages that have reached the client by now, oldest first. */
  release(): ServerMessage[] {
    const now = this.h.clock.monotonicMs();
    const due = this.#inbound.filter((item) => item.at <= now);
    if (due.length === 0) return [];
    const rest = this.#inbound.filter((item) => item.at > now);
    this.#inbound.length = 0;
    this.#inbound.push(...rest);
    return due.toSorted((x, y) => x.at - y.at).map((item) => item.msg);
  }
}

// ------------------------------------------------------------------------------------- cell helpers

export type CellKey = string;

export function cellsKey(cells: readonly Cell[]): CellKey {
  return cells
    .map((c) => `${String(c.x)},${String(c.y)}`)
    .toSorted()
    .join(' ');
}

/** The cells the hard drop of the displayed piece would fill (the ghost the player is shown). */
export function landingCells(state: PlayerState): readonly Cell[] | null {
  const ghost = ghostPosition(state);
  return ghost === null ? null : pieceCells(ghost);
}

// ------------------------------------------------------------------------------------ the client

export interface PredictedLock {
  readonly tick: number;
  readonly kind: string;
  readonly cells: readonly Cell[];
  /** The own board as displayed in the frame that first showed this lock. */
  readonly board: readonly string[];
  readonly shownAtMs: number;
}

export interface PressRecord {
  readonly seq: number;
  readonly action: Action['type'];
  /** The stamp the input was sent with. */
  readonly stamp: number;
  readonly sentAtMs: number;
  /** The ghost of the piece the player was shown when pressing (hard drops only). */
  readonly shownLanding: readonly Cell[] | null;
  /** Virtual ms the server had it (set when the link wrote it to the socket). */
  arrivedAtMs: number | null;
  /** Server tick that was next to process when it arrived. */
  arrivalTick: number | null;
}

export interface EffectRecord {
  readonly seq: number;
  readonly action: Action['type'];
  readonly pressedAtMs: number;
  /** x / rotation the display must show once the input has taken effect. */
  readonly expect: { readonly kind: string; readonly x: number; readonly rotation: number };
  visibleAtMs: number | null;
  /** True when the server had already acknowledged this seq in a snapshot the client had received. */
  ackedBeforeVisible: boolean;
}

export interface Frame {
  readonly state: PlayerState;
  readonly targetTick: number;
}

export class PredictingClient {
  readonly estimator = new TickEstimator();
  readonly predictor = new Predictor();
  readonly mode: ClientMode;
  readonly link: LatencyLink;
  readonly presses: PressRecord[] = [];
  readonly effects: EffectRecord[] = [];
  readonly locks: PredictedLock[] = [];
  /** Every server message the client has received, in order. */
  readonly inbox: ServerMessage[] = [];
  current: Frame | null = null;
  lastOwn: { readonly view: OwnView; readonly tick: number } | null = null;
  ackedSeq = 0;
  #nextSeq = 1;
  #lastStamp = -1;
  #over = false;

  constructor(link: LatencyLink, mode: ClientMode) {
    this.link = link;
    this.mode = mode;
  }

  /** The client's own monotonic clock. */
  now(): number {
    return this.link.h.clock.monotonicMs() + CLIENT_SKEW_MS;
  }

  /** True from the DUEL! instant while the round runs (store.ts `#isLive`). */
  get live(): boolean {
    const goAt = this.estimator.goAtLocalMs();
    return (
      goAt !== null &&
      this.now() >= goAt &&
      !this.#over &&
      this.lastOwn !== null &&
      !this.lastOwn.view.toppedOut
    );
  }

  /** Mirrors `GameStore`'s handling of server messages (store.ts, onMessage). */
  receive(msg: ServerMessage): void {
    this.inbox.push(msg);
    const now = this.now();
    switch (msg.type) {
      case 'created':
      case 'joined':
        this.#nextSeq = 1;
        this.predictor.clear();
        this.lastOwn = null;
        break;
      case 'countdown':
        this.estimator.anchor(msg, now);
        this.#nextSeq = 1;
        this.#lastStamp = -1;
        this.#reseed();
        break;
      case 'resumed':
        this.estimator.anchor(msg, now);
        this.#reseed();
        break;
      case 'paused':
        this.estimator.freeze(now);
        this.#reseed();
        break;
      case 'snapshot':
        this.estimator.observeSnapshot(msg.tick, now);
        if (msg.you !== undefined) {
          this.lastOwn = { view: msg.you, tick: msg.tick };
          this.ackedSeq = msg.you.lastAckSeq;
          this.predictor.onOwnSnapshot(msg.you, msg.tick);
        }
        break;
      case 'gameOver':
        this.#over = true;
        break;
      case 'ping':
        this.estimator.setRtt(msg.rtt);
        this.link.send({ type: 'pong', t: msg.t });
        break;
      default:
        break;
    }
  }

  #reseed(): void {
    this.predictor.clear();
    this.ackedSeq = 0;
    if (this.lastOwn !== null) {
      this.predictor.onOwnSnapshot({ ...this.lastOwn.view, lastAckSeq: 0 }, this.lastOwn.tick);
    }
  }

  /** One render frame: the displayed own board (store.ts `#ownModel`). */
  frame(): Frame | null {
    const own = this.lastOwn;
    if (own === null) return null;
    const now = this.now();
    const tick = this.mode !== 'naive' && this.live ? this.estimator.targetTick(now) : own.tick;
    const shown = this.predictor.display(tick);
    if (shown === null) return null;
    for (const item of shown.newEvents) {
      if (item.event.type === 'locked') {
        this.locks.push({
          tick: item.tick,
          kind: item.event.kind,
          cells: item.event.cells,
          board: shown.state.board,
          shownAtMs: this.link.h.clock.monotonicMs(),
        });
      }
    }
    this.current = { state: shown.state, targetTick: tick };
    this.#checkEffects(shown.state);
    return this.current;
  }

  #checkEffects(state: PlayerState): void {
    const active = state.active;
    if (active === null) return;
    for (const effect of this.effects) {
      if (effect.visibleAtMs !== null) continue;
      if (
        active.kind === effect.expect.kind &&
        active.x === effect.expect.x &&
        active.rotation === effect.expect.rotation
      ) {
        effect.visibleAtMs = this.link.h.clock.monotonicMs();
        effect.ackedBeforeVisible = this.ackedSeq >= effect.seq;
      }
    }
  }

  /** A key press: stamp, send through the link, and (predicting client only) add to the prediction. */
  press(action: Action): PressRecord | null {
    const frame = this.current;
    if (!this.live || frame === null) return null;
    const now = this.now();
    const stamp =
      this.mode === 'predict'
        ? this.estimator.targetTick(now)
        : Math.max(this.#lastStamp, this.estimator.serverTick(now));
    this.#lastStamp = stamp;
    const seq = this.#nextSeq;
    this.#nextSeq += 1;
    this.link.send({ type: 'input', seq, tick: stamp, action: { type: action.type } });
    if (this.mode !== 'naive') this.predictor.addInput({ seq, tick: stamp, action });
    const record: PressRecord = {
      seq,
      action: action.type,
      stamp,
      sentAtMs: this.link.h.clock.monotonicMs(),
      shownLanding: action.type === 'hardDrop' ? landingCells(frame.state) : null,
      arrivedAtMs: null,
      arrivalTick: null,
    };
    this.presses.push(record);
    const before = frame.state.active;
    if (before !== null && action.type !== 'hardDrop' && action.type !== 'softDropStart') {
      const after = applyAction(frame.state, action).state.active;
      if (after !== null && (after.x !== before.x || after.rotation !== before.rotation)) {
        this.effects.push({
          seq,
          action: action.type,
          pressedAtMs: this.link.h.clock.monotonicMs(),
          expect: { kind: after.kind, x: after.x, rotation: after.rotation },
          visibleAtMs: null,
          ackedBeforeVisible: false,
        });
      }
    }
    return record;
  }
}

// ------------------------------------------------------------------------------------------ the bot

export interface PiecePlan {
  /** Quarter turns: 0 none, 1 one CW, 2 two CW, 3 one CCW. */
  readonly turns: 0 | 1 | 2 | 3;
  /** Wanted leftmost cell column (clamped so no cell reaches column 9). */
  readonly targetX: number;
  /** Frames to wait, aligned, before the hard drop. */
  readonly dwell: number;
}

/** Twelve pieces, varied turns, columns and dwell. Column 9 stays empty, so no row ever clears. */
export const DEFAULT_PLAN: readonly PiecePlan[] = [
  { turns: 0, targetX: 4, dwell: 0 },
  { turns: 1, targetX: 0, dwell: 2 },
  { turns: 2, targetX: 6, dwell: 0 },
  { turns: 3, targetX: 2, dwell: 1 },
  { turns: 0, targetX: 0, dwell: 3 },
  { turns: 1, targetX: 7, dwell: 0 },
  { turns: 0, targetX: 2, dwell: 2 },
  { turns: 2, targetX: 4, dwell: 1 },
  { turns: 3, targetX: 8, dwell: 0 },
  { turns: 0, targetX: 6, dwell: 2 },
  { turns: 1, targetX: 1, dwell: 0 },
  { turns: 3, targetX: 5, dwell: 1 },
];

const TURNS: Record<PiecePlan['turns'], readonly Action[]> = {
  0: [],
  1: [{ type: 'rotateCW' }],
  2: [{ type: 'rotateCW' }, { type: 'rotateCW' }],
  3: [{ type: 'rotateCCW' }],
};

/** Presses at most one key per `gapFrames` frames (about 20 keys/s) based on the DISPLAYED piece. */
export class Bot {
  readonly plan: readonly PiecePlan[];
  readonly gapFrames: number;
  pieceIndex = 0;
  #turnsSent = 0;
  #cooldown = 0;
  #dwellLeft: number | null = null;
  #awaitingPlaced: number | null = null;

  constructor(plan: readonly PiecePlan[], gapFrames = 3) {
    this.plan = plan;
    this.gapFrames = gapFrames;
  }

  get done(): boolean {
    return this.pieceIndex >= this.plan.length && this.#awaitingPlaced === null;
  }

  step(client: PredictingClient): void {
    const frame = client.current;
    if (frame === null || !client.live) return;
    const state = frame.state;
    if (state.toppedOut || state.active === null) return;
    if (this.#cooldown > 0) {
      this.#cooldown -= 1;
      return;
    }
    if (this.#awaitingPlaced !== null) {
      if (state.piecesPlaced <= this.#awaitingPlaced) return;
      this.#awaitingPlaced = null;
    }
    const plan = this.plan[this.pieceIndex];
    if (plan === undefined) return;
    const turns = TURNS[plan.turns];
    const turn = turns[this.#turnsSent];
    if (turn !== undefined) {
      this.#turnsSent += 1;
      client.press(turn);
      this.#cooldown = this.gapFrames - 1;
      return;
    }
    const cells = pieceCells(state.active);
    const xs = cells.map((c) => c.x);
    const minX = Math.min(...xs);
    const width = Math.max(...xs) - minX + 1;
    const target = Math.min(plan.targetX, 9 - width);
    if (minX !== target) {
      client.press({ type: minX < target ? 'moveRight' : 'moveLeft' });
      this.#cooldown = this.gapFrames - 1;
      return;
    }
    this.#dwellLeft ??= plan.dwell;
    if (this.#dwellLeft > 0) {
      this.#dwellLeft -= 1;
      return;
    }
    client.press({ type: 'hardDrop' });
    this.#awaitingPlaced = state.piecesPlaced;
    this.pieceIndex += 1;
    this.#turnsSent = 0;
    this.#dwellLeft = null;
    this.#cooldown = this.gapFrames - 1;
  }
}

// ----------------------------------------------------------------------------------- the server side

export interface ServerLock {
  readonly index: number;
  /** The server tick the lock happened in. */
  readonly tick: number;
  /** The cells the piece filled; null when a line clear makes them ambiguous. */
  readonly cells: readonly Cell[] | null;
  readonly kind: string | null;
  /** A's board right after the lock tick. */
  readonly board: readonly string[];
  readonly garbageInserted: number;
  readonly linesCleared: number;
}

export interface ServerAttack {
  /** The server tick in which the attack was routed into A's pending garbage. */
  readonly tick: number;
  readonly rows: number;
}

const EMPTY = '.'.repeat(10);

/** The cells filled by the lock between two server boards (no clear; garbage rows undone first). */
function diffCells(
  before: PlayerState,
  after: PlayerState,
): { cells: Cell[]; kind: string } | null {
  if (after.linesCleared !== before.linesCleared) return null;
  const inserted = after.garbageInserted - before.garbageInserted;
  const rebuilt =
    inserted > 0
      ? [...Array.from({ length: inserted }, () => EMPTY), ...after.board.slice(0, 20 - inserted)]
      : after.board;
  const cells: Cell[] = [];
  let kind = '';
  for (let y = 0; y < rebuilt.length; y += 1) {
    const row = rebuilt[y] ?? EMPTY;
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== '.' && before.board[y]?.[x] === '.') {
        cells.push({ x, y });
        kind = row[x] ?? '';
      }
    }
  }
  return cells.length === 4 ? { cells, kind } : null;
}

// -------------------------------------------------------------------------------------------- a run

export interface DuelOptions {
  /** Round-trip latency in ms (half each way). */
  readonly rttMs: number;
  /** Speed level at the first tick: startTick = level × 1800. */
  readonly level?: number;
  readonly mode: ClientMode;
  readonly plan?: readonly PiecePlan[];
  /** B clears two lines (an attack of one row) and the last piece is delayed by this many ticks. */
  readonly attackDelayTicks?: number;
  /** Extra ticks to keep playing after the last scripted piece so corrections can arrive. */
  readonly tailTicks?: number;
  /** Where the client's render frames sit between server ticks, ms (default 3.3). */
  readonly framePhaseMs?: number;
  /** Hard stop in server ticks (default 1200). */
  readonly maxTicks?: number;
}

export interface DuelRun {
  readonly mode: ClientMode;
  readonly rttMs: number;
  readonly client: PredictingClient;
  readonly serverLocks: ServerLock[];
  readonly attacks: ServerAttack[];
  readonly startTick: number;
  readonly ticksPlayed: number;
  /** The script finished (all pieces placed) before `maxTicks`. */
  readonly completed: boolean;
  /** The round ended (a top-out) before the script finished. */
  readonly roundOver: boolean;
  /** The rtt the client's estimator ended up using (from the server's own ping.rtt). */
  readonly rttUsed: number;
  readonly code: string;
}

export function startTickForLevel(level: number): number {
  return level * 1800;
}

/** Plays one whole scripted duel through a latency link and returns everything both sides saw. */
export async function runDuel(options: DuelOptions): Promise<DuelRun> {
  const level = options.level ?? 12;
  const startTick = level === 12 ? TOP_SPEED_START_TICK : startTickForLevel(level);
  const attacking = options.attackDelayTicks !== undefined;
  const h = await startTestServer({
    test: { startTick },
    // The link barrier (`LatencyLink.flush`) sends `rematch` as a sentinel every few simulated ticks, far
    // faster than the per-connection non-input bucket (F9: burst 20, 5/s) allows on a virtual clock. F9 has
    // its own tests (nonInput.test.ts); lift it here so this harness isolates prediction, not that limit.
    limits: {
      nonInputBurst: 100_000,
      // B's two-line clear needs ~20 inputs inside a few ticks; the default bucket (20 + 30/s) would drop them.
      ...(attacking ? { inputBurst: 400, inputRefillPerSec: 400 } : {}),
    },
  });
  try {
    return await playDuel(h, options, startTick);
  } finally {
    await h.close();
  }
}

async function playDuel(h: Harness, options: DuelOptions, startTick: number): Promise<DuelRun> {
  const clock = h.clock;
  const plan = options.plan ?? DEFAULT_PLAN;
  const a = await h.connect({ autoPong: false });
  const link = new LatencyLink(h, a, options.rttMs / 2);
  const client = new PredictingClient(link, options.mode);
  const bot = new Bot(plan);
  const serverLocks: ServerLock[] = [];
  const attacks: ServerAttack[] = [];
  let code = '';
  let phase: 'lobby' | 'playing' = 'lobby';
  let nextFrameAt = options.framePhaseMs ?? 3.3; // not aligned with the server's ticks
  let nextStepAt = 0;
  let ticksPlayed = 0;
  let tailLeft = options.tailTicks ?? 40;
  let roundOver = false;
  let bPlan: ReturnType<typeof planClear> = null;
  let bPieceIndex = 0;
  let bFinalWait = options.attackDelayTicks ?? 0;
  let b: TestClient | null = null;

  const server = () => h.inspect(code);

  async function oneMs(): Promise<void> {
    clock.advance(1);
    const now = clock.monotonicMs();
    for (const msg of link.release()) client.receive(msg);
    if (now >= nextFrameAt) {
      client.frame();
      if (phase === 'playing') bot.step(client);
      nextFrameAt += TICK_MS;
    }
    const written = await link.pump();
    for (const msg of written) {
      if (msg.type !== 'input') continue;
      const record = client.presses.find((p) => p.seq === msg.seq);
      if (record !== undefined && phase === 'playing') {
        record.arrivedAtMs = now;
        record.arrivalTick = server().tick ?? 0;
      }
    }
    if (phase === 'playing' && now >= nextStepAt) {
      await stepServer();
      nextStepAt += TICK_MS;
    }
  }

  async function runFor(ms: number): Promise<void> {
    for (let i = 0; i < ms; i += 1) await oneMs();
  }

  async function stepServer(): Promise<void> {
    const before = server();
    const beforeA = before.players.A;
    if (before.status !== 'playing' || beforeA === undefined) {
      throw new Error(`the round ended early (status ${before.status})`);
    }
    const tick = before.tick ?? 0;
    // B's script: its pieces are placed on the server's own state, in the tick they are issued.
    if (b !== null && bPlan !== null) {
      await bTurn(b, tick);
    }
    h.step(1);
    ticksPlayed += 1;
    const after = server();
    const afterA = after.players.A;
    if (afterA === undefined) throw new Error('no A state');
    if (afterA.garbageReceived > beforeA.garbageReceived) {
      attacks.push({ tick, rows: afterA.garbageReceived - beforeA.garbageReceived });
    }
    const locked = afterA.piecesPlaced - beforeA.piecesPlaced;
    if (locked > 0) {
      const diff = locked === 1 ? diffCells(beforeA, afterA) : null;
      serverLocks.push({
        index: afterA.piecesPlaced,
        tick,
        cells: diff?.cells ?? null,
        kind: diff?.kind ?? null,
        board: afterA.board,
        garbageInserted: afterA.garbageInserted - beforeA.garbageInserted,
        linesCleared: afterA.linesCleared - beforeA.linesCleared,
      });
    }
    if (after.status !== 'playing') {
      roundOver = true;
      await link.drain();
    } else {
      await link.flush();
    }
    if (bot.done && serverLocks.length >= plan.length) tailLeft -= 1;
  }

  async function bTurn(bClient: TestClient, tick: number): Promise<void> {
    const state = server().players.B;
    if (state === undefined || bPlan === null) return;
    const total = bPlan.length;
    if (bPieceIndex >= total) return;
    const last = bPieceIndex === total - 1;
    if (last && bFinalWait > 0) {
      bFinalWait -= 1;
      return;
    }
    let actions = bPlan[bPieceIndex];
    if (last) {
      // The final piece has fallen for a few ticks: re-plan from the live state.
      actions = planClear(state, 2, { depth: 1 })?.[0];
    }
    if (actions === undefined) throw new Error('B has no placement');
    for (const action of actions) bClient.input(action, tick);
    bPieceIndex += 1;
    await h.settle();
  }

  // ---- lobby: A creates, a few seconds pass so ping.rtt is known, B joins, the countdown runs.
  link.send({ type: 'create', name: 'Ann' });
  await link.flush();
  await runFor(options.rttMs + 20);
  await link.flush();
  const created = a.last('created');
  if (created === undefined) throw new Error('A never got `created`');
  code = created.code;
  // Two pings (3 s apart) cross the link: the second carries the measured rtt.
  for (let i = 0; i < 3600; i += 1) {
    await oneMs();
    if (i % 100 === 0) await link.flush();
  }
  await link.flush();
  b = await h.connect();
  b.send({ type: 'join', code, name: 'Ben' });
  await b.next('joined');
  await h.settle();
  await link.flush();
  await b.next('countdown');
  if (options.attackDelayTicks !== undefined) {
    bPlan = planClear(server().players.B ?? fail('no B state'), 2);
    if (bPlan === null) throw new Error('no two-line plan for B');
  }
  // The countdown fires COUNTDOWN_MS after the join; the first tick runs the same millisecond.
  for (let i = 0; i < COUNTDOWN_MS; i += 1) {
    await oneMs();
    if (i % 50 === 0) await link.flush();
  }
  if (server().status !== 'playing') throw new Error('the round did not start');
  phase = 'playing';
  nextStepAt = clock.monotonicMs();
  await link.flush();

  while (tailLeft > 0 && !roundOver && ticksPlayed < (options.maxTicks ?? 1200)) await oneMs();
  if (!roundOver) await link.flush();
  return {
    mode: options.mode,
    rttMs: options.rttMs,
    client,
    serverLocks,
    attacks,
    startTick,
    ticksPlayed,
    completed: tailLeft <= 0 && !roundOver,
    roundOver,
    rttUsed: client.estimator.rttMs,
    code,
  };
}

function fail(message: string): never {
  throw new Error(message);
}

// ------------------------------------------------------------------------------------------ compare

export interface PieceRow {
  readonly index: number;
  readonly lockTick: number;
  readonly serverCells: CellKey | null;
  readonly predictedCells: CellKey | null;
  readonly predictedTick: number | null;
  readonly cellsEqual: boolean;
  readonly tickEqual: boolean;
  readonly boardEqual: boolean;
  /** True when the server routed garbage into A inside the prediction window before this lock. */
  readonly garbageInWindow: boolean;
}

export interface LandingRow {
  readonly seq: number;
  readonly stamp: number;
  readonly arrivalTick: number | null;
  readonly shown: CellKey | null;
  readonly serverCells: CellKey | null;
  readonly lockTick: number | null;
  /** The tick the server applied the drop: max(stamp, arrival). */
  readonly appliedTick: number | null;
  readonly equal: boolean;
  /** False when a line clear made the server's cells ambiguous (not counted either way). */
  readonly comparable: boolean;
}

export interface Comparison {
  readonly pieces: PieceRow[];
  readonly landings: LandingRow[];
}

/** The prediction window in ticks: run-ahead lead + one-way trip + 1 for cadence rounding. */
export function predictionWindowTicks(rttMs: number): number {
  const oneWay = Math.ceil(rttMs / 2 / TICK_MS);
  return oneWay + 1 + oneWay + 1;
}

export function compareRun(run: DuelRun): Comparison {
  const window = predictionWindowTicks(run.rttMs);
  const predicted = run.client.locks;
  const pieces: PieceRow[] = run.serverLocks.map((lock, i) => {
    const p = predicted[i];
    const serverCells = lock.cells === null ? null : cellsKey(lock.cells);
    const predictedCells = p === undefined ? null : cellsKey(p.cells);
    return {
      index: lock.index,
      lockTick: lock.tick,
      serverCells,
      predictedCells,
      predictedTick: p?.tick ?? null,
      cellsEqual: serverCells !== null && serverCells === predictedCells,
      tickEqual: p?.tick === lock.tick,
      boardEqual: p !== undefined && p.board.join('/') === lock.board.join('/'),
      garbageInWindow: run.attacks.some((a) => lock.tick >= a.tick && lock.tick <= a.tick + window),
    };
  });
  const landings: LandingRow[] = run.client.presses
    .filter((press) => press.action === 'hardDrop' && press.arrivalTick !== null)
    .map((press) => {
      const appliedTick = Math.max(press.stamp, press.arrivalTick ?? 0);
      const lock = run.serverLocks.find((l) => l.tick >= appliedTick) ?? null;
      const serverCells = lock?.cells == null ? null : cellsKey(lock.cells);
      const shown = press.shownLanding === null ? null : cellsKey(press.shownLanding);
      return {
        seq: press.seq,
        stamp: press.stamp,
        arrivalTick: press.arrivalTick,
        shown,
        serverCells,
        lockTick: lock?.tick ?? null,
        appliedTick,
        equal: shown !== null && shown === serverCells,
        comparable: lock !== null && lock.cells !== null,
      };
    });
  return { pieces, landings };
}
