/**
 * REQ-049: the HUD top bar's controls all stay on screen at 390 px. The real geometry is proved in the
 * browser (e2e/geometry-signature.spec.ts "top bar controls ... at 390x844 mobile"); these source scans
 * pin the rules that make it fit, and that the 1280x600 bar and the 32 px HUD floor are untouched.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const read = (path: string): string => readFileSync(`${SRC}${path}`, 'utf8');
const TOKENS = readFileSync(
  fileURLToPath(new URL('../../../../design/tokens/tokens.css', import.meta.url)),
  'utf8',
);

/** The body of every `@media (max-width: <px>px)` block, by its width, with nested braces balanced. */
function narrowBlocks(css: string): Map<number, string> {
  const blocks = new Map<number, string>();
  for (const match of css.matchAll(/@media \(max-width: (\d+)px\) \{/g)) {
    let depth = 1;
    let end = (match.index ?? 0) + match[0].length;
    while (depth > 0 && end < css.length) {
      const char = css[end];
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      end += 1;
    }
    const start = (match.index ?? 0) + match[0].length;
    const width = Number(match[1]);
    blocks.set(width, `${blocks.get(width) ?? ''}${css.slice(start, end - 1)}`);
  }
  return blocks;
}

/** The widest narrow block that mentions the selector: where the compact top bar starts. */
function compactBlock(css: string, selector: string): string | null {
  const widths = [...narrowBlocks(css).entries()]
    .filter(([, body]) => body.includes(selector))
    .map(([width]) => width);
  const widest = Math.max(...widths);
  return widths.length === 0 ? null : (narrowBlocks(css).get(widest) ?? null);
}

describe('REQ-049 the top bar fits a 390 px phone (reflow by collapsing secondary items)', () => {
  const css = read('styles/game.css');

  it('REQ-049 the Music label collapses to its icon on a narrow top bar, kept for assistive tech', () => {
    const block = compactBlock(css, '.topbar .music-btn__label');
    expect(block, 'a narrow-screen rule for the top bar Music label').not.toBeNull();
    // Clipped, not display:none: the button keeps its accessible name "Music".
    expect(block).toMatch(/\.topbar \.music-btn__label[^{]*\{[^}]*clip-path: inset\(50%\)/);
    expect(block).not.toMatch(/\.topbar \.music-btn__label[^{]*\{[^}]*display: none/);
    expect(block).toMatch(/\.topbar \.music-btn__key[^{]*\{[^}]*display: none/);
  });

  it('REQ-049 the "N watching" count stays in the page for screen readers but takes no room', () => {
    const block = compactBlock(css, '.topbar__right .meta');
    expect(block, 'a narrow-screen rule for the spectator count').not.toBeNull();
    expect(block).toMatch(/\.topbar__right \.meta[^{]*\{[^}]*clip-path: inset\(50%\)/);
  });

  it('REQ-049 the compact top bar starts above the phone width and below the 1280x600 layout', () => {
    const widths = [...narrowBlocks(css).entries()]
      .filter(([, body]) => body.includes('.topbar .music-btn__label'))
      .map(([width]) => width);
    expect(widths.length).toBeGreaterThan(0);
    for (const width of widths) {
      expect(width).toBeGreaterThanOrEqual(520);
      expect(width).toBeLessThan(1280);
    }
  });

  it('REQ-049 the HUD buttons keep their 32 px floor in every state of the narrow top bar', () => {
    expect(TOKENS).toMatch(/--hit-hud:\s*32px/);
    const all = [...narrowBlocks(css).values()].join('\n');
    expect(all).not.toMatch(/min-height|--hit-hud/);
    expect(read('styles/controls.css')).toMatch(/\.btn--hud\s*\{\s*min-height: var\(--hit-hud\)/);
  });

  it('REQ-049 the desktop top bar rules outside the media blocks are unchanged', () => {
    const topbar = css.slice(css.indexOf('/* ---- Top bar ---- */'), css.indexOf('.ping {'));
    expect(topbar).toContain('height: var(--space-10);');
    expect(topbar).toContain('.topbar__right {\n  display: flex;\n  flex: none;');
    expect(topbar).not.toMatch(/flex-wrap/);
  });
});
