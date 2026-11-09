/**
 * CSS-style cubic-bezier easing for the canvas, so canvas motion uses the same `easing` tokens as the
 * DOM (DESIGN.md Motion system). Pure.
 */
import type { Bezier } from '../../../../design/tokens/tokens.ts';

const NEWTON_STEPS = 8;
const BISECTION_STEPS = 24;
const EPSILON = 1e-6;

/** The easing function y(x) for a cubic-bezier(x1, y1, x2, y2), with x clamped to [0, 1]. */
export function bezierEasing([x1, y1, x2, y2]: Bezier): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;

  const solveT = (x: number): number => {
    let t = x;
    for (let i = 0; i < NEWTON_STEPS; i += 1) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < EPSILON) return t;
      const slope = slopeX(t);
      if (Math.abs(slope) < EPSILON) break;
      t -= error / slope;
    }
    let low = 0;
    let high = 1;
    t = x;
    for (let i = 0; i < BISECTION_STEPS; i += 1) {
      const value = sampleX(t);
      if (Math.abs(value - x) < EPSILON) return t;
      if (value < x) low = t;
      else high = t;
      t = (low + high) / 2;
    }
    return t;
  };

  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return sampleY(solveT(x));
  };
}
