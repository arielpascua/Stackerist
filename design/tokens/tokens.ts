/**
 * Stackerist: Prime Time tokens for the canvas renderer and other DOM-free code.
 *
 * Every value here mirrors a custom property in design/tokens/tokens.css. `CSS_VARS` and
 * `CSS_VARS_REDUCED_MOTION` list that mapping and a parity check compares them with tokens.css
 * (see DESIGN.md "Token parity check"). Change a value in both files or in neither.
 *
 * No DOM types and no runtime dependencies. Erasable TypeScript only, so Node can strip the types.
 */

export type PieceKind = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export type CellKind = PieceKind | 'G';
/** cubic-bezier control points [x1, y1, x2, y2]; all y values stay within 0..1 (no overshoot). */
export type Bezier = readonly [number, number, number, number];

export const color = {
  bg: '#16130F',
  panel: '#2A231B',
  line: '#3D3329',
  text: '#F2EADF',
  textMuted: '#BCA98F',
  accent: '#F5B700',
  alert: '#FF5A36',
  ok: '#7BD88F',
  well: '#0E0B08',
  grid: '#251F18',
  clockBg: '#0B0907',
  ink: '#16130F',
  inkSoft: '#3A2C00',
  shadow: '#000000',
} as const;

/** Fill colour per cell kind. L was changed from #00B3A4 for tritan separation (DESIGN.md). */
export const pieceColor: Readonly<Record<CellKind, string>> = {
  I: '#F5B700',
  O: '#E9E4D8',
  T: '#2FBF71',
  S: '#FF6A3D',
  Z: '#3D7BFF',
  J: '#C89BFF',
  L: '#12978A',
  G: '#776A5D',
};

export const board = {
  well: color.well,
  gridLine: color.grid,
  frameColor: color.line,
  frameWidthPx: 2,
  gridLineWidthPx: 1,
  /** Inset top highlight and bottom shade on every filled cell. */
  bevelWidthPx: 2,
  /** Used instead of bevelWidthPx when the cell is smaller than bevelSmallBelowPx. */
  bevelWidthSmallPx: 1,
  bevelSmallBelowPx: 16,
  bevelHighlight: 'rgba(255, 255, 255, 0.32)',
  bevelShade: 'rgba(0, 0, 0, 0.38)',
  /** Garbage (G) is hatched at 135 degrees: alternating stripes of pieceColor.G and garbageStripe. */
  garbageStripe: '#6A5E52',
  garbageStripeWidthPx: 3,
  garbageStripeWidthSmallPx: 2,
} as const;

export const ghost = {
  /** 2 px inset outline in the piece colour, no fill. */
  lineWidthPx: 2,
  alpha: 0.55,
} as const;

export const flash = {
  color: '#F2EADF',
  alpha: 0.85,
  alphaReduced: 0.35,
  durationMs: 150,
} as const;

export const bestMoment = {
  clearedOutline: 'rgba(245, 183, 0, 0.9)',
  finisherOutline: '#F2EADF',
  chromeVPx: 408,
  cellMinPx: 8,
  cellMaxPx: 12,
} as const;

export const danger = {
  /** Pulse while stack height + pending garbage >= this many rows. */
  rows: 16,
  color: color.alert,
  ringWidthPx: 2,
  ringMinAlpha: 0.25,
  ringMinAlphaReduced: 1,
  periodMs: 900,
} as const;

export const meter = {
  widthPx: 8,
  widthOppPx: 6,
  fill: color.alert,
  track: color.panel,
} as const;

export const projectile = {
  color: color.accent,
  burstColor: color.accent,
  durationMs: 350,
  baseSizePx: 8,
  perRowPx: 4,
  maxSizePx: 40,
  /** Control-point lift as a fraction of the flight distance. */
  arc: 0.15,
  arcReduced: 0,
  meterGrowMs: 120,
  burstMs: 260,
  burstDistancePx: 20,
  burstDistanceReducedPx: 0,
} as const;

export const chart = {
  you: color.accent,
  opp: pieceColor.O,
  grid: color.grid,
  danger: color.alert,
  label: color.textMuted,
  lineWidthPx: 2,
  widthPx: 300,
  heightPx: 180,
} as const;

export const cellMetrics = {
  /** Vertical px of the game screen that are not board cells (see DESIGN.md > Layout). */
  chromeVPx: 152,
  /** Horizontal px of the game screen that are not board cells. */
  chromeHPx: 448,
  minPx: 12,
  maxPx: 40,
  oppRatio: 0.6,
  nextRatio: 0.45,
  nextMinPx: 5,
  compactBelowPx: 16,
} as const;

export const easing = {
  outExpo: [0.16, 1, 0.3, 1],
  outQuart: [0.25, 1, 0.5, 1],
  inQuad: [0.5, 0, 0.75, 0],
  inOutSine: [0.37, 0, 0.63, 1],
  standard: [0.2, 0, 0, 1],
} as const satisfies Record<string, Bezier>;

export const motion = {
  hoverMs: 80,
  pressMs: 120,
  swapMs: 120,
  flashMs: flash.durationMs,
  nudgeOutMs: 60,
  nudgeBackMs: 120,
  nudgePerRowPx: 2,
  nudgeMaxPx: 8,
  bannerInMs: 160,
  bannerHoldMs: 800,
  bannerOutMs: 200,
  bannerSlidePx: 12,
  speedSwapMs: 180,
  standoffTotalMs: 3000,
  dimMs: 240,
  standoffInMs: 320,
  standoffOffsetPx: 64,
  numeralInMs: 200,
  numeralOutMs: 120,
  numeralScaleFrom: 1.2,
  duelSlamMs: 140,
  duelHoldMs: 360,
  duelOutMs: 240,
  duelScaleFrom: 1.6,
  projectileMs: projectile.durationMs,
  meterGrowMs: projectile.meterGrowMs,
  burstMs: projectile.burstMs,
  dangerPeriodMs: danger.periodMs,
  resultDelayMs: 400,
  artInMs: 400,
  cardInMs: 280,
  cardRisePx: 16,
  copiedMs: 2000,
  reducedMs: 120,
} as const;

export interface CellSizes {
  /** Own board cell, CSS px (grid line included in the pitch). */
  own: number;
  /** Opponent board cell, CSS px. */
  opp: number;
  /** Next-queue mini cell, CSS px. */
  next: number;
  /** Uniform stage scale; 1 unless the viewport is below the 12 px floor. */
  scale: number;
  /** True when the side columns use the compact stat layout. */
  compact: boolean;
}

/** Board outer size in CSS px for a cell size: 10 or 20 cells, one closing grid line, 2 frames. */
export function boardOuterPx(cell: number): { width: number; height: number } {
  const edge = board.gridLineWidthPx + 2 * board.frameWidthPx;
  return { width: 10 * cell + edge, height: 20 * cell + edge };
}

/** The game-screen cell formula from DESIGN.md > Layout. Pure; pass the viewport in CSS px. */
export function computeCellSizes(viewportW: number, viewportH: number): CellSizes {
  const m = cellMetrics;
  const byHeight = Math.floor((viewportH - m.chromeVPx) / 20);
  const byWidth = Math.floor((viewportW - m.chromeHPx) / (10 + 10 * m.oppRatio));
  const fit = Math.min(byHeight, byWidth, m.maxPx);
  const own = Math.max(m.minPx, fit);
  const opp = Math.round(own * m.oppRatio);
  const next = Math.max(m.nextMinPx, Math.round(own * m.nextRatio));
  const naturalW = m.chromeHPx + 10 * own + 10 * opp;
  const naturalH = m.chromeVPx + 20 * own;
  const scale = Math.min(1, viewportW / naturalW, viewportH / naturalH);
  return { own, opp, next, scale, compact: own < m.compactBelowPx };
}

/** Best-moment mini board cell (result card), CSS px. */
export function computeBestMomentCell(viewportH: number): number {
  const b = bestMoment;
  return Math.min(b.cellMaxPx, Math.max(b.cellMinPx, Math.floor((viewportH - b.chromeVPx) / 20)));
}

/** Garbage projectile edge length in CSS px for an attack of `rows` rows. */
export function projectileSizePx(rows: number): number {
  return Math.min(projectile.maxSizePx, projectile.baseSizePx + projectile.perRowPx * rows);
}

/** Garbage nudge distance in CSS px for `rows` inserted rows (0 under reduced motion). */
export function nudgePx(rows: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : Math.min(motion.nudgeMaxPx, motion.nudgePerRowPx * rows);
}

export type PingQuality = 'good' | 'fair' | 'poor' | 'unknown';
/** good < 80 ms, fair 80-149 ms, poor >= 150 ms (prediction is guaranteed up to 150 ms, REQ-069). */
export const ping = { goodBelowMs: 80, poorFromMs: 150 } as const;
export function pingQuality(rttMs: number | null): PingQuality {
  if (rttMs === null) return 'unknown';
  if (rttMs < ping.goodBelowMs) return 'good';
  if (rttMs < ping.poorFromMs) return 'fair';
  return 'poor';
}
export const pingColor: Readonly<Record<PingQuality, string>> = {
  good: color.ok,
  fair: color.accent,
  poor: color.alert,
  unknown: color.textMuted,
};

const bez = (b: Bezier): string => `cubic-bezier(${b.join(', ')})`;
const px = (n: number): string => `${n}px`;
const ms = (n: number): string => `${n}ms`;

/** tokens.css custom property -> value, for every token this file mirrors (base :root block). */
export const CSS_VARS: Readonly<Record<string, string>> = {
  '--color-bg': color.bg,
  '--color-panel': color.panel,
  '--color-line': color.line,
  '--color-text': color.text,
  '--color-text-muted': color.textMuted,
  '--color-accent': color.accent,
  '--color-alert': color.alert,
  '--color-ok': color.ok,
  '--color-well': color.well,
  '--color-grid': color.grid,
  '--color-clock-bg': color.clockBg,
  '--color-ink': color.ink,
  '--color-ink-soft': color.inkSoft,
  '--color-shadow': color.shadow,
  '--piece-I': pieceColor.I,
  '--piece-O': pieceColor.O,
  '--piece-T': pieceColor.T,
  '--piece-S': pieceColor.S,
  '--piece-Z': pieceColor.Z,
  '--piece-J': pieceColor.J,
  '--piece-L': pieceColor.L,
  '--piece-G': pieceColor.G,
  '--piece-G-stripe': board.garbageStripe,
  '--board-frame-width': px(board.frameWidthPx),
  '--board-grid-width': px(board.gridLineWidthPx),
  '--bevel-width': px(board.bevelWidthPx),
  '--bevel-width-small': px(board.bevelWidthSmallPx),
  '--bevel-small-below': px(board.bevelSmallBelowPx),
  '--bevel-highlight': board.bevelHighlight,
  '--bevel-shade': board.bevelShade,
  '--garbage-stripe-width': px(board.garbageStripeWidthPx),
  '--garbage-stripe-width-small': px(board.garbageStripeWidthSmallPx),
  '--ghost-width': px(ghost.lineWidthPx),
  '--ghost-alpha': String(ghost.alpha),
  '--flash-color': flash.color,
  '--flash-alpha': String(flash.alpha),
  '--bm-clear-outline': bestMoment.clearedOutline,
  '--bm-finisher-outline': bestMoment.finisherOutline,
  '--bm-chrome-v': px(bestMoment.chromeVPx),
  '--bm-cell-min': px(bestMoment.cellMinPx),
  '--bm-cell-max': px(bestMoment.cellMaxPx),
  '--danger-rows': String(danger.rows),
  '--danger-ring-width': px(danger.ringWidthPx),
  '--danger-ring-min-alpha': String(danger.ringMinAlpha),
  '--meter-width': px(meter.widthPx),
  '--meter-width-opp': px(meter.widthOppPx),
  '--projectile-color': projectile.color,
  '--burst-color': projectile.burstColor,
  '--chart-you': chart.you,
  '--chart-opp': chart.opp,
  '--chart-grid': chart.grid,
  '--chart-danger': chart.danger,
  '--chart-label': chart.label,
  '--chart-line-width': px(chart.lineWidthPx),
  '--chart-width': px(chart.widthPx),
  '--chart-height': px(chart.heightPx),
  '--layout-chrome-v': px(cellMetrics.chromeVPx),
  '--layout-chrome-h': px(cellMetrics.chromeHPx),
  '--cell-min': px(cellMetrics.minPx),
  '--cell-max': px(cellMetrics.maxPx),
  '--cell-opp-ratio': String(cellMetrics.oppRatio),
  '--cell-next-ratio': String(cellMetrics.nextRatio),
  '--cell-next-min': px(cellMetrics.nextMinPx),
  '--cell-compact-below': px(cellMetrics.compactBelowPx),
  '--ease-out-expo': bez(easing.outExpo),
  '--ease-out-quart': bez(easing.outQuart),
  '--ease-in-quad': bez(easing.inQuad),
  '--ease-in-out-sine': bez(easing.inOutSine),
  '--ease-standard': bez(easing.standard),
  '--dur-hover': ms(motion.hoverMs),
  '--dur-press': ms(motion.pressMs),
  '--dur-swap': ms(motion.swapMs),
  '--dur-flash': ms(motion.flashMs),
  '--dur-nudge-out': ms(motion.nudgeOutMs),
  '--dur-nudge-back': ms(motion.nudgeBackMs),
  '--nudge-per-row': px(motion.nudgePerRowPx),
  '--nudge-max': px(motion.nudgeMaxPx),
  '--dur-banner-in': ms(motion.bannerInMs),
  '--dur-banner-hold': ms(motion.bannerHoldMs),
  '--dur-banner-out': ms(motion.bannerOutMs),
  '--banner-slide': px(motion.bannerSlidePx),
  '--dur-speed-swap': ms(motion.speedSwapMs),
  '--standoff-total': ms(motion.standoffTotalMs),
  '--dur-dim': ms(motion.dimMs),
  '--dur-standoff-in': ms(motion.standoffInMs),
  '--standoff-offset': px(motion.standoffOffsetPx),
  '--dur-numeral-in': ms(motion.numeralInMs),
  '--dur-numeral-out': ms(motion.numeralOutMs),
  '--numeral-scale-from': String(motion.numeralScaleFrom),
  '--dur-duel-slam': ms(motion.duelSlamMs),
  '--dur-duel-hold': ms(motion.duelHoldMs),
  '--dur-duel-out': ms(motion.duelOutMs),
  '--duel-scale-from': String(motion.duelScaleFrom),
  '--dur-projectile': ms(motion.projectileMs),
  '--projectile-base': px(projectile.baseSizePx),
  '--projectile-per-row': px(projectile.perRowPx),
  '--projectile-max': px(projectile.maxSizePx),
  '--projectile-arc': String(projectile.arc),
  '--dur-meter-grow': ms(motion.meterGrowMs),
  '--dur-burst': ms(motion.burstMs),
  '--burst-distance': px(projectile.burstDistancePx),
  '--dur-danger-period': ms(motion.dangerPeriodMs),
  '--dur-result-delay': ms(motion.resultDelayMs),
  '--dur-art-in': ms(motion.artInMs),
  '--dur-card-in': ms(motion.cardInMs),
  '--card-rise': px(motion.cardRisePx),
  '--dur-copied': ms(motion.copiedMs),
  '--dur-reduced': ms(motion.reducedMs),
};

/** Overrides inside tokens.css `@media (prefers-reduced-motion: reduce)`. */
export const CSS_VARS_REDUCED_MOTION: Readonly<Record<string, string>> = {
  '--nudge-per-row': '0px',
  '--nudge-max': '0px',
  '--banner-slide': '0px',
  '--standoff-offset': '0px',
  '--numeral-scale-from': '1',
  '--duel-scale-from': '1',
  '--projectile-arc': String(projectile.arcReduced),
  '--burst-distance': px(projectile.burstDistanceReducedPx),
  '--card-rise': '0px',
  '--flash-alpha': String(flash.alphaReduced),
  '--danger-ring-min-alpha': String(danger.ringMinAlphaReduced),
};
