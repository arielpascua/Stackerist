/**
 * Time for the server (architecture §4.2). Game time is integer ticks; wall-clock time is read ONLY
 * through an injected Clock, so tests drive countdowns, grace periods, pings and the loop with a
 * ManualClock. Timer callbacks are wrapped by `safeCall` at the call sites (rooms, connections, loop).
 */

declare const timerBrand: unique symbol;
/** An opaque timer handle from `Clock.setTimeout`. */
export interface TimerId {
  readonly [timerBrand]: true;
}

export interface Clock {
  /** Wall clock, ms since the Unix epoch (integer). Used ONLY for wire timestamps. */
  nowEpochMs(): number;
  /** Monotonic ms (performance.now() timebase). Loop accumulator, buckets, RTT, timers. */
  monotonicMs(): number;
  setTimeout(fn: () => void, ms: number): TimerId;
  clearTimeout(id: TimerId): void;
}

export const realClock: Clock = {
  nowEpochMs: () => Date.now(),
  monotonicMs: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as TimerId,
  clearTimeout: (id) => {
    clearTimeout(id as unknown as NodeJS.Timeout);
  },
};

interface ManualTimer {
  readonly due: number;
  readonly order: number;
  readonly fn: () => void;
}

/** A deterministic clock for tests: time moves only through `advance`, which fires due timers in order. */
export class ManualClock implements Clock {
  readonly #startEpochMs: number;
  #now = 0;
  #order = 0;
  readonly #timers = new Map<TimerId, ManualTimer>();

  constructor(startEpochMs = 1_767_225_600_000) {
    this.#startEpochMs = startEpochMs;
  }

  nowEpochMs(): number {
    return Math.floor(this.#startEpochMs + this.#now);
  }

  monotonicMs(): number {
    return this.#now;
  }

  setTimeout(fn: () => void, ms: number): TimerId {
    const id = Object.freeze({}) as TimerId;
    this.#order += 1;
    this.#timers.set(id, { due: this.#now + Math.max(0, ms), order: this.#order, fn });
    return id;
  }

  clearTimeout(id: TimerId): void {
    this.#timers.delete(id);
  }

  /** Timers still scheduled. */
  get pendingTimers(): number {
    return this.#timers.size;
  }

  /** Moves time forward by `ms`, firing every timer that falls due (earliest first, then FIFO). */
  advance(ms: number): void {
    const target = this.#now + Math.max(0, ms);
    for (;;) {
      let nextId: TimerId | null = null;
      let next: ManualTimer | null = null;
      for (const [id, timer] of this.#timers) {
        if (timer.due > target) continue;
        if (
          next === null ||
          timer.due < next.due ||
          (timer.due === next.due && timer.order < next.order)
        ) {
          next = timer;
          nextId = id;
        }
      }
      if (next === null || nextId === null) break;
      this.#timers.delete(nextId);
      this.#now = Math.max(this.#now, next.due);
      next.fn();
    }
    this.#now = target;
  }
}
