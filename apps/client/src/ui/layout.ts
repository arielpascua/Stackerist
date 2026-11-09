/**
 * Viewport fitting (REQ-056; DESIGN.md "Scale-down below 1280×600"). The cells shrink by
 * `computeCellSizes` down to the 12 px floor; past that the stage (and the result card) is drawn at its
 * natural size and scaled uniformly, so nothing ever scrolls.
 */

/** Uniform scale that fits `natural` inside `available`; never above 1, never 0 or NaN. */
export function fitScale(
  available: { readonly width: number; readonly height: number },
  natural: { readonly width: number; readonly height: number },
): number {
  if (natural.width <= 0 || natural.height <= 0) return 1;
  const scale = Math.min(1, available.width / natural.width, available.height / natural.height);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** Below this viewport width the legend drops its M and Esc items (their controls are in the top bar). */
export const LEGEND_FULL_FROM_PX = 1100;

export function legendIsShort(viewportWidth: number): boolean {
  return viewportWidth < LEGEND_FULL_FROM_PX;
}

/**
 * DESIGN.md "Hit targets": the floor for a button on home, lobby and the result card. Mirrors
 * `--hit-min` in tokens.css (a node test checks that they agree).
 */
export const HIT_MIN_PX = 44;

/**
 * How far a control's hit area must reach past its box, per side along the height, so that it is
 * still at least `minPx` tall on screen after its container is scaled by `scale` (the result card
 * shrinks as a whole on small screens, which shrinks a 44 px button too). 0 when nothing is lost.
 */
export function hitBleedPx(scale: number, boxHeightPx: number = HIT_MIN_PX, minPx = HIT_MIN_PX) {
  if (!Number.isFinite(scale) || scale <= 0) return 0;
  const needed = minPx / scale;
  return Math.max(0, (needed - boxHeightPx) / 2);
}
