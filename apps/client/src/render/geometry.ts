/**
 * Canvas layout maths (REQ-055, architecture §5.5, DESIGN.md Layout). Pure; every size comes from the
 * tokens (`computeCellSizes`, `boardOuterPx`, `board`, `meter`, `danger`, `cellMetrics`).
 *
 * A board canvas, left to right: the garbage meter, a gap, the danger-ring padding, the board (frame,
 * 10 × 20 cells on a grid, frame), the danger-ring padding. Vertically: ring padding, board, ring
 * padding. The cell size is the pitch: each cell draws a grid line on its leading edges, plus one
 * closing line, so the inner area is 10·cell + 1 by 20·cell + 1.
 */
import { BOARD_HEIGHT, BOARD_WIDTH } from '@stackerist/engine';
import {
  board as boardTokens,
  boardOuterPx,
  cellMetrics,
  computeCellSizes,
  danger,
  meter,
  type CellSizes,
} from '../../../../design/tokens/tokens.ts';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface BoardGeometry {
  /** Cell pitch, CSS px. */
  readonly cell: number;
  /** Canvas CSS size. */
  readonly width: number;
  readonly height: number;
  /** Garbage meter track (zero width when the canvas has no meter). */
  readonly meter: Rect;
  /** The board's outer box, frame included. */
  readonly outer: Rect;
  /** The cell area inside the frame: 10·cell + 1 by 20·cell + 1. */
  readonly inner: Rect;
}

/**
 * The gap between a meter and its board's danger-ring padding, CSS px. The tokens have no meter-gap
 * value (reported to the orchestrator); the meter width keeps it on the token scale.
 */
export const METER_GAP_PX = meter.widthPx;

/** A board canvas: meter of `meterWidthPx` (0 for none) plus gap, ring padding of `ringPx` per side. */
export function boardGeometry(cell: number, meterWidthPx: number, ringPx: number): BoardGeometry {
  const frame = boardTokens.frameWidthPx;
  const outerSize = boardOuterPx(cell);
  const meterSpace = meterWidthPx > 0 ? meterWidthPx + METER_GAP_PX : 0;
  const outer: Rect = {
    x: meterSpace + ringPx,
    y: ringPx,
    w: outerSize.width,
    h: outerSize.height,
  };
  const inner: Rect = {
    x: outer.x + frame,
    y: outer.y + frame,
    w: outer.w - 2 * frame,
    h: outer.h - 2 * frame,
  };
  return {
    cell,
    width: outer.x + outer.w + ringPx,
    height: outer.h + 2 * ringPx,
    meter: { x: 0, y: inner.y, w: meterWidthPx, h: inner.h },
    outer,
    inner,
  };
}

/** The game's board canvas: meter (own or opponent width) and the danger-ring padding. */
export function arenaBoardGeometry(cell: number, ownMeter: boolean): BoardGeometry {
  return boardGeometry(cell, ownMeter ? meter.widthPx : meter.widthOppPx, danger.ringWidthPx);
}

/** The best-moment mini board: just the board (REQ-051). */
export function bareBoardGeometry(cell: number): BoardGeometry {
  return boardGeometry(cell, 0, 0);
}

/** The pitch box of cell (x, y): the cell with its leading grid lines and the closing ones. */
export function pitchRect(g: BoardGeometry, x: number, y: number): Rect {
  const line = boardTokens.gridLineWidthPx;
  return {
    x: g.inner.x + x * g.cell,
    y: g.inner.y + y * g.cell,
    w: g.cell + line,
    h: g.cell + line,
  };
}

/** The fill area of cell (x, y): inside its grid lines. */
export function cellRect(g: BoardGeometry, x: number, y: number): Rect {
  const line = boardTokens.gridLineWidthPx;
  return {
    x: g.inner.x + x * g.cell + line,
    y: g.inner.y + y * g.cell + line,
    w: g.cell - line,
    h: g.cell - line,
  };
}

/** A full-width band over row `y`, grid lines included (line-clear flash, best-moment outline). */
export function rowBand(g: BoardGeometry, y: number): Rect {
  const line = boardTokens.gridLineWidthPx;
  return { x: g.inner.x, y: g.inner.y + y * g.cell, w: g.inner.w, h: g.cell + line };
}

/** Meter segments for `rows` pending rows: one per row, each exactly one cell tall, from the bottom, ≤ 20. */
export function meterSegments(g: BoardGeometry, rows: number): Rect[] {
  const line = boardTokens.gridLineWidthPx;
  const count = Math.max(0, Math.min(BOARD_HEIGHT, Math.floor(rows)));
  const segments: Rect[] = [];
  for (let i = 0; i < count; i += 1) {
    const row = BOARD_HEIGHT - 1 - i;
    segments.push({
      x: g.meter.x,
      y: g.inner.y + row * g.cell + line,
      w: g.meter.w,
      h: g.cell - line,
    });
  }
  return segments;
}

/** Canvas backing-store size in device px: round(CSS size × devicePixelRatio). */
export function backingSize(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): { width: number; height: number } {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return {
    width: Math.max(1, Math.round(cssWidth * ratio)),
    height: Math.max(1, Math.round(cssHeight * ratio)),
  };
}

/**
 * Cell sizes for the arena. Players: `computeCellSizes` (own + 60% opponent). Spectators: both boards at
 * the own size, with the width term over 20 columns (DESIGN.md Spectator layout).
 */
export function arenaCellSizes(
  viewportW: number,
  viewportH: number,
  spectator: boolean,
): CellSizes {
  const sizes = computeCellSizes(viewportW, viewportH);
  if (!spectator) return sizes;
  const m = cellMetrics;
  const byHeight = Math.floor((viewportH - m.chromeVPx) / BOARD_HEIGHT);
  const byWidth = Math.floor((viewportW - m.chromeHPx) / (2 * BOARD_WIDTH));
  const own = Math.max(m.minPx, Math.min(byHeight, byWidth, m.maxPx));
  const next = Math.max(m.nextMinPx, Math.round(own * m.nextRatio));
  const naturalW = m.chromeHPx + 2 * BOARD_WIDTH * own;
  const naturalH = m.chromeVPx + BOARD_HEIGHT * own;
  const scale = Math.min(1, viewportW / naturalW, viewportH / naturalH);
  return { own, opp: own, next, scale, compact: own < m.compactBelowPx };
}

/** Mini-piece slots in a NEXT column: 4 cells wide, 2 cells tall each, one cell apart. */
export function nextCanvasSize(cellNext: number, count: number): { width: number; height: number } {
  const slots = Math.max(1, count);
  return { width: 4 * cellNext, height: slots * 2 * cellNext + (slots - 1) * cellNext };
}

/** The 4 x 2 cell slot of preview `index` in a NEXT column: slots are one cell apart. */
export function previewSlotRect(cellNext: number, index: number): Rect {
  return { x: 0, y: index * 3 * cellNext, w: 4 * cellNext, h: 2 * cellNext };
}
