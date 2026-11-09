/**
 * @stackerist/protocol — the WebSocket contract shared by client and server (architecture §3):
 * constants, zod schemas and their inferred types, codes and links, parsing, the information-hiding
 * views, the client's tick estimator and the run-ahead predictor. `typeAssertions.ts` is compile-time
 * only and exports nothing at runtime.
 */
export const PROTOCOL_VERSION = 1;

export * from './constants.js';
export * from './schemas.js';
export type * from './messages.js';
export * from './codes.js';
export * from './parse.js';
export * from './views.js';
export * from './clock.js';
export * from './predict.js';
