/**
 * The one timer seam for CORE. Pure modules (input DAS/ARR, socket backoff) take a `Timers` so tests
 * drive time by hand; the browser composition passes `browserTimers`.
 */
export interface Timers {
  /** Runs `fn` once after `ms` milliseconds; returns a handle for `clear`. */
  set(fn: () => void, ms: number): number;
  clear(handle: number): void;
}

export const browserTimers: Timers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (handle) => {
    window.clearTimeout(handle);
  },
};
