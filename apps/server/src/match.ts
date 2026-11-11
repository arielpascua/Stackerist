/**
 * One round (architecture §4.6–4.7): both engine states, the per-seat input pipeline, the fixed-step
 * `step()`, attack routing and the round report samples. Pure game logic with no I/O; the room sends.
 *
 * Input pipeline (§4.3 a–e) — the gate order is a contract:
 *   a. bucket.take()  — the ONLY charge, at receipt; the drain never charges
 *   b. seq ≤ seqFloor → badSeq
 *   c. tick > match.tick + 30, or tick < lastStampTick → badTick
 *   d. buffer full → queueFull
 *   e. push, THEN seqFloor = seq, lastStampTick = tick
 * lastSeenSeq = max(lastSeenSeq, seq) at every outcome from (a) on. Nothing else is written before its gate.
 */
import {
  HEIGHT_SAMPLE_EVERY_TICKS,
  MAX_INPUT_LEAD_TICKS,
  MAX_SNAPSHOT_EVENTS,
  otherSeat,
  SNAPSHOT_EVERY_TICKS,
  toPlayerStats,
  type PlayerStats,
  type RoundReport,
  type Seat,
  type SnapshotEvent,
} from '@stackerist/protocol';
import {
  MAX_ACTIONS_PER_TICK,
  applyAction,
  createBag,
  createPlayerState,
  levelForTick,
  receiveGarbage,
  stackHeight,
  tick as tickPlayer,
  type EngineEvent,
  type PlayerState,
  type StampedInput,
} from '@stackerist/engine';
import type { Limits } from './config.js';
import { TokenBucket } from './rateLimit.js';

export interface MatchSeeds {
  readonly pieceSeed: number;
  readonly holeSeed: number;
}

export type InputVerdict = 'accepted' | 'rateLimited' | 'badSeq' | 'badTick' | 'queueFull';

export interface RoundOutcome {
  readonly winner: Seat | null;
  readonly reason: 'TOP_OUT' | 'DRAW';
}

export interface MatchStepResult {
  /** True when a snapshot must go out now (a lock, the 2-tick cadence, or the round's end). */
  readonly snapshotDue: boolean;
  readonly outcome: RoundOutcome | null;
}

export interface MatchOptions {
  readonly seeds: MatchSeeds;
  /** First play tick of the round (0 in production; tests may start at a higher level). */
  readonly startTick: number;
  /** A hole column 0..9 per call (REQ-017: the server's own RNG, one call per attack). */
  readonly holeRng: () => number;
  readonly limits: Pick<
    Limits,
    'inputBurst' | 'inputRefillPerSec' | 'maxQueuedInputs' | 'maxHeightSamples'
  >;
  /** Monotonic ms at creation (the buckets start full). */
  readonly nowMs: number;
}

interface SeatPipe {
  buffer: StampedInput[];
  seqFloor: number;
  lastSeenSeq: number;
  lastStampTick: number;
  readonly bucket: TokenBucket;
  actions: number;
  readonly heightSamples: number[];
}

const SEATS: readonly Seat[] = ['A', 'B'];

function isInt(n: number, min: number, max: number): boolean {
  return Number.isInteger(n) && n >= min && n <= max;
}

export class Match {
  readonly startTick: number;
  /** The next tick `step()` processes. */
  tick: number;
  readonly states: Record<Seat, PlayerState>;
  readonly #holeRng: () => number;
  readonly #limits: MatchOptions['limits'];
  readonly #pipes: Record<Seat, SeatPipe>;
  #events: SnapshotEvent[] = [];
  #lastSnapshotTick: number;

  constructor(options: MatchOptions) {
    const { seeds, startTick } = options;
    if (!isInt(seeds.pieceSeed, 0, 2 ** 31 - 1) || !isInt(seeds.holeSeed, 0, 2 ** 31 - 1)) {
      throw new RangeError('Match seeds must be integers in 0..2^31-1');
    }
    if (!isInt(startTick, 0, 2 ** 31 - 1)) throw new RangeError('startTick must be a tick');
    this.startTick = startTick;
    this.tick = startTick;
    this.#lastSnapshotTick = startTick;
    this.#holeRng = options.holeRng;
    this.#limits = options.limits;
    // REQ-023: one seed, a separate bag instance per seat → identical sequences, nothing shared.
    this.states = {
      A: createPlayerState({ bag: createBag(seeds.pieceSeed), tick: startTick }),
      B: createPlayerState({ bag: createBag(seeds.pieceSeed), tick: startTick }),
    };
    const pipe = (seat: Seat): SeatPipe => ({
      buffer: [],
      seqFloor: 0,
      lastSeenSeq: 0,
      lastStampTick: -1,
      bucket: new TokenBucket(
        options.limits.inputBurst,
        options.limits.inputRefillPerSec,
        options.nowMs,
      ),
      actions: 0,
      heightSamples: [stackHeight(this.states[seat].board)],
    });
    this.#pipes = { A: pipe('A'), B: pipe('B') };
  }

  /** The §4.3 a–e pipeline for one input from `seat` (the caller has passed the seat and status gates). */
  receiveInput(seat: Seat, input: StampedInput, nowMs: number): InputVerdict {
    const pipe = this.#pipes[seat];
    let verdict: InputVerdict;
    if (!pipe.bucket.take(nowMs)) {
      verdict = 'rateLimited';
    } else if (input.seq <= pipe.seqFloor) {
      verdict = 'badSeq';
    } else if (input.tick > this.tick + MAX_INPUT_LEAD_TICKS || input.tick < pipe.lastStampTick) {
      verdict = 'badTick';
    } else if (pipe.buffer.length >= this.#limits.maxQueuedInputs) {
      verdict = 'queueFull';
    } else {
      pipe.buffer.push({ seq: input.seq, tick: input.tick, action: { type: input.action.type } });
      pipe.seqFloor = input.seq;
      pipe.lastStampTick = input.tick;
      verdict = 'accepted';
    }
    pipe.lastSeenSeq = Math.max(pipe.lastSeenSeq, input.seq);
    return verdict;
  }

  /** Every lower seq has been applied or discarded (decision 12). */
  lastAckSeq(seat: Seat): number {
    const pipe = this.#pipes[seat];
    const head = pipe.buffer[0];
    return head === undefined ? pipe.lastSeenSeq : head.seq - 1;
  }

  bufferLength(seat: Seat): number {
    return this.#pipes[seat].buffer.length;
  }

  /** On pause: empty both buffers and forget the stamps; lastSeenSeq stays, so they are acknowledged. */
  clearBuffers(): void {
    for (const seat of SEATS) {
      const pipe = this.#pipes[seat];
      pipe.buffer = [];
      pipe.lastStampTick = -1;
    }
  }

  /** On every bind: a fresh seq space for this seat (decision 13). */
  resetSeatSequence(seat: Seat): void {
    const pipe = this.#pipes[seat];
    pipe.buffer = [];
    pipe.seqFloor = 0;
    pipe.lastSeenSeq = 0;
    pipe.lastStampTick = -1;
  }

  #drain(seat: Seat, n: number, events: EngineEvent[]): void {
    const pipe = this.#pipes[seat];
    let applied = 0;
    while (applied < MAX_ACTIONS_PER_TICK && !this.states[seat].toppedOut) {
      const front = pipe.buffer[0];
      if (front === undefined || front.tick > n) break;
      pipe.buffer.shift();
      const result = applyAction(this.states[seat], front.action);
      this.states[seat] = result.state;
      events.push(...result.events);
      pipe.actions += 1;
      applied += 1;
    }
  }

  /** Processes tick N = this.tick (architecture §4.6 steps 1–6). */
  step(): MatchStepResult {
    const n = this.tick;
    const level = levelForTick(n);
    const events: Record<Seat, EngineEvent[]> = { A: [], B: [] };
    // 1. Inputs with tick ≤ N, A then B, at most MAX_ACTIONS_PER_TICK each.
    for (const seat of SEATS) this.#drain(seat, n, events[seat]);
    // 2. Gravity and lock delay.
    for (const seat of SEATS) {
      const result = tickPlayer(this.states[seat], level);
      this.states[seat] = result.state;
      events[seat].push(...result.events);
    }
    // 3. Route attacks (A's first, in event order), one hole RNG call per attack.
    let locked = false;
    for (const seat of SEATS) {
      for (const event of events[seat]) {
        if (event.type === 'locked') locked = true;
        if (event.type === 'garbageCancelled') {
          this.#events.push({ type: 'cancel', seat, rows: event.rows, tick: n });
        } else if (event.type === 'attack') {
          const target = otherSeat(seat);
          const holeColumn = this.#holeRng();
          this.states[target] = receiveGarbage(this.states[target], {
            rows: event.rows,
            holeColumn,
          });
          this.#events.push({ type: 'attack', from: seat, rows: event.rows, tick: n });
        }
      }
    }
    // 4. Top-outs.
    const outA = this.states.A.toppedOut;
    const outB = this.states.B.toppedOut;
    const outcome: RoundOutcome | null =
      outA && outB
        ? { winner: null, reason: 'DRAW' }
        : outA
          ? { winner: 'B', reason: 'TOP_OUT' }
          : outB
            ? { winner: 'A', reason: 'TOP_OUT' }
            : null;
    // 5. Advance and sample.
    this.tick = n + 1;
    if ((this.tick - this.startTick) % HEIGHT_SAMPLE_EVERY_TICKS === 0) {
      for (const seat of SEATS) {
        const samples = this.#pipes[seat].heightSamples;
        if (samples.length < this.#limits.maxHeightSamples) {
          samples.push(stackHeight(this.states[seat].board));
        }
      }
    }
    // 6. Snapshot cadence (REQ-027): after any lock, else at most every 2 ticks; always at the end.
    const snapshotDue =
      locked || outcome !== null || this.tick - this.#lastSnapshotTick >= SNAPSHOT_EVERY_TICKS;
    return { snapshotDue, outcome };
  }

  /** The events since the last broadcast snapshot; clears them and restarts the cadence. */
  takeSnapshotEvents(): SnapshotEvent[] {
    const events = this.#events.slice(-MAX_SNAPSHOT_EVENTS);
    this.#events = [];
    this.#lastSnapshotTick = this.tick;
    return events;
  }

  get durationTicks(): number {
    return this.tick - this.startTick;
  }

  stats(seat: Seat): PlayerStats {
    return toPlayerStats(this.states[seat]);
  }

  report(seat: Seat): RoundReport {
    const state = this.states[seat];
    const pipe = this.#pipes[seat];
    return {
      piecesPlaced: state.piecesPlaced,
      actions: pipe.actions,
      garbageSent: state.garbageSent,
      garbageReceived: state.garbageReceived,
      garbageCancelled: state.garbageCancelled,
      durationTicks: this.durationTicks,
      heightSamples: [...pipe.heightSamples],
    };
  }
}
