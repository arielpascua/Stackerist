/**
 * The round result card's content, derived from `gameOver`, the latest `room` and the ready flags
 * (REQ-050, REQ-051; DESIGN.md "Result: round card"). Pure, so every reason line, headline and button
 * state is unit-tested without a DOM.
 */
import type {
  GameOverMessage,
  PlayerStats,
  RoomStatus,
  Seat,
  SeriesView,
  WireBestMoment,
} from '@stackerist/protocol';
import type { Role } from '../game/contract.ts';
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

export interface ResultView {
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

export function otherSeat(seat: Seat): Seat {
  return seat === 'A' ? 'B' : 'A';
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

/** "Triple · +5 sent · 1 cancelled · 04:12" (cancelled only when above 0). */
export function bestMomentCaption(moment: WireBestMoment, roundTick: number): string {
  const parts = [clearName(moment.linesCleared), COPY.combo.sent(moment.sent)];
  if (moment.cancelled > 0) parts.push(COPY.combo.cancelled(moment.cancelled));
  parts.push(formatTicks(roundTick));
  return parts.join(' · ');
}

function statValues(
  stats: GameOverMessage['stats'],
  report: GameOverMessage['report'],
  seat: Seat,
): readonly string[] {
  const s: PlayerStats | undefined = stats[seat];
  const r = report[seat];
  const num = (n: number | undefined) => (n === undefined ? '—' : String(n));
  return [
    num(s?.linesCleared),
    num(s?.garbageSent),
    num(r?.garbageReceived),
    num(s?.garbageCancelled),
    s === undefined ? '—' : COPY.result.bestComboValue(s.bestCombo),
    num(s?.piecesPlaced),
  ];
}

const ROW_LABELS = [
  COPY.result.rows.lines,
  COPY.result.rows.garbageSent,
  COPY.result.rows.garbageReceived,
  COPY.result.rows.garbageCancelled,
  COPY.result.rows.bestCombo,
  COPY.result.rows.pieces,
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

export function deriveResult(input: ResultInput): ResultView {
  const { result, role, names } = input;
  const series = input.series ?? result.series;
  const seriesOver = series.over || input.status === 'seriesOver';
  const outcome = outcomeOf(result, role);
  const finalLabel = COPY.result.final(result.round, result.replay);
  const headline = headlineOf(outcome, result, names);
  const reason = reasonLine(input);
  const opponent = role === 'spectator' ? null : otherSeat(role);
  const order: readonly [Seat, Seat] = role === 'spectator' ? ['A', 'B'] : [role, otherSeat(role)];
  const columns: readonly [string, string] =
    role === 'spectator' ? [names.A, names.B] : [COPY.result.you, names[order[1]]];
  const left = statValues(result.stats, result.report, order[0]);
  const right = statValues(result.stats, result.report, order[1]);
  const rows = ROW_LABELS.map((label, i): StatRow => ({
    label,
    values: [left[i] ?? '—', right[i] ?? '—'],
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

  const primary =
    role === 'spectator'
      ? null
      : {
          label: seriesOver ? COPY.result.newSeries : COPY.result.nextRound,
          disabled: input.ready[role] || (seriesOver && input.opponentSeated === false),
        };

  const seriesView = {
    A: { name: names.A, score: series.score.A },
    B: { name: names.B, score: series.score.B },
  };
  const summary = COPY.result.summary([
    COPY.result.finalSpoken(result.round, result.replay),
    headline,
    reason,
    COPY.result.seriesScoreName(names.A, series.score.A, series.score.B, names.B),
  ]);

  return {
    outcome,
    art: outcome === 'win' || (outcome === 'watch' && result.winner !== null) ? 'win' : 'arena',
    winner: result.winner,
    finalLabel,
    headline,
    reason,
    series: seriesView,
    seriesOver,
    columns,
    rows,
    bestMoments,
    primary,
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
 * A series that ended with no round report to show (a forfeit between rounds): the same card with
 * only the verdict, the series bug and the actions. W4 replaces this with the full series card.
 */
export function deriveSeriesEnd(input: SeriesEndInput): ResultView {
  const { series, role, names } = input;
  const winner = series.winner;
  let outcome: Outcome = 'watch';
  if (role !== 'spectator') outcome = winner === null ? 'draw' : winner === role ? 'win' : 'lose';
  let headline: string = COPY.result.draw;
  if (outcome === 'win') headline = COPY.result.youWin;
  else if (outcome === 'lose') headline = COPY.result.youLose;
  else if (winner !== null) headline = COPY.result.wins(names[winner]);
  const loser = winner === null ? null : otherSeat(winner);
  let reason = '';
  if (loser !== null && series.endReason === 'OPPONENT_LEFT')
    reason = COPY.result.left(names[loser]);
  if (loser !== null && series.endReason === 'OPPONENT_DISCONNECTED') {
    reason = COPY.result.didntReconnect(names[loser]);
  }
  const opponent = role === 'spectator' ? null : otherSeat(role);
  const statusInput = {
    role,
    names,
    ready: input.ready,
    opponentSeated: input.opponentSeated,
    opponentConnected: input.opponentConnected,
  };
  return {
    outcome,
    art: outcome === 'win' || (outcome === 'watch' && winner !== null) ? 'win' : 'arena',
    winner,
    finalLabel: COPY.result.seriesOverNoReport,
    headline,
    reason,
    series: {
      A: { name: names.A, score: series.score.A },
      B: { name: names.B, score: series.score.B },
    },
    seriesOver: true,
    columns: [COPY.result.you, ''],
    rows: [],
    bestMoments: [],
    primary:
      role === 'spectator'
        ? null
        : {
            label: COPY.result.newSeries,
            disabled: input.ready[role] || input.opponentSeated === false,
          },
    status: statusLine(statusInput, true, opponent),
    summary: COPY.result.summary(
      [
        COPY.result.seriesOverNoReport,
        headline,
        reason,
        COPY.result.seriesScoreName(names.A, series.score.A, series.score.B, names.B),
      ].filter((part) => part !== ''),
    ),
  };
}
