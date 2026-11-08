/**
 * @stackerist/engine — pure, deterministic rules engine.
 *
 * Rules: no I/O, no Date, no Math.random, no floats in game state, never mutate inputs.
 * W1a checkpoint: types and config from docs/architecture.md §2.2–2.3. The rule modules land in W1b.
 */
export * from './types.js';
export * from './config.js';

export const ENGINE_VERSION = '0.0.0';
