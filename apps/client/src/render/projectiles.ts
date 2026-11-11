/**
 * Garbage projectiles and cancel bursts (REQ-087, DESIGN.md "Garbage projectile and cancel burst"). Pure:
 * times and board positions are passed in, and the result is a list of draw ops for the fx canvas, so the
 * flight, the landing and the burst are tested without a canvas.
 *
 * Visual only. Each effect is started by one snapshot `attack` or `cancel` event (each event is carried by
 * exactly one snapshot) and nothing here is waited on by input, state or the meters, which follow snapshot truth.
 *
 * - Projectile: an amber, skewed, bevelled square of `projectileSizePx(rows)` flies from the sender's board
 *   (centre column, the cleared row's height, else mid-board) to the receiver's meter at its current fill
 *   top along a quadratic curve lifted by `projectile.arc` x distance, over `projectile.durationMs` on
 *   `easing.inQuad`. At most `MAX_IN_FLIGHT_PER_DIRECTION` fly per direction; extras are skipped visually.
 *   On landing the receiver's new top segments get a brief amber outline (`motion.meterGrowMs`).
 * - Reduced motion: no flight; the outline appears at once and lasts `flash.durationMs`.
 * - Burst: each cancelled meter segment breaks into two fragments (meter width x half a cell) that travel
 *   sideways and up, rotate and fade over `projectile.burstMs` on `easing.outExpo`. Reduced motion: the
 *   fragments fade in place over `motion.reducedMs`.
 */
import {
  board as boardTokens,
  color,
  easing,
  flash,
  motion,
  projectile,
  projectileSizePx,
} from '../../../../design/tokens/tokens.ts';
import type { Side } from '../game/contract.ts';
import { bezierEasing } from './easing.ts';
import { meterSegments, rowBand, type BoardGeometry, type Rect } from './geometry.ts';
import { bevelWidth, outlineOps, type FxOp, type Point } from './renderList.ts';

/** DESIGN.md: at most 4 projectiles in flight per direction. The tokens have no value for it. */
export const MAX_IN_FLIGHT_PER_DIRECTION = 4;
/** DESIGN.md: burst fragments rise 8 px and rotate up to 30 degrees. The tokens have no value for them. */
export const BURST_LIFT_PX = 8;
export const BURST_ROTATE_DEG = 30;
/** DESIGN.md: the reduced-motion landing outline is 2 px. The tokens have no value for it. */
export const LANDING_OUTLINE_PX = 2;
/** `--skew-onair` (-12deg), which tokens.ts does not carry; the CSS variable is its source. */
export const PROJECTILE_SKEW_DEG = -12;

const easeInQuad = bezierEasing(easing.inQuad);
const easeOutExpo = bezierEasing(easing.outExpo);
const RAD = Math.PI / 180;

/** What the effects need to know about the arena right now. */
export interface FxScene {
  /** The board canvas layout for `side`, or null before the first layout. */
  geometry(side: Side): BoardGeometry | null;
  /** The board canvas' top-left corner in fx-canvas CSS px. */
  origin(side: Side): Point;
  /** Rows currently shown in `side`'s garbage meter. */
  pending(side: Side): number;
}

export function otherSide(side: Side): Side {
  return side === 'left' ? 'right' : 'left';
}

/** A point `p` (0..1) along the quadratic curve a -> control -> b. */
export function quadraticPoint(a: Point, control: Point, b: Point, p: number): Point {
  const q = 1 - p;
  return {
    x: q * q * a.x + 2 * q * p * control.x + p * p * b.x,
    y: q * q * a.y + 2 * q * p * control.y + p * p * b.y,
  };
}

/** The control point: the midpoint lifted (up) by `arc` x the flight distance. */
export function controlPoint(a: Point, b: Point, arc: number): Point {
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - arc * distance };
}

/** Where a projectile starts, in its sender board's canvas: centre column, the cleared row, else mid-board. */
export function projectileStart(g: BoardGeometry, originRow: number | null): Point {
  const x = g.inner.x + g.inner.w / 2;
  if (originRow === null) return { x, y: g.inner.y + g.inner.h / 2 };
  const band = rowBand(g, originRow);
  return { x, y: band.y + band.h / 2 };
}

/** Where a projectile lands, in its receiver board's canvas: the meter at the top of its fill. */
export function projectileEnd(g: BoardGeometry, pendingRows: number): Point {
  const top = meterSegments(g, pendingRows).at(-1);
  const x = g.meter.x + g.meter.w / 2;
  if (top === undefined) return { x, y: g.meter.y + g.meter.h - g.cell / 2 };
  return { x, y: top.y + top.h / 2 };
}

/** `rect` as four corners, rotated by `rotation` and sheared by `skewTan` about its centre, then moved by (dx, dy). */
export function transformedRect(
  rect: Rect,
  {
    dx = 0,
    dy = 0,
    rotation = 0,
    skewTan = 0,
  }: { dx?: number; dy?: number; rotation?: number; skewTan?: number },
): Point[] {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [
    [-rect.w / 2, -rect.h / 2],
    [rect.w / 2, -rect.h / 2],
    [rect.w / 2, rect.h / 2],
    [-rect.w / 2, rect.h / 2],
  ].map(([ox = 0, oy = 0]) => {
    const sheared = ox + skewTan * oy;
    return { x: cx + dx + sheared * cos - oy * sin, y: cy + dy + sheared * sin + oy * cos };
  });
}

interface Flight {
  readonly from: Side;
  readonly rows: number;
  readonly startMs: number;
  /** In the sender board's canvas. */
  readonly start: Point;
  /** In the receiver board's canvas. */
  readonly end: Point;
}

interface Landing {
  readonly side: Side;
  readonly rows: number;
  readonly startMs: number;
  readonly durationMs: number;
  readonly reduced: boolean;
}

interface Fragment {
  /** In the board canvas. */
  readonly rect: Rect;
  /** -1 flies left, +1 right. */
  readonly direction: -1 | 1;
}

interface Burst {
  readonly side: Side;
  readonly fragments: readonly Fragment[];
  readonly startMs: number;
  readonly reduced: boolean;
}

function add(point: Point, by: Point): Point {
  return { x: point.x + by.x, y: point.y + by.y };
}

export class FxField {
  #flights: Flight[] = [];
  #landings: Landing[] = [];
  #bursts: Burst[] = [];
  #launched = 0;

  /** Projectiles launched (or, under reduced motion, landed) since creation: `data-projectile-count`. */
  get launched(): number {
    return this.#launched;
  }

  /** A snapshot `attack`: `rows` leftover rows from `from` to the other board's meter. */
  launch(
    event: { readonly from: Side; readonly rows: number; readonly originRow: number | null },
    nowMs: number,
    scene: FxScene,
    reducedMotion: boolean,
  ): void {
    const to = otherSide(event.from);
    if (event.rows <= 0) return;
    this.#advance(nowMs);
    if (reducedMotion) {
      this.#launched += 1;
      this.#landings.push({
        side: to,
        rows: event.rows,
        startMs: nowMs,
        durationMs: flash.durationMs,
        reduced: true,
      });
      return;
    }
    const sender = scene.geometry(event.from);
    const receiver = scene.geometry(to);
    if (sender === null || receiver === null) return;
    if (this.#flights.filter((f) => f.from === event.from).length >= MAX_IN_FLIGHT_PER_DIRECTION) {
      return;
    }
    this.#launched += 1;
    this.#flights.push({
      from: event.from,
      rows: event.rows,
      startMs: nowMs,
      start: projectileStart(sender, event.originRow),
      end: projectileEnd(receiver, scene.pending(to)),
    });
  }

  /** A snapshot `cancel`: the top `rows` segments of `side`'s meter burst. */
  burst(
    event: { readonly side: Side; readonly rows: number },
    nowMs: number,
    scene: FxScene,
    reducedMotion: boolean,
  ): void {
    const g = scene.geometry(event.side);
    if (g === null || event.rows <= 0) return;
    // The meter has already shrunk to the snapshot's value; the burst sits where the rows used to be.
    const pending = scene.pending(event.side);
    const removed = meterSegments(g, pending + event.rows).slice(pending);
    const fragments = removed.flatMap((segment): Fragment[] => {
      const half = g.cell / 2;
      return [
        { rect: { x: segment.x, y: segment.y, w: segment.w, h: half }, direction: -1 },
        { rect: { x: segment.x, y: segment.y + half, w: segment.w, h: half }, direction: 1 },
      ];
    });
    this.#bursts.push({ side: event.side, fragments, startMs: nowMs, reduced: reducedMotion });
  }

  /** Effects still running at `nowMs`. */
  activeCount(nowMs: number): number {
    this.#advance(nowMs);
    return this.#flights.length + this.#landings.length + this.#bursts.length;
  }

  /** The draw ops for `nowMs` (flights, landing outlines, bursts), in fx-canvas CSS px. */
  ops(nowMs: number, scene: FxScene): FxOp[] {
    this.#advance(nowMs);
    return [
      ...this.#landings.flatMap((landing) => this.#landingOps(landing, nowMs, scene)),
      ...this.#bursts.flatMap((burst) => this.#burstOps(burst, nowMs, scene)),
      ...this.#flights.flatMap((flight) => this.#flightOps(flight, nowMs, scene)),
    ];
  }

  /** Moves landed flights to landings and drops finished effects. */
  #advance(nowMs: number): void {
    const landed = this.#flights.filter((f) => nowMs - f.startMs >= projectile.durationMs);
    if (landed.length > 0) {
      this.#flights = this.#flights.filter((f) => nowMs - f.startMs < projectile.durationMs);
      for (const flight of landed) {
        this.#landings.push({
          side: otherSide(flight.from),
          rows: flight.rows,
          startMs: flight.startMs + projectile.durationMs,
          durationMs: motion.meterGrowMs,
          reduced: false,
        });
      }
    }
    this.#landings = this.#landings.filter((l) => nowMs - l.startMs < l.durationMs);
    this.#bursts = this.#bursts.filter((b) => nowMs - b.startMs < burstDuration(b.reduced));
  }

  #flightOps(flight: Flight, nowMs: number, scene: FxScene): FxOp[] {
    const to = otherSide(flight.from);
    const start = add(flight.start, scene.origin(flight.from));
    const end = add(flight.end, scene.origin(to));
    const progress = easeInQuad(
      Math.min(1, Math.max(0, (nowMs - flight.startMs) / projectile.durationMs)),
    );
    const at = quadraticPoint(start, controlPoint(start, end, projectile.arc), end, progress);
    const size = projectileSizePx(flight.rows);
    const bevel = Math.min(bevelWidth(size), size / 2);
    const skewTan = Math.tan(PROJECTILE_SKEW_DEG * RAD);
    const box = (offsetY: number, height: number): Point[] =>
      transformedRect(
        { x: at.x - size / 2, y: at.y - size / 2 + offsetY, w: size, h: height },
        {
          skewTan,
          // Shear about the projectile's own centre, whichever strip is drawn.
          dx: skewTan * (offsetY + height / 2 - size / 2),
        },
      );
    return [
      { op: 'poly', points: box(0, size), color: projectile.color, alpha: 1 },
      { op: 'poly', points: box(0, bevel), color: boardTokens.bevelHighlight, alpha: 1 },
      { op: 'poly', points: box(size - bevel, bevel), color: boardTokens.bevelShade, alpha: 1 },
    ];
  }

  #landingOps(landing: Landing, nowMs: number, scene: FxScene): FxOp[] {
    const g = scene.geometry(landing.side);
    if (g === null) return [];
    const origin = scene.origin(landing.side);
    const segments = meterSegments(g, scene.pending(landing.side));
    const top = segments.slice(Math.max(0, segments.length - landing.rows));
    // Reduced motion holds the outline for its whole duration; otherwise it fades out.
    const elapsed = (nowMs - landing.startMs) / landing.durationMs;
    const alpha = landing.reduced ? 1 : 1 - Math.min(1, Math.max(0, elapsed));
    return top.flatMap((segment) =>
      outlineOps(
        { x: segment.x + origin.x, y: segment.y + origin.y, w: segment.w, h: segment.h },
        LANDING_OUTLINE_PX,
        color.accent,
        alpha,
      ),
    );
  }

  #burstOps(burst: Burst, nowMs: number, scene: FxScene): FxOp[] {
    const origin = scene.origin(burst.side);
    const progress = Math.min(
      1,
      Math.max(0, (nowMs - burst.startMs) / burstDuration(burst.reduced)),
    );
    const eased = easeOutExpo(progress);
    const distance = burst.reduced ? projectile.burstDistanceReducedPx : projectile.burstDistancePx;
    const lift = burst.reduced ? 0 : BURST_LIFT_PX;
    const rotate = burst.reduced ? 0 : BURST_ROTATE_DEG * RAD;
    return burst.fragments.map(({ rect, direction }) => ({
      op: 'poly',
      points: transformedRect(
        { x: rect.x + origin.x, y: rect.y + origin.y, w: rect.w, h: rect.h },
        {
          dx: direction * distance * eased,
          dy: -lift * eased,
          rotation: direction * rotate * eased,
        },
      ),
      color: projectile.burstColor,
      alpha: 1 - progress,
    }));
  }
}

function burstDuration(reduced: boolean): number {
  return reduced ? motion.reducedMs : projectile.burstMs;
}
