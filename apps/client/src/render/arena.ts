/**
 * `mountArena` (REQ-055, architecture §5.5): the one requestAnimationFrame loop per mounted arena.
 *
 * Each frame: compute the frame from the store (prediction, standoff, input-live) → start its effects →
 * draw both boards (DPR-aware) → write the `DATA_HOOKS` → notify the `subscribeFrame` listeners. The
 * line-clear flash and the garbage nudge are drawn from timelines; they never hold back input or state.
 *
 * W4 adds here: the ghost (renderList slot), the NEXT previews (the next canvases are sized now), the
 * danger frame and ring, and projectiles and bursts on the fx canvas (the frame already carries them).
 */
import { PREVIEW_COUNT } from '@stackerist/engine';
import { PUBLIC_PREVIEW_COUNT } from '@stackerist/protocol';
import { board as boardTokens } from '../../../../design/tokens/tokens.ts';
import type {
  ArenaCanvases,
  ArenaHandle,
  BoardModel,
  FrameModel,
  GameStore,
  MountArena,
} from '../game/contract.ts';
import { frameDriverOf } from '../game/driver.ts';
import { executeOps, prepareCanvas } from './canvas.ts';
import { BoardEffects } from './effects.ts';
import {
  arenaBoardGeometry,
  arenaCellSizes,
  nextCanvasSize,
  type BoardGeometry,
} from './geometry.ts';
import { HookWriter, boardHookValues, fxHookValues } from './hooks.ts';
import { boardOps, flashOps } from './renderList.ts';

/** Everything the loop needs from the browser, injectable for tests. */
export interface ArenaEnvironment {
  requestFrame(callback: (timestampMs: number) => void): number;
  cancelFrame(handle: number): void;
  /** Viewport size in CSS px. */
  viewport(): { readonly width: number; readonly height: number };
  devicePixelRatio(): number;
  /** Calls `listener` when the viewport or DPR may have changed; returns the unsubscribe. */
  onResize(listener: () => void): () => void;
  /** Calls `listener` with the new prefers-reduced-motion value when it changes. */
  onReducedMotionChange(listener: (reduced: boolean) => void): () => void;
  /** Where drawing errors go; the loop keeps running so input and the standoff never stall. */
  reportError(error: unknown): void;
}

class BoardView {
  readonly effects = new BoardEffects();
  readonly #canvas: HTMLCanvasElement;
  readonly #nextCanvas: HTMLCanvasElement;
  readonly #hooks: HookWriter;
  #ctx: CanvasRenderingContext2D | null = null;
  #geometry: BoardGeometry | null = null;
  #drawnModel: BoardModel | null | undefined = undefined;
  #flashing = false;
  #offset = 0;

  constructor(canvas: HTMLCanvasElement, nextCanvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    this.#nextCanvas = nextCanvas;
    this.#hooks = new HookWriter(canvas);
  }

  layout(geometry: BoardGeometry, nextSize: { width: number; height: number }, dpr: number): void {
    this.#geometry = geometry;
    this.#ctx = prepareCanvas(this.#canvas, geometry.width, geometry.height, dpr);
    this.#drawnModel = undefined;
    const nextCtx = prepareCanvas(this.#nextCanvas, nextSize.width, nextSize.height, dpr);
    // NEXT previews are drawn in W4 (REQ-060); until then the column is sized and left empty.
    nextCtx?.clearRect(0, 0, nextSize.width, nextSize.height);
  }

  draw(model: BoardModel | null, nowMs: number): void {
    const bands = this.effects.flashBands(nowMs);
    const geometry = this.#geometry;
    const ctx = this.#ctx;
    if (
      geometry !== null &&
      ctx !== null &&
      (model !== this.#drawnModel || bands.length > 0 || this.#flashing)
    ) {
      ctx.clearRect(0, 0, geometry.width, geometry.height);
      executeOps(ctx, [
        ...boardOps(geometry, model, { frameColor: boardTokens.frameColor }),
        ...flashOps(geometry, bands),
      ]);
      this.#drawnModel = model;
    }
    this.#flashing = bands.length > 0;
    const offset = this.effects.nudgeOffset(nowMs);
    if (offset !== this.#offset) {
      this.#offset = offset;
      this.#canvas.style.transform = offset > 0 ? `translateY(${String(-offset)}px)` : '';
    }
    this.#hooks.write(
      boardHookValues(model, {
        active: this.effects.activeCount(nowMs),
        flashes: this.effects.flashCount,
        nudges: this.effects.nudgeCount,
      }),
    );
  }

  reset(): void {
    this.#canvas.style.transform = '';
  }
}

export function createMountArena(env: ArenaEnvironment): MountArena {
  return (canvases: ArenaCanvases, store: GameStore, options): ArenaHandle => {
    const driver = frameDriverOf(store);
    if (driver === null)
      throw new TypeError('mountArena needs the store from createCoreServices()');
    const boards = {
      left: new BoardView(canvases.left, canvases.leftNext),
      right: new BoardView(canvases.right, canvases.rightNext),
    };
    const fxHooks = new HookWriter(canvases.fx);
    let reducedMotion = options.reducedMotion;
    let layoutDirty = true;
    let laidOutRole = driver.role();
    let running = true;

    const layout = (): void => {
      layoutDirty = false;
      laidOutRole = driver.role();
      const viewport = env.viewport();
      const dpr = env.devicePixelRatio();
      const spectator = laidOutRole === 'spectator';
      const cells = arenaCellSizes(viewport.width, viewport.height, spectator);
      boards.left.layout(
        arenaBoardGeometry(cells.own, true),
        nextCanvasSize(cells.next, spectator ? PUBLIC_PREVIEW_COUNT : PREVIEW_COUNT),
        dpr,
      );
      boards.right.layout(
        arenaBoardGeometry(spectator ? cells.own : cells.opp, spectator),
        nextCanvasSize(cells.next, PUBLIC_PREVIEW_COUNT),
        dpr,
      );
      // The fx overlay is positioned by the UI over the arena: keep its CSS size, match its backing.
      const fx = canvases.fx;
      prepareCanvas(fx, Math.max(1, fx.clientWidth), Math.max(1, fx.clientHeight), dpr, false);
    };

    const startEffects = (frame: FrameModel): void => {
      for (const fx of frame.fx) {
        if (fx.kind === 'flash') boards[fx.side].effects.flash(fx.rows, frame.nowMs, reducedMotion);
        else if (fx.kind === 'nudge')
          boards[fx.side].effects.nudge(fx.rows, frame.nowMs, reducedMotion);
        // 'projectile' and 'burst' are drawn on the fx canvas in W4 (REQ-087).
      }
    };

    const draw = (frame: FrameModel): void => {
      if (layoutDirty || driver.role() !== laidOutRole) layout();
      startEffects(frame);
      boards.left.draw(frame.left, frame.nowMs);
      boards.right.draw(frame.right, frame.nowMs);
      fxHooks.write(fxHookValues(0, 0));
    };

    let handle = 0;
    const loop = (timestampMs: number): void => {
      if (!running) return;
      handle = env.requestFrame(loop);
      const frame = driver.computeFrame(timestampMs, reducedMotion);
      try {
        draw(frame);
      } catch (error) {
        env.reportError(error);
      }
      driver.publishFrame(frame);
    };

    const unsubscribeResize = env.onResize(() => {
      layoutDirty = true;
    });
    const unsubscribeMotion = env.onReducedMotionChange((reduced) => {
      reducedMotion = reduced;
    });
    handle = env.requestFrame(loop);

    return {
      destroy() {
        if (!running) return;
        running = false;
        env.cancelFrame(handle);
        unsubscribeResize();
        unsubscribeMotion();
        driver.stopFrames();
        boards.left.reset();
        boards.right.reset();
      },
    };
  };
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** The real browser: rAF, window size and DPR, resize and media-query events, console errors. */
export function browserArenaEnvironment(): ArenaEnvironment {
  return {
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => {
      window.cancelAnimationFrame(handle);
    },
    viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    devicePixelRatio: () => window.devicePixelRatio,
    onResize: (listener) => {
      window.addEventListener('resize', listener);
      return () => {
        window.removeEventListener('resize', listener);
      };
    },
    onReducedMotionChange: (listener) => {
      const query = window.matchMedia(REDUCED_MOTION_QUERY);
      const onChange = (event: MediaQueryListEvent): void => {
        listener(event.matches);
      };
      query.addEventListener('change', onChange);
      return () => {
        query.removeEventListener('change', onChange);
      };
    },
    reportError: (error) => {
      console.error('Stackerist arena draw failed', error);
    },
  };
}

/** The production `MountArena`. */
export const mountArena: MountArena = (canvases, store, options) =>
  createMountArena(browserArenaEnvironment())(canvases, store, options);
