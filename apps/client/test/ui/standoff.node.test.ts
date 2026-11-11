/**
 * Source scans for the standoff's timing rule (REQ-086): DUEL! and input-live come from the same CORE
 * frame, so no timer or animation callback may drive the numerals or DUEL!.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const read = (path: string): string => readFileSync(`${SRC}${path}`, 'utf8');

describe('REQ-086 the standoff is driven by the frame, not by timers', () => {
  it('REQ-086 the frame painter has no timer, no animation callback and no rAF of its own', () => {
    const painter = read('ui/screens/game/framePaint.ts');
    expect(painter).not.toMatch(/setTimeout|setInterval|requestAnimationFrame|animationend/i);
  });

  it('REQ-086 the game screen paints the standoff from subscribeFrame, with no animation callbacks', () => {
    const game = read('ui/screens/Game.tsx');
    expect(game).toMatch(/subscribeFrame/);
    expect(game).toMatch(/paintCountdown/);
    expect(game).not.toMatch(/onAnimationEnd|onTransitionEnd|animationend/);
  });

  it('REQ-086 the standoff overlay renders no timer-driven numerals', () => {
    const overlays = read('ui/screens/game/Overlays.tsx');
    const standoff = overlays.slice(
      overlays.indexOf('export function CountdownOverlay'),
      overlays.indexOf('export interface DisconnectOverlayProps'),
    );
    expect(standoff).not.toMatch(/setTimeout|setInterval|useEffect|useState/);
  });

  it('REQ-086 the dim, round tag and plates fade out on data-phase="duel", the DUEL! frame', () => {
    const css = read('styles/overlays.css');
    expect(css).toMatch(/\[data-phase='duel'\] \.countdown__scrim/);
    expect(css).toMatch(/\[data-phase='duel'\] \.standoff/);
    expect(css).toMatch(
      /\.countdown__duel\s*\{[^}]*pointer-events|\.countdown\s*\{[^}]*pointer-events: none/,
    );
  });

  it('REQ-086 reduced motion: static plates, no numeral scale, DUEL! holds 500 ms then fades', () => {
    const css = read('styles/overlays.css');
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.standoff__plate--left/);
    expect(reduced).toMatch(/\.countdown__numeral\[data-swap\]\s*\{\s*animation: none/);
    expect(reduced).toMatch(/duel-out var\(--dur-reduced\) var\(--ease-standard\) 500ms/);
  });
});

describe('REQ-086 the HUD VS column steps aside while the standoff is up (U7)', () => {
  const css = read('styles/game.css');

  it('REQ-086 the HUD VS, round tag, speed and clock are hidden while the standoff overlay shows', () => {
    expect(css).toMatch(
      /\.arena:has\(\.countdown:not\(\[hidden\]\)\) \.vs-col\s*\{[^}]*visibility: hidden;/,
    );
  });

  it('REQ-086 by visibility only: no display or size change, so the 1280x600 geometry cannot move', () => {
    const rule = /\.arena:has\(\.countdown:not\(\[hidden\]\)\) \.vs-col\s*\{([^}]*)\}/.exec(css);
    expect(rule?.[1]).toBeDefined();
    expect(rule?.[1]).not.toMatch(/display|width|height|margin|padding|position|opacity/);
  });
});

describe('REQ-091 the chart is hand-rolled SVG: no chart library', () => {
  it('REQ-091 the client depends on no chart, router or state library', () => {
    const pkg = JSON.parse(readFileSync(`${SRC}../package.json`, 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      '@fontsource/archivo',
      '@fontsource/big-shoulders-display',
      '@stackerist/engine',
      '@stackerist/protocol',
      'react',
      'react-dom',
      'zod',
    ]);
  });
});
