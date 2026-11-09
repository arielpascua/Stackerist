/**
 * The only code that touches a 2D context: DPR-aware sizing and the draw-op executor (REQ-055).
 * Canvas CSS size is set here from the layout maths; the backing store is round(CSS × DPR) and the
 * context is scaled by DPR, so every op is in CSS px.
 */
import { backingSize } from './geometry.ts';
import type { DrawOp } from './renderList.ts';

/**
 * Sizes `canvas` to `cssWidth` × `cssHeight` CSS px at `dpr` and returns its context with the DPR
 * transform applied, or null when 2D canvas is unavailable.
 */
export function prepareCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  setCssSize = true,
): CanvasRenderingContext2D | null {
  if (setCssSize) {
    canvas.style.width = `${String(cssWidth)}px`;
    canvas.style.height = `${String(cssHeight)}px`;
  }
  const backing = backingSize(cssWidth, cssHeight, dpr);
  if (canvas.width !== backing.width) canvas.width = backing.width;
  if (canvas.height !== backing.height) canvas.height = backing.height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  ctx.setTransform(backing.width / cssWidth, 0, 0, backing.height / cssHeight, 0, 0);
  return ctx;
}

function hatch(ctx: CanvasRenderingContext2D, op: Extract<DrawOp, { op: 'hatch' }>): void {
  const { x, y, w, h } = op.rect;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = op.color;
  ctx.fillRect(x, y, w, h);
  // 135° stripes: bands of constant (x + y), each `stripeWidth` wide measured across the stripe.
  const period = op.stripeWidth * Math.SQRT2;
  ctx.fillStyle = op.stripe;
  for (let start = period; start < w + h; start += 2 * period) {
    const end = start + period;
    ctx.beginPath();
    ctx.moveTo(x + start, y);
    ctx.lineTo(x + end, y);
    ctx.lineTo(x + end - h, y + h);
    ctx.lineTo(x + start - h, y + h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function executeOps(ctx: CanvasRenderingContext2D, ops: readonly DrawOp[]): void {
  for (const op of ops) {
    if (op.op === 'hatch') {
      hatch(ctx, op);
      continue;
    }
    ctx.globalAlpha = op.alpha;
    ctx.fillStyle = op.color;
    ctx.fillRect(op.rect.x, op.rect.y, op.rect.w, op.rect.h);
  }
  ctx.globalAlpha = 1;
}
