/**
 * The signature features in real two-browser matches (QA pass 3): the DUEL! standoff (REQ-086), the
 * best-of-3 series (REQ-083/084/085/059), the round report and stack-height chart (REQ-090/091), the
 * duel effects (REQ-061/087/088), the music button (REQ-089) and the spectator view (REQ-062).
 * Ids come from TEST_IDS, strings from COPY, canvas state from DATA_HOOKS; protocol facts (scores,
 * report numbers) come from the frames the page's own WebSocket received.
 */
import { expect, test, type Page } from '@playwright/test';
import type { GameOverMessage } from '../packages/protocol/src/index.ts';
import {
  closeAll,
  COPY,
  DATA_HOOKS,
  newPlayer,
  ownCanvas,
  resultCard,
  startMatch,
  TEST_IDS,
  verdictOf,
  waitUntilLive,
  type Player,
} from './support/app.ts';
import { watchFrames } from './support/frames.ts';
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

declare global {
  interface Window {
    __standoff?: StandoffLog;
  }
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

// Keep imports referenced while the spec grows.
void loseRound;
void waitUntilLive;
