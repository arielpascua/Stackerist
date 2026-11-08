/**
 * Server-tick estimation for the client (architecture §3.9, design §6.1). Pure: every time is passed in.
 *
 * Units: `*LocalMs` are client-local monotonic ms (performance.now()); `startsAt`, `serverNow` and
 * `serverEpochMs` are server wall-clock ms since the Unix epoch; `rttMs` is a duration in ms; ticks are
 * integer match ticks. Tick maths uses ms × TICK_RATE / 1000, which is the §3.9 "÷ TICK_MS" without the
 * float error of 1000/60, so an exact whole-tick boundary never floors one tick short.
 */
import { TICK_RATE } from '@stackerist/engine';
import { DEFAULT_RTT_MS, MAX_INPUT_LEAD_TICKS } from './constants.js';
import type { CountdownMessage } from './messages.js';

/** Snapshot samples the estimator keeps (≈ 4 s at 30 Hz). */
export const TICK_SAMPLE_WINDOW = 120;

/** What `anchor` needs from a `countdown` or `resumed` message. */
export type ClockAnchor = Pick<CountdownMessage, 'startsAt' | 'serverNow' | 'tick'>;

/** Ticks (float) in `ms` milliseconds. */
function msToTicks(ms: number): number {
  return (ms * TICK_RATE) / 1000;
}

/**
 * Local ms at which the server's wall clock reads `serverEpochMs`:
 * recvLocalMs − rttMs / 2 + (serverEpochMs − serverNow).
 */
export function toLocalMs(
  serverEpochMs: number,
  serverNow: number,
  recvLocalMs: number,
  rttMs: number,
): number {
  return recvLocalMs - rttMs / 2 + (serverEpochMs - serverNow);
}

interface Anchor {
  readonly startsAt: number;
  readonly serverNow: number;
  readonly tick: number;
  readonly recvLocalMs: number;
  /** The rtt when the anchor arrived; the anchor's offset and goAt stay fixed if rtt changes later. */
  readonly rttMs: number;
}

interface Sample {
  readonly tick: number;
  readonly recvLocalMs: number;
  /** s = recvLocalMs − tick × TICK_MS (ms); the smallest s is the least-delayed snapshot. */
  readonly s: number;
}

export class TickEstimator {
  #rttMs = DEFAULT_RTT_MS;
  #anchor: Anchor | null = null;
  #samples: Sample[] = [];
  #best: Sample | null = null;
  #frozenTick: number | null = null;
  #lastTarget: number | null = null;

  /** The rtt in use, ms: DEFAULT_RTT_MS until the first `ping.rtt`. */
  get rttMs(): number {
    return this.#rttMs;
  }

  /**
   * On `countdown` / `resumed`: play (re)starts at match tick `msg.tick` at server time `msg.startsAt`.
   * Clears the samples and the target floor, and unfreezes.
   */
  anchor(msg: ClockAnchor, recvLocalMs: number): void {
    this.#anchor = {
      startsAt: msg.startsAt,
      serverNow: msg.serverNow,
      tick: msg.tick,
      recvLocalMs,
      rttMs: this.#rttMs,
    };
    this.#samples = [];
    this.#best = null;
    this.#frozenTick = null;
    this.#lastTarget = null;
  }

  /**
   * On every snapshot: keep the last TICK_SAMPLE_WINDOW samples s = recvLocalMs − tick × TICK_MS.
   * Ignored while frozen, and before the anchored start (`goAtLocalMs`): the server isn't ticking then,
   * so such a sample says nothing about the tick rate.
   */
  observeSnapshot(tick: number, recvLocalMs: number): void {
    if (this.#frozenTick !== null) {
      return;
    }
    const goAt = this.goAtLocalMs();
    if (goAt !== null && recvLocalMs < goAt) {
      return;
    }
    const sample: Sample = { tick, recvLocalMs, s: recvLocalMs - (tick * 1000) / TICK_RATE };
    this.#samples.push(sample);
    const dropped = this.#samples.length > TICK_SAMPLE_WINDOW ? this.#samples.shift() : undefined;
    if (dropped !== undefined && dropped === this.#best) {
      this.#best = null;
      for (const kept of this.#samples) {
        if (this.#best === null || kept.s < this.#best.s) {
          this.#best = kept;
        }
      }
    } else if (this.#best === null || sample.s < this.#best.s) {
      this.#best = sample;
    }
  }

  /** From `ping.rtt` (ms). null, a negative or a non-finite value keeps the previous rtt. */
  setRtt(rttMs: number | null): void {
    if (rttMs === null || !Number.isFinite(rttMs) || rttMs < 0) {
      return;
    }
    this.#rttMs = rttMs;
  }

  /** On `paused`: hold the estimate at its current value until the next `anchor()`. */
  freeze(localMs: number): void {
    if (this.#frozenTick === null) {
      this.#frozenTick = this.serverTick(localMs);
    }
  }

  /**
   * The server's next tick to process (integer).
   * - Frozen: the frozen value.
   * - With ≥ 1 sample: floor((localMs − min(s)) / TICK_MS + (rtt / 2) / TICK_MS).
   * - Else, anchored: tick + max(0, floor((localMs + offset − startsAt) / TICK_MS)), where
   *   offset = serverNow + rtt / 2 − recvLocalMs (server epoch ≈ local + offset).
   * - Else 0 (nothing heard yet).
   */
  serverTick(localMs: number): number {
    if (this.#frozenTick !== null) {
      return this.#frozenTick;
    }
    if (this.#best !== null) {
      const best = this.#best;
      return best.tick + Math.floor(msToTicks(localMs - best.recvLocalMs + this.#rttMs / 2));
    }
    const anchor = this.#anchor;
    if (anchor !== null) {
      const offset = anchor.serverNow + anchor.rttMs / 2 - anchor.recvLocalMs;
      return anchor.tick + Math.max(0, Math.floor(msToTicks(localMs + offset - anchor.startsAt)));
    }
    return 0;
  }

  /**
   * The tick an input sent now reaches the server: serverTick + ceil((rtt / 2) / TICK_MS) + 1, clamped to
   * ≤ serverTick + MAX_INPUT_LEAD_TICKS, and never below a value it already returned since the last
   * `anchor()`. Used for the display and as the input stamp, so a stamp can't trip BAD_TICK.
   */
  targetTick(localMs: number): number {
    const server = this.serverTick(localMs);
    const lead = Math.ceil(msToTicks(this.#rttMs / 2)) + 1;
    const clamped = server + Math.min(lead, MAX_INPUT_LEAD_TICKS);
    const target = this.#lastTarget === null ? clamped : Math.max(this.#lastTarget, clamped);
    this.#lastTarget = target;
    return target;
  }

  /** Local ms at which play (re)starts: the DUEL! instant and the input-live instant (REQ-086). */
  goAtLocalMs(): number | null {
    const anchor = this.#anchor;
    return anchor === null
      ? null
      : toLocalMs(anchor.startsAt, anchor.serverNow, anchor.recvLocalMs, anchor.rttMs);
  }
}
