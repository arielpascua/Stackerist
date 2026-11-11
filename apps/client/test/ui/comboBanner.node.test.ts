/**
 * REQ-052 / U6 (UX review 9a): the combo banner hung 14 px past the board's left edge and was 125 px
 * wide, so it covered well columns 0 to 4 in rows 5 to 6, where a falling piece passes during a chain.
 * Now it is anchored by its right edge to the left edge of column COMBO_BANNER_CLEAR_COLUMN (3), so it
 * grows leftwards, out over the meter and the margin, and never reaches a protected column however wide
 * its text is. The CSS rule is evaluated here with the real board geometry at the two gate viewports; the
 * rendered box is also measured in a browser (the one-off check in the FIX2 report).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { danger, meter, computeCellSizes } from '../../../../design/tokens/tokens.ts';
import { BOARD_WIDTH } from '@stackerist/engine';
import { arenaBoardGeometry, arenaCellSizes, pitchRect } from '../../src/render/geometry.ts';
import { COMBO_BANNER_CLEAR_COLUMN, comboBannerRightEdgePx } from '../../src/ui/layout.ts';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const read = (path: string): string => readFileSync(`${SRC}${path}`, 'utf8');
const css = read('styles/game.css');

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `a rule for ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('\n}', start));
}

/** Evaluates `a - b * c`-style sums of numbers (the only operators the banner rule uses). */
function evaluate(expression: string): number {
  const tokens = expression.match(/-?\d+(?:\.\d+)?|[+\-*]/g) ?? [];
  const terms: number[] = [];
  let sign = 1;
  let product: number | null = null;
  let pendingMultiply = false;
  for (const token of tokens) {
    if (token === '*') {
      pendingMultiply = true;
    } else if (token === '+' || token === '-') {
      if (product !== null) terms.push(sign * product);
      product = null;
      sign = token === '-' ? -1 : 1;
    } else {
      const value = Number(token);
      product = pendingMultiply && product !== null ? product * value : value;
      pendingMultiply = false;
    }
  }
  if (product !== null) terms.push(sign * product);
  return terms.reduce((sum, term) => sum + term, 0);
}

/** The banner's `right:` offset in px, from the CSS rule, for a board canvas `width` wide. */
function cssRightPx(width: number, inset: number, cell: number): number {
  const declaration = /right:\s*calc\(([^;]+)\);/.exec(rule('.combo-banner'))?.[1];
  expect(declaration, '.combo-banner has right: calc(...)').toBeDefined();
  const numeric = (declaration ?? '')
    .replace('100%', String(width))
    .replace('var(--board-inset)', String(inset))
    .replace('var(--banner-clear-cols)', String(COMBO_BANNER_CLEAR_COLUMN))
    .replace('var(--cell)', String(cell));
  expect(numeric, 'every variable in the rule is known to this test').not.toContain('var(');
  return evaluate(numeric);
}

const VIEWPORTS = [
  { width: 1280, height: 600 },
  { width: 1440, height: 900 },
] as const;
const BANNER_WIDTHS = [125, 160, 240] as const;

describe('REQ-052 the combo banner never covers a protected well column', () => {
  it('REQ-052 the protected columns start at column 3', () => {
    expect(COMBO_BANNER_CLEAR_COLUMN).toBe(3);
  });

  it('REQ-052 --board-inset in CSS is the board canvas offset the geometry uses', () => {
    expect(css).toContain(
      '--board-inset: calc(var(--meter-width) * 2 + var(--danger-ring-width));',
    );
    expect(css).toContain(
      '--board-inset: calc(var(--meter-width-opp) + var(--meter-width) + var(--danger-ring-width));',
    );
    for (const { width, height } of VIEWPORTS) {
      const { own, opp } = computeCellSizes(width, height);
      expect(arenaBoardGeometry(own, true).outer.x).toBe(meter.widthPx * 2 + danger.ringWidthPx);
      expect(arenaBoardGeometry(opp, false).outer.x).toBe(
        meter.widthOppPx + meter.widthPx + danger.ringWidthPx,
      );
    }
  });

  for (const { width, height } of VIEWPORTS) {
    for (const [name, spectator, own] of [
      ['own board', false, true],
      ['opponent board', false, false],
      ['spectator board B', true, true],
    ] as const) {
      it(`REQ-052 ${String(width)}x${String(height)} ${name}: the banner box ends before column 3, at any text width`, () => {
        const sizes = arenaCellSizes(width, height, spectator);
        const cell = own || spectator ? sizes.own : sizes.opp;
        const g = arenaBoardGeometry(cell, own || spectator);
        const right = g.width - cssRightPx(g.width, g.outer.x, cell);
        // Where the banner's right edge sits: exactly the helper's value, left of column 3's pitch box.
        expect(right).toBe(comboBannerRightEdgePx(g));
        expect(right).toBeLessThanOrEqual(pitchRect(g, COMBO_BANNER_CLEAR_COLUMN, 0).x);
        for (const bannerWidth of BANNER_WIDTHS) {
          const left = right - bannerWidth;
          // Columns 3..9 are all to the right of the box, whatever its width.
          for (let column = COMBO_BANNER_CLEAR_COLUMN; column < BOARD_WIDTH; column += 1) {
            expect(left + bannerWidth).toBeLessThanOrEqual(pitchRect(g, column, 0).x);
          }
        }
      });
    }
  }

  it('REQ-052 the right edge is anchored, so the banner grows leftwards and keeps its slant', () => {
    const banner = rule('.combo-banner');
    expect(banner).not.toMatch(/\n\s+left:/);
    // The skew (-12deg) pivots on the top right corner: the right edge never leans past the anchor.
    expect(banner).toContain('transform-origin: top right;');
    expect(banner).toContain('transform: skewX(var(--skew-onair));');
    expect(banner).toContain('top: 25%;');
  });

  it('REQ-052 each column feeds its own cell size to the banner, and the screen sets the column count', () => {
    expect(css).toMatch(/\.player-col \{[^}]*--cell: var\(--cell-own\);/s);
    expect(css).toMatch(/\.player-col--opp \{[^}]*--cell: var\(--cell-opp\);/s);
    expect(read('ui/screens/Game.tsx')).toContain(
      "'--banner-clear-cols': COMBO_BANNER_CLEAR_COLUMN",
    );
  });
});
