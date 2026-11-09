/**
 * Best-of-3 series bookkeeping (architecture §4.5, design §5.6). Pure: every function returns a new
 * state and never mutates its input. Terminal states are gated: once `over`, no result, forfeit or
 * next round may be applied (a RangeError surfaces the bug instead of silently resuming a series).
 */
import {
  MAX_ROUND_SUMMARIES,
  SERIES_WINS_NEEDED,
  type GameOverReason,
  type RoundSummary,
  type Seat,
  type SeriesEndReason,
  type SeriesView,
} from '@stackerist/protocol';

export interface SeriesState {
  readonly round: number;
  readonly replay: boolean;
  readonly score: { readonly A: number; readonly B: number };
  readonly over: boolean;
  readonly winner: Seat | null;
  readonly endReason: SeriesEndReason | null;
  readonly rounds: readonly RoundSummary[];
}

export type ForfeitReason = 'OPPONENT_LEFT' | 'OPPONENT_DISCONNECTED';

export function otherSeat(seat: Seat): Seat {
  return seat === 'A' ? 'B' : 'A';
}

/** Round 1, 0–0. */
export function newSeries(): SeriesState {
  return {
    round: 1,
    replay: false,
    score: { A: 0, B: 0 },
    over: false,
    winner: null,
    endReason: null,
    rounds: [],
  };
}

function assertLive(s: SeriesState, what: string): void {
  if (s.over) throw new RangeError(`${what} on a series that is already over`);
}

function appendRound(rounds: readonly RoundSummary[], summary: RoundSummary): RoundSummary[] {
  return [...rounds, summary].slice(-MAX_ROUND_SUMMARIES);
}

/** A played round: a win adds to the score (two wins end the series); a draw counts for nobody. */
export function applyRoundResult(
  s: SeriesState,
  r: {
    readonly winner: Seat | null;
    readonly reason: GameOverReason;
    readonly durationTicks: number;
  },
): SeriesState {
  assertLive(s, 'applyRoundResult');
  const rounds = appendRound(s.rounds, {
    round: s.round,
    replay: s.replay,
    winner: r.winner,
    reason: r.reason,
    durationTicks: r.durationTicks,
  });
  if (r.winner === null) return { ...s, rounds };
  const score = { ...s.score, [r.winner]: s.score[r.winner] + 1 };
  const over = score[r.winner] >= SERIES_WINS_NEEDED;
  return {
    ...s,
    score,
    rounds,
    over,
    winner: over ? r.winner : null,
    endReason: over ? 'TWO_WINS' : null,
  };
}

/**
 * The whole series goes to the opponent without adding a round win (decision 25). `durationTicks` is
 * the forfeited round's length, or null when no round was in progress (gap ruling G1: nothing appended).
 */
export function applyForfeit(
  s: SeriesState,
  forfeiter: Seat,
  reason: ForfeitReason,
  durationTicks: number | null,
): SeriesState {
  assertLive(s, 'applyForfeit');
  const winner = otherSeat(forfeiter);
  const rounds =
    durationTicks === null
      ? s.rounds
      : appendRound(s.rounds, { round: s.round, replay: s.replay, winner, reason, durationTicks });
  return { ...s, rounds, over: true, winner, endReason: reason };
}

/** After a draw: the same round number with replay = true. Otherwise round + 1, replay = false. */
export function nextRound(s: SeriesState): SeriesState {
  assertLive(s, 'nextRound');
  const last = s.rounds.at(-1);
  if (last?.reason === 'DRAW') return { ...s, replay: true };
  return { ...s, round: s.round + 1, replay: false };
}

export function toSeriesView(s: SeriesState): SeriesView {
  return {
    round: s.round,
    replay: s.replay,
    score: { A: s.score.A, B: s.score.B },
    over: s.over,
    winner: s.winner,
    endReason: s.endReason,
    rounds: s.rounds.map((r) => ({ ...r })),
  };
}
