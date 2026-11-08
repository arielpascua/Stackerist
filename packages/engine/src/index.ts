/**
 * @stackerist/engine — pure, deterministic rules engine.
 *
 * Rules: no I/O, no wall clock, no unseeded randomness, no timers, integers only in game state,
 * never mutate inputs. Every public symbol is re-exported here (consumers resolve this file through
 * the `@stackerist/source` export condition).
 */
export * from './types.js';
export * from './config.js';
export * from './pieces.js';
export * from './board.js';
export * from './rng.js';
export * from './bag.js';
export * from './srs.js';
export * from './garbage.js';
export * from './player.js';
export * from './simulate.js';

export const ENGINE_VERSION = '0.0.0';
