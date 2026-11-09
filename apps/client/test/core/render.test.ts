import { emptyBoard, parseBoard } from '@stackerist/engine';
import type { WireBestMoment } from '@stackerist/protocol';
import { describe, expect, it } from 'vitest';
import {
  bestMoment as bestMomentTokens,
  board as boardTokens,
  boardOuterPx,
  danger,
  easing,
  flash,
  meter,
  motion,
  nudgePx,
  pieceColor,
} from '../../../../design/tokens/tokens.ts';
import type { BoardModel } from '../../src/game/contract.ts';
import { bezierEasing } from '../../src/render/easing.ts';
import { BoardEffects, flashAlphaAt, nudgeOffsetAt } from '../../src/render/effects.ts';
import {
  METER_GAP_PX,
  arenaBoardGeometry,
  arenaCellSizes,
  backingSize,
  bareBoardGeometry,
  cellRect,
  meterSegments,
  nextCanvasSize,
} from '../../src/render/geometry.ts';
import {
  DATA_HOOKS,
  HookWriter,
  boardHookValues,
  fxHookValues,
  pieceHook,
} from '../../src/render/hooks.ts';
import {
  bestMomentOps,
  blockOps,
  boardOps,
  flashOps,
  type DrawOp,
} from '../../src/render/renderList.ts';

const EMPTY = '..........';
const rects = (ops: readonly DrawOp[], color: string) =>
  ops.filter((op) => op.op === 'rect' && op.color === color);

describe('REQ-055 canvas maths', () => {
  it('REQ-055 cell sizes follow the DESIGN.md formula (22/13/10 at 1280×600 … 14/8/6 compact)', () => {
    expect(arenaCellSizes(1280, 600, false)).toMatchObject({ own: 22, opp: 13, next: 10 });
    expect(arenaCellSizes(1366, 768, false)).toMatchObject({ own: 30, opp: 18, next: 14 });
    expect(arenaCellSizes(1920, 1080, false)).toMatchObject({ own: 40, opp: 24, next: 18 });
    expect(arenaCellSizes(800, 450, false)).toMatchObject({
      own: 14,
      opp: 8,
      next: 6,
      compact: true,
    });
  });

  it('REQ-055 spectators get both boards at the own size, with 20 columns in the width term', () => {
    const sizes = arenaCellSizes(1280, 600, true);
    expect(sizes.own).toBe(22);
    expect(sizes.opp).toBe(sizes.own);
    expect(arenaCellSizes(900, 1200, true).own).toBe(Math.floor((900 - 448) / 20));
  });

  it('REQ-055 the backing store is round(CSS size × devicePixelRatio)', () => {
    expect(backingSize(245, 449, 1)).toEqual({ width: 245, height: 449 });
    expect(backingSize(245, 449, 2)).toEqual({ width: 490, height: 898 });
    expect(backingSize(245, 449, 1.25)).toEqual({ width: 306, height: 561 });
    expect(backingSize(100, 100, 0)).toEqual({ width: 100, height: 100 });
  });

  it('REQ-055 a board canvas is meter + gap + ring padding + boardOuterPx + ring padding', () => {
    const g = arenaBoardGeometry(22, true);
    const outer = boardOuterPx(22);
    const ring = danger.ringWidthPx;
    expect(g.width).toBe(meter.widthPx + METER_GAP_PX + ring + outer.width + ring);
    expect(g.height).toBe(ring + outer.height + ring);
    expect(g.inner.w).toBe(10 * 22 + boardTokens.gridLineWidthPx);
    expect(g.inner.h).toBe(20 * 22 + boardTokens.gridLineWidthPx);
    expect(arenaBoardGeometry(13, false).meter.w).toBe(meter.widthOppPx);
    const bare = bareBoardGeometry(9);
    expect([bare.width, bare.height]).toEqual([boardOuterPx(9).width, boardOuterPx(9).height]);
  });

  it('REQ-055 meter segments are one cell tall each, aligned with the rows, from the bottom, ≤ 20', () => {
    const g = arenaBoardGeometry(22, true);
    const three = meterSegments(g, 3);
    expect(three).toHaveLength(3);
    for (const [i, segment] of three.entries()) {
      const row = cellRect(g, 0, 19 - i);
      expect([segment.y, segment.h]).toEqual([row.y, row.h]);
    }
    expect(meterSegments(g, 25)).toHaveLength(20);
    expect(meterSegments(g, 0)).toHaveLength(0);
  });

  it('REQ-055 a NEXT column is 4 cells wide with 2-cell slots one cell apart', () => {
    expect(nextCanvasSize(10, 5)).toEqual({ width: 40, height: 5 * 20 + 4 * 10 });
    expect(nextCanvasSize(6, 1)).toEqual({ width: 24, height: 12 });
  });
});

describe('REQ-055 render list (block style, grid, meter, frame)', () => {
  const g = arenaBoardGeometry(22, true);
  const frameColor = boardTokens.frameColor;

  it('REQ-055 an empty board draws the well, 11 + 21 grid lines, the meter track and the frame', () => {
    const ops = boardOps(
      g,
      { board: emptyBoard(), active: null, pendingGarbage: 0 },
      { frameColor },
    );
    expect(rects(ops, boardTokens.well)).toHaveLength(1);
    expect(rects(ops, boardTokens.gridLine)).toHaveLength(11 + 21);
    expect(rects(ops, meter.track)).toHaveLength(1);
    expect(rects(ops, frameColor)).toHaveLength(4);
    expect(ops.every((op) => op.op === 'rect' || op.op === 'hatch')).toBe(true);
  });

  it('REQ-055 blocks are a flat fill with an inset top highlight and bottom shade from the tokens', () => {
    const area = { x: 10, y: 20, w: 21, h: 21 };
    expect(blockOps(area, 'T', 22)).toEqual([
      { op: 'rect', rect: area, color: pieceColor.T, alpha: 1 },
      {
        op: 'rect',
        rect: { x: 10, y: 20, w: 21, h: boardTokens.bevelWidthPx },
        color: boardTokens.bevelHighlight,
        alpha: 1,
      },
      {
        op: 'rect',
        rect: { x: 10, y: 20 + 21 - boardTokens.bevelWidthPx, w: 21, h: boardTokens.bevelWidthPx },
        color: boardTokens.bevelShade,
        alpha: 1,
      },
    ]);
    const small = blockOps({ x: 0, y: 0, w: 11, h: 11 }, 'I', 12);
    expect(small[1]?.rect.h).toBe(boardTokens.bevelWidthSmallPx);
  });

  it('REQ-055 garbage is hatched in G and its stripe colour, thinner on small cells', () => {
    const [hatch] = blockOps({ x: 0, y: 0, w: 21, h: 21 }, 'G', 22);
    expect(hatch).toMatchObject({
      op: 'hatch',
      color: pieceColor.G,
      stripe: boardTokens.garbageStripe,
      stripeWidth: boardTokens.garbageStripeWidthPx,
    });
    const [smallHatch] = blockOps({ x: 0, y: 0, w: 11, h: 11 }, 'G', 12);
    expect(smallHatch).toMatchObject({ stripeWidth: boardTokens.garbageStripeWidthSmallPx });
  });

  it('REQ-055 locked cells and the falling piece land in their cell rects; cells above row 0 are skipped', () => {
    const board = parseBoard([...Array<string>(19).fill(EMPTY), 'L........G']);
    const ops = boardOps(
      g,
      { board, active: { kind: 'I', rotation: 1, x: 0, y: -2 }, pendingGarbage: 0 },
      { frameColor },
    );
    expect(rects(ops, pieceColor.L)[0]?.rect).toEqual(cellRect(g, 0, 19));
    expect(ops.filter((op) => op.op === 'hatch')[0]?.rect).toEqual(cellRect(g, 9, 19));
    // I vertical at x = 2 (box column 2), rows −2..1: only rows 0 and 1 are on the board.
    expect(rects(ops, pieceColor.I).map((op) => op.rect)).toEqual([
      cellRect(g, 2, 0),
      cellRect(g, 2, 1),
    ]);
  });

  it('REQ-055 the meter fills one segment per pending row, capped at 20', () => {
    const fills = (pending: number) =>
      rects(
        boardOps(g, { board: emptyBoard(), active: null, pendingGarbage: pending }, { frameColor }),
        meter.fill,
      );
    expect(fills(4)).toHaveLength(4);
    expect(fills(4).map((op) => op.rect)).toEqual(meterSegments(g, 4));
    expect(fills(40)).toHaveLength(20);
    expect(fills(0)).toHaveLength(0);
  });

  it('REQ-055 flash bands cover the cleared rows in the flash colour at the given alpha', () => {
    const ops = flashOps(g, [
      { row: 18, alpha: 0.5 },
      { row: 19, alpha: 0 },
    ]);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'rect', color: flash.color, alpha: 0.5 });
    expect(ops[0]?.rect.y).toBe(g.inner.y + 18 * 22);
  });
});

describe('REQ-055 line-clear flash and garbage nudge timing', () => {
  it('REQ-055 the flash lasts 150 ms, fading from flash.alpha to 0', () => {
    expect(flash.durationMs).toBe(150);
    expect(flashAlphaAt(0, false)).toBeCloseTo(flash.alpha);
    expect(flashAlphaAt(75, false)).toBeLessThan(flash.alpha);
    expect(flashAlphaAt(75, false)).toBeGreaterThan(0);
    expect(flashAlphaAt(flash.durationMs, false)).toBe(0);
  });

  it('REQ-055 reduced motion: a static band at the reduced alpha for 150 ms, no fade', () => {
    expect(flashAlphaAt(0, true)).toBe(flash.alphaReduced);
    expect(flashAlphaAt(149, true)).toBe(flash.alphaReduced);
    expect(flashAlphaAt(150, true)).toBe(0);
  });

  it('REQ-055 the nudge rises nudgePx(rows), then settles back to 0', () => {
    const distance = nudgePx(3, false);
    expect(nudgeOffsetAt(distance, 0)).toBe(0);
    expect(nudgeOffsetAt(distance, motion.nudgeOutMs)).toBeCloseTo(distance);
    expect(nudgeOffsetAt(distance, motion.nudgeOutMs + motion.nudgeBackMs)).toBe(0);
    expect(nudgePx(3, true)).toBe(0);
  });

  it('REQ-055 BoardEffects counts each effect once and expires it on time', () => {
    const fx = new BoardEffects();
    fx.flash([18, 19], 1000, false);
    fx.nudge(2, 1000, false);
    expect([fx.flashCount, fx.nudgeCount, fx.activeCount(1000)]).toEqual([1, 1, 2]);
    expect(fx.flashBands(1000).map((band) => band.row)).toEqual([18, 19]);
    expect(fx.nudgeOffset(1000 + motion.nudgeOutMs)).toBeCloseTo(nudgePx(2, false));
    expect(fx.activeCount(1000 + flash.durationMs)).toBe(1);
    expect(fx.activeCount(1000 + motion.nudgeOutMs + motion.nudgeBackMs)).toBe(0);
    expect(fx.flashBands(1000 + flash.durationMs)).toEqual([]);
    expect([fx.flashCount, fx.nudgeCount]).toEqual([1, 1]);
  });

  it('REQ-055 easing curves run 0 → 1 without overshoot', () => {
    for (const curve of Object.values(easing)) {
      const ease = bezierEasing(curve);
      let previous = 0;
      for (let i = 0; i <= 20; i += 1) {
        const y = ease(i / 20);
        expect(y).toBeGreaterThanOrEqual(previous - 1e-9);
        expect(y).toBeLessThanOrEqual(1);
        previous = y;
      }
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
    }
    expect(bezierEasing([0, 0, 1, 1])(0.3)).toBeCloseTo(0.3, 5);
  });
});

describe('REQ-055 DATA_HOOKS for e2e', () => {
  const model: BoardModel = {
    seat: 'A',
    board: emptyBoard(),
    active: { kind: 'T', rotation: 1, x: 3, y: 4 },
    ghost: null,
    next: ['I', 'O', 'S', 'Z', 'J'],
    pendingGarbage: 3,
    combo: 2,
    chain: { sent: 0, cancelled: 0 },
    danger: false,
    toppedOut: false,
  };

  it('REQ-055 board hooks encode the piece, preview, combo, danger, pending and fx counters', () => {
    expect(boardHookValues(model, { active: 1, flashes: 4, nudges: 2 })).toEqual({
      'data-active': 'T:1:3:4',
      'data-ghost': '',
      'data-next': 'IOSZJ',
      'data-combo': '2',
      'data-danger': 'false',
      'data-pending': '3',
      'data-fx': '1',
      'data-flash-count': '4',
      'data-nudge-count': '2',
    });
    expect(boardHookValues(null, { active: 0, flashes: 0, nudges: 0 })[DATA_HOOKS.active]).toBe('');
    expect(pieceHook({ kind: 'I', rotation: 0, x: 3, y: -1 })).toBe('I:0:3:-1');
    expect(fxHookValues(0, 0)).toEqual({ 'data-fx': '0', 'data-projectile-count': '0' });
  });

  it('REQ-055 hook attributes are written on change only', () => {
    const writes: string[] = [];
    const writer = new HookWriter({
      setAttribute: (name, value) => writes.push(`${name}=${value}`),
    });
    writer.write({ [DATA_HOOKS.combo]: '0', [DATA_HOOKS.danger]: 'false' });
    writer.write({ [DATA_HOOKS.combo]: '0', [DATA_HOOKS.danger]: 'false' });
    writer.write({ [DATA_HOOKS.combo]: '2' });
    expect(writes).toEqual(['data-combo=0', 'data-danger=false', 'data-combo=2']);
  });
});

describe('REQ-055 best-moment mini board (REQ-051 drawing)', () => {
  const moment: WireBestMoment = {
    board: [...Array<string>(17).fill(EMPTY), 'IIITTTJJJL', 'OOOOTSSZZL', 'GGGG.GGGGG'],
    clearedRows: [17, 18],
    pieceCells: [
      { x: 3, y: 17 },
      { x: 4, y: 17 },
      { x: 5, y: 17 },
      { x: 4, y: 18 },
    ],
    combo: 3,
    linesCleared: 2,
    attack: 2,
    sent: 1,
    cancelled: 1,
    tick: 96,
  };
  const g = bareBoardGeometry(9);
  const ops = bestMomentOps(g, moment);

  it('REQ-055 draws the recorded board in block style with garbage hatched', () => {
    expect(rects(ops, pieceColor.T).length).toBe(4);
    expect(ops.filter((op) => op.op === 'hatch')).toHaveLength(9);
  });

  it('REQ-055 outlines each cleared row 1 px in the cleared-outline token', () => {
    const outline = rects(ops, bestMomentTokens.clearedOutline);
    expect(outline).toHaveLength(2 * 4);
    expect(outline.filter((op) => op.rect.h === 1 || op.rect.w === 1)).toHaveLength(8);
  });

  it('REQ-055 outlines only the finishing piece’s outer edges, 2 px, in the finisher token', () => {
    const outline = rects(ops, bestMomentTokens.finisherOutline);
    // A T has 10 outer edges (4 cells × 4 sides − 2 × 3 shared).
    expect(outline).toHaveLength(10);
    expect(outline.every((op) => op.rect.w === 2 || op.rect.h === 2)).toBe(true);
  });
});
