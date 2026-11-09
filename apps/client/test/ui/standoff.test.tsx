import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StandoffPhase } from '../../src/game/contract.ts';
import { COPY } from '../../src/ui/copy.ts';
import { paintCountdown } from '../../src/ui/screens/game/framePaint.ts';
import { CountdownOverlay } from '../../src/ui/screens/game/Overlays.tsx';
import { TEST_IDS } from '../../src/ui/testIds.ts';

interface FakeElement {
  dataset: Record<string, string | undefined>;
  hidden: boolean;
  textContent: string;
}

function fake(hidden = false): FakeElement {
  return { dataset: {}, hidden, textContent: '' };
}

function elements() {
  return { root: fake(true), numeral: fake(), duel: fake(true), live: fake() };
}

const asDom = (e: ReturnType<typeof elements>) =>
  e as unknown as Parameters<typeof paintCountdown>[0];

const INTRO = COPY.countdown.intro(1, 'Ariel', 'Sam');

describe('REQ-086 the standoff: 3 · 2 · 1 · DUEL!, painted from the frame loop', () => {
  it('REQ-086 each frame phase paints the numerals, then DUEL!, and the overlay hides after', () => {
    const e = elements();
    let phase: StandoffPhase = null;
    const frames: {
      phase: StandoffPhase;
      numeral: string;
      duelHidden: boolean;
      hidden: boolean;
    }[] = [];
    for (const next of ['dim', '3', '2', '1', 'duel', null] as const) {
      phase = paintCountdown(asDom(e), phase, next, INTRO);
      frames.push({
        phase,
        numeral: e.numeral.textContent,
        duelHidden: e.duel.hidden,
        hidden: e.root.hidden,
      });
    }
    expect(frames).toEqual([
      { phase: 'dim', numeral: '', duelHidden: true, hidden: false },
      { phase: '3', numeral: '3', duelHidden: true, hidden: false },
      { phase: '2', numeral: '2', duelHidden: true, hidden: false },
      { phase: '1', numeral: '1', duelHidden: true, hidden: false },
      { phase: 'duel', numeral: '', duelHidden: false, hidden: false },
      { phase: null, numeral: '', duelHidden: true, hidden: true },
    ]);
  });

  it('REQ-086 DUEL! and the phase attribute that fades the dim and plates change in one call', () => {
    const e = elements();
    paintCountdown(asDom(e), '1', '1', INTRO);
    const before = { ...e.root.dataset };
    paintCountdown(asDom(e), '1', 'duel', INTRO);
    // One synchronous call flips both: the DUEL! banner shows and data-phase="duel" (CSS fades the
    // dim, the round tag and the plates on exactly that attribute).
    expect(before.phase).toBeUndefined();
    expect(e.duel.hidden).toBe(false);
    expect(e.root.dataset.phase).toBe('duel');
  });

  it('REQ-086 the live region says the round, then 3, 2, 1, Duel! — four updates', () => {
    const e = elements();
    const said: string[] = [];
    let phase: StandoffPhase = null;
    for (const next of ['dim', '3', '2', '1', 'duel', null] as const) {
      const before = e.live.textContent;
      phase = paintCountdown(asDom(e), phase, next, INTRO);
      if (e.live.textContent !== before) said.push(e.live.textContent);
    }
    expect(said).toEqual([INTRO, '3', '2', '1', 'Duel!']);
    expect(INTRO).toBe('Round 1. Ariel versus Sam.');
  });

  it('REQ-086 an unchanged phase is a no-op (60 Hz frames cost nothing)', () => {
    const e = elements();
    const first = paintCountdown(asDom(e), null, '2', INTRO);
    e.numeral.textContent = 'sentinel';
    expect(paintCountdown(asDom(e), first, '2', INTRO)).toBe('2');
    expect(e.numeral.textContent).toBe('sentinel');
  });
});

describe('REQ-086 the face-off plates', () => {
  function html(props: Partial<Parameters<typeof CountdownOverlay>[0]> = {}): string {
    return renderToStaticMarkup(
      <CountdownOverlay
        rootRef={null}
        numeralRef={null}
        duelRef={null}
        liveRef={null}
        roundLabel="Round 2"
        left={{ name: 'Ariel', won: 1 }}
        right={{ name: 'Sam', won: 0 }}
        kind="start"
        {...props}
      />,
    );
  }

  it('REQ-086 two plates around VS: yours left, the opponent right, the round tag above', () => {
    const out = html();
    const left = out.indexOf(TEST_IDS.countdown.plateLeft);
    const vs = out.indexOf(COPY.game.vs);
    const right = out.indexOf(TEST_IDS.countdown.plateRight);
    expect(left).toBeGreaterThan(-1);
    expect(left).toBeLessThan(vs);
    expect(vs).toBeLessThan(right);
    expect(out.indexOf(TEST_IDS.countdown.round)).toBeLessThan(left);
    expect(out).toContain('Round 2');
    expect(out).toContain('Ariel');
    expect(out).toContain('Sam');
  });

  it('REQ-086 a replayed draw tags the round "Round 2 · Replay"', () => {
    expect(html({ roundLabel: COPY.game.roundTagReplay(2) })).toContain('Round 2 · Replay');
  });

  it('REQ-086 series pips ride on each plate: a won round is filled', () => {
    const out = html();
    expect(out).toContain('aria-label="Ariel, 1 round won"');
    expect(out).toContain('aria-label="Sam, 0 rounds won"');
    expect(out.match(/data-filled="true"/g)?.length).toBe(1);
  });

  it('REQ-086 the resume sequence is marked, so the plates stay still', () => {
    expect(html({ kind: 'resume' })).toContain('data-kind="resume"');
    expect(html()).toContain('data-kind="start"');
  });

  it('REQ-086 the visual numerals are aria-hidden; DUEL! starts hidden; one polite status', () => {
    const out = html();
    expect(out).toContain('class="countdown__content" aria-hidden="true"');
    expect(out).toMatch(/countdown__duel" hidden=""/);
    expect(out).toContain('role="status"');
  });

  it('REQ-044 a name is text on a plate, never markup', () => {
    const out = html({ left: { name: '<b onmouseover=x>Ariel</b>', won: 0 } });
    expect(out).not.toContain('<b ');
    expect(out).toContain('&lt;b onmouseover=x&gt;Ariel&lt;/b&gt;');
  });
});
