/**
 * A scripted `GameStore` for the visual harness. It registers a frame driver, so CORE's real
 * `mountArena` draws the scripted boards, and its `subscribeFrame` listeners get real frames.
 */
import type {
  BoardModel,
  ClientState,
  FrameModel,
  GameStore,
  StandoffPhase,
} from '../../../src/game/contract.ts';
import { registerFrameDriver } from '../../../src/game/driver.ts';

export interface FrameScript {
  readonly left: BoardModel | null;
  readonly right: BoardModel | null;
  readonly standoff: StandoffPhase;
}

export class FakeStore implements GameStore {
  #state: ClientState;
  #script: FrameScript;
  readonly #listeners = new Set<() => void>();
  readonly #frameListeners = new Set<(frame: FrameModel) => void>();
  /** What the store would do on a request (the harness scripts errors and replies). */
  onCreate: (name: string) => void = () => undefined;
  onJoin: (code: string, name: string | null, asSpectator: boolean) => void = () => undefined;

  constructor(state: ClientState, script: FrameScript) {
    this.#state = state;
    this.#script = script;
    registerFrameDriver(this, {
      computeFrame: (nowMs) => ({
        nowMs,
        left: this.#script.left,
        right: this.#script.right,
        fx: [],
        level: this.#state.level,
        standoff: this.#script.standoff,
        inputLive: this.#script.standoff === null,
      }),
      publishFrame: (frame) => {
        for (const listener of this.#frameListeners) listener(frame);
      },
      stopFrames: () => undefined,
      role: () => this.#state.role,
    });
  }

  patch(patch: Partial<ClientState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }

  setScript(script: Partial<FrameScript>): void {
    this.#script = { ...this.#script, ...script };
  }

  getState = (): ClientState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  subscribeFrame = (listener: (frame: FrameModel) => void): (() => void) => {
    this.#frameListeners.add(listener);
    return () => this.#frameListeners.delete(listener);
  };

  connect = (): void => undefined;
  create = (name: string): void => {
    this.onCreate(name);
  };
  join = (code: string, name: string | null, asSpectator: boolean): void => {
    this.onJoin(code, name, asSpectator);
  };
  resume = (): boolean => false;
  leave = (): void => undefined;
  ready = (): void => undefined;
  clearError = (): void => {
    if (this.#state.error !== null) this.patch({ error: null });
  };
  matchElapsedMs = (): number | null => 192_000;
}
