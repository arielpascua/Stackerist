/**
 * Board drawing as data: pure functions turn a board model into a list of draw ops, and `canvas.ts`
 * executes them. Tests assert on the list, so the look is checked without a canvas (REQ-055).
 *
 * Every colour and size comes from the tokens: block style (flat fill, inset top highlight, inset
 * bottom shade, `board.bevel*`), garbage hatched at 135° (`board.garbageStripe*`), grid and well,
 * the segmented meter (`meter.*`), the line-clear flash (`flash.*`), the ghost (`ghost.*`), the danger
 * frame and ring (`danger.*`), the NEXT previews and the best-moment outlines (`bestMoment.*`). There is
 * no text op: names are never drawn on a canvas (REQ-044).
 */
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  pieceCells,
  type ActivePiece,
  type Board,
  type CellKind,
  type PieceKind,
} from '@stackerist/engine';
import type { WireBestMoment } from '@stackerist/protocol';
import {
  bestMoment as bestMomentTokens,
  board as boardTokens,
  danger,
  flash,
  ghost,
  meter,
  pieceColor,
} from '../../../../design/tokens/tokens.ts';
import {
  cellRect,
  meterSegments,
  pitchRect,
  previewSlotRect,
  rowBand,
  type BoardGeometry,
  type Rect,
} from './geometry.ts';

export type DrawOp =
  | { readonly op: 'rect'; readonly rect: Rect; readonly color: string; readonly alpha: number }
  | {
      readonly op: 'hatch';
      readonly rect: Rect;
      readonly color: string;
      readonly stripe: string;
      /** Stripe width measured across the stripe, CSS px. */
      readonly stripeWidth: number;
    };

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A filled quadrilateral (a skewed or rotated square on the fx canvas); corners in drawing order. */
export interface PolyOp {
  readonly op: 'poly';
  readonly points: readonly Point[];
  readonly color: string;
  readonly alpha: number;
}

/** What the fx canvas draws: the board ops plus polygons. */
export type FxOp = DrawOp | PolyOp;

/** What a board canvas shows (a `BoardModel` satisfies it). */
export interface BoardDrawModel {
  readonly board: Board;
  readonly active: ActivePiece | null;
  readonly pendingGarbage: number;
  /** Where a hard drop would land the falling piece: own board only (REQ-061). */
  readonly ghost?: ActivePiece | null;
}

/** The danger frame and ring for one frame of the pulse (REQ-088); see `DangerPulse`. */
export interface DangerLook {
  /** Opacity of the red frame over the normal one: 1 in danger, fading to 0 on exit. */
  readonly frameAlpha: number;
  /** Opacity of the ring just outside the frame (0 = no ring). */
  readonly ringAlpha: number;
}

export interface BoardDrawOptions {
  /** The normal frame colour: `board.frameColor`. */
  readonly frameColor: string;
  readonly danger?: DangerLook;
}

function rect(r: Rect, color: string, alpha = 1): DrawOp {
  return { op: 'rect', rect: r, color, alpha };
}

function isCellKind(char: string): char is CellKind {
  return Object.hasOwn(pieceColor, char);
}

/** The bevel width for a cell pitch (thinner below `board.bevelSmallBelowPx`). */
export function bevelWidth(cell: number): number {
  return cell < boardTokens.bevelSmallBelowPx
    ? boardTokens.bevelWidthSmallPx
    : boardTokens.bevelWidthPx;
}

/** One block in the Prime Time style: flat fill (hatched for garbage), top highlight, bottom shade. */
export function blockOps(area: Rect, kind: CellKind, cell: number): DrawOp[] {
  const small = cell < boardTokens.bevelSmallBelowPx;
  const fill: DrawOp =
    kind === 'G'
      ? {
          op: 'hatch',
          rect: area,
          color: pieceColor.G,
          stripe: boardTokens.garbageStripe,
          stripeWidth: small
            ? boardTokens.garbageStripeWidthSmallPx
            : boardTokens.garbageStripeWidthPx,
        }
      : rect(area, pieceColor[kind]);
  const bevel = Math.min(bevelWidth(cell), area.h / 2);
  return [
    fill,
    rect({ x: area.x, y: area.y, w: area.w, h: bevel }, boardTokens.bevelHighlight),
    rect({ x: area.x, y: area.y + area.h - bevel, w: area.w, h: bevel }, boardTokens.bevelShade),
  ];
}

/** Well and grid lines: one line on each cell's leading edges plus the closing lines. */
export function wellOps(g: BoardGeometry): DrawOp[] {
  const line = boardTokens.gridLineWidthPx;
  const ops: DrawOp[] = [rect(g.inner, boardTokens.well)];
  for (let x = 0; x <= BOARD_WIDTH; x += 1) {
    ops.push(
      rect(
        { x: g.inner.x + x * g.cell, y: g.inner.y, w: line, h: g.inner.h },
        boardTokens.gridLine,
      ),
    );
  }
  for (let y = 0; y <= BOARD_HEIGHT; y += 1) {
    ops.push(
      rect(
        { x: g.inner.x, y: g.inner.y + y * g.cell, w: g.inner.w, h: line },
        boardTokens.gridLine,
      ),
    );
  }
  return ops;
}

/** Every filled board cell in block style. */
export function lockedCellOps(g: BoardGeometry, board: Board): DrawOp[] {
  const ops: DrawOp[] = [];
  board.forEach((row, y) => {
    for (let x = 0; x < row.length && x < BOARD_WIDTH; x += 1) {
      const char = row.charAt(x);
      if (isCellKind(char)) ops.push(...blockOps(cellRect(g, x, y), char, g.cell));
    }
  });
  return ops;
}

/** The falling piece's on-board cells (cells above row 0 are not drawn: there are no hidden rows). */
export function pieceOps(g: BoardGeometry, piece: ActivePiece | null): DrawOp[] {
  if (piece === null) return [];
  return pieceCells(piece)
    .filter(({ x, y }) => x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT)
    .flatMap(({ x, y }) => blockOps(cellRect(g, x, y), piece.kind, g.cell));
}

/** The garbage meter: the track, then one cell-tall segment per pending row from the bottom (≤ 20). */
export function meterOps(g: BoardGeometry, pendingRows: number): DrawOp[] {
  if (g.meter.w <= 0) return [];
  const segments = meterSegments(g, pendingRows);
  const ops: DrawOp[] = [rect(g.meter, meter.track)];
  const top = segments.at(-1);
  if (top === undefined) return ops;
  // The 1 px separators between segments are grid-coloured lines (DESIGN.md Game HUD).
  const line = boardTokens.gridLineWidthPx;
  const bottom = g.meter.y + g.meter.h;
  ops.push(
    rect(
      { x: g.meter.x, y: top.y - line, w: g.meter.w, h: bottom - (top.y - line) },
      boardTokens.gridLine,
    ),
  );
  for (const segment of segments) ops.push(rect(segment, meter.fill));
  return ops;
}

/** The board frame: four bands of `board.frameWidthPx` around the inner area. */
export function frameOps(g: BoardGeometry, color: string, alpha = 1): DrawOp[] {
  const width = boardTokens.frameWidthPx;
  const { x, y, w, h } = g.outer;
  return [
    rect({ x, y, w, h: width }, color, alpha),
    rect({ x, y: y + h - width, w, h: width }, color, alpha),
    rect({ x, y: y + width, w: width, h: h - 2 * width }, color, alpha),
    rect({ x: x + w - width, y: y + width, w: width, h: h - 2 * width }, color, alpha),
  ];
}

/**
 * A `width`-px outline drawn inside `area` as four bands that do not overlap, so a translucent outline
 * has no darker corners.
 */
export function outlineOps(area: Rect, width: number, color: string, alpha = 1): DrawOp[] {
  const edge = Math.max(0, Math.min(width, area.h / 2));
  const side = Math.max(0, Math.min(width, area.w / 2));
  return [
    rect({ x: area.x, y: area.y, w: area.w, h: edge }, color, alpha),
    rect({ x: area.x, y: area.y + area.h - edge, w: area.w, h: edge }, color, alpha),
    rect({ x: area.x, y: area.y + edge, w: side, h: area.h - 2 * edge }, color, alpha),
    rect(
      { x: area.x + area.w - side, y: area.y + edge, w: side, h: area.h - 2 * edge },
      color,
      alpha,
    ),
  ];
}

/**
 * The danger frame and ring (REQ-088): the red frame over the normal one at `frameAlpha`, and a
 * `danger.ringWidthPx` ring just outside the frame (in the canvas padding, so nothing shifts) at `ringAlpha`.
 */
export function dangerOps(g: BoardGeometry, look: DangerLook): DrawOp[] {
  const ops: DrawOp[] = [];
  if (look.frameAlpha > 0) ops.push(...frameOps(g, danger.color, look.frameAlpha));
  if (look.ringAlpha > 0) {
    const ring = danger.ringWidthPx;
    const { x, y, w, h } = g.outer;
    ops.push(
      ...outlineOps(
        { x: x - ring, y: y - ring, w: w + 2 * ring, h: h + 2 * ring },
        ring,
        danger.color,
        look.ringAlpha,
      ),
    );
  }
  return ops;
}

/**
 * The ghost (REQ-061): each cell of the landing piece as a `ghost.lineWidthPx` inset outline in the piece
 * colour at `ghost.alpha`, no fill. Cells above the board are not drawn.
 */
export function ghostOps(g: BoardGeometry, piece: ActivePiece | null): DrawOp[] {
  if (piece === null) return [];
  return pieceCells(piece)
    .filter(({ x, y }) => x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT)
    .flatMap(({ x, y }) =>
      outlineOps(cellRect(g, x, y), ghost.lineWidthPx, pieceColor[piece.kind], ghost.alpha),
    );
}

/**
 * A NEXT column (REQ-060): one mini piece per slot, in block style, rotation 0, centred in its 4 x 2 cell
 * slot. The first kind is the next piece. Transparent background.
 */
export function nextPreviewOps(cell: number, kinds: readonly PieceKind[]): DrawOp[] {
  const line = boardTokens.gridLineWidthPx;
  return kinds.flatMap((kind, index) => {
    const slot = previewSlotRect(cell, index);
    const cells = pieceCells({ kind, rotation: 0, x: 0, y: 0 });
    const minX = Math.min(...cells.map((c) => c.x));
    const maxX = Math.max(...cells.map((c) => c.x));
    const minY = Math.min(...cells.map((c) => c.y));
    const maxY = Math.max(...cells.map((c) => c.y));
    const left = slot.x + ((4 - (maxX - minX + 1)) * cell) / 2;
    const top = slot.y + ((2 - (maxY - minY + 1)) * cell) / 2;
    return cells.flatMap((c) =>
      blockOps(
        {
          x: left + (c.x - minX) * cell,
          y: top + (c.y - minY) * cell,
          w: cell - line,
          h: cell - line,
        },
        kind,
        cell,
      ),
    );
  });
}

/** A whole board canvas: well and grid, locked cells, the falling piece, the meter, the frame. */
export function boardOps(
  g: BoardGeometry,
  model: BoardDrawModel | null,
  options: BoardDrawOptions,
): DrawOp[] {
  return [
    ...wellOps(g),
    ...(model === null ? [] : lockedCellOps(g, model.board)),
    ...(model === null ? [] : ghostOps(g, model.ghost ?? null)),
    ...(model === null ? [] : pieceOps(g, model.active)),
    ...meterOps(g, model?.pendingGarbage ?? 0),
    ...frameOps(g, options.frameColor),
    ...(options.danger === undefined ? [] : dangerOps(g, options.danger)),
  ];
}

/** Line-clear flash bands over the cleared rows' former positions. */
export function flashOps(g: BoardGeometry, bands: readonly FlashBand[]): DrawOp[] {
  return bands
    .filter(({ row, alpha }) => alpha > 0 && row >= 0 && row < BOARD_HEIGHT)
    .map(({ row, alpha }) => rect(rowBand(g, row), flash.color, alpha));
}

export interface FlashBand {
  readonly row: number;
  /** Opacity, 0..1. */
  readonly alpha: number;
}

/** A `width`-px outline drawn inside `area`. */
function insetOutline(area: Rect, width: number, color: string): DrawOp[] {
  return [
    rect({ x: area.x, y: area.y, w: area.w, h: width }, color),
    rect({ x: area.x, y: area.y + area.h - width, w: area.w, h: width }, color),
    rect({ x: area.x, y: area.y, w: width, h: area.h }, color),
    rect({ x: area.x + area.w - width, y: area.y, w: width, h: area.h }, color),
  ];
}

const CLEARED_OUTLINE_PX = 1;
const FINISHER_OUTLINE_PX = 2;

/**
 * The best-moment mini board (REQ-051): the recorded board in block style, each cleared row outlined
 * 1 px in `bestMoment.clearedOutline`, and the finishing piece's outer edge outlined 2 px (inset) in
 * `bestMoment.finisherOutline`.
 */
export function bestMomentOps(g: BoardGeometry, moment: WireBestMoment): DrawOp[] {
  const ops: DrawOp[] = [
    ...wellOps(g),
    ...lockedCellOps(g, moment.board),
    ...frameOps(g, boardTokens.frameColor),
  ];
  for (const row of moment.clearedRows) {
    ops.push(...insetOutline(rowBand(g, row), CLEARED_OUTLINE_PX, bestMomentTokens.clearedOutline));
  }
  const inPiece = new Set(moment.pieceCells.map(({ x, y }) => `${String(x)},${String(y)}`));
  const has = (x: number, y: number): boolean => inPiece.has(`${String(x)},${String(y)}`);
  const width = FINISHER_OUTLINE_PX;
  const color = bestMomentTokens.finisherOutline;
  for (const { x, y } of moment.pieceCells) {
    const box = pitchRect(g, x, y);
    if (!has(x, y - 1)) ops.push(rect({ x: box.x, y: box.y, w: box.w, h: width }, color));
    if (!has(x, y + 1))
      ops.push(rect({ x: box.x, y: box.y + box.h - width, w: box.w, h: width }, color));
    if (!has(x - 1, y)) ops.push(rect({ x: box.x, y: box.y, w: width, h: box.h }, color));
    if (!has(x + 1, y))
      ops.push(rect({ x: box.x + box.w - width, y: box.y, w: width, h: box.h }, color));
  }
  return ops;
}
