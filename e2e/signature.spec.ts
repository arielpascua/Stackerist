/**
 * The signature features in real two-browser matches (QA pass 3): the DUEL! standoff (REQ-086), the
 * best-of-3 series (REQ-083/084/085/059), the round report and stack-height chart (REQ-090/091), the
 * duel effects (REQ-061/087/088), the music button (REQ-089) and the spectator view (REQ-062).
 * Ids come from TEST_IDS, strings from COPY, canvas state from DATA_HOOKS; protocol facts (scores,
 * report numbers) come from the frames the page's own WebSocket received.
 */
import { expect, test, type Page } from '@playwright/test';
import { emptyBoard, type Board } from '../packages/engine/src/index.ts';
import { MUSIC_STORAGE_KEY } from '../packages/protocol/src/constants.ts';
import type { GameOverMessage } from '../packages/protocol/src/index.ts';
import {
  closeAll,
  COPY,
  createGame,
  DATA_HOOKS,
  joinViaLink,
  newPlayer,
  ownCanvas,
  ownStat,
  oppCanvas,
  resultCard,
  sleep,
  startMatch,
  TEST_IDS,
  verdictOf,
  waitUntilLive,
  type Player,
} from './support/app.ts';
import { placeOnePiece } from './support/bot.ts';
import { watchFrames, type FrameLog } from './support/frames.ts';
import {
  lastGameOver,
  loseRound,
  pipsOf,
  playRound,
  pressPrimary,
  readReport,
  seriesBug,
  seriesBugText,
} from './support/series.ts';

interface PhaseEntry {
  readonly phase: string;
  readonly numeral: string;
  readonly duelHidden: boolean;
  readonly t: number;
  readonly active: string | null;
}

interface StandoffLog {
  readonly phases: PhaseEntry[];
  /** x of the falling piece, read in the frame callback right after the probe key was sent. */
  probes: { phase: string; before: string | null; after: string | null }[];
}

interface FxLog {
  /** Highest `data-fx` (effects running) seen on the fx canvas. */
  maxFx: number;
  /** Last `data-projectile-count` (projectiles launched since the arena mounted). */
  launched: number;
  /** Highest pending garbage rows seen on this player's own meter. */
  maxPending: number;
}

declare global {
  interface Window {
    __standoff?: StandoffLog;
    __fxLog?: FxLog;
  }
}

/** Installed before load: records the fx canvas hooks and the own meter's pending rows as they change. */
function installFxRecorder(args: {
  fx: string;
  meter: string;
  activeHook: string;
  countHook: string;
}): void {
  const log: FxLog = { maxFx: 0, launched: 0, maxPending: 0 };
  window.__fxLog = log;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target as Element;
      const id = target.getAttribute('data-testid');
      if (id === args.fx) {
        log.maxFx = Math.max(log.maxFx, Number(target.getAttribute(args.activeHook) ?? 0));
        log.launched = Number(target.getAttribute(args.countHook) ?? 0);
      } else if (id === args.meter) {
        log.maxPending = Math.max(log.maxPending, Number(target.getAttribute('data-pending') ?? 0));
      }
    }
  });
  observer.observe(document, {
    subtree: true,
    attributes: true,
    attributeFilter: [args.activeHook, args.countHook, 'data-pending'],
  });
}

/**
 * Installed before the page loads. A MutationObserver on the standoff overlay's `data-phase` runs in the
 * microtask right after the frame that painted the phase (the same rAF callback that enabled input), so
 * a key dispatched from it is "the first key after that paint". It sends ArrowLeft on the last numeral
 * ("1": must be ignored) and again on DUEL! (must be accepted).
 */
function installStandoffProbe(args: {
  overlay: string;
  numeral: string;
  duel: string;
  canvas: string;
  activeAttr: string;
}): void {
  const log: StandoffLog = { phases: [], probes: [] };
  window.__standoff = log;
  const press = (): void => {
    for (const type of ['keydown', 'keyup']) {
      window.dispatchEvent(
        new KeyboardEvent(type, { code: 'ArrowLeft', key: 'ArrowLeft', bubbles: true }),
      );
    }
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target as Element;
      if (target.getAttribute('data-testid') !== args.overlay) continue;
      const phase = target.getAttribute('data-phase') ?? '';
      const numeral = document.querySelector(`[data-testid="${args.numeral}"]`)?.textContent ?? '';
      const duel = document.querySelector(`[data-testid="${args.duel}"]`);
      const canvas = document.querySelector(`[data-testid="${args.canvas}"]`);
      log.phases.push({
        phase,
        numeral,
        duelHidden: duel?.hasAttribute('hidden') ?? true,
        t: performance.now(),
        active: canvas?.getAttribute(args.activeAttr) ?? null,
      });
      if (phase === '1' || phase === 'duel') {
        const probe: StandoffLog['probes'][number] = {
          phase,
          before: canvas?.getAttribute(args.activeAttr) ?? null,
          after: null,
        };
        log.probes.push(probe);
        press();
        window.setTimeout(() => {
          log.probes[log.probes.indexOf(probe)] = {
            ...probe,
            after: canvas?.getAttribute(args.activeAttr) ?? null,
          };
        }, 250);
      }
    }
  });
  observer.observe(document, {
    subtree: true,
    attributes: true,
    attributeFilter: ['data-phase'],
  });
}

/** Esc in the frame DUEL! is painted, then clicks "Leave series" as soon as the dialog exists. */
function installQuickLeave(args: { overlay: string; leave: string }): void {
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target as Element;
      if (target.getAttribute('data-testid') !== args.overlay) continue;
      if (target.getAttribute('data-phase') !== 'duel') continue;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
      const click = (): void => {
        const button = document.querySelector<HTMLElement>(`[data-testid="${args.leave}"]`);
        if (button === null) window.requestAnimationFrame(click);
        else button.click();
      };
      window.requestAnimationFrame(click);
    }
  });
  observer.observe(document, { subtree: true, attributes: true, attributeFilter: ['data-phase'] });
}

function xOf(active: string | null): number {
  const x = (active ?? '').split(':')[2];
  return Number(x);
}

test.describe('REQ-086 the DUEL! standoff', () => {
  test('REQ-086 plates, 3 2 1, DUEL!; input goes live in the frame DUEL! appears (about 3 s)', async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const a = await newPlayer(browser, 'Alice');
    const b = await newPlayer(browser, 'Bob');
    try {
      await a.page.addInitScript(installStandoffProbe, {
        overlay: TEST_IDS.countdown.overlay,
        numeral: TEST_IDS.countdown.numeral,
        duel: TEST_IDS.countdown.duel,
        canvas: TEST_IDS.game.ownCanvas,
        activeAttr: DATA_HOOKS.active,
      });
      await startMatch(a, b);
      const { page } = a;

      // The plates face off: your name on the left, the opponent's on the right, round tag above.
      await expect(page.getByTestId(TEST_IDS.countdown.nameLeft)).toHaveText(a.name);
      await expect(page.getByTestId(TEST_IDS.countdown.nameRight)).toHaveText(b.name);
      await expect(page.getByTestId(TEST_IDS.countdown.round)).toHaveText(COPY.game.roundTag(1));
      await expect(page.getByTestId(TEST_IDS.countdown.pipsLeft)).toHaveAttribute('data-won', '0');
      await expect(page.getByTestId(TEST_IDS.countdown.pipsRight)).toHaveAttribute('data-won', '0');

      // Wait for DUEL! on screen, then for it to leave.
      await expect(page.getByTestId(TEST_IDS.countdown.duel)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId(TEST_IDS.countdown.duel)).toHaveText(COPY.countdown.duel);
      await expect(page.getByTestId(TEST_IDS.countdown.overlay)).toBeHidden({ timeout: 10_000 });
      await expect(ownCanvas(page)).not.toHaveAttribute(DATA_HOOKS.active, '');

      const log = await page.evaluate(() => window.__standoff);
      expect(log, 'the probe was installed').toBeDefined();
      if (log === undefined) return;
      const at = (phase: string) => log.phases.find((p) => p.phase === phase);

      // The sequence is 3, 2, 1, DUEL!, then the overlay goes (phase none): numerals and the DUEL!
      // element are in step with the phase on every paint.
      const seen = log.phases.map((p) => p.phase).filter((p) => p !== 'dim');
      expect(seen).toEqual(['3', '2', '1', 'duel', 'none']);
      for (const p of log.phases) {
        expect(p.numeral, `numeral at phase ${p.phase}`).toBe(
          p.phase === '3' || p.phase === '2' || p.phase === '1' ? p.phase : '',
        );
        expect(p.duelHidden, `DUEL! hidden at phase ${p.phase}`).toBe(p.phase !== 'duel');
      }

      // About 3 s from the 3 to DUEL!, a second per numeral (frame-quantised, so a little slack).
      const t3 = at('3')?.t ?? Number.NaN;
      const t2 = at('2')?.t ?? Number.NaN;
      const t1 = at('1')?.t ?? Number.NaN;
      const tDuel = at('duel')?.t ?? Number.NaN;
      expect(tDuel - t3, `3 -> DUEL! took ${String(tDuel - t3)} ms`).toBeGreaterThan(2_800);
      expect(tDuel - t3).toBeLessThan(3_200);
      for (const gap of [t2 - t3, t1 - t2, tDuel - t1]) {
        expect(gap).toBeGreaterThan(850);
        expect(gap).toBeLessThan(1_150);
      }

      // Input goes live in the frame DUEL! is painted. ArrowLeft sent in the last frame of "1" (the
      // observer runs right after that frame): ignored, the piece stays where the server put it. The
      // same key sent in the DUEL! frame: accepted, the piece moves one column left.
      const pre = log.probes.find((p) => p.phase === '1');
      const live = log.probes.find((p) => p.phase === 'duel');
      expect(pre, 'probe on the last numeral').toBeDefined();
      expect(live, 'probe on DUEL!').toBeDefined();
      const start = xOf(pre?.before ?? null);
      expect(Number.isFinite(start), `a piece is on the board during the standoff`).toBe(true);
      expect(xOf(pre?.after ?? null), 'a key before DUEL! must not move the piece').toBe(start);
      expect(xOf(live?.before ?? null), 'still unmoved when DUEL! appears').toBe(start);
      expect(xOf(live?.after ?? null), 'the first key after DUEL! must move the piece').toBe(
        start - 1,
      );
      expect(a.problems, 'A console problems').toEqual([]);
    } finally {
      await closeAll([a, b]);
    }
  });
});

test.describe('REQ-083/084/085/059 a full best-of-3', () => {
  test('REQ-083 round 1, Next round handshake, round 2, round 3, the series card, New series', async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const a = await newPlayer(browser, 'Alice');
    const b = await newPlayer(browser, 'Bob');
    const framesA = watchFrames(a.page);
    const framesB = watchFrames(b.page);
    const names = { a: { me: a.name, opponent: b.name }, b: { me: b.name, opponent: a.name } };
    try {
      await startMatch(a, b);
      // The HUD shows the round and the score from the first frame (REQ-085).
      for (const player of [a, b]) {
        await expect(player.page.getByTestId(TEST_IDS.game.roundTag)).toHaveText(
          COPY.game.roundTag(1),
        );
        expect(await pipsOf(player.page)).toEqual({ own: 0, opp: 0 });
      }

      // ---- Round 1: Bob hammers and tops out, Alice wins it ----
      await playRound(a, b, b);
      for (const player of [a, b]) {
        await expect(resultCard(player.page)).toHaveAttribute('data-kind', 'round');
        await expect(player.page.getByTestId(TEST_IDS.result.finalLabel)).toHaveText(
          COPY.result.final(1, false),
        );
        expect(await seriesBugText(player.page)).toBe(seriesBug(a.name, 1, 0, b.name));
        await expect(player.page.getByTestId(TEST_IDS.result.primaryButton)).toHaveText(
          COPY.result.nextRound,
        );
        await expect(player.page.getByTestId(TEST_IDS.result.primaryButton)).toBeEnabled();
        await expect(player.page.getByTestId(TEST_IDS.result.status)).toHaveText('');
        await expect(player.page.getByTestId(TEST_IDS.disconnect.overlay)).toHaveCount(0);
      }
      expect(await verdictOf(a.page)).toBe('win');
      expect(await verdictOf(b.page)).toBe('lose');
      const over1 = lastGameOver(framesA.gameOvers());
      expect(over1.round).toBe(1);
      expect(over1.winner).toBe('A');
      expect(over1.series.score).toEqual({ A: 1, B: 0 });
      expect(over1.series.over).toBe(false);

      // REQ-059: Bob accepts first and waits; Alice sees that Bob is ready; nothing starts yet.
      await pressPrimary(b);
      await expect(b.page.getByTestId(TEST_IDS.result.primaryButton)).toBeDisabled();
      await expect(b.page.getByTestId(TEST_IDS.result.status)).toHaveText(
        COPY.result.waitingAccept,
      );
      await expect(a.page.getByTestId(TEST_IDS.result.status)).toHaveText(
        COPY.result.opponentReady(b.name),
      );
      await expect(resultCard(a.page)).toBeVisible();
      await expect(resultCard(b.page)).toBeVisible();
      await expect(a.page.getByTestId(TEST_IDS.countdown.overlay)).toBeHidden();
      await expect(b.page.getByTestId(TEST_IDS.countdown.overlay)).toBeHidden();
      // Alice accepts: both get a fresh countdown for round 2.
      await pressPrimary(a);
      for (const player of [a, b]) {
        await expect(player.page.getByTestId(TEST_IDS.countdown.overlay)).toBeVisible();
        await expect(player.page.getByTestId(TEST_IDS.countdown.round)).toHaveText(
          COPY.game.roundTag(2),
        );
        await expect(resultCard(player.page)).toHaveCount(0);
        await expect(player.page.getByTestId(TEST_IDS.game.roundTag)).toHaveText(
          COPY.game.roundTag(2),
        );
      }
      expect(await pipsOf(a.page)).toEqual({ own: 1, opp: 0 });
      expect(await pipsOf(b.page)).toEqual({ own: 0, opp: 1 });
      await expect(a.page.getByTestId(TEST_IDS.countdown.pipsLeft)).toHaveAttribute(
        'data-won',
        '1',
      );
      await expect(a.page.getByTestId(TEST_IDS.game.ownPips)).toHaveAccessibleName(
        COPY.game.pipsName(a.name, 1),
      );
      await expect(a.page.getByTestId(TEST_IDS.game.oppPips)).toHaveAccessibleName(
        COPY.game.pipsName(b.name, 0),
      );

      // ---- Round 2: Alice hammers and tops out, Bob wins it: 1 - 1 ----
      await playRound(a, b, a);
      for (const player of [a, b]) {
        await expect(resultCard(player.page)).toHaveAttribute('data-kind', 'round');
        expect(await seriesBugText(player.page)).toBe(seriesBug(a.name, 1, 1, b.name));
        await expect(player.page.getByTestId(TEST_IDS.result.finalLabel)).toHaveText(
          COPY.result.final(2, false),
        );
      }
      expect(await verdictOf(a.page)).toBe('lose');
      expect(await verdictOf(b.page)).toBe('win');
      await pressPrimary(a);
      await pressPrimary(b);
      for (const player of [a, b]) {
        await expect(player.page.getByTestId(TEST_IDS.countdown.round)).toHaveText(
          COPY.game.roundTag(3),
        );
      }

      // ---- Round 3: Alice hammers again; Bob takes the series 2 - 1 ----
      await playRound(a, b, a);
      for (const player of [a, b]) {
        await expect(resultCard(player.page)).toHaveAttribute('data-kind', 'series');
        await expect(player.page.getByTestId(TEST_IDS.result.finalLabel)).toHaveText(
          COPY.result.series.final,
        );
        await expect(player.page.getByTestId(TEST_IDS.result.headline)).toHaveText(
          COPY.result.series.headline(b.name, { won: 2, lost: 1 }),
        );
        expect(await seriesBugText(player.page)).toBe(seriesBug(a.name, 1, 2, b.name));
        // Each round's result, in order, with its winner.
        const chips = player.page.getByTestId(TEST_IDS.result.chip);
        await expect(chips).toHaveCount(3);
        await expect(chips.nth(0)).toContainText(COPY.result.series.chipName(1, a.name));
        await expect(chips.nth(1)).toContainText(COPY.result.series.chipName(2, b.name));
        await expect(chips.nth(2)).toContainText(COPY.result.series.chipName(3, b.name));
        // Series over: only New series, never Next round.
        await expect(player.page.getByTestId(TEST_IDS.result.primaryButton)).toHaveText(
          COPY.result.newSeries,
        );
        await expect(player.page.getByRole('button', { name: COPY.result.nextRound })).toHaveCount(
          0,
        );
        await expect(player.page.getByTestId(TEST_IDS.disconnect.overlay)).toHaveCount(0);
      }
      expect(await verdictOf(a.page, names.a)).toBe('lose');
      expect(await verdictOf(b.page, names.b)).toBe('win');
      await expect(a.page.getByTestId(TEST_IDS.result.reason)).toHaveText(
        COPY.result.series.theyWonRounds(b.name, 2, 1),
      );
      await expect(b.page.getByTestId(TEST_IDS.result.reason)).toHaveText(
        COPY.result.series.youWonRounds(2, 1),
      );
      const final = lastGameOver(framesB.gameOvers());
      expect(framesB.gameOvers().map((over) => over.round)).toEqual([1, 2, 3]);
      expect(final.series.score).toEqual({ A: 1, B: 2 });
      expect(final.series.over).toBe(true);
      expect(final.series.winner).toBe('B');
      expect(final.series.endReason).toBe('TWO_WINS');
      expect(final.series.rounds.map((round) => round.winner)).toEqual(['A', 'B', 'B']);

      // ---- New series needs both players ----
      await pressPrimary(b);
      await expect(a.page.getByTestId(TEST_IDS.result.status)).toHaveText(
        COPY.result.opponentWantsSeries(b.name),
      );
      await expect(resultCard(a.page)).toBeVisible();
      await expect(a.page.getByTestId(TEST_IDS.countdown.overlay)).toBeHidden();
      await pressPrimary(a);
      for (const player of [a, b]) {
        await expect(player.page.getByTestId(TEST_IDS.countdown.overlay)).toBeVisible();
        await expect(resultCard(player.page)).toHaveCount(0);
        await expect(player.page.getByTestId(TEST_IDS.countdown.round)).toHaveText(
          COPY.game.roundTag(1),
        );
        await expect(player.page.getByTestId(TEST_IDS.game.roundTag)).toHaveText(
          COPY.game.roundTag(1),
        );
        expect(await pipsOf(player.page)).toEqual({ own: 0, opp: 0 });
      }
      expect(a.problems, 'A console problems').toEqual([]);
      expect(b.problems, 'B console problems').toEqual([]);
    } finally {
      await closeAll([a, b]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-090 / REQ-091: the report and the chart
// ---------------------------------------------------------------------------------------------

type Seat = 'A' | 'B';

/** What a player's report column must read for `seat`, from the numbers the server sent. */
function expectedColumn(over: GameOverMessage, seat: Seat): Record<string, string> {
  const stats = over.stats[seat];
  const report = over.report[seat];
  if (stats === undefined || report === undefined) throw new Error(`no report for seat ${seat}`);
  const seconds = report.durationTicks / 60;
  const rate = report.durationTicks >= 60;
  return {
    [COPY.result.rows.lines]: String(stats.linesCleared),
    [COPY.result.rows.garbageSent]: String(stats.garbageSent),
    [COPY.result.rows.garbageReceived]: String(report.garbageReceived),
    [COPY.result.rows.garbageCancelled]: String(stats.garbageCancelled),
    [COPY.result.rows.bestCombo]: COPY.result.bestComboValue(stats.bestCombo),
    // REQ-091: PPS = pieces / seconds played (two decimals), APM = actions x 60 / seconds played.
    [COPY.result.rows.piecesPerSecond]: rate
      ? (report.piecesPlaced / seconds).toFixed(2)
      : COPY.result.noValue,
    [COPY.result.rows.actionsPerMinute]: rate
      ? String(Math.round((report.actions * 60) / seconds))
      : COPY.result.noValue,
  };
}

async function cardText(page: Page): Promise<string> {
  return (await resultCard(page).textContent()) ?? '';
}

/** No NaN / Infinity / undefined leaks onto a card. */
function expectNoGarbageText(text: string, what: string): void {
  for (const bad of ['NaN', 'Infinity', 'undefined', 'null']) {
    expect(text, `${what} shows "${bad}"`).not.toContain(bad);
  }
}

/** The chart of a result card against the heightSamples the server reported for the two seats. */
async function expectChartMatches(
  page: Page,
  over: GameOverMessage,
  seats: readonly [Seat, Seat],
  names: readonly [string, string],
): Promise<void> {
  const chart = page.getByTestId(TEST_IDS.result.chart);
  await expect(chart).toBeVisible();
  const svg = chart.locator('svg');
  await expect(svg).toHaveCount(1);
  await expect(svg).toHaveAttribute('role', 'img');

  // Accessible name and description: the <title> and <desc> the SVG points at.
  const titleId = await svg.getAttribute('aria-labelledby');
  const descId = await svg.getAttribute('aria-describedby');
  expect(titleId, 'svg aria-labelledby').not.toBeNull();
  expect(descId, 'svg aria-describedby').not.toBeNull();
  await expect(svg.locator(`title[id="${titleId ?? ''}"]`)).toHaveText(
    COPY.result.chart.title(over.round),
  );
  const samples = seats.map((seat) => over.report[seat]?.heightSamples ?? []);
  const labels = [COPY.result.chart.you, names[1]] as const;
  const desc = (await svg.locator(`desc[id="${descId ?? ''}"]`).textContent()) ?? '';
  samples.forEach((own, index) => {
    const name = labels[index] ?? '';
    if (own.length === 0) {
      expect(desc).toContain(COPY.result.chart.noData(name));
    } else {
      expect(desc, `description of ${name}`).toContain(
        `${name} peaked at ${String(Math.max(...own))} `,
      );
    }
  });

  // The legend names both lines; the data table summarises the same samples.
  const legend = page.getByTestId(TEST_IDS.result.chartLegend);
  await expect(legend).toContainText(COPY.result.chart.you);
  await expect(legend).toContainText(names[1]);
  await expect(legend).toContainText(COPY.result.chart.danger);
  const table = page.getByTestId(TEST_IDS.result.chartTable);
  await expect(table.locator('caption')).toHaveText(COPY.result.chart.tableCaption);
  await expect(table.locator('thead th')).toHaveText([
    COPY.result.chart.colPlayer,
    COPY.result.chart.colPeak,
    COPY.result.chart.colAt,
    COPY.result.chart.colAverage,
  ]);
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(2);
  const viewBox = ((await svg.getAttribute('viewBox')) ?? '').split(' ').map(Number);
  const plotHeight = (viewBox[3] ?? 0) - 8 - 20; // DESIGN.md: margins top 8, bottom 20
  const charted = samples.some((own) => own.length >= 2);
  for (let index = 0; index < 2; index += 1) {
    const own = samples[index] ?? [];
    const row = rows.nth(index);
    await expect(row.locator('th')).toHaveText(labels[index] ?? '');
    if (own.length === 0) {
      await expect(row.locator('td')).toHaveText(COPY.result.chart.noData(labels[index] ?? ''));
    } else {
      const average = Math.round((own.reduce((sum, h) => sum + h, 0) / own.length) * 10) / 10;
      await expect(row.locator('td').nth(0)).toHaveText(COPY.result.chart.rows(Math.max(...own)));
      await expect(row.locator('td').nth(2)).toHaveText(COPY.result.chart.rows(average));
    }
    if (!charted) continue;
    // The drawn line: one point per sample, each at the height the server reported.
    const line = chart.getByTestId(
      index === 0 ? TEST_IDS.result.chartLineYou : TEST_IDS.result.chartLineOpp,
    );
    await expect(line).toHaveAttribute('data-samples', String(own.length));
    if (own.length >= 2) {
      const points = ((await line.locator('polyline').getAttribute('points')) ?? '')
        .split(' ')
        .map((pair) => pair.split(',').map(Number));
      expect(points, `points of line ${String(index)}`).toHaveLength(own.length);
      own.forEach((high, i) => {
        const expectedY = 8 + plotHeight - (high / 20) * plotHeight;
        expect(points[i]?.[1] ?? Number.NaN, `y of sample ${String(i)}`).toBeCloseTo(expectedY, 0);
      });
      // x strictly increases left to right (time).
      for (let i = 1; i < points.length; i += 1) {
        expect(points[i]?.[0] ?? 0).toBeGreaterThan(points[i - 1]?.[0] ?? Number.POSITIVE_INFINITY);
      }
    }
  }
}

test.describe('REQ-090/091 the round report', () => {
  test('REQ-091 a played round: PPS, APM, garbage, lines, combo and the stack-height chart match the server', async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const a = await newPlayer(browser, 'Alice');
    const b = await newPlayer(browser, 'Bob');
    const framesA = watchFrames(a.page);
    const framesB = watchFrames(b.page);
    try {
      await startMatch(a, b);
      await playRound(a, b, b); // Bob hammers and tops out; Alice idles and wins
      await expect.poll(() => framesA.gameOvers().length).toBe(1);
      await expect.poll(() => framesB.gameOvers().length).toBe(1);
      const overA = lastGameOver(framesA.gameOvers());
      const overB = lastGameOver(framesB.gameOvers());
      expect(overB.report).toEqual(overA.report);

      // The server reports a real round: a few seconds, and Bob's drops all counted.
      const reportB = overA.report.B;
      expect(reportB, 'Bob report').toBeDefined();
      expect(reportB?.piecesPlaced ?? 0).toBeGreaterThan(5);
      expect(reportB?.actions ?? 0).toBeGreaterThanOrEqual(reportB?.piecesPlaced ?? 0);
      expect(reportB?.durationTicks ?? 0).toBeGreaterThan(60);
      expect(overA.stats.B?.piecesPlaced).toBe(reportB?.piecesPlaced);

      const views: [Player, Seat, Seat, string, string][] = [
        [a, 'A', 'B', a.name, b.name],
        [b, 'B', 'A', b.name, a.name],
      ];
      for (const [player, me, opp, myName, oppName] of views) {
        const rows = await readReport(player.page);
        const mine = expectedColumn(overA, me);
        const theirs = expectedColumn(overA, opp);
        for (const label of Object.keys(mine)) {
          expect(rows[label]?.[0], `${myName}'s "${label}"`).toBe(mine[label]);
          expect(rows[label]?.[1], `${oppName}'s "${label}" as seen by ${myName}`).toBe(
            theirs[label],
          );
        }
        // The columns are titled You and the opponent's name.
        const heads = player.page.getByTestId(TEST_IDS.result.statsTable).locator('thead th');
        await expect(heads.nth(1)).toHaveText(COPY.result.you);
        await expect(heads.nth(2)).toHaveText(oppName);
        expectNoGarbageText(await cardText(player.page), `${myName}'s card`);
        await expectChartMatches(player.page, overA, [me, opp], [myName, oppName]);
      }
      // Bob really played and Alice did not: the table says so.
      const rowsA = await readReport(a.page);
      expect(Number(rowsA[COPY.result.rows.piecesPerSecond]?.[1])).toBeGreaterThan(0);
      expect(Number(rowsA[COPY.result.rows.piecesPerSecond]?.[0])).toBe(0);
      expect(a.problems).toEqual([]);
      expect(b.problems).toEqual([]);
    } finally {
      await closeAll([a, b]);
    }
  });

  test('REQ-091 a round shorter than one second shows a dash, not NaN or Infinity, and no chart', async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const a = await newPlayer(browser, 'Alice');
    const b = await newPlayer(browser, 'Bob');
    const framesB = watchFrames(b.page);
    try {
      // Alice leaves in the frame DUEL! appears (Esc, then Leave series, all inside the page so no
      // test round trip adds ticks): the shortest round there can be.
      await a.page.addInitScript(installQuickLeave, {
        overlay: TEST_IDS.countdown.overlay,
        leave: TEST_IDS.leaveConfirm.leaveSeries,
      });
      await startMatch(a, b);
      await expect(resultCard(b.page)).toBeVisible({ timeout: 10_000 });
      await expect.poll(() => framesB.gameOvers().length).toBe(1);
      const over = lastGameOver(framesB.gameOvers());
      const duration = Math.max(
        over.report.A?.durationTicks ?? 0,
        over.report.B?.durationTicks ?? 0,
      );
      console.log(`SHORT ROUND: durationTicks ${String(duration)}`);
      expect(duration, 'the forfeit round is under one second of play').toBeLessThan(60);

      const rows = await readReport(b.page);
      for (const label of [COPY.result.rows.piecesPerSecond, COPY.result.rows.actionsPerMinute]) {
        expect(rows[label], `"${label}" row`).toEqual([COPY.result.noValue, COPY.result.noValue]);
      }
      expectNoGarbageText(await cardText(b.page), 'the short round card');
      // Too few samples to chart: the axes and the "too short" note, not a line.
      await expect(b.page.getByTestId(TEST_IDS.result.chart)).toHaveAttribute('data-empty', 'true');
      await expect(b.page.getByTestId(TEST_IDS.result.chartEmpty)).toHaveText(
        COPY.result.chart.empty,
      );
      expect(b.problems).toEqual([]);
    } finally {
      await closeAll([a, b]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-061 / REQ-087 / REQ-088: the duel effects in a real match
// ---------------------------------------------------------------------------------------------

const PIECE_HOOK = /^[IOTSZJL]:[0-3]:-?\d+:-?\d+$/;

interface RingSample {
  /** Alpha (0..255) of the danger ring pixel, min and max over the sampling window. */
  readonly ringMin: number;
  readonly ringMax: number;
  /** The board frame pixel, RGBA, at the end of the window. */
  readonly frame: readonly number[];
  readonly samples: number;
}

/**
 * Runs in the page: reads one pixel of the ring (the 2 px padding above the board) and one of the
 * frame (just below it) from the board canvas on every animation frame for `ms`. The canvas is drawn
 * at device-pixel-ratio 1 in these tests, so CSS px = canvas px.
 */
function sampleDangerInPage(args: { id: string; ms: number }): Promise<RingSample> {
  const canvas = document.querySelector<HTMLCanvasElement>(`[data-testid="${args.id}"]`);
  const ctx = canvas?.getContext('2d') ?? null;
  if (canvas === null || ctx === null) throw new Error(`no 2d canvas ${args.id}`);
  const x = canvas.width - 40;
  return new Promise((resolve) => {
    const start = performance.now();
    let ringMin = 255;
    let ringMax = 0;
    let samples = 0;
    const tick = (): void => {
      const alpha = ctx.getImageData(x, 0, 1, 1).data[3] ?? 0;
      ringMin = Math.min(ringMin, alpha);
      ringMax = Math.max(ringMax, alpha);
      samples += 1;
      if (performance.now() - start < args.ms) {
        window.requestAnimationFrame(tick);
        return;
      }
      resolve({
        ringMin,
        ringMax,
        frame: Array.from(ctx.getImageData(x, 2, 1, 1).data),
        samples,
      });
    };
    window.requestAnimationFrame(tick);
  });
}

/** The alert colour of the design tokens: #FF5A36. */
function isAlertRed(rgba: readonly number[]): boolean {
  const [r = 0, g = 0, b = 0, a = 0] = rgba;
  return a === 255 && Math.abs(r - 0xff) <= 8 && Math.abs(g - 0x5a) <= 8 && Math.abs(b - 0x36) <= 8;
}

/** Space (hard drop) on `player` until its own board's danger hook is on; stops at once. */
async function stackUntilDanger(player: Player): Promise<void> {
  const own = ownCanvas(player.page);
  for (let i = 0; i < 40; i += 1) {
    if ((await own.getAttribute(DATA_HOOKS.danger)) === 'true') return;
    await player.page.keyboard.press('Space');
    await sleep(70);
  }
  throw new Error(`${player.name}'s board never reached danger in 40 drops`);
}

test.describe('REQ-061/087/088 duel effects', () => {
  test('REQ-061 the ghost is on your own board only, and follows the piece', async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const a = await newPlayer(browser, 'Alice');
    const b = await newPlayer(browser, 'Bob');
    try {
      await startMatch(a, b);
      await waitUntilLive(a);
      await waitUntilLive(b);
      for (const player of [a, b]) {
        const own = ownCanvas(player.page);
        await expect(own).toHaveAttribute(DATA_HOOKS.ghost, PIECE_HOOK);
        // The opponent's board never carries a ghost (REQ-061: a ghost is your own aid).
        await expect(oppCanvas(player.page)).toHaveAttribute(DATA_HOOKS.ghost, '');
        // The ghost is the falling piece, straight down: same kind, rotation and column.
        const active = ((await own.getAttribute(DATA_HOOKS.active)) ?? '').split(':');
        const ghost = ((await own.getAttribute(DATA_HOOKS.ghost)) ?? '').split(':');
        expect(ghost.slice(0, 3), 'ghost kind, rotation, column').toEqual(active.slice(0, 3));
        expect(Number(ghost[3])).toBeGreaterThanOrEqual(Number(active[3]));
      }
      // Moving the piece moves the ghost with it.
      const before = ((await ownCanvas(a.page).getAttribute(DATA_HOOKS.ghost)) ?? '').split(':');
      await a.page.keyboard.press('ArrowLeft');
      await expect
        .poll(
          async () =>
            ((await ownCanvas(a.page).getAttribute(DATA_HOOKS.ghost)) ?? '').split(':')[2],
        )
        .toBe(String(Number(before[2]) - 1));
      await expect(oppCanvas(a.page)).toHaveAttribute(DATA_HOOKS.ghost, '');
      expect(a.problems).toEqual([]);
    } finally {
      await closeAll([a, b]);
    }
  });

  test('REQ-087 garbage sent by one player launches a projectile that lands on the receiver', async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const opened: Player[] = [];
    try {
      // The stacker is a greedy bot on a random piece sequence: it nearly always earns a double or a
      // combo within a few dozen pieces, but not on every seed. A match where it did not is thrown
      // away and played again (up to three fresh matches), so the test fails only if the product does.
      let pair: { a: Player; b: Player; framesB: FrameLog; sent: number } | null = null;
      for (let attempt = 1; pair === null; attempt += 1) {
        const a = await newPlayer(browser, 'Alice');
        const b = await newPlayer(browser, 'Bob');
        opened.push(a, b);
        const framesB = watchFrames(b.page);
        // Both pages record the fx canvas and Bob's own garbage meter from the first frame on.
        for (const player of [a, b]) {
          await player.page.addInitScript(installFxRecorder, {
            fx: TEST_IDS.game.fxCanvas,
            meter: TEST_IDS.game.ownMeter,
            activeHook: DATA_HOOKS.fx,
            countHook: DATA_HOOKS.projectileCount,
          });
        }
        await startMatch(a, b);
        await waitUntilLive(a);
        await waitUntilLive(b);
        await expect(b.page.getByTestId(TEST_IDS.game.fxCanvas)).toHaveAttribute(
          DATA_HOOKS.projectileCount,
          '0',
        );

        // Alice stacks until her Sent counter moves (a double, or a combo); Bob idles.
        let board: Board = emptyBoard();
        let placed = 0;
        for (; placed < 80 && (await ownStat(a.page, COPY.game.sent)) === 0; placed += 1) {
          const next = await placeOnePiece(a.page, board, { attack: true, fast: true });
          if (next === null) break;
          board = next;
        }
        const sent = await ownStat(a.page, COPY.game.sent);
        console.log(
          `GARBAGE attempt ${String(attempt)}: Alice sent ${String(sent)} after ${String(placed)} pieces`,
        );
        if (sent > 0) {
          pair = { a, b, framesB, sent };
        } else {
          expect(attempt, 'the stacker earned no garbage in three fresh matches').toBeLessThan(3);
          await closeAll([a, b]);
        }
      }
      const { a, b, framesB } = pair;

      // The receiver: a projectile was launched, ran (fx > 0), and is gone again (fx back to 0).
      const fxB = b.page.getByTestId(TEST_IDS.game.fxCanvas);
      await expect(fxB).not.toHaveAttribute(DATA_HOOKS.projectileCount, '0');
      await expect(fxB).toHaveAttribute(DATA_HOOKS.fx, '0', { timeout: 10_000 });
      const logB = await b.page.evaluate(() => window.__fxLog);
      const logA = await a.page.evaluate(() => window.__fxLog);
      console.log(`FX receiver ${JSON.stringify(logB)}\nFX sender   ${JSON.stringify(logA)}`);
      expect(logB?.maxFx, 'a projectile was running on the receiver').toBeGreaterThan(0);
      expect(logB?.launched ?? 0, 'projectiles launched on the receiver').toBeGreaterThanOrEqual(1);
      expect(logB?.maxPending ?? 0, "the garbage meter on Bob's board rose").toBeGreaterThanOrEqual(
        1,
      );

      // The server's own account: Bob was sent an attack from Alice, and the totals agree.
      const attacks = framesB
        .ofType('snapshot')
        .flatMap((m) => (m.events ?? []) as { type: string; from?: string; rows: number }[])
        .filter((event) => event.type === 'attack' && event.from === 'A');
      expect(attacks.length, 'attack events from Alice reached Bob').toBeGreaterThanOrEqual(1);
      await expect
        .poll(
          async () =>
            framesB
              .ofType('snapshot')
              .flatMap((m) => (m.events ?? []) as { type: string; from?: string; rows: number }[])
              .filter((event) => event.type === 'attack' && event.from === 'A')
              .reduce((sum, event) => sum + event.rows, 0) -
            (await ownStat(a.page, COPY.game.sent)),
        )
        .toBe(0);
      expect(a.problems).toEqual([]);
      expect(b.problems).toEqual([]);
    } finally {
      await closeAll(opened);
    }
  });

  test('REQ-088 danger: both boards flip on, the frame is red and pulses (steady under reduced motion)', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const a = await newPlayer(browser, 'Alice');
    const b = await newPlayer(browser, 'Bob', { reducedMotion: true });
    try {
      await startMatch(a, b);
      await waitUntilLive(a);
      await waitUntilLive(b);
      // Before any stacking: no danger on any of the four canvases.
      for (const player of [a, b]) {
        await expect(ownCanvas(player.page)).toHaveAttribute(DATA_HOOKS.danger, 'false');
        await expect(oppCanvas(player.page)).toHaveAttribute(DATA_HOOKS.danger, 'false');
      }
      const calm = await a.page.evaluate(sampleDangerInPage, {
        id: TEST_IDS.game.ownCanvas,
        ms: 200,
      });
      expect(calm.ringMax, 'no ring while calm').toBe(0);
      expect(isAlertRed(calm.frame), 'the frame is not red while calm').toBe(false);

      // Both players stack in the middle at the same time until their own board is in danger
      // (height >= 16). Concurrent, so neither board keeps falling long before the other arrives.
      await Promise.all([stackUntilDanger(a), stackUntilDanger(b)]);
      // Each page shows danger on BOTH boards: its own, and the opponent's (public snapshots).
      for (const player of [a, b]) {
        await expect(ownCanvas(player.page)).toHaveAttribute(DATA_HOOKS.danger, 'true');
        await expect(oppCanvas(player.page)).toHaveAttribute(DATA_HOOKS.danger, 'true', {
          timeout: 5_000,
        });
      }

      // The frame is red on every board, on both pages; all four sampled at the same time (the
      // stacks keep growing while the pieces fall, so the window is kept short).
      const ids = [TEST_IDS.game.ownCanvas, TEST_IDS.game.oppCanvas];
      const looks = await Promise.all(
        [a, b].flatMap((player) =>
          ids.map(async (id) => ({
            player,
            id,
            look: await player.page.evaluate(sampleDangerInPage, { id, ms: 1_100 }),
          })),
        ),
      );
      for (const { player, id, look } of looks) {
        console.log(`DANGER ${player.name} ${id}: ${JSON.stringify(look)}`);
        expect(isAlertRed(look.frame), `${player.name} ${id}: red frame`).toBe(true);
        expect(look.ringMax, `${player.name} ${id}: ring is drawn`).toBeGreaterThan(0);
        if (player === a) {
          // Alice: normal motion. The ring pulses (alpha 1 -> 0.25 over a 900 ms cycle).
          expect(look.ringMax - look.ringMin, `${id}: ring alpha pulses`).toBeGreaterThan(100);
        } else {
          // Bob: reduced motion. The same frame, but a steady ring.
          expect(look.ringMax - look.ringMin, `${id}: ring alpha is steady`).toBeLessThanOrEqual(2);
        }
      }
      expect(a.problems).toEqual([]);
      expect(b.problems).toEqual([]);
    } finally {
      await closeAll([a, b]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-089: the music button (never the audio itself: headless Chromium cannot be heard)
// ---------------------------------------------------------------------------------------------

test.describe('REQ-089 the music button', () => {
  test('REQ-089 lobby footer and game top bar; click and M toggle aria-pressed; the choice survives a reload', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const a = await newPlayer(browser, 'Alice');
    const b = await newPlayer(browser, 'Bob');
    try {
      const created = await createGame(a);
      const button = a.page.getByTestId(TEST_IDS.music.button);

      // Lobby: the button is in the footer, named "Music", with the M key cap, on by default.
      await expect(a.page.getByTestId(TEST_IDS.lobby.screen).locator('footer')).toContainText(
        COPY.music.name,
      );
      await expect(a.page.getByTestId(TEST_IDS.lobby.screen).locator('footer')).toContainText(
        COPY.music.key,
      );
      await expect(button).toHaveAccessibleName(new RegExp(COPY.music.name));
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      const stored = () => a.page.evaluate((key) => localStorage.getItem(key), MUSIC_STORAGE_KEY);
      // The audio may be locked until a gesture; if so the UI says so and a click unlocks it.
      const state = await button.getAttribute('data-state');
      console.log(`MUSIC initial state: ${String(state)}`);
      expect(['on', 'blocked', 'off', 'unavailable']).toContain(state);
      if (state === 'blocked') {
        await expect(a.page.getByTestId(TEST_IDS.music.hint)).toHaveText(COPY.music.blockedHint);
        await button.click(); // the gesture that starts it: stays "on", does not mute
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await expect(button).not.toHaveAttribute('data-state', 'blocked');
      } else if (state === 'unavailable') {
        await expect(a.page.getByTestId(TEST_IDS.music.hint)).toHaveText(
          COPY.music.unavailableHint,
        );
      }

      if (state !== 'unavailable') {
        // Click toggles off, then on.
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(stored).toBe('off');
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(stored).toBe('on');
        // The M key toggles too (focus on the page body, not in a text field), and announces it.
        await a.page.keyboard.press('m');
        await expect(button).toHaveAttribute('aria-pressed', 'false');
        await expect(a.page.getByTestId(TEST_IDS.music.live)).toHaveText(COPY.music.announceOff);
        await expect.poll(stored).toBe('off');
        await a.page.keyboard.press('m');
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await expect(a.page.getByTestId(TEST_IDS.music.live)).toHaveText(COPY.music.announceOn);
        // Leave it off, and reload: the preference survives (localStorage, MUSIC_STORAGE_KEY).
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(stored).toBe('off');
        await a.page.reload();
        await expect(a.page.getByTestId(TEST_IDS.lobby.screen)).toBeVisible();
        await expect(a.page.getByTestId(TEST_IDS.music.button)).toHaveAttribute(
          'aria-pressed',
          'false',
        );
        expect(await stored()).toBe('off');
      }

      // Game top bar: Bob joins; the button sits in the header and shows the same remembered choice.
      await joinViaLink(b, created.link, created.code);
      for (const player of [a, b]) {
        await expect(player.page.getByTestId(TEST_IDS.game.screen)).toBeVisible();
        await expect(
          player.page.locator('header').getByTestId(TEST_IDS.music.button),
        ).toBeVisible();
      }
      if (state !== 'unavailable') {
        const inGame = a.page.locator('header').getByTestId(TEST_IDS.music.button);
        await expect(inGame).toHaveAttribute('aria-pressed', 'false');
        // M works while a round is on: it must not reach the board as a game key.
        await waitUntilLive(a);
        await a.page.keyboard.press('m');
        await expect(inGame).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(stored).toBe('on');
        await expect(ownCanvas(a.page)).not.toHaveAttribute(DATA_HOOKS.active, '');
        await inGame.click();
        await expect(inGame).toHaveAttribute('aria-pressed', 'false');
        // Bob never touched his own preference: another browser context keeps its own storage.
        await expect(b.page.locator('header').getByTestId(TEST_IDS.music.button)).toHaveAttribute(
          'aria-pressed',
          'true',
        );
      }
      expect(a.problems).toEqual([]);
      expect(b.problems).toEqual([]);
    } finally {
      await closeAll([a, b]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-062: the spectator view
// ---------------------------------------------------------------------------------------------

test.describe('REQ-062 a spectator', () => {
  test('REQ-062 sees both boards read-only with names and score; players see the count', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const a = await newPlayer(browser, 'Alice');
    const b = await newPlayer(browser, 'Bob');
    const cara = await newPlayer(browser, 'Cara');
    try {
      const { code, link } = await startMatch(a, b);
      await joinViaLink(cara, link, code);
      const view = cara.page;
      await expect(view.getByTestId(TEST_IDS.game.screen)).toHaveAttribute(
        'data-role',
        'spectator',
      );
      await expect(a.page.getByTestId(TEST_IDS.game.spectators)).toHaveText(COPY.game.watching(1));
      await expect(b.page.getByTestId(TEST_IDS.game.spectators)).toHaveText(COPY.game.watching(1));

      // Both boards, with the players' names (A left, B right), the round and the score.
      await expect(view.getByTestId(TEST_IDS.game.ownName)).toHaveText(a.name);
      await expect(view.getByTestId(TEST_IDS.game.oppName)).toHaveText(b.name);
      await expect(view.getByTestId(TEST_IDS.game.roundTag)).toHaveText(COPY.game.roundTag(1));
      expect(await pipsOf(view)).toEqual({ own: 0, opp: 0 });
      await expect(view.getByTestId(TEST_IDS.game.ownPips)).toHaveAccessibleName(
        COPY.game.pipsName(a.name, 0),
      );
      await expect(view.getByTestId(TEST_IDS.game.leaveButton)).toHaveText(COPY.game.stopWatching);
      // No controls legend for a spectator, and no Leave confirm.
      await expect(view.getByTestId(TEST_IDS.game.legend)).toHaveCount(0);
      for (const id of [TEST_IDS.game.ownCanvas, TEST_IDS.game.oppCanvas]) {
        const box = await view.getByTestId(id).boundingBox();
        expect(box?.width ?? 0).toBeGreaterThan(0);
        expect(box?.height ?? 0).toBeGreaterThan(0);
      }

      // Live: both players' boards move on the spectator's screen as they play.
      await waitUntilLive(a);
      await waitUntilLive(b);
      await expect(view.getByTestId(TEST_IDS.game.ownCanvas)).not.toHaveAttribute(
        DATA_HOOKS.active,
        '',
      );
      await expect(view.getByTestId(TEST_IDS.game.oppCanvas)).not.toHaveAttribute(
        DATA_HOOKS.active,
        '',
      );
      // The spectator sees no ghost: it is a player's own aid.
      await expect(view.getByTestId(TEST_IDS.game.ownCanvas)).toHaveAttribute(DATA_HOOKS.ghost, '');
      await a.page.keyboard.press('Space');
      await expect
        .poll(() => specStat(view, TEST_IDS.game.ownStats, COPY.game.pieces), { timeout: 5_000 })
        .toBe(1);
      await b.page.keyboard.press('Space');
      await b.page.keyboard.press('Space');
      await expect
        .poll(() => specStat(view, TEST_IDS.game.oppStats, COPY.game.pieces), { timeout: 5_000 })
        .toBe(2);

      // Read-only: a spectator's game keys do nothing to either board.
      for (const key of ['Space', 'ArrowLeft', 'ArrowUp', 'KeyX']) await view.keyboard.press(key);
      await expect.poll(() => specStat(a.page, TEST_IDS.game.ownStats, COPY.game.pieces)).toBe(1);
      expect(await specStat(b.page, TEST_IDS.game.ownStats, COPY.game.pieces)).toBe(2);
      expect(cara.problems, 'the spectator was not kicked or errored').toEqual([]);
      await expect(view.getByTestId(TEST_IDS.game.screen)).toBeVisible();

      // The round ends (Bob hammers and loses): the spectator gets a card for the winner, no buttons
      // to press but Back to home, and the report lists both players by name.
      await loseRound(b, [a, b, cara]);
      await expect(resultCard(view)).toHaveAttribute('data-kind', 'round');
      await expect(view.getByTestId(TEST_IDS.result.headline)).toHaveText(COPY.result.wins(a.name));
      await expect(view.getByTestId(TEST_IDS.result.primaryButton)).toHaveCount(0);
      await expect(view.getByTestId(TEST_IDS.result.backButton)).toHaveText(COPY.result.backToHome);
      await expect(view.getByTestId(TEST_IDS.result.status)).toHaveText(
        COPY.result.spectatorWaiting,
      );
      const heads = view.getByTestId(TEST_IDS.result.statsTable).locator('thead th');
      await expect(heads.nth(1)).toHaveText(a.name);
      await expect(heads.nth(2)).toHaveText(b.name);
      expect(await seriesBugText(view)).toBe(seriesBug(a.name, 1, 0, b.name));
      // Spectators see names in the chart, never "You".
      await expect(view.getByTestId(TEST_IDS.result.chartLegend)).toContainText(a.name);
      await expect(view.getByTestId(TEST_IDS.result.chartLegend)).not.toContainText(
        COPY.result.chart.you,
      );
      expect(cara.problems).toEqual([]);
    } finally {
      await closeAll([a, b, cara]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The known stale "disconnected 0 s" overlay, on the paths the E2E_SLOW test does not cover
// ---------------------------------------------------------------------------------------------

test.describe('disconnect overlay after a pause that resumed', () => {
  test('the overlay is gone at the round card, the next countdown and the series card', async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const a = await newPlayer(browser, 'Alice');
    const b = await newPlayer(browser, 'Bob');
    try {
      await startMatch(a, b);
      await waitUntilLive(a);
      await waitUntilLive(b);
      // Alice's tab leaves the game page mid-round (its socket closes at once), then comes back to the
      // same game address with the same session and rejoins her seat.
      const overlay = b.page.getByTestId(TEST_IDS.disconnect.overlay);
      const gameUrl = a.page.url();
      await a.page.goto('about:blank');
      await expect(overlay).toBeVisible({ timeout: 10_000 });
      await a.page.goto(gameUrl);
      await expect(a.page.getByTestId(TEST_IDS.game.screen)).toBeVisible();
      await expect(overlay).toBeHidden({ timeout: 10_000 });
      await waitUntilLive(a);
      await waitUntilLive(b);

      // Between rounds: the round ends normally; no overlay on either card.
      await loseRound(b, [a, b]);
      await expect(resultCard(a.page)).toHaveAttribute('data-kind', 'round');
      for (const player of [a, b]) {
        await expect
          .soft(
            player.page.getByTestId(TEST_IDS.disconnect.overlay),
            `${player.name}: no disconnect overlay under the round card`,
          )
          .toHaveCount(0);
      }
      await pressPrimary(a);
      await pressPrimary(b);
      for (const player of [a, b]) {
        await expect(player.page.getByTestId(TEST_IDS.countdown.round)).toHaveText(
          COPY.game.roundTag(2),
        );
        await expect
          .soft(
            player.page.getByTestId(TEST_IDS.disconnect.overlay),
            `${player.name}: no disconnect overlay in the next round's countdown`,
          )
          .toHaveCount(0);
      }

      // Series end: Alice takes round 2, so the series (2 - 0); no overlay on the series card.
      await playRound(a, b, b);
      for (const player of [a, b]) {
        await expect(resultCard(player.page)).toHaveAttribute('data-kind', 'series');
        await expect
          .soft(
            player.page.getByTestId(TEST_IDS.disconnect.overlay),
            `${player.name}: no disconnect overlay under the series card`,
          )
          .toHaveCount(0);
      }
      expect(await verdictOf(a.page, { me: a.name, opponent: b.name })).toBe('win');
    } finally {
      await closeAll([a, b]);
    }
  });
});

test.describe('a drop between rounds', () => {
  test('the round card says the opponent is reconnecting (no overlay), and Next round still works after they return', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const a = await newPlayer(browser, 'Alice');
    const b = await newPlayer(browser, 'Bob');
    try {
      await startMatch(a, b);
      await playRound(a, b, b);
      await expect(resultCard(b.page)).toHaveAttribute('data-kind', 'round');
      const gameUrl = a.page.url();
      await a.page.goto('about:blank');
      await expect(b.page.getByTestId(TEST_IDS.result.status)).toHaveText(
        COPY.result.opponentReconnecting(a.name),
        { timeout: 10_000 },
      );
      await expect(b.page.getByTestId(TEST_IDS.disconnect.overlay)).toHaveCount(0);
      await expect(resultCard(b.page)).toBeVisible();
      await a.page.goto(gameUrl);
      await expect(resultCard(a.page)).toBeVisible({ timeout: 10_000 });
      await expect(b.page.getByTestId(TEST_IDS.result.status)).toHaveText('');
      // Both accept: the next round starts as usual.
      await pressPrimary(a);
      await pressPrimary(b);
      for (const player of [a, b]) {
        await expect(player.page.getByTestId(TEST_IDS.countdown.round)).toHaveText(
          COPY.game.roundTag(2),
        );
        await expect(player.page.getByTestId(TEST_IDS.disconnect.overlay)).toHaveCount(0);
      }
      expect(await pipsOf(a.page)).toEqual({ own: 1, opp: 0 });
      expect(b.problems).toEqual([]);
    } finally {
      await closeAll([a, b]);
    }
  });
});

/** One value from a stats block (`testId`) of any page, as a number. */
async function specStat(page: Page, testId: string, label: string): Promise<number> {
  const value = page
    .getByTestId(testId)
    .locator('dt')
    .filter({ hasText: label })
    .locator('xpath=following-sibling::dd[1]');
  return Number((await value.textContent()) ?? Number.NaN);
}
