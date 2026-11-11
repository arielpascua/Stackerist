/**
 * The round result card's content, derived from `gameOver`, the latest `room` and the ready flags
 * (REQ-050, REQ-051; DESIGN.md "Result: round card"). Pure, so every reason line, headline and button
 * state is unit-tested without a DOM.
 */
import { TICK_RATE } from '@stackerist/engine';
import {
  otherSeat,
  type GameOverMessage,
  type PlayerStats,
  type RoomStatus,
  type Seat,
  type SeriesView,
  type WireBestMoment,
} from '@stackerist/protocol';
import type { Role } from '../game/contract.ts';
import { buildChart, type ChartModel } from './chart.ts';
import { COPY } from './copy.ts';
import { formatTicks } from './format.ts';

export interface SeatNames {
  readonly A: string;
  readonly B: string;
}

export type Outcome = 'win' | 'lose' | 'draw' | 'watch';

export interface StatRow {
  readonly label: string;
  readonly values: readonly [string, string];
}

export interface BestMomentView {
  readonly seat: Seat;
  readonly label: string;
  readonly title: string;
  readonly caption: string;
  readonly moment: WireBestMoment;
}

/** One played round on the series card, including a replayed draw (REQ-084). */
export interface RoundChip {
  /** "R1", or the whole "R2 · Draw, replayed" for a draw, "R2 · Forfeit" for a forfeit. */
  readonly label: string;
  /** The winner's name; empty for a draw or a forfeit (a forfeit adds no round win, decision 25). */
  readonly winner: string;
  readonly draw: boolean;
  /** The round ended because a player left or timed out: no round winner is shown. */
  readonly forfeit: boolean;
  /** The chip's accessible name. */
  readonly name: string;
}

export interface ResultView {
  /** The round card, or the series winner screen (REQ-084). */
  readonly kind: 'round' | 'series';
  readonly outcome: Outcome;
  /** Win art for a win (and for spectators of a decided round); the scrimmed arena otherwise. */
  readonly art: 'win' | 'arena';
  /** null on a draw. */
  readonly winner: Seat | null;
  readonly finalLabel: string;
  readonly headline: string;
  readonly reason: string;
  /** Seat A on the left (DESIGN.md series bug). */
  readonly series: {
    readonly A: { readonly name: string; readonly score: number };
    readonly B: { readonly name: string; readonly score: number };
  };
  readonly seriesOver: boolean;
  readonly columns: readonly [string, string];
  readonly rows: readonly StatRow[];
  readonly bestMoments: readonly BestMomentView[];
  /** Series card only: one chip per played round, in order. */
  readonly chips: readonly RoundChip[];
  /** The stack-height chart; null when there is no round report to draw. */
  readonly chart: ChartModel | null;
  /** null for spectators (Back to home only). */
  readonly primary: { readonly label: string; readonly disabled: boolean } | null;
  readonly status: string;
  /** The assertive announcement, read once. */
  readonly summary: string;
}

export interface ResultInput {
  readonly result: GameOverMessage;
  readonly role: Role;
  readonly names: SeatNames;
  /** The latest `room` series, which can be newer than `result.series` (a forfeit after the round). */
  readonly series: SeriesView | null;
  readonly status: RoomStatus | null;
  readonly ready: { readonly A: boolean; readonly B: boolean };
  /** The opponent still holds a seat (null for spectators). */
  readonly opponentSeated: boolean | null;
  readonly opponentConnected: boolean | null;
  readonly roundStartTick: number | null;
}

/** Ticks from the round's first tick to `tick`; falls back to the report's duration. */
function roundTicks(input: ResultInput, tick: number): number {
  if (input.roundStartTick !== null) return Math.max(0, tick - input.roundStartTick);
  const report = input.result.report;
  return Math.max(report.A?.durationTicks ?? 0, report.B?.durationTicks ?? 0);
}

function reasonLine(input: ResultInput): string {
  const { result, role, names } = input;
  const time = formatTicks(roundTicks(input, result.tick));
  if (result.winner === null) {
    return role === 'spectator'
      ? COPY.result.bothPlayersToppedOut(time, result.round)
      : COPY.result.bothToppedOut(time, result.round);
  }
  const loser = otherSeat(result.winner);
  switch (result.reason) {
    case 'TOP_OUT':
    case 'DRAW':
      return role === loser
        ? COPY.result.youToppedOut(time)
        : COPY.result.toppedOut(names[loser], time);
    case 'OPPONENT_LEFT':
      return COPY.result.left(names[loser]);
    case 'OPPONENT_DISCONNECTED':
      return COPY.result.didntReconnect(names[loser]);
  }
}

function outcomeOf(result: GameOverMessage, role: Role): Outcome {
  if (role === 'spectator') return 'watch';
  if (result.winner === null) return 'draw';
  return result.winner === role ? 'win' : 'lose';
}

function headlineOf(outcome: Outcome, result: GameOverMessage, names: SeatNames): string {
  switch (outcome) {
    case 'win':
      return COPY.result.youWin;
    case 'lose':
      return COPY.result.youLose;
    case 'draw':
      return COPY.result.draw;
    case 'watch':
      return result.winner === null ? COPY.result.draw : COPY.result.wins(names[result.winner]);
  }
}

/** "Combo ×N" for a combo of 2 or more, otherwise the clear's name ("Single" … "Quad"). */
export function bestMomentTitle(moment: WireBestMoment): string {
  return moment.combo >= 2 ? COPY.combo.title(moment.combo) : clearName(moment.linesCleared);
}

export function clearName(lines: number): string {
  const names = COPY.result.clearNames;
  return names[Math.min(names.length, Math.max(1, lines)) - 1] ?? names[0];
}

/** "Triple · +5 sent · 1 cancelled · 04:12" ("sent" and "cancelled" only when above 0). */
export function bestMomentCaption(moment: WireBestMoment, roundTick: number): string {
  const parts = [clearName(moment.linesCleared)];
  if (moment.sent > 0) parts.push(COPY.combo.sent(moment.sent));
  if (moment.cancelled > 0) parts.push(COPY.combo.cancelled(moment.cancelled));
  parts.push(formatTicks(roundTick));
  return parts.join(' · ');
}

/** Under one second of play a per-second rate means nothing: show a dash (and never divide by 0). */
function playedSeconds(durationTicks: number): number | null {
  return durationTicks >= TICK_RATE ? durationTicks / TICK_RATE : null;
}

/** PPS = piecesPlaced ÷ (durationTicks ÷ 60), two decimals (REQ-091). */
export function piecesPerSecond(piecesPlaced: number, durationTicks: number): string {
  const seconds = playedSeconds(durationTicks);
  return seconds === null ? COPY.result.noValue : (piecesPlaced / seconds).toFixed(2);
}

/** APM = actions × 60 ÷ (durationTicks ÷ 60), an integer (REQ-091). */
export function actionsPerMinute(actions: number, durationTicks: number): string {
  const seconds = playedSeconds(durationTicks);
  return seconds === null ? COPY.result.noValue : String(Math.round((actions * 60) / seconds));
}

function statValues(
  stats: GameOverMessage['stats'],
  report: GameOverMessage['report'],
  seat: Seat,
): readonly string[] {
  const s: PlayerStats | undefined = stats[seat];
  const r = report[seat];
  const none = COPY.result.noValue;
  const num = (n: number | undefined) => (n === undefined ? none : String(n));
  return [
    num(s?.linesCleared),
    num(s?.garbageSent),
    num(r?.garbageReceived),
    num(s?.garbageCancelled),
    s === undefined ? none : COPY.result.bestComboValue(s.bestCombo),
    r === undefined ? none : piecesPerSecond(r.piecesPlaced, r.durationTicks),
    r === undefined ? none : actionsPerMinute(r.actions, r.durationTicks),
  ];
}

const ROW_LABELS = [
  COPY.result.rows.lines,
  COPY.result.rows.garbageSent,
  COPY.result.rows.garbageReceived,
  COPY.result.rows.garbageCancelled,
  COPY.result.rows.bestCombo,
  COPY.result.rows.piecesPerSecond,
  COPY.result.rows.actionsPerMinute,
] as const;

type StatusInput = Pick<
  ResultInput,
  'role' | 'names' | 'ready' | 'opponentSeated' | 'opponentConnected'
>;

function statusLine(input: StatusInput, seriesOver: boolean, opponent: Seat | null): string {
  if (input.role === 'spectator' || opponent === null) return COPY.result.spectatorWaiting;
  const me = input.role;
  if (input.opponentSeated === false) return COPY.result.opponentLeft;
  if (input.ready[me]) return COPY.result.waitingAccept;
  const oppName = input.names[opponent];
  if (input.ready[opponent]) {
    return seriesOver
      ? COPY.result.opponentWantsSeries(oppName)
      : COPY.result.opponentReady(oppName);
  }
  if (input.opponentConnected === false) return COPY.result.opponentReconnecting(oppName);
  return '';
}

/** Next round / New series: pressing it, or an opponent who left, disables it (REQ-059). */
function primaryButton(
  input: StatusInput,
  seriesOver: boolean,
): { readonly label: string; readonly disabled: boolean } | null {
  if (input.role === 'spectator') return null;
  return {
    label: seriesOver ? COPY.result.newSeries : COPY.result.nextRound,
    disabled: input.ready[input.role] || input.opponentSeated === false,
  };
}

/** Which seats topped out this round: the loser of a top-out, both on a draw, nobody on a forfeit. */
function toppedOutSeats(result: GameOverMessage): { readonly A: boolean; readonly B: boolean } {
  if (result.reason !== 'TOP_OUT' && result.reason !== 'DRAW') return { A: false, B: false };
  if (result.winner === null) return { A: true, B: true };
  return { A: result.winner === 'B', B: result.winner === 'A' };
}

/** The stack-height chart for a round report (REQ-091). Players: you (amber) then the opponent. */
function chartFor(
  result: GameOverMessage,
  role: Role,
  names: SeatNames,
  order: readonly [Seat, Seat],
): ChartModel {
  const topped = toppedOutSeats(result);
  const durationTicks = Math.max(
    result.report.A?.durationTicks ?? 0,
    result.report.B?.durationTicks ?? 0,
  );
  const nameOf = (seat: Seat, first: boolean): string =>
    role === 'spectator' || !first ? names[seat] : COPY.result.chart.you;
  return buildChart({
    round: result.round,
    durationTicks,
    series: order.map((seat, index) => ({
      key: index === 0 ? ('you' as const) : ('opp' as const),
      name: nameOf(seat, index === 0),
      samples: result.report[seat]?.heightSamples ?? [],
      toppedOut: topped[seat],
    })),
  });
}

function chipsOf(series: SeriesView, names: SeatNames): readonly RoundChip[] {
  return series.rounds.map((round): RoundChip => {
    if (round.reason === 'OPPONENT_LEFT' || round.reason === 'OPPONENT_DISCONNECTED') {
      return {
        label: COPY.result.series.chipForfeit(round.round),
        winner: '',
        draw: false,
        forfeit: true,
        name: COPY.result.series.chipForfeitName(round.round),
      };
    }
    if (round.winner === null) {
      return {
        label: COPY.result.series.chipDraw(round.round),
        winner: '',
        draw: true,
        forfeit: false,
        name: COPY.result.series.chipDrawName(round.round),
      };
    }
    return {
      label: COPY.result.series.chipRound(round.round),
      winner: names[round.winner],
      draw: false,
      forfeit: false,
      name: COPY.result.series.chipName(round.round, names[round.winner]),
    };
  });
}

function seriesReason(series: SeriesView, winner: Seat, role: Role, names: SeatNames): string {
  const loser = otherSeat(winner);
  const won = series.score[winner];
  const lost = series.score[loser];
  const text = COPY.result.series;
  switch (series.endReason) {
    case 'OPPONENT_LEFT':
      if (role === winner) return text.opponentLeftYours(names[loser]);
      return role === loser ? text.youLeft(names[winner]) : text.leftSpectator(names[loser]);
    case 'OPPONENT_DISCONNECTED':
      if (role === winner) return text.opponentDisconnectedYours(names[loser]);
      return role === loser
        ? text.youDisconnected(names[winner])
        : COPY.result.didntReconnect(names[loser]);
    case 'TWO_WINS':
    case null:
      return role === winner
        ? text.youWonRounds(won, lost)
        : text.theyWonRounds(names[winner], won, lost);
  }
}

interface SeriesVerdict {
  readonly outcome: Outcome;
  readonly art: 'win' | 'arena';
  readonly finalLabel: string;
  readonly headline: string;
  readonly reason: string;
  readonly chips: readonly RoundChip[];
}

/** The series winner screen's verdict (REQ-084): headline, reason and the round chips. */
function seriesVerdict(
  series: SeriesView,
  role: Role,
  names: SeatNames,
  winner: Seat,
): SeriesVerdict {
  const outcome: Outcome = role === 'spectator' ? 'watch' : role === winner ? 'win' : 'lose';
  // A forfeit has no meaningful round score to announce; the series bug still shows it.
  const score =
    series.endReason === 'TWO_WINS'
      ? { won: series.score[winner], lost: series.score[otherSeat(winner)] }
      : null;
  return {
    outcome,
    art: outcome === 'lose' ? 'arena' : 'win',
    finalLabel: COPY.result.series.final,
    headline: COPY.result.series.headline(names[winner], score),
    reason: seriesReason(series, winner, role, names),
    chips: chipsOf(series, names),
  };
}

function seriesBug(series: SeriesView, names: SeatNames): ResultView['series'] {
  return {
    A: { name: names.A, score: series.score.A },
    B: { name: names.B, score: series.score.B },
  };
}

export function deriveResult(input: ResultInput): ResultView {
  const { result, role, names } = input;
  const series = input.series ?? result.series;
  const seriesOver = series.over || input.status === 'seriesOver';
  const verdict =
    seriesOver && series.winner !== null ? seriesVerdict(series, role, names, series.winner) : null;
  const opponent = role === 'spectator' ? null : otherSeat(role);
  const order: readonly [Seat, Seat] = role === 'spectator' ? ['A', 'B'] : [role, otherSeat(role)];
  const columns: readonly [string, string] =
    role === 'spectator' ? [names.A, names.B] : [COPY.result.you, names[order[1]]];
  const left = statValues(result.stats, result.report, order[0]);
  const right = statValues(result.stats, result.report, order[1]);
  const rows = ROW_LABELS.map((label, i): StatRow => ({
    label,
    values: [left[i] ?? COPY.result.noValue, right[i] ?? COPY.result.noValue],
  }));

  const momentSeats: readonly Seat[] = role === 'spectator' ? ['A', 'B'] : [role];
  const bestMoments = momentSeats.flatMap((seat): BestMomentView[] => {
    const moment = result.stats[seat]?.bestMoment ?? null;
    if (moment === null) return [];
    return [
      {
        seat,
        label:
          role === 'spectator' ? COPY.result.bestMomentOf(names[seat]) : COPY.result.yourBestMoment,
        title: bestMomentTitle(moment),
        caption: bestMomentCaption(moment, roundTicks(input, moment.tick)),
        moment,
      },
    ];
  });

  const outcome = verdict?.outcome ?? outcomeOf(result, role);
  const headline = verdict?.headline ?? headlineOf(outcome, result, names);
  const reason = verdict?.reason ?? reasonLine(input);
  const finalLabel = verdict?.finalLabel ?? COPY.result.final(result.round, result.replay);
  const summary = COPY.result.summary([
    verdict === null ? COPY.result.finalSpoken(result.round, result.replay) : finalLabel,
    headline,
    reason,
    COPY.result.seriesScoreName(names.A, series.score.A, series.score.B, names.B),
  ]);

  return {
    kind: verdict === null ? 'round' : 'series',
    outcome,
    art:
      verdict?.art ??
      (outcome === 'win' || (outcome === 'watch' && result.winner !== null) ? 'win' : 'arena'),
    winner: verdict === null ? result.winner : series.winner,
    finalLabel,
    headline,
    reason,
    series: seriesBug(series, names),
    seriesOver,
    columns,
    rows,
    bestMoments,
    chips: verdict?.chips ?? [],
    chart: chartFor(result, role, names, order),
    primary: primaryButton(input, seriesOver),
    status: statusLine(input, seriesOver, opponent),
    summary,
  };
}

export interface SeriesEndInput {
  readonly series: SeriesView;
  readonly role: Role;
  readonly names: SeatNames;
  readonly ready: { readonly A: boolean; readonly B: boolean };
  readonly opponentSeated: boolean | null;
  readonly opponentConnected: boolean | null;
}

/**
 * A series that ended with no round report to show (a forfeit mid-round whose `gameOver` never
 * arrived): the series winner screen with only the verdict, the score, the round chips and the
 * actions. The body (table, chart, best moment) is hidden (REQ-084).
 */
export function deriveSeriesEnd(input: SeriesEndInput): ResultView {
  const { series, role, names } = input;
  const verdict = seriesVerdict(series, role, names, series.winner ?? 'A');
  const opponent = role === 'spectator' ? null : otherSeat(role);
  return {
    kind: 'series',
    outcome: verdict.outcome,
    art: verdict.art,
    winner: series.winner,
    finalLabel: verdict.finalLabel,
    headline: verdict.headline,
    reason: verdict.reason,
    series: seriesBug(series, names),
    seriesOver: true,
    columns: [COPY.result.you, ''],
    rows: [],
    bestMoments: [],
    chips: verdict.chips,
    chart: null,
    primary: primaryButton(input, true),
    status: statusLine(input, true, opponent),
    summary: COPY.result.summary([
      verdict.finalLabel,
      verdict.headline,
      verdict.reason,
      COPY.result.seriesScoreName(names.A, series.score.A, series.score.B, names.B),
    ]),
  };
}
