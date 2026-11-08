/**
 * mulberry32 in 32-bit integer maths (REQ-008). Pure form (state in, state out) for the bag, and a
 * stateful convenience for the server's hole RNG.
 */

export interface RngStep {
  /** uint32 output. */
  readonly value: number;
  /** uint32 state to pass to the next call. */
  readonly state: number;
}

const MULBERRY_INCREMENT = 0x6d2b79f5;
const UINT32_RANGE = 0x1_0000_0000; // 2^32

/** Any number → a uint32 state (seed >>> 0). */
export function seedRng(seed: number): number {
  return seed >>> 0;
}

/** One mulberry32 step: the next uint32 and the next state. */
export function rngNext(state: number): RngStep {
  const a = (state + MULBERRY_INCREMENT) | 0;
  let t = Math.imul(a ^ (a >>> 15), a | 1);
  t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
  return { value: (t ^ (t >>> 14)) >>> 0, state: a >>> 0 };
}

/** Uniform integer in [0, n) by rejection sampling; 1 ≤ n ≤ 2^32. */
export function rngInt(state: number, n: number): RngStep {
  if (!Number.isInteger(n) || n < 1 || n > UINT32_RANGE) {
    throw new RangeError(`rngInt range must be an integer in 1..2^32, got ${String(n)}.`);
  }
  // Largest multiple of n that fits in 2^32; draws at or above it would bias the low values.
  const limit = UINT32_RANGE - (UINT32_RANGE % n);
  let current = state;
  for (;;) {
    const step = rngNext(current);
    if (step.value < limit) return { value: step.value % n, state: step.state };
    current = step.state;
  }
}

/** Stateful convenience for the server's hole RNG: each call returns the next uint32. */
export function createRng(seed: number): () => number {
  let state = seedRng(seed);
  return () => {
    const step = rngNext(state);
    state = step.state;
    return step.value;
  };
}
