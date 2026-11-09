/**
 * The report chart's geometry and text (REQ-091; DESIGN.md "Report chart"). Pure: every number the SVG
 * draws, and every word its text alternative says, is computed here and unit-tested without a DOM.
 *
 * The form is a line chart of both players' stack height (rows, fixed 0–20 so rounds compare) over
 * the round's playing time. `heightSamples` holds one sample per HEIGHT_SAMPLE_EVERY_TICKS (30) ticks.
 */
import { BOARD_HEIGHT, TICK_RATE } from '@stackerist/engine';
import { HEIGHT_SAMPLE_EVERY_TICKS } from '@stackerist/protocol';
import { chart as chartTokens, danger } from '../../../../design/tokens/tokens.ts';
import { COPY } from './copy.ts';

/** The SVG's user-space size: DESIGN.md pins `viewBox="0 0 300 180"` (= --chart-width × --chart-height). */
export const VIEW_WIDTH = chartTokens.widthPx;
export const VIEW_HEIGHT = chartTokens.heightPx;
/** Plot margins in user units (DESIGN.md): left 24, right 8, top 8, bottom 20. */
export const MARGIN = { left: 24, right: 8, top: 8, bottom: 20 } as const;
export const PLOT_WIDTH = VIEW_WIDTH - MARGIN.left - MARGIN.right;
export const PLOT_HEIGHT = VIEW_HEIGHT - MARGIN.top - MARGIN.bottom;
/** The end-of-line marker is a 5 px square (the block motif). */
export const END_MARK = 5;
/** Whole-minute x labels are kept at least this far apart (and from the end labels). */
export const MIN_LABEL_GAP = 48;
/** Rows labelled on the y axis; grid lines sit at every 5. */
export const Y_LABELS: readonly number[] = [0, 10, BOARD_HEIGHT];
export const GRID_ROWS: readonly number[] = [5, 10, 15, BOARD_HEIGHT];
/** The danger rule: the same threshold as the danger pulse (REQ-088). */
export const DANGER_ROWS = danger.rows;

const TICKS_PER_MINUTE = TICK_RATE * 60;
const MINUTE_STEPS: readonly number[] = [1, 2, 5, 10, 15, 30, 60];

export type SeriesKey = 'you' | 'opp';

export interface ChartSeriesInput {
  /** `you` is the amber line (seat A for a spectator), `opp` the cream line. */
  readonly key: SeriesKey;
  /** Plain text: shown in the legend and the text alternative. */
  readonly name: string;
  readonly samples: readonly number[];
  readonly toppedOut: boolean;
}

export interface ChartInput {
  readonly round: number;
  /** The round's playing time in ticks (pauses excluded); the largest of the two reports. */
  readonly durationTicks: number;
  /** Drawn in this order: the last one is on top (yours). */
  readonly series: readonly ChartSeriesInput[];
}

export interface ChartLine {
  readonly key: SeriesKey;
  readonly name: string;
  /** SVG `points` attribute; empty with no samples. */
  readonly points: string;
  /** The 5 px end marker's centre; null with no samples. */
  readonly end: { readonly x: number; readonly y: number } | null;
  readonly sampleCount: number;
  readonly peak: number;
  /** m:ss of the first sample at the peak. */
  readonly peakAt: string;
  readonly average: number;
  readonly toppedOut: boolean;
}

export interface AxisTick {
  readonly x: number;
  readonly label: string;
  readonly anchor: 'start' | 'middle' | 'end';
}

export interface ChartModel {
  readonly title: string;
  readonly description: string;
  /** No line has two samples: the axes are drawn and "Round too short to chart" sits in the plot. */
  readonly empty: boolean;
  /** Draw order: the last line is on top (yours). */
  readonly lines: readonly ChartLine[];
  /** Input order (you first), for the legend and the text alternative. */
  readonly summary: readonly ChartLine[];
  /** The x domain end, in ticks. */
  readonly domainTicks: number;
  readonly xTicks: readonly AxisTick[];
  readonly yLabels: readonly { readonly y: number; readonly label: string }[];
  readonly gridYs: readonly number[];
  readonly baselineY: number;
  readonly dangerY: number;
  /** The danger rule's axis label ("16"). */
  readonly dangerLabel: string;
}

/** y for a stack height in rows, clamped to the fixed 0–20 axis. */
export function yForRows(rows: number): number {
  const clamped = Math.min(BOARD_HEIGHT, Math.max(0, rows));
  return round1(MARGIN.top + PLOT_HEIGHT - (clamped / BOARD_HEIGHT) * PLOT_HEIGHT);
}

/** x for a tick in a domain of `domainTicks` ticks. */
export function xForTick(tick: number, domainTicks: number): number {
  const fraction = domainTicks <= 0 ? 0 : Math.min(1, Math.max(0, tick / domainTicks));
  return round1(MARGIN.left + fraction * PLOT_WIDTH);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** m:ss for a tick count: "0:00", "3:40", "12:05". */
export function formatAxisTime(ticks: number): string {
  const totalSeconds = Number.isFinite(ticks) && ticks > 0 ? Math.floor(ticks / TICK_RATE) : 0;
  const seconds = totalSeconds % 60;
  return `${String(Math.floor(totalSeconds / 60))}:${seconds < 10 ? '0' : ''}${String(seconds)}`;
}

/** "0:00" at the start, the final time at the end, whole minutes between when ≥ 48 px apart. */
export function xAxisTicks(domainTicks: number): readonly AxisTick[] {
  const endX = xForTick(domainTicks, domainTicks);
  const ticks: AxisTick[] = [{ x: MARGIN.left, label: formatAxisTime(0), anchor: 'start' }];
  const pxPerMinute = domainTicks <= 0 ? 0 : (TICKS_PER_MINUTE / domainTicks) * PLOT_WIDTH;
  if (pxPerMinute > 0) {
    const step = MINUTE_STEPS.find((minutes) => minutes * pxPerMinute >= MIN_LABEL_GAP) ?? 60;
    for (let minute = step; minute * TICKS_PER_MINUTE < domainTicks; minute += step) {
      const x = xForTick(minute * TICKS_PER_MINUTE, domainTicks);
      if (x - MARGIN.left >= MIN_LABEL_GAP && endX - x >= MIN_LABEL_GAP) {
        ticks.push({ x, label: `${String(minute)}:00`, anchor: 'middle' });
      }
    }
  }
  const endLabel = formatAxisTime(domainTicks);
  // A round shorter than a second would label both ends "0:00": say it once.
  if (endX - MARGIN.left >= MIN_LABEL_GAP && endLabel !== ticks[0]?.label) {
    ticks.push({ x: endX, label: endLabel, anchor: 'end' });
  }
  return ticks;
}

function lineFor(input: ChartSeriesInput, domainTicks: number): ChartLine {
  const { samples } = input;
  const xy = samples.map((rows, i) => ({
    x: xForTick(i * HEIGHT_SAMPLE_EVERY_TICKS, domainTicks),
    y: yForRows(rows),
  }));
  let peak = 0;
  let peakIndex = 0;
  let sum = 0;
  samples.forEach((rows, i) => {
    sum += rows;
    if (rows > peak) {
      peak = rows;
      peakIndex = i;
    }
  });
  const last = xy[xy.length - 1];
  return {
    key: input.key,
    name: input.name,
    points: xy.map((p) => `${String(p.x)},${String(p.y)}`).join(' '),
    end: last === undefined ? null : last,
    sampleCount: samples.length,
    peak,
    peakAt: formatAxisTime(peakIndex * HEIGHT_SAMPLE_EVERY_TICKS),
    average: samples.length === 0 ? 0 : Math.round((sum / samples.length) * 10) / 10,
    toppedOut: input.toppedOut,
  };
}

function describe(lines: readonly ChartLine[]): string {
  return lines
    .map((line) =>
      line.sampleCount === 0
        ? COPY.result.chart.noData(line.name)
        : COPY.result.chart.peaked(line.name, line.peak, line.peakAt, line.toppedOut),
    )
    .join(' ');
}

export function buildChart(input: ChartInput): ChartModel {
  const longest = input.series.reduce((most, s) => Math.max(most, s.samples.length), 0);
  const lastSampleTick = Math.max(0, longest - 1) * HEIGHT_SAMPLE_EVERY_TICKS;
  const domainTicks = Math.max(1, input.durationTicks, lastSampleTick);
  const summary = input.series.map((s) => lineFor(s, domainTicks));
  // Yours is drawn last, so it sits on top where the lines meet.
  const lines = [...summary].sort((a, b) => Number(a.key === 'you') - Number(b.key === 'you'));
  return {
    title: COPY.result.chart.title(input.round),
    description: describe(summary),
    empty: longest < 2,
    lines,
    summary,
    domainTicks,
    xTicks: xAxisTicks(domainTicks),
    yLabels: Y_LABELS.map((rows) => ({ y: yForRows(rows), label: String(rows) })),
    gridYs: GRID_ROWS.map(yForRows),
    baselineY: yForRows(0),
    dangerY: yForRows(DANGER_ROWS),
    dangerLabel: String(DANGER_ROWS),
  };
}
