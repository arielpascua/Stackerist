/**
 * The CORE-internal side of a `GameStore`: what the arena's rAF loop needs beyond the UI contract.
 * The concrete store registers itself here, so `mountArena(canvases, store, …)` can find the frame
 * driver for the store UI hands it without widening the UI-facing contract.
 */
import type { FrameModel, GameStore, Role } from './contract.ts';

export interface FrameDriver {
  /** Builds the frame for this rAF timestamp; flips input live in the same call (REQ-086). */
  computeFrame(nowMs: number, reducedMotion: boolean): FrameModel;
  /** Notifies `subscribeFrame` listeners with the frame that was just drawn. */
  publishFrame(frame: FrameModel): void;
  /** The arena unmounted: input is no longer live. */
  stopFrames(): void;
  role(): Role | null;
}

const drivers = new WeakMap<GameStore, FrameDriver>();

export function registerFrameDriver(store: GameStore, driver: FrameDriver): void {
  drivers.set(store, driver);
}

export function frameDriverOf(store: GameStore): FrameDriver | null {
  return drivers.get(store) ?? null;
}
