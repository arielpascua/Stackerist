/**
 * `mountArena` (REQ-055, architecture §5.5): the one requestAnimationFrame loop per mounted arena.
 *
 * Each frame: compute the frame from the store (prediction, standoff, input-live) → start its effects →
 * draw both boards (DPR-aware: ghost, danger frame and ring, meter) and the NEXT previews → draw the
 * projectiles and bursts on the fx canvas → write the `DATA_HOOKS` → notify the `subscribeFrame`
 * listeners. Every effect is drawn from a timeline; none of them holds back input or state.
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
  Side,
} from '../game/contract.ts';
import { frameDriverOf } from '../game/driver.ts';
import { executeOps, prepareCanvas } from './canvas.ts';
import { BoardEffects, DangerPulse } from './effects.ts';
import {
  arenaBoardGeometry,
  arenaCellSizes,
  nextCanvasSize,
  type BoardGeometry,
  type Rect,
} from './geometry.ts';
import { HookWriter, boardHookValues, fxHookValues } from './hooks.ts';
import { FxField, type FxScene } from './projectiles.ts';
import { boardOps, flashOps, nextPreviewOps, type DangerLook, type Point } from './renderList.ts';

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
  /** A canvas' box in viewport CSS px (to place projectiles over the boards); absent = all at (0, 0). */
  canvasBounds?(canvas: HTMLCanvasElement): Rect | null;
}

function sameLook(a: DangerLook | null, b: DangerLook): boolean {
  return a !== null && a.frameAlpha === b.frameAlpha && a.ringAlpha === b.ringAlpha;
}

class BoardView {
  readonly effects = new BoardEffects();
  readonly #canvas: HTMLCanvasElement;
  readonly #nextCanvas: HTMLCanvasElement;
  readonly #hooks: HookWriter;
  readonly #pulse = new DangerPulse();
  #ctx: CanvasRenderingContext2D | null = null;
  #nextCtx: CanvasRenderingContext2D | null = null;
  #nextCell = 0;
  #nextSize = { width: 0, height: 0 };
  #nextKey: string | null = null;
  #geometry: BoardGeometry | null = null;
  #drawnModel: BoardModel | null | undefined = undefined;
  #drawnLook: DangerLook | null = null;
  #flashing = false;
  #offset = 0;

  constructor(canvas: HTMLCanvasElement, nextCanvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    this.#nextCanvas = nextCanvas;
    this.#hooks = new HookWriter(canvas);
  }

  get geometry(): BoardGeometry | null {
    return this.#geometry;
  }

  layout(
    geometry: BoardGeometry,
    next: { readonly size: { width: number; height: number }; readonly cell: number },
    dpr: number,
  ): void {
    this.#geometry = geometry;
    this.#ctx = prepareCanvas(this.#canvas, geometry.width, geometry.height, dpr);
    this.#drawnModel = undefined;
    this.#nextCtx = prepareCanvas(this.#nextCanvas, next.size.width, next.size.height, dpr);
    this.#nextCell = next.cell;
    this.#nextSize = next.size;
    this.#nextKey = null;
  }

  /** The NEXT column (REQ-060): redrawn only when the queue it shows changes. */
  #drawNext(model: BoardModel | null): void {
    const ctx = this.#nextCtx;
    if (ctx === null) return;
    const kinds = model?.next ?? [];
    const key = kinds.join('');
    if (key === this.#nextKey) return;
    this.#nextKey = key;
    ctx.clearRect(0, 0, this.#nextSize.width, this.#nextSize.height);
    executeOps(ctx, nextPreviewOps(this.#nextCell, kinds));
  }

  draw(model: BoardModel | null, nowMs: number, reducedMotion: boolean): void {
    const bands = this.effects.flashBands(nowMs);
    const look = this.#pulse.look(model?.danger ?? false, nowMs, reducedMotion);
    const geometry = this.#geometry;
    const ctx = this.#ctx;
    if (
      geometry !== null &&
      ctx !== null &&
      (model !== this.#drawnModel ||
        bands.length > 0 ||
        this.#flashing ||
        !sameLook(this.#drawnLook, look))
    ) {
      ctx.clearRect(0, 0, geometry.width, geometry.height);
      executeOps(ctx, [
        ...boardOps(geometry, model, { frameColor: boardTokens.frameColor, danger: look }),
        ...flashOps(geometry, bands),
      ]);
      this.#drawnModel = model;
      this.#drawnLook = look;
    }
    this.#drawNext(model);
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
    const field = new FxField();
    let fxCtx: CanvasRenderingContext2D | null = null;
    let fxSize = { width: 0, height: 0 };
    let fxDirty = false;
    const origins: Record<Side, Point> = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
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
        {
          size: nextCanvasSize(cells.next, spectator ? PUBLIC_PREVIEW_COUNT : PREVIEW_COUNT),
          cell: cells.next,
        },
        dpr,
      );
      boards.right.layout(
        arenaBoardGeometry(spectator ? cells.own : cells.opp, spectator),
        { size: nextCanvasSize(cells.next, PUBLIC_PREVIEW_COUNT), cell: cells.next },
        dpr,
      );
      layoutFx();
    };

    /** The fx overlay is positioned by the UI over the arena: keep its CSS size, match its backing. */
    const layoutFx = (): void => {
      const fx = canvases.fx;
      fxSize = { width: Math.max(1, fx.clientWidth), height: Math.max(1, fx.clientHeight) };
      fxCtx = prepareCanvas(fx, fxSize.width, fxSize.height, env.devicePixelRatio(), false);
      fxDirty = true;
    };

    /** Board canvases' top-left corners in fx-canvas px, read while an effect is running. */
    const measureOrigins = (): void => {
      const base = env.canvasBounds?.(canvases.fx);
      for (const side of ['left', 'right'] as const) {
        const box = env.canvasBounds?.(side === 'left' ? canvases.left : canvases.right);
        origins[side] =
          box === null || box === undefined || base === null || base === undefined
            ? { x: 0, y: 0 }
            : { x: box.x - base.x, y: box.y - base.y };
      }
    };

    const sceneOf = (frame: FrameModel): FxScene => ({
      geometry: (side) => boards[side].geometry,
      origin: (side) => origins[side],
      pending: (side) => frame[side]?.pendingGarbage ?? 0,
    });

    const startEffects = (frame: FrameModel, scene: FxScene): void => {
      for (const fx of frame.fx) {
        if (fx.kind === 'flash') boards[fx.side].effects.flash(fx.rows, frame.nowMs, reducedMotion);
        else if (fx.kind === 'nudge')
          boards[fx.side].effects.nudge(fx.rows, frame.nowMs, reducedMotion);
        else if (fx.kind === 'projectile') field.launch(fx, frame.nowMs, scene, reducedMotion);
        else field.burst(fx, frame.nowMs, scene, reducedMotion);
      }
    };

    /** Projectiles, landing outlines and bursts over the boards; cleared once the last one ends. */
    const drawFx = (frame: FrameModel, scene: FxScene): number => {
      const canvas = canvases.fx;
      if (canvas.clientWidth !== fxSize.width || canvas.clientHeight !== fxSize.height) {
        if (canvas.clientWidth > 0 && canvas.clientHeight > 0) layoutFx();
      }
      const active = field.activeCount(frame.nowMs);
      if (active > 0) {
        measureOrigins();
        fxCtx?.clearRect(0, 0, fxSize.width, fxSize.height);
        if (fxCtx !== null) executeOps(fxCtx, field.ops(frame.nowMs, scene));
        fxDirty = true;
      } else if (fxDirty) {
        fxCtx?.clearRect(0, 0, fxSize.width, fxSize.height);
        fxDirty = false;
      }
      return active;
    };

    const draw = (frame: FrameModel): void => {
      if (layoutDirty || driver.role() !== laidOutRole) layout();
      const scene = sceneOf(frame);
      startEffects(frame, scene);
      boards.left.draw(frame.left, frame.nowMs, reducedMotion);
      boards.right.draw(frame.right, frame.nowMs, reducedMotion);
      fxHooks.write(fxHookValues(drawFx(frame, scene), field.launched));
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
    canvasBounds: (canvas) => {
      const box = canvas.getBoundingClientRect();
      return { x: box.left, y: box.top, w: box.width, h: box.height };
    },
  };
}

/** The production `MountArena`. */
export const mountArena: MountArena = (canvases, store, options) =>
  createMountArena(browserArenaEnvironment())(canvases, store, options);
