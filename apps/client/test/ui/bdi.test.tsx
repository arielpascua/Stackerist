/**
 * Security review F7: every player name is rendered inside `<bdi>`, so a name in a right-to-left script
 * (or one that tries to look like one) can't reorder the text around it.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Music } from '../../src/game/contract.ts';
import { Bdi, withNames } from '../../src/ui/components/Bdi.tsx';
import { LeaveConfirm } from '../../src/ui/components/LeaveConfirm.tsx';
import { deriveResult } from '../../src/ui/result.ts';
import { PlayerColumn } from '../../src/ui/screens/game/Hud.tsx';
import { CountdownOverlay, DisconnectOverlay } from '../../src/ui/screens/game/Overlays.tsx';
import { Lobby } from '../../src/ui/screens/Lobby.tsx';
import { ResultCard } from '../../src/ui/screens/ResultCard.tsx';
import { makeGameOver, makeReport, makeRoom, makeSeries } from './fixtures.ts';

// Hebrew letters, written as code points so no right-to-left text sits in the source.
const RTL = String.fromCharCode(0x5e9, 0x5dc, 0x5d5, 0x5dd);
const OTHER = 'Sam';

/** The markup with every `<bdi>…</bdi>` and every attribute value removed: what is left is bare text. */
function bare(markup: string): string {
  // An SVG <title>/<desc> is plain text for assistive tech and cannot hold elements.
  return markup
    .replace(/<(title|desc)[^>]*>[^<]*<\/\1>/g, '')
    .replace(/<bdi>[^<]*<\/bdi>/g, '')
    .replace(/="[^"]*"/g, '="…"');
}

function expectIsolated(markup: string, name = RTL): void {
  expect(markup).toContain(`<bdi>${name}</bdi>`);
  expect(bare(markup)).not.toContain(name);
}

const noop = () => undefined;
const music: Music = {
  unlock: noop,
  start: noop,
  setLevel: noop,
  stop: noop,
  status: () => 'on',
  toggle: noop,
  subscribe: () => noop,
  preference: () => 'on',
  lastToggleSource: () => null,
};

describe('F7 names render inside <bdi>', () => {
  it('F7 Bdi and withNames add elements only: the text is unchanged', () => {
    expect(renderToStaticMarkup(<Bdi>{RTL}</Bdi>)).toBe(`<bdi>${RTL}</bdi>`);
    const sentence = `${RTL} wins the series 2–1`;
    const out = renderToStaticMarkup(<p>{withNames(sentence, [RTL, OTHER])}</p>);
    expect(out).toBe(`<p><bdi>${RTL}</bdi> wins the series 2–1</p>`);
    expect(out.replace(/<\/?[a-z]+>/g, '')).toBe(sentence);
    expect(renderToStaticMarkup(<p>{withNames('no names here', [RTL])}</p>)).toBe(
      '<p>no names here</p>',
    );
    // Regex characters in a name are just characters.
    expect(renderToStaticMarkup(<p>{withNames('a.b* wins', ['a.b*'])}</p>)).toBe(
      '<p><bdi>a.b*</bdi> wins</p>',
    );
  });

  it('F7 the result card: headline, reason, series bug, chips, stats columns and chart', () => {
    const result = makeGameOver({
      round: 1,
      winner: 'A',
      reason: 'TOP_OUT',
      series: makeSeries({ round: 2, score: { A: 1, B: 0 } }),
      report: { A: makeReport(), B: makeReport() },
    });
    for (const role of ['A', 'B', 'spectator'] as const) {
      const view = deriveResult({
        result,
        role,
        names: { A: RTL, B: OTHER },
        series: result.series,
        status: 'roundOver',
        ready: { A: false, B: false },
        opponentSeated: role === 'spectator' ? null : true,
        opponentConnected: true,
        roundStartTick: 0,
      });
      const markup = renderToStaticMarkup(
        <ResultCard
          view={view}
          reducedMotion={false}
          viewportHeight={600}
          drawBestMoment={noop}
          onPrimary={noop}
          onBack={noop}
        />,
      );
      expectIsolated(markup);
    }
  });

  it('F7 the face-off plates, the player column, the disconnect overlay and the leave confirm', () => {
    expectIsolated(
      renderToStaticMarkup(
        <CountdownOverlay
          rootRef={null}
          numeralRef={null}
          duelRef={null}
          liveRef={null}
          roundLabel="Round 1"
          left={{ name: RTL, won: 0 }}
          right={{ name: OTHER, won: 0 }}
          kind="start"
        />,
      ),
    );
    expectIsolated(
      renderToStaticMarkup(
        <PlayerColumn
          kind="own"
          roleLabel="You"
          name={RTL}
          won={0}
          side={null}
          boardLabel="Your board"
          canvasRef={null}
          nextRef={null}
          bannerRef={null}
          bannerCountRef={null}
          dimmed={false}
        />,
      ),
    );
    expectIsolated(
      renderToStaticMarkup(
        <DisconnectOverlay
          opponent={{ name: RTL, graceEndsAtMs: 20_000, pausesLeft: 2 }}
          spectator={false}
          graceSeconds={20}
        />,
      ),
    );
    expectIsolated(
      renderToStaticMarkup(<LeaveConfirm opponent={RTL} onKeep={noop} onLeave={noop} />),
    );
  });

  it('F7 the lobby: the player list and the series line', () => {
    const room = makeRoom({
      players: { A: { name: RTL, connected: true }, B: { name: OTHER, connected: true } },
    });
    const markup = renderToStaticMarkup(
      <Lobby
        code="K7QM4X"
        role="B"
        room={room}
        names={{ A: RTL, B: OTHER }}
        loadingText={null}
        notice={null}
        error={null}
        origin="https://example.test"
        copyText={() => Promise.resolve()}
        onLeave={noop}
        music={music}
      />,
    );
    expectIsolated(markup);
    expectIsolated(markup, OTHER);
  });
});
