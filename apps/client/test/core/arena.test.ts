import { emptyBoard } from '@stackerist/engine';
import { describe, expect, it } from 'vitest';
import { danger, meter } from '../../../../design/tokens/tokens.ts';
import type {
  ArenaCanvases,
  BoardModel,
  FrameModel,
  GameStore,
  Role,
} from '../../src/game/contract.ts';
import { registerFrameDriver, type FrameDriver } from '../../src/game/driver.ts';
import { createMountArena, type ArenaEnvironment } from '../../src/render/arena.ts';
import { DATA_HOOKS } from '../../src/render/hooks.ts';

class FakeCanvas {
  width = 300;
  height = 150;
  clientWidth = 900;
  clientHeight = 500;
  readonly style: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  getContext(): null {
    return null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

function canvases() {
  const all = {
    left: new FakeCanvas(),
    right: new FakeCanvas(),
    leftNext: new FakeCanvas(),
    rightNext: new FakeCanvas(),
    fx: new FakeCanvas(),
  };
  return { fakes: all, canvases: all as unknown as ArenaCanvases };
}

const own: BoardModel = {
  seat: 'A',
  board: emptyBoard(),
  active: { kind: 'T', rotation: 0, x: 3, y: 0 },
  ghost: null,
  next: ['I', 'O'],
  pendingGarbage: 2,
  combo: 0,
  chain: { sent: 0, cancelled: 0 },
  danger: false,
  toppedOut: false,
};

function rig(role: Role = 'A') {
  const order: string[] = [];
  let frames: FrameModel[] = [];
  let fxQueue: FrameModel['fx'] = [];
  const store = {} as GameStore;
  const driver: FrameDriver = {
    computeFrame: (nowMs, reducedMotion) => {
      order.push(`compute:${String(nowMs)}:${String(reducedMotion)}`);
      const fx = fxQueue;
      fxQueue = [];
      return { nowMs, left: own, right: null, fx, level: 0, standoff: null, inputLive: true };
    },
    publishFrame: (frame) => {
      order.push(`publish:${String(frame.nowMs)}`);
      frames = [...frames, frame];
    },
    stopFrames: () => order.push('stop'),
    role: () => role,
  };
  registerFrameDriver(store, driver);
  let callback: ((ts: number) => void) | null = null;
  let resize: (() => void) | null = null;
  const env: ArenaEnvironment = {
    requestFrame: (cb) => {
      callback = cb;
      return 1;
    },
    cancelFrame: () => {
      callback = null;
    },
    viewport: () => ({ width: 1280, height: 600 }),
    devicePixelRatio: () => 2,
    onResize: (listener) => {
      resize = listener;
      return () => {
        resize = null;
      };
    },
    onReducedMotionChange: () => () => undefined,
    reportError: (error) => {
      throw error;
    },
  };
  const tick = (ts: number): void => {
    const cb = callback;
    if (cb === null) throw new Error('no frame requested');
    cb(ts);
  };
  return {
    store,
    env,
    order,
    tick,
    frames: () => frames,
    pushFx: (fx: FrameModel['fx']) => {
      fxQueue = fx;
    },
    pending: () => callback !== null,
    resized: () => resize !== null,
  };
}

describe('REQ-055 arena rAF loop', () => {
  it('REQ-055 each animation frame computes, draws, then notifies subscribeFrame, and asks for the next', () => {
    const r = rig();
    const { canvases: c } = canvases();
    const handle = createMountArena(r.env)(c, r.store, { reducedMotion: false });
    expect(r.pending()).toBe(true);
    r.tick(16);
    r.tick(33);
    expect(r.order).toEqual(['compute:16:false', 'publish:16', 'compute:33:false', 'publish:33']);
    expect(r.pending()).toBe(true);
    handle.destroy();
    expect(r.pending()).toBe(false);
    expect(r.order.at(-1)).toBe('stop');
    expect(r.resized()).toBe(false);
  });

  it('REQ-055 canvases get the layout CSS size and a DPR-scaled backing store', () => {
    const r = rig();
    const { fakes, canvases: c } = canvases();
    createMountArena(r.env)(c, r.store, { reducedMotion: false });
    r.tick(16);
    // 1280×600 → own cell 22: meter 8 + gap 8 + ring 2 + board 225 + ring 2 = 245 wide, 449 tall.
    const ring = danger.ringWidthPx;
    expect(fakes.left.style.width).toBe(`${String(meter.widthPx * 2 + 2 * ring + 225)}px`);
    expect(fakes.left.style.height).toBe(`${String(2 * ring + 445)}px`);
    expect([fakes.left.width, fakes.left.height]).toEqual([245 * 2, 449 * 2]);
    expect([fakes.fx.width, fakes.fx.height]).toEqual([1800, 1000]);
    expect(fakes.fx.style.width).toBeUndefined();
  });

  it('REQ-055 hooks reflect the drawn board; a nudge lifts the board and is counted', () => {
    const r = rig();
    const { fakes, canvases: c } = canvases();
    createMountArena(r.env)(c, r.store, { reducedMotion: false });
    r.pushFx([
      { kind: 'nudge', side: 'left', rows: 3 },
      { kind: 'flash', side: 'left', rows: [19] },
    ]);
    r.tick(100);
    expect(fakes.left.attributes.get(DATA_HOOKS.active)).toBe('T:0:3:0');
    expect(fakes.left.attributes.get(DATA_HOOKS.pending)).toBe('2');
    expect(fakes.left.attributes.get(DATA_HOOKS.flashCount)).toBe('1');
    expect(fakes.left.attributes.get(DATA_HOOKS.nudgeCount)).toBe('1');
    expect(fakes.left.attributes.get(DATA_HOOKS.fx)).toBe('2');
    r.tick(140);
    expect(fakes.left.style.transform).toMatch(/^translateY\(-\d/);
    r.tick(1000);
    expect(fakes.left.style.transform).toBe('');
    expect(fakes.left.attributes.get(DATA_HOOKS.fx)).toBe('0');
    expect(fakes.right.attributes.get(DATA_HOOKS.active)).toBe('');
    expect(fakes.fx.attributes.get(DATA_HOOKS.projectileCount)).toBe('0');
  });

  it('REQ-055 refuses a store that is not CORE’s', () => {
    const r = rig();
    const { canvases: c } = canvases();
    const stranger = {} as GameStore;
    expect(() => createMountArena(r.env)(c, stranger, { reducedMotion: false })).toThrow(TypeError);
  });

  it('REQ-055 spectators lay out both boards at the own cell size', () => {
    const r = rig('spectator');
    const { fakes, canvases: c } = canvases();
    createMountArena(r.env)(c, r.store, { reducedMotion: true });
    r.tick(16);
    expect(fakes.right.style.height).toBe(fakes.left.style.height);
    expect(r.order[0]).toBe('compute:16:true');
  });
});
