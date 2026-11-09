import { emptyBoard, pieceCells, type ActivePiece, type PieceKind } from '@stackerist/engine';
import { describe, expect, it } from 'vitest';
import {
  board as boardTokens,
  danger,
  flash,
  ghost,
  meter,
  motion,
  pieceColor,
  projectile,
  projectileSizePx,
} from '../../../../design/tokens/tokens.ts';
import type {
  ArenaCanvases,
  BoardModel,
  FrameModel,
  GameStore,
  Role,
} from '../../src/game/contract.ts';
import { registerFrameDriver, type FrameDriver } from '../../src/game/driver.ts';
import { createMountArena, type ArenaEnvironment } from '../../src/render/arena.ts';
import { DangerPulse, dangerFrameFadeAt, dangerRingAlpha } from '../../src/render/effects.ts';
import {
  arenaBoardGeometry,
  cellRect,
  meterSegments,
  nextCanvasSize,
  previewSlotRect,
} from '../../src/render/geometry.ts';
import { DATA_HOOKS, boardHookValues } from '../../src/render/hooks.ts';
import {
  FxField,
  LANDING_OUTLINE_PX,
  MAX_IN_FLIGHT_PER_DIRECTION,
  controlPoint,
  projectileEnd,
  projectileStart,
  quadraticPoint,
  transformedRect,
  type FxScene,
} from '../../src/render/projectiles.ts';
import {
  boardOps,
  dangerOps,
  ghostOps,
  nextPreviewOps,
  type DrawOp,
  type FxOp,
  type Point,
} from '../../src/render/renderList.ts';

const rects = (ops: readonly FxOp[]) => ops.filter((op) => op.op === 'rect');
const polys = (ops: readonly FxOp[]) => ops.filter((op) => op.op === 'poly');
const own = arenaBoardGeometry(22, true);
const opp = arenaBoardGeometry(13, false);

describe('REQ-061 ghost piece drawing', () => {
  const piece: ActivePiece = { kind: 'T', rotation: 0, x: 3, y: 18 };

  it('REQ-061 each ghost cell is a ghost.lineWidthPx outline in the piece colour at ghost.alpha, no fill', () => {
    const ops = ghostOps(own, piece);
    expect(ops).toHaveLength(4 * 4);
    for (const op of rects(ops)) {
      expect(op).toMatchObject({ color: pieceColor.T, alpha: ghost.alpha });
    }
    // Every cell is outlined by thin bands: none is as large as a whole cell, so nothing is filled.
    const cell = cellRect(own, 3, 18);
    for (const op of rects(ops)) {
      if (op.op !== 'rect') continue;
      expect(Math.min(op.rect.w, op.rect.h)).toBeLessThanOrEqual(ghost.lineWidthPx);
      expect(op.rect.w * op.rect.h).toBeLessThan(cell.w * cell.h);
    }
  });

  it('REQ-061 the outline stays inside its cell (inset)', () => {
    for (const { x, y } of pieceCells(piece)) {
      const cell = cellRect(own, x, y);
      const inside = rects(ghostOps(own, piece)).filter(
        (op) =>
          op.op === 'rect' &&
          op.rect.x >= cell.x &&
          op.rect.y >= cell.y &&
          op.rect.x + op.rect.w <= cell.x + cell.w &&
          op.rect.y + op.rect.h <= cell.y + cell.h,
      );
      expect(inside.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('REQ-061 no ghost, no ops; cells above the board are skipped', () => {
    expect(ghostOps(own, null)).toEqual([]);
    expect(ghostOps(own, { kind: 'I', rotation: 1, x: 3, y: -5 }).length).toBeLessThan(16);
  });

  it('REQ-061 the board draws the ghost under the falling piece', () => {
    const model = {
      board: emptyBoard(),
      active: { kind: 'T', rotation: 0, x: 3, y: 0 } satisfies ActivePiece,
      ghost: piece,
      pendingGarbage: 0,
    };
    const ops = boardOps(own, model, { frameColor: boardTokens.frameColor });
    const firstGhost = ops.findIndex((op) => op.op === 'rect' && op.alpha === ghost.alpha);
    const firstPiece = ops.findIndex(
      (op) => op.op === 'rect' && op.color === pieceColor.T && op.alpha === 1,
    );
    expect(firstGhost).toBeGreaterThan(-1);
    expect(firstGhost).toBeLessThan(firstPiece);
    const without = boardOps(
      own,
      { ...model, ghost: null },
      { frameColor: boardTokens.frameColor },
    );
    expect(without.some((op) => op.op === 'rect' && op.alpha === ghost.alpha)).toBe(false);
  });

  it('REQ-061 data-ghost reports the ghost as kind:rotation:x:y, empty when none', () => {
    const base: BoardModel = {
      seat: 'A',
      board: emptyBoard(),
      active: null,
      ghost: piece,
      next: [],
      pendingGarbage: 0,
      combo: 0,
      chain: { sent: 0, cancelled: 0 },
      danger: false,
      toppedOut: false,
    };
    const counts = { active: 0, flashes: 0, nudges: 0 };
    expect(boardHookValues(base, counts)[DATA_HOOKS.ghost]).toBe('T:0:3:18');
    expect(boardHookValues({ ...base, ghost: null }, counts)[DATA_HOOKS.ghost]).toBe('');
  });
});

describe('REQ-088 danger pulse', () => {
  it('REQ-088 the ring pulses between 1 and danger.ringMinAlpha over danger.periodMs', () => {
    expect(dangerRingAlpha(0, false)).toBeCloseTo(1);
    expect(dangerRingAlpha(danger.periodMs / 2, false)).toBeCloseTo(danger.ringMinAlpha);
    expect(dangerRingAlpha(danger.periodMs, false)).toBeCloseTo(1);
    expect(dangerRingAlpha(danger.periodMs * 3.5, false)).toBeCloseTo(danger.ringMinAlpha);
  });

  it('REQ-088 the pulse alternates: down in the first half cycle, back up in the second', () => {
    const quarter = dangerRingAlpha(danger.periodMs / 4, false);
    const threeQuarter = dangerRingAlpha((danger.periodMs * 3) / 4, false);
    expect(quarter).toBeLessThan(1);
    expect(quarter).toBeGreaterThan(danger.ringMinAlpha);
    expect(quarter).toBeCloseTo(threeQuarter);
  });

  it('REQ-088 reduced motion keeps the ring at 1: a steady frame', () => {
    for (const t of [0, 100, danger.periodMs / 2, 777]) {
      expect(dangerRingAlpha(t, true)).toBe(danger.ringMinAlphaReduced);
    }
  });

  it('REQ-088 a board in danger shows a steady red frame; leaving fades it over motion.swapMs and stops the ring', () => {
    const pulse = new DangerPulse();
    expect(pulse.look(false, 0, false)).toEqual({ frameAlpha: 0, ringAlpha: 0 });
    expect(pulse.look(true, 100, false)).toEqual({ frameAlpha: 1, ringAlpha: 1 });
    expect(pulse.look(true, 100 + danger.periodMs / 2, false).frameAlpha).toBe(1);
    const exit = 1000;
    const start = pulse.look(false, exit, false);
    expect(start).toEqual({ frameAlpha: 1, ringAlpha: 0 });
    const mid = pulse.look(false, exit + motion.swapMs / 2, false);
    expect(mid.frameAlpha).toBeGreaterThan(0);
    expect(mid.frameAlpha).toBeLessThan(1);
    expect(mid.ringAlpha).toBe(0);
    expect(pulse.look(false, exit + motion.swapMs, false)).toEqual({ frameAlpha: 0, ringAlpha: 0 });
    expect(dangerFrameFadeAt(motion.swapMs)).toBe(0);
  });

  it('REQ-088 re-entering danger restarts the pulse and cancels a fade', () => {
    const pulse = new DangerPulse();
    pulse.look(true, 0, false);
    pulse.look(false, 500, false);
    expect(pulse.look(true, 520, false)).toEqual({ frameAlpha: 1, ringAlpha: 1 });
  });

  it('REQ-088 the frame is red (danger.color) and the ring lies outside the frame, inside the canvas', () => {
    const ops = dangerOps(own, { frameAlpha: 1, ringAlpha: 0.5 });
    const red = rects(ops);
    expect(red.every((op) => op.op === 'rect' && op.color === danger.color)).toBe(true);
    const ring = red.filter((op) => op.op === 'rect' && op.alpha === 0.5);
    expect(ring).toHaveLength(4);
    for (const op of ring) {
      if (op.op !== 'rect') continue;
      expect(op.rect.x).toBeGreaterThanOrEqual(0);
      expect(op.rect.y).toBeGreaterThanOrEqual(0);
      expect(op.rect.x + op.rect.w).toBeLessThanOrEqual(own.width);
      expect(op.rect.y + op.rect.h).toBeLessThanOrEqual(own.height);
      // Nothing of the ring overlaps the board's own outer box.
      const overlaps =
        op.rect.x < own.outer.x + own.outer.w &&
        op.rect.x + op.rect.w > own.outer.x &&
        op.rect.y < own.outer.y + own.outer.h &&
        op.rect.y + op.rect.h > own.outer.y;
      expect(overlaps).toBe(false);
    }
    expect(dangerOps(own, { frameAlpha: 0, ringAlpha: 0 })).toEqual([]);
  });

  it('REQ-088 under reduced motion the frame plus ring is a steady 4 px red edge', () => {
    expect(boardTokens.frameWidthPx + danger.ringWidthPx).toBe(4);
    const look = new DangerPulse().look(true, 5000, true);
    expect(look).toEqual({ frameAlpha: 1, ringAlpha: danger.ringMinAlphaReduced });
  });

  it('REQ-088 a board in danger draws the red frame; a calm one does not', () => {
    const model = { board: emptyBoard(), active: null, ghost: null, pendingGarbage: 0 };
    const calm = boardOps(own, model, { frameColor: boardTokens.frameColor });
    const hot = boardOps(own, model, {
      frameColor: boardTokens.frameColor,
      danger: { frameAlpha: 1, ringAlpha: 1 },
    });
    const isRed = (op: DrawOp): boolean => op.op === 'rect' && op.color === danger.color;
    // The meter fill is red too, but an empty meter draws none.
    expect(calm.some(isRed)).toBe(false);
    expect(hot.filter(isRed)).toHaveLength(8);
  });

  it('REQ-088 data-danger reports true and false', () => {
    const base: BoardModel = {
      seat: 'A',
      board: emptyBoard(),
      active: null,
      ghost: null,
      next: [],
      pendingGarbage: 0,
      combo: 0,
      chain: { sent: 0, cancelled: 0 },
      danger: true,
      toppedOut: false,
    };
    const counts = { active: 0, flashes: 0, nudges: 0 };
    expect(boardHookValues(base, counts)[DATA_HOOKS.danger]).toBe('true');
    expect(boardHookValues({ ...base, danger: false }, counts)[DATA_HOOKS.danger]).toBe('false');
  });
});

describe('REQ-060 NEXT previews', () => {
  const kinds: PieceKind[] = ['I', 'O', 'T', 'S', 'Z'];
  const cell = 10;

  it('REQ-060 five slots for the own board, one piece each, in block style in the piece colour', () => {
    const ops = nextPreviewOps(cell, kinds);
    for (const [index, kind] of kinds.entries()) {
      const slot = previewSlotRect(cell, index);
      const fills = rects(ops).filter(
        (op) =>
          op.op === 'rect' &&
          op.color === pieceColor[kind] &&
          op.rect.y >= slot.y &&
          op.rect.y + op.rect.h <= slot.y + slot.h,
      );
      expect(fills).toHaveLength(4);
    }
    const size = nextCanvasSize(cell, 5);
    for (const op of rects(ops)) {
      if (op.op !== 'rect') continue;
      expect(op.rect.x).toBeGreaterThanOrEqual(0);
      expect(op.rect.x + op.rect.w).toBeLessThanOrEqual(size.width);
      expect(op.rect.y + op.rect.h).toBeLessThanOrEqual(size.height);
    }
  });

  it('REQ-060 the opponent column shows exactly one piece', () => {
    const ops = nextPreviewOps(cell, ['L']);
    const fills = rects(ops).filter((op) => op.op === 'rect' && op.color === pieceColor.L);
    expect(fills).toHaveLength(4);
    expect(rects(nextPreviewOps(cell, []))).toEqual([]);
  });

  it('REQ-060 pieces are centred in their 4 x 2 slot (I is a flat bar across it, O sits mid-width)', () => {
    const [i] = rects(nextPreviewOps(cell, ['I'])).filter(
      (op) => op.op === 'rect' && op.color === pieceColor.I,
    );
    const slot = previewSlotRect(cell, 0);
    if (i?.op !== 'rect') throw new Error('no I fill');
    expect(i.rect.x).toBeGreaterThanOrEqual(slot.x);
    const o = rects(nextPreviewOps(cell, ['O'])).filter(
      (op) => op.op === 'rect' && op.color === pieceColor.O,
    );
    const xs = o.flatMap((op) => (op.op === 'rect' ? [op.rect.x] : []));
    expect(Math.min(...xs)).toBeCloseTo(cell); // one cell in from the left of a 4-wide slot
  });

  it('REQ-060 slots are stacked three cells apart', () => {
    expect(previewSlotRect(cell, 1).y - previewSlotRect(cell, 0).y).toBe(3 * cell);
  });

  it('REQ-060 data-next lists the preview letters, next first', () => {
    const model: BoardModel = {
      seat: 'A',
      board: emptyBoard(),
      active: null,
      ghost: null,
      next: kinds,
      pendingGarbage: 0,
      combo: 0,
      chain: { sent: 0, cancelled: 0 },
      danger: false,
      toppedOut: false,
    };
    expect(boardHookValues(model, { active: 0, flashes: 0, nudges: 0 })[DATA_HOOKS.next]).toBe(
      'IOTSZ',
    );
  });
});

/** A scene with both boards laid out side by side in the fx canvas. */
function scene(pending: { left: number; right: number } = { left: 0, right: 0 }): FxScene {
  return {
    geometry: (side) => (side === 'left' ? own : opp),
    origin: (side) => (side === 'left' ? { x: 0, y: 0 } : { x: 400, y: 100 }),
    pending: (side) => pending[side],
  };
}

describe('REQ-087 projectile geometry', () => {
  it('REQ-087 the projectile starts at the board centre, or at the cleared row when known', () => {
    const mid = projectileStart(own, null);
    expect(mid.x).toBeCloseTo(own.inner.x + own.inner.w / 2);
    expect(mid.y).toBeCloseTo(own.inner.y + own.inner.h / 2);
    const row = projectileStart(own, 17);
    expect(row.y).toBeGreaterThan(mid.y);
  });

  it('REQ-087 it lands on the meter at the top of its current fill', () => {
    const empty = projectileEnd(own, 0);
    const three = projectileEnd(own, 3);
    expect(three.x).toBeCloseTo(own.meter.x + own.meter.w / 2);
    expect(three.y).toBeLessThan(empty.y);
    const top = meterSegments(own, 3).at(-1);
    expect(three.y).toBeGreaterThan(top?.y ?? Infinity);
    expect(three.y).toBeLessThan((top?.y ?? 0) + own.cell);
  });

  it('REQ-087 the curve passes through both ends and its control point is lifted by arc x distance', () => {
    const a: Point = { x: 0, y: 100 };
    const b: Point = { x: 300, y: 100 };
    expect(quadraticPoint(a, controlPoint(a, b, 0.15), b, 0)).toEqual(a);
    expect(quadraticPoint(a, controlPoint(a, b, 0.15), b, 1)).toEqual(b);
    expect(controlPoint(a, b, 0.15)).toEqual({ x: 150, y: 100 - 0.15 * 300 });
    expect(controlPoint(a, b, 0)).toEqual({ x: 150, y: 100 });
  });

  it('REQ-087 transformedRect skews and rotates about the centre', () => {
    const unit = { x: 0, y: 0, w: 10, h: 10 };
    expect(transformedRect(unit, {})).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
    const skew = transformedRect(unit, { skewTan: -0.2 });
    // The top edge shifts right and the bottom edge left (skewX with a negative angle).
    expect(skew[0]?.x).toBeCloseTo(0 + 1);
    expect(skew[3]?.x).toBeCloseTo(0 - 1);
    const turned = transformedRect(unit, { rotation: Math.PI });
    expect(turned[0]?.x).toBeCloseTo(10);
    expect(turned[0]?.y).toBeCloseTo(10);
  });
});

describe('REQ-087 projectile flights', () => {
  it('REQ-087 a sent attack launches one projectile (counted) that flies for projectile.durationMs', () => {
    const field = new FxField();
    field.launch({ from: 'left', rows: 2, originRow: null }, 1000, scene(), false);
    expect(field.launched).toBe(1);
    expect(field.activeCount(1000)).toBe(1);
    expect(projectile.durationMs).toBe(350);
    expect(polys(field.ops(1000, scene())).length).toBeGreaterThan(0);
    expect(field.activeCount(1000 + projectile.durationMs - 1)).toBe(1);
    // After the flight only the landing outline remains, and then nothing.
    const landed = 1000 + projectile.durationMs;
    expect(polys(field.ops(landed, scene({ left: 0, right: 2 })))).toEqual([]);
    expect(field.activeCount(landed)).toBe(1);
    expect(field.activeCount(landed + motion.meterGrowMs)).toBe(0);
    expect(field.launched).toBe(1);
  });

  it('REQ-087 it is sized by rows: min(projectile.maxSizePx, base + rows x perRow)', () => {
    const edge = (rows: number): number => {
      const field = new FxField();
      field.launch({ from: 'left', rows, originRow: null }, 0, scene(), false);
      const [body] = polys(field.ops(0, scene()));
      if (body?.op !== 'poly') throw new Error('no body');
      const ys = body.points.map((p) => p.y);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(edge(1)).toBeCloseTo(projectileSizePx(1));
    expect(edge(4)).toBeCloseTo(projectileSizePx(4));
    expect(projectileSizePx(1)).toBe(12);
    expect(projectileSizePx(4)).toBe(24);
    expect(edge(4)).toBeGreaterThan(edge(1));
    expect(edge(40)).toBeCloseTo(projectile.maxSizePx);
  });

  it('REQ-087 it is amber with the block bevel (highlight and shade strips), no trail', () => {
    const field = new FxField();
    field.launch({ from: 'left', rows: 2, originRow: null }, 0, scene(), false);
    const ops = polys(field.ops(0, scene()));
    expect(ops.map((op) => (op.op === 'poly' ? op.color : ''))).toEqual([
      projectile.color,
      boardTokens.bevelHighlight,
      boardTokens.bevelShade,
    ]);
  });

  it('REQ-087 it accelerates into the hit (ease-in) and ends on the receiver meter', () => {
    const centre = (ms: number): Point => {
      const field = new FxField();
      field.launch({ from: 'left', rows: 2, originRow: null }, 0, scene(), false);
      const [body] = polys(field.ops(ms, scene()));
      if (body?.op !== 'poly') throw new Error('no body');
      const xs = body.points.map((p) => p.x);
      const ys = body.points.map((p) => p.y);
      return {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
      };
    };
    const start = projectileStart(own, null);
    const end = {
      ...projectileEnd(opp, 0),
      x: projectileEnd(opp, 0).x + 400,
      y: projectileEnd(opp, 0).y + 100,
    };
    const total = Math.hypot(end.x - start.x, end.y - start.y);
    const half = centre(projectile.durationMs / 2);
    const travelled = Math.hypot(half.x - start.x, half.y - start.y);
    expect(travelled).toBeLessThan(total / 2);
    const nearly = centre(projectile.durationMs - 1);
    expect(Math.hypot(nearly.x - end.x, nearly.y - end.y)).toBeLessThan(total * 0.05);
  });

  it('REQ-087 at most 4 fly per direction; extras are skipped visually (and not counted)', () => {
    const field = new FxField();
    for (let i = 0; i < 6; i += 1) {
      field.launch({ from: 'left', rows: 1, originRow: null }, i, scene(), false);
    }
    expect(MAX_IN_FLIGHT_PER_DIRECTION).toBe(4);
    expect(field.launched).toBe(4);
    // The other direction has its own allowance.
    field.launch({ from: 'right', rows: 1, originRow: null }, 7, scene(), false);
    expect(field.launched).toBe(5);
    // Once they land, new ones fly again.
    field.launch({ from: 'left', rows: 1, originRow: null }, 1000, scene(), false);
    expect(field.launched).toBe(6);
  });

  it('REQ-087 the landing outlines the new top meter segments in the accent colour', () => {
    const field = new FxField();
    field.launch({ from: 'left', rows: 2, originRow: null }, 0, scene(), false);
    const ops = field.ops(projectile.durationMs, scene({ left: 0, right: 5 }));
    const outline = rects(ops).filter((op) => op.op === 'rect');
    expect(outline).toHaveLength(2 * 4);
    const top = meterSegments(opp, 5).slice(-2);
    for (const op of outline) {
      if (op.op !== 'rect') continue;
      expect(Math.min(op.rect.w, op.rect.h)).toBeLessThanOrEqual(LANDING_OUTLINE_PX);
      expect(op.rect.x).toBeGreaterThanOrEqual(400 + opp.meter.x);
      expect(op.rect.y).toBeGreaterThanOrEqual(100 + (top[1]?.y ?? 0));
    }
  });

  it('REQ-087 reduced motion: no flight, the outline appears at once for flash.durationMs', () => {
    const field = new FxField();
    field.launch({ from: 'left', rows: 3, originRow: null }, 0, scene(), true);
    expect(field.launched).toBe(1);
    const ops = field.ops(0, scene({ left: 0, right: 4 }));
    expect(polys(ops)).toEqual([]);
    expect(rects(ops)).toHaveLength(3 * 4);
    expect(rects(field.ops(flash.durationMs - 1, scene({ left: 0, right: 4 })))).toHaveLength(12);
    expect(field.activeCount(flash.durationMs)).toBe(0);
  });

  it('REQ-087 nothing is launched before the first layout or for zero rows', () => {
    const field = new FxField();
    const blind: FxScene = { ...scene(), geometry: () => null };
    field.launch({ from: 'left', rows: 2, originRow: null }, 0, blind, false);
    field.launch({ from: 'left', rows: 0, originRow: null }, 0, scene(), false);
    expect(field.launched).toBe(0);
    expect(field.activeCount(0)).toBe(0);
  });
});

describe('REQ-087 cancel burst', () => {
  it('REQ-087 each cancelled segment breaks into two meter-wide, half-cell fragments in the burst colour', () => {
    const field = new FxField();
    field.burst({ side: 'left', rows: 3 }, 0, scene({ left: 2, right: 0 }), false);
    const ops = polys(field.ops(0, scene({ left: 2, right: 0 })));
    expect(ops).toHaveLength(6);
    for (const op of ops) {
      if (op.op !== 'poly') continue;
      expect(op.color).toBe(projectile.burstColor);
      const xs = op.points.map((p) => p.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(meter.widthPx);
      const ys = op.points.map((p) => p.y);
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(own.cell / 2);
    }
  });

  it('REQ-087 the fragments sit where the removed rows were: above the meter that already shrank', () => {
    const field = new FxField();
    field.burst({ side: 'left', rows: 2 }, 0, scene({ left: 3, right: 0 }), false);
    const removed = meterSegments(own, 5).slice(3);
    const ops = polys(field.ops(0, scene({ left: 3, right: 0 })));
    const top = Math.min(
      ...ops.flatMap((op) => (op.op === 'poly' ? op.points.map((p) => p.y) : [])),
    );
    expect(top).toBeCloseTo(removed.at(-1)?.y ?? NaN);
  });

  it('REQ-087 fragments travel sideways +-burstDistance, rise, rotate and fade over burstMs', () => {
    const field = new FxField();
    field.burst({ side: 'left', rows: 1 }, 0, scene(), false);
    const at = (ms: number) => polys(field.ops(ms, scene()));
    const first = at(0);
    const later = at(projectile.burstMs * 0.6);
    expect(later).toHaveLength(2);
    const dx = (op: FxOp | undefined, index: number): number => {
      if (op?.op !== 'poly') return NaN;
      const base = first[index];
      return (op.points[0]?.x ?? 0) - (base?.op === 'poly' ? (base.points[0]?.x ?? 0) : 0);
    };
    expect(dx(later[0], 0)).toBeLessThan(0);
    expect(dx(later[1], 1)).toBeGreaterThan(0);
    expect(Math.abs(dx(later[1], 1))).toBeLessThanOrEqual(projectile.burstDistancePx + own.cell);
    expect(later[0]?.op === 'poly' && later[0].alpha).toBeLessThan(1);
    expect(field.activeCount(projectile.burstMs)).toBe(0);
  });

  it('REQ-087 reduced motion: no travel, a fade in place over motion.reducedMs', () => {
    const field = new FxField();
    field.burst({ side: 'left', rows: 1 }, 0, scene(), true);
    const start = polys(field.ops(0, scene()));
    const mid = polys(field.ops(motion.reducedMs / 2, scene()));
    expect(mid.map((op) => (op.op === 'poly' ? op.points : []))).toEqual(
      start.map((op) => (op.op === 'poly' ? op.points : [])),
    );
    expect(mid[0]?.op === 'poly' && mid[0].alpha).toBeCloseTo(0.5);
    expect(field.activeCount(motion.reducedMs)).toBe(0);
  });

  it('REQ-087 a burst is not a projectile: it is not counted in data-projectile-count', () => {
    const field = new FxField();
    field.burst({ side: 'left', rows: 2 }, 0, scene(), false);
    expect(field.launched).toBe(0);
  });
});

// ---- the arena loop: hooks, previews and the fx canvas ----

class RecordingContext {
  fills = 0;
  clears = 0;
  paths = 0;
  globalAlpha = 1;
  fillStyle = '';
  setTransform(): void {}
  clearRect(): void {
    this.clears += 1;
  }
  fillRect(): void {
    this.fills += 1;
  }
  beginPath(): void {}
  moveTo(): void {
    this.paths += 1;
  }
  lineTo(): void {}
  closePath(): void {}
  fill(): void {}
  save(): void {}
  restore(): void {}
  rect(): void {}
  clip(): void {}
}

class FakeCanvas {
  width = 300;
  height = 150;
  clientWidth = 900;
  clientHeight = 500;
  readonly style: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly ctx = new RecordingContext();
  getContext(): RecordingContext {
    return this.ctx;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

function model(over: Partial<BoardModel> = {}): BoardModel {
  return {
    seat: 'A',
    board: emptyBoard(),
    active: null,
    ghost: null,
    next: ['I', 'O'],
    pendingGarbage: 2,
    combo: 0,
    chain: { sent: 0, cancelled: 0 },
    danger: false,
    toppedOut: false,
    ...over,
  };
}

function arenaRig(role: Role = 'A') {
  const fakes = {
    left: new FakeCanvas(),
    right: new FakeCanvas(),
    leftNext: new FakeCanvas(),
    rightNext: new FakeCanvas(),
    fx: new FakeCanvas(),
  };
  let left: BoardModel | null = model();
  let right: BoardModel | null = model({ seat: 'B', next: ['T'] });
  let fxQueue: FrameModel['fx'] = [];
  const store = {} as GameStore;
  const driver: FrameDriver = {
    computeFrame: (nowMs) => {
      const fx = fxQueue;
      fxQueue = [];
      return { nowMs, left, right, fx, level: 0, standoff: null, inputLive: true };
    },
    publishFrame: () => undefined,
    stopFrames: () => undefined,
    role: () => role,
  };
  registerFrameDriver(store, driver);
  let callback: ((ts: number) => void) | null = null;
  const env: ArenaEnvironment = {
    requestFrame: (cb) => {
      callback = cb;
      return 1;
    },
    cancelFrame: () => undefined,
    viewport: () => ({ width: 1280, height: 600 }),
    devicePixelRatio: () => 1,
    onResize: () => () => undefined,
    onReducedMotionChange: () => () => undefined,
    reportError: (error) => {
      throw error;
    },
  };
  const tick = (ts: number): void => {
    callback?.(ts);
  };
  createMountArena(env)(fakes as unknown as ArenaCanvases, store, { reducedMotion: false });
  return {
    fakes,
    tick,
    pushFx: (fx: FrameModel['fx']) => {
      fxQueue = fx;
    },
    setModels: (l: BoardModel | null, r: BoardModel | null) => {
      left = l;
      right = r;
    },
  };
}

describe('REQ-060 the arena fills the NEXT canvases from the snapshot views', () => {
  it('REQ-060 each NEXT canvas is drawn when its queue changes, not every frame', () => {
    const r = arenaRig();
    r.tick(16);
    const afterFirst = r.fakes.leftNext.ctx.fills;
    expect(afterFirst).toBeGreaterThan(0);
    expect(r.fakes.rightNext.ctx.fills).toBeGreaterThan(0);
    r.tick(33);
    r.tick(50);
    expect(r.fakes.leftNext.ctx.fills).toBe(afterFirst);
    r.setModels(model({ next: ['S', 'Z', 'J'] }), model({ seat: 'B', next: ['T'] }));
    r.tick(66);
    expect(r.fakes.leftNext.ctx.fills).toBeGreaterThan(afterFirst);
    expect(r.fakes.left.attributes.get(DATA_HOOKS.next)).toBe('SZJ');
    expect(r.fakes.right.attributes.get(DATA_HOOKS.next)).toBe('T');
  });
});

describe('REQ-088 the arena pulses the frame on both boards', () => {
  it('REQ-088 data-danger follows each board model, and a pulsing frame is redrawn each frame', () => {
    const r = arenaRig();
    r.setModels(model({ danger: true }), model({ seat: 'B', danger: true }));
    r.tick(100);
    expect(r.fakes.left.attributes.get(DATA_HOOKS.danger)).toBe('true');
    expect(r.fakes.right.attributes.get(DATA_HOOKS.danger)).toBe('true');
    const drawn = r.fakes.left.ctx.clears;
    r.tick(100 + danger.periodMs / 4);
    expect(r.fakes.left.ctx.clears).toBeGreaterThan(drawn);
    r.setModels(model(), model({ seat: 'B' }));
    r.tick(2000);
    expect(r.fakes.left.attributes.get(DATA_HOOKS.danger)).toBe('false');
  });

  it('REQ-088 a calm board is not redrawn while nothing changes', () => {
    const r = arenaRig();
    r.tick(16);
    const clears = r.fakes.left.ctx.clears;
    r.tick(33);
    r.tick(50);
    expect(r.fakes.left.ctx.clears).toBe(clears);
  });
});

describe('REQ-087 the arena draws projectiles on the fx canvas', () => {
  it('REQ-087 data-projectile-count rises with each sent attack, once', () => {
    const r = arenaRig();
    r.tick(16);
    expect(r.fakes.fx.attributes.get(DATA_HOOKS.projectileCount)).toBe('0');
    r.pushFx([{ kind: 'projectile', from: 'left', rows: 2, originRow: null }]);
    r.tick(33);
    expect(r.fakes.fx.attributes.get(DATA_HOOKS.projectileCount)).toBe('1');
    expect(r.fakes.fx.attributes.get(DATA_HOOKS.fx)).toBe('1');
    expect(r.fakes.fx.ctx.paths).toBeGreaterThan(0);
    r.tick(60);
    expect(r.fakes.fx.attributes.get(DATA_HOOKS.projectileCount)).toBe('1');
    r.tick(33 + projectile.durationMs + motion.meterGrowMs + 16);
    expect(r.fakes.fx.attributes.get(DATA_HOOKS.fx)).toBe('0');
    expect(r.fakes.fx.attributes.get(DATA_HOOKS.projectileCount)).toBe('1');
  });

  it('REQ-087 the fx canvas is cleared once the last effect ends', () => {
    const r = arenaRig();
    r.tick(16);
    r.pushFx([{ kind: 'burst', side: 'right', rows: 1 }]);
    r.tick(33);
    const clears = r.fakes.fx.ctx.clears;
    r.tick(33 + projectile.burstMs + 10);
    expect(r.fakes.fx.ctx.clears).toBeGreaterThan(clears);
    const settled = r.fakes.fx.ctx.clears;
    r.tick(33 + projectile.burstMs + 40);
    expect(r.fakes.fx.ctx.clears).toBe(settled);
  });
});
