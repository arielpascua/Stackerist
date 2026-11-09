/**
 * Rate limits (architecture §4.8; REQ-038, REQ-081). Time is passed in (monotonic ms from the Clock).
 * Neither structure grows on a check: only `take` (which IS the charge) and `charge` write.
 */

/** A lazily refilled token bucket. `take` is the one and only charge. */
export class TokenBucket {
  readonly capacity: number;
  readonly refillPerSec: number;
  #tokens: number;
  #last: number;

  constructor(capacity: number, refillPerSec: number, nowMs: number) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.#tokens = capacity;
    this.#last = nowMs;
  }

  /** Refills from elapsed time, then spends one token if available. */
  take(nowMs: number): boolean {
    const elapsed = Math.max(0, nowMs - this.#last);
    this.#last = Math.max(this.#last, nowMs);
    this.#tokens = Math.min(this.capacity, this.#tokens + (elapsed * this.refillPerSec) / 1000);
    if (this.#tokens < 1) return false;
    this.#tokens -= 1;
    return true;
  }
}

/** Hits per key within a sliding window. Keys are client IPs: kept in memory only, never logged. */
export class SlidingWindowCounter {
  readonly windowMs: number;
  readonly #hits = new Map<string, number[]>();

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  #live(key: string, nowMs: number): number[] | undefined {
    const hits = this.#hits.get(key);
    if (hits === undefined) return undefined;
    const cutoff = nowMs - this.windowMs;
    while (hits.length > 0 && (hits[0] ?? Infinity) <= cutoff) hits.shift();
    if (hits.length === 0) {
      this.#hits.delete(key);
      return undefined;
    }
    return hits;
  }

  /** Hits for `key` inside the window. Never creates an entry. */
  count(key: string, nowMs: number): number {
    return this.#live(key, nowMs)?.length ?? 0;
  }

  isFull(key: string, limit: number, nowMs: number): boolean {
    return this.count(key, nowMs) >= limit;
  }

  charge(key: string, nowMs: number): void {
    const hits = this.#live(key, nowMs);
    if (hits === undefined) this.#hits.set(key, [nowMs]);
    else hits.push(nowMs);
  }

  /** Drops every key whose hits have all expired. */
  sweep(nowMs: number): void {
    for (const key of [...this.#hits.keys()]) this.#live(key, nowMs);
  }

  get size(): number {
    return this.#hits.size;
  }
}
