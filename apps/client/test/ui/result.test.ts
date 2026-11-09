import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/ui/copy.ts';
import {
  bestMomentCaption,
  bestMomentTitle,
  deriveResult,
  deriveSeriesEnd,
  type ResultInput,
} from '../../src/ui/result.ts';
import { makeGameOver, makeMoment, makeSeries, makeStats } from './fixtures.ts';

const names = { A: 'Ariel', B: 'Sam' };

function input(overrides: Partial<ResultInput> = {}): ResultInput {
  const result = overrides.result ?? makeGameOver();
  return {
    result,
    role: 'A',
    names,
    series: result.series,
    status: 'roundOver',
    ready: { A: false, B: false },
    opponentSeated: true,
    opponentConnected: true,
    roundStartTick: 0,
    ...overrides,
  };
}

describe('REQ-050 round result card: verdict, reason, series score, both players’ stats', () => {
  it('REQ-050 the winner sees "You win" and why the opponent lost', () => {
    const view = deriveResult(input());
    expect(view.outcome).toBe('win');
    expect(view.headline).toBe(COPY.result.youWin);
    expect(view.reason).toBe('Sam topped out at 04:51');
    expect(view.finalLabel).toBe('Round 1 · Final');
    expect(view.art).toBe('win');
  });

  it('REQ-050 the loser sees "You lose" and their own top-out time', () => {
    const view = deriveResult(input({ role: 'B' }));
    expect(view.outcome).toBe('lose');
    expect(view.headline).toBe(COPY.result.youLose);
    expect(view.reason).toBe('You topped out at 04:51');
    expect(view.art).toBe('arena');
  });

  it('REQ-050 a draw names the replay round', () => {
    const view = deriveResult(input({ result: makeGameOver({ winner: null, reason: 'DRAW' }) }));
    expect(view.headline).toBe(COPY.result.draw);
    expect(view.reason).toBe('You both topped out at 04:51. Round 1 will be replayed.');
  });

  it('REQ-050 forfeits read "left the series" and "didn’t reconnect in time"', () => {
    expect(deriveResult(input({ result: makeGameOver({ reason: 'OPPONENT_LEFT' }) })).reason).toBe(
      'Sam left the series',
    );
    expect(
      deriveResult(input({ result: makeGameOver({ reason: 'OPPONENT_DISCONNECTED' }) })).reason,
    ).toBe("Sam didn't reconnect in time");
  });

  it('REQ-050 the series score puts seat A on the left', () => {
    const view = deriveResult(input({ role: 'B' }));
    expect(view.series).toEqual({ A: { name: 'Ariel', score: 1 }, B: { name: 'Sam', score: 0 } });
  });

  it('REQ-050 both players’ stats: "You" first for a player, seat order for a spectator', () => {
    const player = deriveResult(input({ role: 'B' }));
    expect(player.columns).toEqual(['You', 'Ariel']);
    expect(player.rows.map((r) => r.label)).toEqual([
      'Lines',
      'Garbage sent',
      'Garbage received',
      'Garbage cancelled',
      'Best combo',
      'Pieces',
    ]);
    expect(player.rows[0]?.values).toEqual(['31', '48']);
    expect(player.rows[4]?.values).toEqual(['×3', '×6']);
    const watcher = deriveResult(input({ role: 'spectator' }));
    expect(watcher.columns).toEqual(['Ariel', 'Sam']);
    expect(watcher.headline).toBe('Ariel wins');
    expect(watcher.primary).toBeNull();
    expect(watcher.status).toBe(COPY.result.spectatorWaiting);
  });

  it('REQ-050 Next round: pressed → disabled and waiting; opponent first → still enabled', () => {
    expect(deriveResult(input()).primary).toEqual({ label: 'Next round', disabled: false });
    const pressed = deriveResult(input({ ready: { A: true, B: false } }));
    expect(pressed.primary?.disabled).toBe(true);
    expect(pressed.status).toBe(COPY.result.waitingAccept);
    const theirs = deriveResult(input({ ready: { A: false, B: true } }));
    expect(theirs.primary?.disabled).toBe(false);
    expect(theirs.status).toBe('Sam is ready for the next round');
  });

  it('REQ-050 a finished series offers New series; an opponent who left disables it', () => {
    const over = makeGameOver({
      series: makeSeries({ score: { A: 2, B: 1 }, over: true, winner: 'A', endReason: 'TWO_WINS' }),
    });
    const view = deriveResult(input({ result: over, series: over.series, status: 'seriesOver' }));
    expect(view.primary).toEqual({ label: 'New series', disabled: false });
    const left = deriveResult(
      input({ result: over, series: over.series, status: 'seriesOver', opponentSeated: false }),
    );
    expect(left.primary).toEqual({ label: 'New series', disabled: true });
    expect(left.status).toBe(COPY.result.opponentLeft);
  });

  it('REQ-050 the assertive summary reads as one sentence per part', () => {
    expect(deriveResult(input()).summary).toBe(
      'Round 1 final. You win. Sam topped out at 04:51. Series: Ariel 1, Sam 0.',
    );
  });

  it('REQ-050 a forfeit between rounds still gets a verdict card without a report', () => {
    const view = deriveSeriesEnd({
      series: makeSeries({
        score: { A: 1, B: 0 },
        over: true,
        winner: 'A',
        endReason: 'OPPONENT_LEFT',
      }),
      role: 'A',
      names,
      ready: { A: false, B: false },
      opponentSeated: false,
      opponentConnected: null,
    });
    expect(view.headline).toBe(COPY.result.youWin);
    expect(view.reason).toBe('Sam left the series');
    expect(view.rows).toEqual([]);
    expect(view.primary?.disabled).toBe(true);
  });
});

describe('REQ-051 best moment: own panel, title, caption; hidden when there is none', () => {
  it('REQ-051 a player sees only their own best moment', () => {
    const view = deriveResult(input({ role: 'B' }));
    expect(view.bestMoments).toHaveLength(1);
    expect(view.bestMoments[0]?.seat).toBe('B');
    expect(view.bestMoments[0]?.label).toBe(COPY.result.yourBestMoment);
  });

  it('REQ-051 the panel is hidden when the player cleared no lines', () => {
    const result = makeGameOver({
      stats: { A: makeStats({ bestMoment: null }), B: makeStats() },
    });
    expect(deriveResult(input({ result })).bestMoments).toEqual([]);
  });

  it('REQ-051 spectators see both players’ best moments', () => {
    const view = deriveResult(input({ role: 'spectator' }));
    expect(view.bestMoments.map((m) => m.label)).toEqual([
      "Ariel's best moment",
      "Sam's best moment",
    ]);
  });

  it('REQ-051 the title is "Combo ×N" from ×2, otherwise the clear name', () => {
    expect(bestMomentTitle(makeMoment({ combo: 6 }))).toBe('Combo ×6');
    expect(bestMomentTitle(makeMoment({ combo: 1, linesCleared: 3 }))).toBe('Triple');
    expect(bestMomentTitle(makeMoment({ combo: 1, linesCleared: 4 }))).toBe('Quad');
    expect(bestMomentTitle(makeMoment({ combo: 1, linesCleared: 1 }))).toBe('Single');
  });

  it('REQ-051 the caption lists the clear, rows sent, cancelled only above 0, and the time', () => {
    expect(bestMomentCaption(makeMoment(), 15120)).toBe('Triple · +5 sent · 1 cancelled · 04:12');
    expect(bestMomentCaption(makeMoment({ cancelled: 0, linesCleared: 2, sent: 2 }), 600)).toBe(
      'Double · +2 sent · 00:10',
    );
  });
});
