/**
 * The lookahead scheduler (REQ-089, architecture §5.6): a 25 ms timer wakes up and schedules every score
 * step that starts within the next 100 ms on the audio clock. JavaScript timers are imprecise; the audio
 * clock is not, so notes are placed on it ahead of time. The tempo is read before each step, so a level
 * change takes effect on the very next step without a jump. Pure: the clock, timer and sink are injected.
 */
import type { Timers } from '../game/timers.ts';
import { stepSeconds } from './tempo.ts';

export const SCHEDULER_TICK_MS = 25;
export const LOOKAHEAD_SECONDS = 0.1;
/** The first step starts this long after `start()`, so its notes are never scheduled in the past. */
export const START_DELAY_SECONDS = 0.05;
/** A wake-up this far behind the schedule (a throttled tab) re-syncs instead of bursting the backlog. */
export const MAX_LAG_SECONDS = 0.5;

export interface SchedulerPorts {
  /** The audio clock, seconds. */
  now(): number;
  bpm(): number;
  /** Place the notes of `step` at `whenSeconds` on the audio clock; a step lasts `stepSeconds`. */
  playStep(step: number, whenSeconds: number, stepSeconds: number): void;
  readonly timers: Timers;
}

export class LookaheadScheduler {
  readonly #ports: SchedulerPorts;
  #handle: number | null = null;
  #step = 0;
  #nextTime = 0;

  constructor(ports: SchedulerPorts) {
    this.#ports = ports;
  }

  get running(): boolean {
    return this.#handle !== null;
  }

  /** The next step to be scheduled. */
  get step(): number {
    return this.#step;
  }

  /** Starts at the top of the song, or continues from the current step when `fromTop` is false. */
  start(fromTop = true): void {
    this.stop();
    if (fromTop) this.#step = 0;
    this.#nextTime = this.#ports.now() + START_DELAY_SECONDS;
    this.#tick();
  }

  stop(): void {
    if (this.#handle === null) return;
    this.#ports.timers.clear(this.#handle);
    this.#handle = null;
  }

  #tick(): void {
    const now = this.#ports.now();
    if (now - this.#nextTime > MAX_LAG_SECONDS) this.#nextTime = now;
    while (this.#nextTime < now + LOOKAHEAD_SECONDS) {
      const length = stepSeconds(this.#ports.bpm());
      this.#ports.playStep(this.#step, this.#nextTime, length);
      this.#nextTime += length;
      this.#step += 1;
    }
    this.#handle = this.#ports.timers.set(() => {
      this.#tick();
    }, SCHEDULER_TICK_MS);
  }
}
