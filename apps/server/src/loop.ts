/**
 * The 60 Hz fixed-step loop (architecture §4.6, REQ-024). Real mode: one process-wide timer chain that
 * wakes every TICK_MS while any room is playing; each room keeps its own accumulator over the monotonic
 * clock and catches up at most `maxCatchUpTicks` per wake (the rest of the backlog is dropped, so a
 * stall never becomes a death spiral). Manual mode (tests): no timer; `stepAll(n)` drives the ticks.
 */
import { TICK_RATE } from '@stackerist/engine';
import { TICK_MS } from '@stackerist/protocol';
import type { Clock, TimerId } from './clock.js';

/** A playing room. `stepSafely` must never throw (rooms wrap their own step). */
export interface LoopRoom {
  stepSafely(): void;
}

interface Accumulator {
  /** Elapsed ms × TICK_RATE: one tick is exactly 1000 units, so whole ticks never lose a float ulp. */
  units: number;
  lastWake: number;
}

const UNITS_PER_TICK = 1000;

export class GameLoop {
  readonly #clock: Clock;
  readonly #manual: boolean;
  readonly #maxCatchUp: number;
  readonly #rooms = new Map<LoopRoom, Accumulator>();
  #timer: TimerId | null = null;

  constructor(
    clock: Clock,
    options: { readonly manual: boolean; readonly maxCatchUpTicks: number },
  ) {
    this.#clock = clock;
    this.#manual = options.manual;
    this.#maxCatchUp = options.maxCatchUpTicks;
  }

  /** Starts ticking `room` with an empty accumulator (also the T2 "reset the accumulator"). */
  add(room: LoopRoom): void {
    this.#rooms.set(room, { units: 0, lastWake: this.#clock.monotonicMs() });
    this.#arm();
  }

  remove(room: LoopRoom): void {
    this.#rooms.delete(room);
    if (this.#rooms.size === 0) this.#disarm();
  }

  has(room: LoopRoom): boolean {
    return this.#rooms.has(room);
  }

  get size(): number {
    return this.#rooms.size;
  }

  /** One real-time wake: advance every accumulator, run the whole ticks (≤ maxCatchUpTicks). */
  wake(): void {
    this.#timer = null;
    const now = this.#clock.monotonicMs();
    for (const [room, acc] of [...this.#rooms]) {
      acc.units += Math.max(0, now - acc.lastWake) * TICK_RATE;
      acc.lastWake = now;
      let n = Math.floor(acc.units / UNITS_PER_TICK);
      if (n > this.#maxCatchUp) {
        n = this.#maxCatchUp;
        acc.units %= UNITS_PER_TICK;
      } else {
        acc.units -= n * UNITS_PER_TICK;
      }
      for (let i = 0; i < n && this.#rooms.get(room) === acc; i += 1) room.stepSafely();
    }
    this.#arm();
  }

  /** Manual mode: N ticks for every playing room, tick-major. */
  stepAll(ticks: number): void {
    for (let i = 0; i < ticks; i += 1) {
      for (const room of [...this.#rooms.keys()]) {
        if (this.#rooms.has(room)) room.stepSafely();
      }
    }
  }

  stop(): void {
    this.#rooms.clear();
    this.#disarm();
  }

  #arm(): void {
    if (this.#manual || this.#timer !== null || this.#rooms.size === 0) return;
    this.#timer = this.#clock.setTimeout(() => {
      this.wake();
    }, TICK_MS);
  }

  #disarm(): void {
    if (this.#timer !== null) {
      this.#clock.clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
}
