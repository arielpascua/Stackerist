/**
 * Per-board effect timelines (REQ-055, DESIGN.md Motion system). Pure: times are passed in, so the
 * renderer and the tests share one definition.
 *
 * - Line-clear flash: bands over the cleared rows for `flash.durationMs`, fading from `flash.alpha` to 0
 *   on `easing.outExpo`; reduced motion: a static band at `flash.alphaReduced`, no fade. Visual only:
 *   the board under it already shows the post-clear state, and nothing waits for it.
 * - Garbage nudge: the board rises `nudgePx(rows)` over `motion.nudgeOutMs`, then settles over
 *   `motion.nudgeBackMs`, both on `easing.outQuart`; reduced motion: no movement.
 */
import { easing, flash, motion, nudgePx } from '../../../../design/tokens/tokens.ts';
import { bezierEasing } from './easing.ts';
import type { FlashBand } from './renderList.ts';

const easeOutExpo = bezierEasing(easing.outExpo);
const easeOutQuart = bezierEasing(easing.outQuart);

interface Flash {
  readonly rows: readonly number[];
  readonly startMs: number;
  readonly reduced: boolean;
}

interface Nudge {
  readonly distancePx: number;
  readonly startMs: number;
}

const NUDGE_TOTAL_MS = motion.nudgeOutMs + motion.nudgeBackMs;

/** Upward nudge offset `elapsedMs` into a nudge of `distancePx`, CSS px (0 when settled). */
export function nudgeOffsetAt(distancePx: number, elapsedMs: number): number {
  if (elapsedMs < 0 || elapsedMs >= NUDGE_TOTAL_MS) return 0;
  if (elapsedMs < motion.nudgeOutMs) {
    return distancePx * easeOutQuart(elapsedMs / motion.nudgeOutMs);
  }
  return distancePx * (1 - easeOutQuart((elapsedMs - motion.nudgeOutMs) / motion.nudgeBackMs));
}

/** Flash opacity `elapsedMs` into a flash (0 once it is over). */
export function flashAlphaAt(elapsedMs: number, reduced: boolean): number {
  if (elapsedMs < 0 || elapsedMs >= flash.durationMs) return 0;
  return reduced
    ? flash.alphaReduced
    : flash.alpha * (1 - easeOutExpo(elapsedMs / flash.durationMs));
}

export class BoardEffects {
  #flashes: Flash[] = [];
  #nudges: Nudge[] = [];
  #flashCount = 0;
  #nudgeCount = 0;

  /** Flashes started since creation. */
  get flashCount(): number {
    return this.#flashCount;
  }

  /** Nudges started since creation. */
  get nudgeCount(): number {
    return this.#nudgeCount;
  }

  flash(rows: readonly number[], nowMs: number, reducedMotion: boolean): void {
    if (rows.length === 0) return;
    this.#flashes.push({ rows, startMs: nowMs, reduced: reducedMotion });
    this.#flashCount += 1;
  }

  nudge(rows: number, nowMs: number, reducedMotion: boolean): void {
    if (rows <= 0) return;
    this.#nudges.push({ distancePx: nudgePx(rows, reducedMotion), startMs: nowMs });
    this.#nudgeCount += 1;
  }

  /** Drops finished effects. */
  prune(nowMs: number): void {
    this.#flashes = this.#flashes.filter((f) => nowMs - f.startMs < flash.durationMs);
    this.#nudges = this.#nudges.filter((n) => nowMs - n.startMs < NUDGE_TOTAL_MS);
  }

  /** Effects still running at `nowMs`. */
  activeCount(nowMs: number): number {
    this.prune(nowMs);
    return this.#flashes.length + this.#nudges.length;
  }

  /** The flash bands to draw now (the strongest per row). */
  flashBands(nowMs: number): FlashBand[] {
    const byRow = new Map<number, number>();
    for (const f of this.#flashes) {
      const alpha = flashAlphaAt(nowMs - f.startMs, f.reduced);
      if (alpha <= 0) continue;
      for (const row of f.rows) byRow.set(row, Math.max(alpha, byRow.get(row) ?? 0));
    }
    return [...byRow].map(([row, alpha]) => ({ row, alpha }));
  }

  /** How far the board is lifted now, CSS px (the largest running nudge). */
  nudgeOffset(nowMs: number): number {
    let offset = 0;
    for (const n of this.#nudges)
      offset = Math.max(offset, nudgeOffsetAt(n.distancePx, nowMs - n.startMs));
    return offset;
  }
}
