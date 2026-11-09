import { HEIGHT_SAMPLE_EVERY_TICKS } from '@stackerist/protocol';
import { describe, expect, it } from 'vitest';
import {
  buildChart,
  formatAxisTime,
  MARGIN,
  PLOT_HEIGHT,
  PLOT_WIDTH,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  xAxisTicks,
  xForTick,
  yForRows,
  type ChartInput,
} from '../../src/ui/chart.ts';
import { COPY } from '../../src/ui/copy.ts';
import { actionsPerMinute, deriveResult, piecesPerSecond } from '../../src/ui/result.ts';
import { makeGameOver, makeReport } from './fixtures.ts';

const names = { A: 'Ariel', B: 'Sam' };

function input(overrides: Partial<ChartInput> = {}): ChartInput {
  return {
    round: 1,
    durationTicks: 17460,
    series: [
      { key: 'you', name: 'You', samples: [0, 4, 8, 12, 10, 6], toppedOut: false },
      { key: 'opp', name: 'Sam', samples: [0, 6, 12, 20], toppedOut: true },
    ],
    ...overrides,
  };
}

describe('REQ-091 report table: pieces per second and actions per minute', () => {
  it('REQ-091 PPS = piecesPlaced ÷ (durationTicks ÷ 60), two decimals', () => {
    // 131 pieces in 17460 ticks (291 s): 0.45 per second.
    expect(piecesPerSecond(131, 17460)).toBe('0.45');
    expect(piecesPerSecond(60, 3600)).toBe('1.00');
  });

  it('REQ-091 APM = actions × 60 ÷ (durationTicks ÷ 60), an integer', () => {
    // 420 actions in 291 s: 86.6 a minute.
    expect(actionsPerMinute(420, 17460)).toBe('87');
    expect(actionsPerMinute(60, 3600)).toBe('60');
  });

  it('REQ-091 a round under one second shows a dash, never a division by zero', () => {
    for (const ticks of [0, 1, 59]) {
      expect(piecesPerSecond(5, ticks)).toBe(COPY.result.noValue);
      expect(actionsPerMinute(5, ticks)).toBe(COPY.result.noValue);
    }
    expect(piecesPerSecond(1, 60)).toBe('1.00');
  });

  it('REQ-091 the table lists both players’ report rows, PPS and APM from each player’s own report', () => {
    const result = makeGameOver({
      report: {
        A: makeReport({ piecesPlaced: 60, actions: 120, durationTicks: 3600 }),
        B: makeReport({ piecesPlaced: 30, actions: 90, durationTicks: 3600 }),
      },
    });
    const view = deriveResult({
      result,
      role: 'A',
      names,
      series: result.series,
      status: 'roundOver',
      ready: { A: false, B: false },
      opponentSeated: true,
      opponentConnected: true,
      roundStartTick: 0,
    });
    const byLabel = Object.fromEntries(view.rows.map((row) => [row.label, row.values]));
    expect(byLabel[COPY.result.rows.piecesPerSecond]).toEqual(['1.00', '0.50']);
    expect(byLabel[COPY.result.rows.actionsPerMinute]).toEqual(['120', '90']);
    expect(Object.keys(byLabel)).toEqual([
      'Lines',
      'Garbage sent',
      'Garbage received',
      'Garbage cancelled',
      'Best combo',
      'Pieces per second',
      'Actions per minute',
    ]);
  });
});

describe('REQ-091 stack-height chart geometry', () => {
  it('REQ-091 the viewBox is 300 × 180 with margins 24 / 8 / 8 / 20', () => {
    expect([VIEW_WIDTH, VIEW_HEIGHT]).toEqual([300, 180]);
    expect(MARGIN).toEqual({ left: 24, right: 8, top: 8, bottom: 20 });
    expect(PLOT_WIDTH).toBe(268);
    expect(PLOT_HEIGHT).toBe(152);
  });

  it('REQ-091 the y axis is fixed at 0–20 rows, so rounds compare; 16 is the danger rule', () => {
    expect(yForRows(0)).toBe(160);
    expect(yForRows(20)).toBe(8);
    expect(yForRows(10)).toBe(84);
    expect(yForRows(-3)).toBe(160);
    expect(yForRows(99)).toBe(8);
    const model = buildChart(input());
    expect(model.dangerY).toBe(yForRows(16));
    expect(model.dangerLabel).toBe('16');
    expect(model.gridYs).toEqual([5, 10, 15, 20].map(yForRows));
    expect(model.yLabels.map((tick) => tick.label)).toEqual(['0', '10', '20']);
  });

  it('REQ-091 x runs from 0 to the round’s playing time', () => {
    expect(xForTick(0, 17460)).toBe(24);
    expect(xForTick(17460, 17460)).toBe(292);
    expect(xForTick(5, 0)).toBe(24);
  });

  it('REQ-091 each line has one point per 30-tick sample and ends in a marker', () => {
    const model = buildChart(input());
    const you = model.lines.find((line) => line.key === 'you');
    expect(you?.points.split(' ')).toHaveLength(6);
    expect(you?.points.startsWith(`24,${String(yForRows(0))}`)).toBe(true);
    const expectedLastX = xForTick(5 * HEIGHT_SAMPLE_EVERY_TICKS, 17460);
    expect(you?.end).toEqual({ x: expectedLastX, y: yForRows(6) });
  });

  it('REQ-091 your line is drawn last, on top', () => {
    const model = buildChart(input());
    expect(model.lines.map((line) => line.key)).toEqual(['opp', 'you']);
    expect(model.summary.map((line) => line.key)).toEqual(['you', 'opp']);
  });

  it('REQ-091 x labels: 0:00, the final time, and whole minutes at least 48 px apart', () => {
    const labels = (ticks: number) => xAxisTicks(ticks).map((tick) => tick.label);
    // 4:00 would sit 47 px from the 4:51 end label, so the 48 px rule drops it.
    expect(labels(17460)).toEqual(['0:00', '1:00', '2:00', '3:00', '4:51']);
    expect(labels(4200)).toEqual(['0:00', '1:10']);
    // A long round steps in whole minutes wide enough apart.
    const long = xAxisTicks(60 * 60 * 30);
    for (let i = 1; i < long.length; i += 1) {
      expect((long[i]?.x ?? 0) - (long[i - 1]?.x ?? 0)).toBeGreaterThanOrEqual(48);
    }
  });

  it('REQ-091 axis times read m:ss', () => {
    expect(formatAxisTime(0)).toBe('0:00');
    expect(formatAxisTime(60 * 220)).toBe('3:40');
    expect(formatAxisTime(60 * 65)).toBe('1:05');
    expect(formatAxisTime(Number.NaN)).toBe('0:00');
  });

  it('REQ-091 the text alternative names each player’s peak, when, and who topped out', () => {
    const model = buildChart(input());
    expect(model.title).toBe('Stack height over round 1');
    expect(model.description).toBe(
      'You peaked at 12 rows at 0:01. Sam peaked at 20 rows at 0:01 and topped out.',
    );
    const you = model.summary[0];
    expect(you?.peak).toBe(12);
    expect(you?.average).toBe(6.7);
  });

  it('REQ-091 zero samples draw the axes and say so; one sample is a lone marker', () => {
    const none = buildChart(input({ series: [] }));
    expect(none.empty).toBe(true);
    const empty = buildChart(
      input({
        series: [
          { key: 'you', name: 'You', samples: [], toppedOut: false },
          { key: 'opp', name: 'Sam', samples: [3], toppedOut: false },
        ],
      }),
    );
    expect(empty.empty).toBe(true);
    expect(empty.description).toContain('You has no height samples.');
    expect(empty.lines.find((line) => line.key === 'opp')?.end).toEqual({
      x: 24,
      y: yForRows(3),
    });
    // The axes are still described, even with nothing to chart.
    expect(empty.xTicks.length).toBeGreaterThanOrEqual(1);
    expect(empty.yLabels).toHaveLength(3);
  });

  it('REQ-091 a 0-tick round and an absurd sample still stay inside the plot', () => {
    const model = buildChart(
      input({
        durationTicks: 0,
        series: [
          { key: 'you', name: 'You', samples: [0, 25, 20], toppedOut: false },
          { key: 'opp', name: 'Sam', samples: [0, 1], toppedOut: false },
        ],
      }),
    );
    for (const line of model.lines) {
      for (const pair of line.points.split(' ')) {
        const [x = 0, y = 0] = pair.split(',').map(Number);
        expect(x).toBeGreaterThanOrEqual(MARGIN.left);
        expect(x).toBeLessThanOrEqual(MARGIN.left + PLOT_WIDTH);
        expect(y).toBeGreaterThanOrEqual(MARGIN.top);
        expect(y).toBeLessThanOrEqual(MARGIN.top + PLOT_HEIGHT);
      }
    }
  });

  it('REQ-091 a result card carries the chart: you amber (seat A for a spectator), who topped out', () => {
    const result = makeGameOver({
      report: {
        A: makeReport({ heightSamples: [0, 5, 9] }),
        B: makeReport({ heightSamples: [0, 8, 20] }),
      },
    });
    const common = {
      result,
      names,
      series: result.series,
      status: 'roundOver' as const,
      ready: { A: false, B: false },
      opponentConnected: true,
      roundStartTick: 0,
    };
    const player = deriveResult({ ...common, role: 'A', opponentSeated: true });
    expect(player.chart?.summary.map((line) => line.name)).toEqual(['You', 'Sam']);
    expect(player.chart?.description).toContain('Sam peaked at 20 rows');
    expect(player.chart?.description).toContain('and topped out');
    const watcher = deriveResult({ ...common, role: 'spectator', opponentSeated: null });
    expect(watcher.chart?.summary.map((line) => line.name)).toEqual(['Ariel', 'Sam']);
    expect(watcher.chart?.summary.map((line) => line.key)).toEqual(['you', 'opp']);
  });
});
