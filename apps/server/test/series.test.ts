import { SeriesViewSchema } from '@stackerist/protocol';
import { describe, expect, it } from 'vitest';
import {
  applyForfeit,
  applyRoundResult,
  newSeries,
  nextRound,
  toSeriesView,
  type SeriesState,
} from '../src/series.js';

function win(s: SeriesState, winner: 'A' | 'B', durationTicks = 600): SeriesState {
  return applyRoundResult(s, { winner, reason: 'TOP_OUT', durationTicks });
}

describe('series bookkeeping (architecture §4.5)', () => {
  it('REQ-083 a new series starts at round 1, 0–0, not over', () => {
    const s = newSeries();
    expect(s).toEqual({
      round: 1,
      replay: false,
      score: { A: 0, B: 0 },
      over: false,
      winner: null,
      endReason: null,
      rounds: [],
    });
    expect(SeriesViewSchema.safeParse(toSeriesView(s)).success).toBe(true);
  });

  it('REQ-083 REQ-092 two round wins end the series with TWO_WINS', () => {
    let s = win(newSeries(), 'A');
    expect(s.over).toBe(false);
    expect(s.score).toEqual({ A: 1, B: 0 });
    s = nextRound(s);
    expect(s.round).toBe(2);
    s = win(s, 'B');
    expect(s.score).toEqual({ A: 1, B: 1 });
    s = nextRound(s);
    expect(s.round).toBe(3);
    s = win(s, 'B', 1234);
    expect(s.over).toBe(true);
    expect(s.winner).toBe('B');
    expect(s.endReason).toBe('TWO_WINS');
    expect(s.score).toEqual({ A: 1, B: 2 });
    expect(s.rounds.map((r) => [r.round, r.winner])).toEqual([
      [1, 'A'],
      [2, 'B'],
      [3, 'B'],
    ]);
    expect(s.rounds[2]?.durationTicks).toBe(1234);
    expect(SeriesViewSchema.safeParse(toSeriesView(s)).success).toBe(true);
  });

  it('REQ-083 REQ-092 a 2–0 sweep ends after round 2', () => {
    const s = win(nextRound(win(newSeries(), 'A')), 'A');
    expect(s.over).toBe(true);
    expect(s.round).toBe(2);
    expect(s.winner).toBe('A');
  });

  it('REQ-083 REQ-092 a drawn round is replayed with the same number and counts for nobody', () => {
    let s = applyRoundResult(newSeries(), { winner: null, reason: 'DRAW', durationTicks: 90 });
    expect(s.score).toEqual({ A: 0, B: 0 });
    expect(s.over).toBe(false);
    expect(s.rounds).toEqual([
      { round: 1, replay: false, winner: null, reason: 'DRAW', durationTicks: 90 },
    ]);
    s = nextRound(s);
    expect(s.round).toBe(1);
    expect(s.replay).toBe(true);
    s = win(s, 'B');
    expect(s.rounds[1]).toMatchObject({ round: 1, replay: true, winner: 'B' });
    s = nextRound(s);
    expect(s.round).toBe(2);
    expect(s.replay).toBe(false);
  });

  it('REQ-092 a forfeit mid-round ends the series without adding a win and records the round', () => {
    const s = applyForfeit(win(newSeries(), 'B'), 'B', 'OPPONENT_LEFT', 321);
    expect(s.over).toBe(true);
    expect(s.winner).toBe('A');
    expect(s.endReason).toBe('OPPONENT_LEFT');
    expect(s.score).toEqual({ A: 0, B: 1 });
    expect(s.rounds.at(-1)).toEqual({
      round: 1,
      replay: false,
      winner: 'A',
      reason: 'OPPONENT_LEFT',
      durationTicks: 321,
    });
    expect(SeriesViewSchema.safeParse(toSeriesView(s)).success).toBe(true);
  });

  it('REQ-092 a forfeit between rounds appends no RoundSummary (gap ruling G1)', () => {
    const before = nextRound(win(newSeries(), 'A'));
    const s = applyForfeit(before, 'A', 'OPPONENT_DISCONNECTED', null);
    expect(s.over).toBe(true);
    expect(s.winner).toBe('B');
    expect(s.endReason).toBe('OPPONENT_DISCONNECTED');
    expect(s.rounds).toHaveLength(1);
  });

  it('REQ-092 terminal states are gated: no result, forfeit or next round after the series is over', () => {
    const over = applyForfeit(newSeries(), 'A', 'OPPONENT_LEFT', null);
    expect(() => win(over, 'B')).toThrow(RangeError);
    expect(() => applyForfeit(over, 'B', 'OPPONENT_LEFT', null)).toThrow(RangeError);
    expect(() => nextRound(over)).toThrow(RangeError);
  });

  it('REQ-092 inputs are never mutated and the view is a copy', () => {
    const s = Object.freeze(newSeries());
    const after = win(s, 'A');
    expect(s.score).toEqual({ A: 0, B: 0 });
    const view = toSeriesView(after);
    expect(view.rounds).not.toBe(after.rounds);
    expect(view.score).not.toBe(after.score);
  });
});
