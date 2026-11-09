import { WATCH_QUERY_PARAM, type GameOverMessage } from '@stackerist/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/ui/copy.ts';
import { presentError } from '../../src/ui/errors.ts';
import { deriveResult, deriveSeriesEnd, type ResultInput } from '../../src/ui/result.ts';
import { roomPath } from '../../src/ui/router.ts';
import { ResultCard } from '../../src/ui/screens/ResultCard.tsx';
import { TEST_IDS } from '../../src/ui/testIds.ts';
import { makeGameOver, makeReport, makeSeries } from './fixtures.ts';

const names = { A: 'Ariel', B: 'Sam' };

/** Ariel won round 1, Sam won round 2, a draw was replayed, then Ariel took round 2 again: 2–1. */
function decided(overrides: Partial<GameOverMessage> = {}): GameOverMessage {
  return makeGameOver({
    round: 3,
    series: makeSeries({
      round: 3,
      score: { A: 2, B: 1 },
      over: true,
      winner: 'A',
      endReason: 'TWO_WINS',
      rounds: [
        { round: 1, replay: false, winner: 'A', reason: 'TOP_OUT', durationTicks: 9000 },
        { round: 2, replay: false, winner: null, reason: 'DRAW', durationTicks: 4000 },
        { round: 2, replay: true, winner: 'B', reason: 'TOP_OUT', durationTicks: 7000 },
        { round: 3, replay: false, winner: 'A', reason: 'TOP_OUT', durationTicks: 17460 },
      ],
    }),
    ...overrides,
  });
}

function input(overrides: Partial<ResultInput> = {}): ResultInput {
  const result = overrides.result ?? decided();
  return {
    result,
    role: 'A',
    names,
    series: result.series,
    status: 'seriesOver',
    ready: { A: false, B: false },
    opponentSeated: true,
    opponentConnected: true,
    roundStartTick: 0,
    ...overrides,
  };
}

function render(view: ReturnType<typeof deriveResult>): string {
  return renderToStaticMarkup(
    <ResultCard
      view={view}
      reducedMotion={false}
      viewportHeight={600}
      drawBestMoment={() => undefined}
      onPrimary={() => undefined}
      onBack={() => undefined}
    />,
  );
}

describe('REQ-084 series winner screen: "ARIEL WINS THE SERIES 2–1", per-round summary, New series', () => {
  it('REQ-084 the headline names the series winner with the winner’s rounds first', () => {
    const view = deriveResult(input());
    expect(view.kind).toBe('series');
    expect(view.finalLabel).toBe('Series final');
    expect(view.headline).toBe('Ariel wins the series 2–1');
    expect(deriveResult(input({ role: 'B' })).headline).toBe('Ariel wins the series 2–1');
  });

  it('REQ-084 the reason line is "You won 2 rounds to 1." or "Sam won 2 rounds to 1."', () => {
    expect(deriveResult(input()).reason).toBe('You won 2 rounds to 1.');
    expect(deriveResult(input({ role: 'B' })).reason).toBe('Ariel won 2 rounds to 1.');
    expect(deriveResult(input({ role: 'spectator', opponentSeated: null })).reason).toBe(
      'Ariel won 2 rounds to 1.',
    );
  });

  it('REQ-084 a forfeit says who left, and why the series is yours', () => {
    const left = makeGameOver({
      reason: 'OPPONENT_LEFT',
      series: makeSeries({
        round: 2,
        score: { A: 1, B: 0 },
        over: true,
        winner: 'A',
        endReason: 'OPPONENT_LEFT',
      }),
    });
    const winner = deriveResult(input({ result: left, opponentSeated: false }));
    expect(winner.headline).toBe('Ariel wins the series');
    expect(winner.reason).toBe('Sam left, so the series is yours.');
    const dropped = makeGameOver({
      reason: 'OPPONENT_DISCONNECTED',
      series: makeSeries({
        score: { A: 1, B: 0 },
        over: true,
        winner: 'A',
        endReason: 'OPPONENT_DISCONNECTED',
      }),
    });
    expect(deriveResult(input({ result: dropped })).reason).toBe(
      "Sam didn't reconnect in time, so the series is yours.",
    );
    expect(deriveResult(input({ result: dropped, role: 'B' })).reason).toBe(
      "You didn't reconnect in time, so Ariel won.",
    );
  });

  it('REQ-084 one chip per played round, a replayed draw included', () => {
    const view = deriveResult(input());
    expect(view.chips.map((chip) => chip.label)).toEqual(['R1', 'R2 · Draw, replayed', 'R2', 'R3']);
    expect(view.chips.map((chip) => chip.winner)).toEqual(['Ariel', '', 'Sam', 'Ariel']);
    expect(view.chips.map((chip) => chip.draw)).toEqual([false, true, false, false]);
    const html = render(view);
    expect(html.match(new RegExp(`data-testid="${TEST_IDS.result.chip}"`, 'g'))?.length).toBe(4);
    expect(html).toContain('Round 2, a draw that was replayed');
  });

  it('REQ-084 the series card ends in New series and Back to home; the winner gets win art', () => {
    const view = deriveResult(input());
    expect(view.primary).toEqual({ label: 'New series', disabled: false });
    expect(view.art).toBe('win');
    expect(deriveResult(input({ role: 'B' })).art).toBe('arena');
    expect(deriveResult(input({ role: 'spectator', opponentSeated: null })).art).toBe('win');
    const html = render(view);
    expect(html).toContain('New series');
    expect(html).toContain('Back to home');
    expect(html).toContain('data-kind="series"');
  });

  it('REQ-084 the body is the deciding round’s report: table, chart and best moment', () => {
    const html = render(deriveResult(input()));
    expect(html).toContain(TEST_IDS.result.statsTable);
    expect(html).toContain(TEST_IDS.result.chart);
    expect(html).toContain(TEST_IDS.result.bestMoment);
  });

  it('REQ-084 a forfeit mid-round with no report hides the body', () => {
    const view = deriveSeriesEnd({
      series: makeSeries({
        round: 2,
        score: { A: 1, B: 0 },
        over: true,
        winner: 'A',
        endReason: 'OPPONENT_LEFT',
        rounds: [{ round: 1, replay: false, winner: 'A', reason: 'TOP_OUT', durationTicks: 9000 }],
      }),
      role: 'A',
      names,
      ready: { A: false, B: false },
      opponentSeated: false,
      opponentConnected: null,
    });
    expect(view.kind).toBe('series');
    expect(view.chart).toBeNull();
    expect(view.rows).toEqual([]);
    expect(view.chips.map((chip) => chip.label)).toEqual(['R1']);
    const html = render(view);
    expect(html).not.toContain(TEST_IDS.result.statsTable);
    expect(html).not.toContain(TEST_IDS.result.chart);
    expect(html).toContain('Sam left, so the series is yours.');
  });

  it('REQ-084 the assertive summary reads the verdict once', () => {
    expect(deriveResult(input()).summary).toBe(
      'Series final. Ariel wins the series 2–1. You won 2 rounds to 1. Series: Ariel 2, Sam 1.',
    );
  });

  it('REQ-044 a name is text on the series card, never markup', () => {
    const evil = { A: '<img src=x onerror=alert(1)>', B: 'Sam' };
    const html = render(deriveResult(input({ names: evil })));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('REQ-085 round number and series score on every screen that lists them', () => {
  it('REQ-085 the round card shows the round, and the series score with seat A on the left', () => {
    const result = makeGameOver();
    const view = deriveResult(input({ result, status: 'roundOver', series: result.series }));
    expect(view.finalLabel).toBe('Round 1 · Final');
    expect(view.series).toEqual({ A: { name: 'Ariel', score: 1 }, B: { name: 'Sam', score: 0 } });
    const html = render(view);
    expect(html).toContain('Round 1 · Final');
    expect(html).toContain('Ariel');
    expect(html).toContain('1 – 0');
  });

  it('REQ-085 a replayed draw reads "Round 2 · Replay · Final"', () => {
    const result = makeGameOver({ round: 2, replay: true });
    const view = deriveResult(input({ result, status: 'roundOver', series: result.series }));
    expect(view.finalLabel).toBe('Round 2 · Replay · Final');
  });

  it('REQ-085 the series card shows the final score for both seats', () => {
    const html = render(deriveResult(input()));
    expect(html).toContain('2 – 1');
  });

  it('REQ-085 the HUD round tag, the lobby series line and the standoff tag all use one wording', () => {
    expect(COPY.game.roundTag(2)).toBe('Round 2');
    expect(COPY.game.roundTagReplay(2)).toBe('Round 2 · Replay');
    expect(COPY.lobby.seriesLine(2, 'Ariel', 1, 0, 'Sam')).toBe('Round 2 · Ariel 1 – 0 Sam');
    expect(COPY.game.pipsName('Ariel', 1)).toBe('Ariel, 1 round won');
  });
});

describe('REQ-059 Next round and New series: waiting, ready and left states', () => {
  function round(overrides: Partial<ResultInput>): ReturnType<typeof deriveResult> {
    const result = makeGameOver();
    return deriveResult(
      input({ result, series: result.series, status: 'roundOver', ...overrides }),
    );
  }

  it('REQ-059 pressing Next round disables it and says "Waiting for opponent to accept…"', () => {
    const view = round({ ready: { A: true, B: false } });
    expect(view.primary).toEqual({ label: 'Next round', disabled: true });
    expect(view.status).toBe('Waiting for opponent to accept…');
    expect(render(view)).toContain('Waiting for opponent to accept…');
  });

  it('REQ-059 an opponent who is ready first leaves the button enabled and says so', () => {
    const view = round({ ready: { A: false, B: true } });
    expect(view.primary?.disabled).toBe(false);
    expect(view.status).toBe('Sam is ready for the next round');
  });

  it('REQ-059 an opponent who left disables Next round and says "Opponent left"', () => {
    const view = round({ opponentSeated: false });
    expect(view.primary).toEqual({ label: 'Next round', disabled: true });
    expect(view.status).toBe('Opponent left');
    expect(render(view)).toContain('disabled=""');
  });

  it('REQ-059 on the series card: New series, "Sam wants a new series", and "Opponent left" disabled', () => {
    expect(deriveResult(input({ ready: { A: true, B: false } })).status).toBe(
      'Waiting for opponent to accept…',
    );
    const theirs = deriveResult(input({ ready: { A: false, B: true } }));
    expect(theirs.status).toBe('Sam wants a new series');
    expect(theirs.primary).toEqual({ label: 'New series', disabled: false });
    const left = deriveResult(input({ opponentSeated: false }));
    expect(left.status).toBe('Opponent left');
    expect(left.primary).toEqual({ label: 'New series', disabled: true });
  });

  it('REQ-059 spectators get only Back to home, "Waiting for the next round"', () => {
    const view = round({ role: 'spectator', opponentSeated: null });
    expect(view.primary).toBeNull();
    expect(view.status).toBe('Waiting for the next round');
    expect(render(view)).not.toContain(TEST_IDS.result.primaryButton);
  });
});

describe('REQ-062 spectator view: read-only boards with names, the count, ?watch=1, room-full copy', () => {
  it('REQ-062 a watch link carries ?watch=1 and a player’s link does not', () => {
    expect(roomPath('K7QM4X', true)).toBe(`/g/K7QM4X?${WATCH_QUERY_PARAM}=1`);
    expect(roomPath('K7QM4X', false)).toBe('/g/K7QM4X');
  });

  it('REQ-062 a full room says why, with the recovery, and a spectator who is bumped is told', () => {
    const context = { intent: 'join' as const, roomCode: 'K7QM4X' };
    expect(presentError('ROOM_FULL', context).text).toBe(COPY.errors.roomFull);
    expect(COPY.errors.roomFull).toContain('eight spectators');
    expect(COPY.errors.roomFull).toContain('Ask for a new game code');
    expect(COPY.errors.joinedAsSpectator).toBe(
      "That game already has two players, so you're watching.",
    );
  });

  it('REQ-062 players see how many are watching', () => {
    expect(COPY.game.watching(1)).toBe('1 watching');
    expect(COPY.game.watching(8)).toBe('8 watching');
  });

  it('REQ-062 a spectator’s result card shows both players’ names, stats and best moments', () => {
    const result = makeGameOver({
      report: { A: makeReport(), B: makeReport({ heightSamples: [0, 3] }) },
    });
    const view = deriveResult(
      input({
        result,
        series: result.series,
        status: 'roundOver',
        role: 'spectator',
        opponentSeated: null,
      }),
    );
    expect(view.columns).toEqual(['Ariel', 'Sam']);
    expect(view.headline).toBe('Ariel wins');
    expect(view.bestMoments.map((moment) => moment.label)).toEqual([
      "Ariel's best moment",
      "Sam's best moment",
    ]);
    const html = render(view);
    expect(html.match(new RegExp(TEST_IDS.result.bestMomentCanvas, 'g'))?.length).toBe(2);
    expect(html).toContain('data-outcome="watch"');
  });
});
