/**
 * Run-ahead prediction of the player's own board (architecture §3.10, design §6.1; REQ-054, REQ-069,
 * REQ-082). The one prediction algorithm: the client and the REQ-082 latency harness both use it.
 *
 * The displayed state is always `simulate(base, targetTick, pending)` with the engine's real `simulate`:
 * - base = the last own snapshot rebuilt by `ownViewToPlayerState` (bag null, queue = the 5-piece
 *   preview), so a hard drop is predicted all the way through the lock and the next piece comes from
 *   the preview; past the preview the engine reports `starved` and prediction stops cleanly;
 * - pending = the inputs the server has not yet acknowledged (seq > lastAckSeq), at their stamped ticks;
 * - garbage reaches the own board only through snapshots: the base's pending garbage carries the hole
 *   columns, and nothing here adds garbage.
 * Each call snaps to the result; there is no smoothing.
 */
import {
  simulate,
  type PlayerState,
  type StampedInput,
  type TickedEvent,
} from '@stackerist/engine';
import type { OwnView } from './messages.js';
import { ownViewToPlayerState } from './views.js';

export interface DisplayResult {
  /**
   * The displayed own board at `targetTick` (a match tick). If prediction stopped early, this is the
   * state where it stopped: `toppedOut`, or starved (`active === null`, the preview ran dry).
   */
  readonly state: PlayerState;
  /**
   * Events whose tick is above the high-water mark, in order. Each event is delivered once, so
   * effects fire once. A later re-simulation never re-delivers a tick that was already delivered.
   */
  readonly newEvents: readonly TickedEvent[];
}

const NO_EVENTS: readonly TickedEvent[] = Object.freeze([]);

interface Memo {
  readonly base: PlayerState;
  readonly pendingLength: number;
  readonly targetTick: number;
  result: DisplayResult;
}

export class Predictor {
  #base: PlayerState | null = null;
  #lastAckSeq = 0;
  #pending: StampedInput[] = [];
  /** The highest match tick whose events have been delivered; null = none since the last clear. */
  #highWater: number | null = null;
  #memo: Memo | null = null;

  /** Inputs sent but not yet acknowledged (count). */
  get pendingCount(): number {
    return this.#pending.length;
  }

  /**
   * On every own snapshot: base = ownViewToPlayerState(view, tick), where `tick` is the snapshot's
   * match tick. Pending inputs with seq ≤ view.lastAckSeq are dropped (applied or discarded server-side).
   */
  onOwnSnapshot(view: OwnView, tick: number): void {
    this.#base = ownViewToPlayerState(view, tick);
    this.#lastAckSeq = view.lastAckSeq;
    this.#pending = this.#pending.filter((input) => input.seq > view.lastAckSeq);
    this.#memo = null;
  }

  /** An input just sent, stamped with the tick it should apply at. Already-acknowledged seqs are ignored. */
  addInput(input: StampedInput): void {
    if (input.seq <= this.#lastAckSeq) {
      return;
    }
    this.#pending.push(input);
  }

  /**
   * On paused / countdown / joined: forget the base, the pending inputs, the acknowledged seq and the
   * high-water mark (a new round restarts its ticks and its seq space).
   */
  clear(): void {
    this.#base = null;
    this.#lastAckSeq = 0;
    this.#pending = [];
    this.#highWater = null;
    this.#memo = null;
  }

  /**
   * simulate(base, targetTick, pending), memoised on (base, pending length, targetTick); null before the
   * first own snapshot. `targetTick` is an integer match tick (TickEstimator.targetTick). A repeated call
   * with an unchanged key returns the memoised state without re-simulating, and never re-delivers its
   * events: from the second call on it returns one stable object whose `newEvents` is empty.
   * Throws RangeError for a non-integer target.
   */
  display(targetTick: number): DisplayResult | null {
    if (!Number.isInteger(targetTick)) {
      throw new RangeError(`targetTick must be an integer match tick, got ${String(targetTick)}.`);
    }
    const base = this.#base;
    if (base === null) {
      return null;
    }
    const memo = this.#memo;
    if (
      memo !== null &&
      memo.base === base &&
      memo.pendingLength === this.#pending.length &&
      memo.targetTick === targetTick
    ) {
      if (memo.result.newEvents.length > 0) {
        memo.result = { state: memo.result.state, newEvents: NO_EVENTS };
      }
      return memo.result;
    }

    const run = simulate(base, targetTick, this.#pending);
    const floor = this.#highWater ?? Number.NEGATIVE_INFINITY;
    const fresh = run.events.filter((event) => event.tick > floor);
    // Every tick below reachedTick was simulated; a stop on a starved spawn tags its events with
    // reachedTick itself, so the last event tick counts as delivered too.
    let high = Math.max(floor, run.reachedTick - 1);
    for (const event of fresh) {
      high = Math.max(high, event.tick);
    }
    this.#highWater = high;

    const result: DisplayResult = {
      state: run.state,
      newEvents: fresh.length === 0 ? NO_EVENTS : fresh,
    };
    this.#memo = { base, pendingLength: this.#pending.length, targetTick, result };
    return result;
  }
}
