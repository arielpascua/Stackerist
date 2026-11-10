/**
 * The geometry gate (design gate 9d) on the signature screens (QA pass 3): the standoff overlay, the
 * round card with report and chart, the series winner card (a played best-of-3 and a forfeit), the
 * spectator view and the lobby with the Music button, at 1280 x 600 and 390 x 844. Same probe, same
 * exclusions and the same fixture-health guard as geometry.spec.ts (support/geometry.ts); a last
 * group proves the probe goes red on the series card (a probe that has never failed is not evidence).
 *
 * The series card is also measured: its box height against the room the viewport leaves it.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  closeAll,
  COPY,
  createGame,
  DESKTOP,
  MOBILE,
  newPlayer,
  open,
  ownStat,
  resultCard,
  startMatch,
  TEST_IDS,
  waitUntilLive,
  type Player,
} from './support/app.ts';
import {
  assertHealthy,
  formatFindings,
  measure,
  settle,
  type CheckName,
  type Finding,
  type MeasureOptions,
} from './support/geometry.ts';
import { placeOnePiece } from './support/bot.ts';
import { playRound, pressPrimary } from './support/series.ts';
import { emptyBoard, type Board } from '../packages/engine/src/index.ts';

interface Profile {
  readonly label: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly mobile: boolean;
}

const PROFILES: readonly Profile[] = [
  { label: '1280x600 desktop', viewport: DESKTOP, mobile: false },
  { label: '390x844 mobile', viewport: MOBILE, mobile: true },
];

type Screen =
  | 'standoff'
  | 'standoff-duel'
  | 'round-card'
  | 'series-card'
  | 'forfeit-series-card'
  | 'spectator-game'
  | 'spectator-card'
  | 'lobby';

function optionsFor(profile: Profile, screen: Screen): MeasureOptions {
  const arena = screen !== 'lobby';
  const card = screen === 'round-card' || screen.endsWith('card');
  return {
    touch: profile.mobile,
    noPageScroll: !profile.mobile && arena,
    mustFit: card ? TEST_IDS.result.card : null,
  };
}

/**
 * The probe's touch rule scrolls each control into view; inside a clipped (overflow:hidden) ancestor that
 * scrolls the ancestor and leaves the layout shifted for the next measurement. Put every scroll position
 * back so one finding cannot leak into the next measurement.
 */
async function resetScroll(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (el.scrollLeft !== 0) el.scrollLeft = 0;
      if (el.scrollTop !== 0) el.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  });
}

/** Two animation frames: lets the resize observers (the card's fit scale) catch up with a style change. */
async function frames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

/** Guards the fixture, optionally lets animations finish, measures, and logs the findings. */
async function check(
  page: Page,
  profile: Profile,
  screen: Screen,
  who: string,
  rest = true,
): Promise<Finding[]> {
  const label = `${screen} (${who}) @ ${profile.label}`;
  await assertHealthy(page, label);
  if (rest) await settle(page);
  const findings = await measure(page, optionsFor(profile, screen));
  await resetScroll(page);
  console.log(formatFindings(label, findings));
  return findings;
}

function expectClean(findings: readonly Finding[], what: string): void {
  expect(findings, formatFindings(what, findings)).toEqual([]);
}

async function playerFor(
  browser: Browser,
  profile: Profile,
  name: string,
  mobile = profile.mobile,
): Promise<Player> {
  return newPlayer(browser, name, { viewport: profile.viewport, mobile });
}

interface CardMetrics {
  /** The card's rendered height (after its fit scale), px. */
  readonly rendered: number;
  /** The card's layout height before the fit scale, px. */
  readonly layout: number;
  /** The room the frame gives the card, px. */
  readonly available: number;
  readonly scale: string;
  readonly viewportHeight: number;
  readonly headlineHeight: number;
  readonly headlineLineHeight: number;
}

/** The card's box height against the room it has: the "546 of 552" measurement. */
async function cardMetrics(page: Page): Promise<CardMetrics> {
  return page.evaluate((cardId: string): CardMetrics => {
    const card = document.querySelector<HTMLElement>(`[data-testid="${cardId}"]`);
    if (card === null) throw new Error('no result card');
    const frame = card.closest<HTMLElement>('.result__frame');
    const headline = card.querySelector<HTMLElement>('h2');
    const style = frame === null ? null : getComputedStyle(frame);
    // The room the card has: the frame's content box (its padding is the card's margin to the edge).
    const available =
      frame === null || style === null
        ? -1
        : frame.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    return {
      rendered: Math.round(card.getBoundingClientRect().height * 10) / 10,
      layout: card.offsetHeight,
      available,
      scale: getComputedStyle(card).getPropertyValue('--result-scale').trim(),
      viewportHeight: document.documentElement.clientHeight,
      headlineHeight:
        headline === null ? 0 : Math.round(headline.getBoundingClientRect().height * 10) / 10,
      headlineLineHeight: headline === null ? 0 : parseFloat(getComputedStyle(headline).lineHeight),
    };
  }, TEST_IDS.result.card);
}

function describeMetrics(label: string, m: CardMetrics): string {
  const spare = Math.round((m.available - m.rendered) * 10) / 10;
  return `CARD-HEIGHT ${label}: rendered ${String(m.rendered)} px, layout ${String(m.layout)} px of ${String(m.available)} px available, spare ${String(spare)} px (scale ${m.scale}, viewport height ${String(m.viewportHeight)}, headline box ${String(m.headlineHeight)} px at line-height ${String(m.headlineLineHeight)} px)`;
}

// Wide capitals, 16 characters (NAME_MAX_LENGTH): the widest headline and the tallest series card.
const LONG_A = 'WWWWWWWWWWWWWWWW';
const LONG_B = 'MMMMMMMMMMMMMMMM';

for (const profile of PROFILES) {
  test.describe(`signature geometry ${profile.label}`, () => {
    test('standoff overlay, round card (report + chart), then the series card of a played best-of-3', async ({
      browser,
    }) => {
      test.setTimeout(200_000);
      const a = await playerFor(browser, profile, LONG_A);
      const b = await playerFor(browser, profile, LONG_B);
      const findings: Finding[] = [];
      try {
        await startMatch(a, b);

        // The standoff: the plates and the numeral, then DUEL! itself.
        for (const player of [a, b]) {
          await expect(player.page.getByTestId(TEST_IDS.countdown.overlay)).toHaveAttribute(
            'data-phase',
            /^[123]$/,
          );
          await expect(player.page.getByTestId(TEST_IDS.countdown.nameLeft)).toBeVisible();
          findings.push(
            ...(await check(player.page, profile, 'standoff', player.name.slice(0, 1))),
          );
        }
        for (const player of [a, b]) {
          await expect(player.page.getByTestId(TEST_IDS.countdown.duel)).toBeVisible({
            timeout: 10_000,
          });
          // No settle: this is the frame DUEL! lands, the most dramatic pose it has.
          findings.push(
            ...(await check(player.page, profile, 'standoff-duel', player.name.slice(0, 1), false)),
          );
        }

        // Round 1: B tops out. The round card carries the report table and the chart.
        await playRound(a, b, b);
        for (const player of [a, b]) {
          await expect(resultCard(player.page)).toHaveAttribute('data-kind', 'round');
          await expect(player.page.getByTestId(TEST_IDS.result.statsTable)).toBeVisible();
          await expect(player.page.getByTestId(TEST_IDS.result.chart)).toBeVisible();
          await expect(player.page.getByTestId(TEST_IDS.result.headline)).toBeFocused();
          findings.push(
            ...(await check(player.page, profile, 'round-card', player.name.slice(0, 1))),
          );
          console.log(
            describeMetrics(
              `round card ${player.name.slice(0, 1)}`,
              await cardMetrics(player.page),
            ),
          );
        }

        // Rounds 2 and 3: A tops out twice; B takes the series 2 - 1.
        await pressPrimary(a);
        await pressPrimary(b);
        await playRound(a, b, a);
        await pressPrimary(a);
        await pressPrimary(b);
        await playRound(a, b, a);
        for (const player of [a, b]) {
          await expect(resultCard(player.page)).toHaveAttribute('data-kind', 'series');
          await expect(player.page.getByTestId(TEST_IDS.result.chip)).toHaveCount(3);
          await expect(player.page.getByTestId(TEST_IDS.result.headline)).toBeFocused();
          findings.push(
            ...(await check(player.page, profile, 'series-card', player.name.slice(0, 1))),
          );
          console.log(
            describeMetrics(
              `series card 3 rounds, 16-char names, ${player.name.slice(0, 1)}`,
              await cardMetrics(player.page),
            ),
          );
        }
        expect(a.problems).toEqual([]);
        expect(b.problems).toEqual([]);
        expectClean(findings, `standoff + cards @ ${profile.label}`);
      } finally {
        await closeAll([a, b]);
      }
    });

    test('series card after a forfeit (winner view, short names), and the spectator view', async ({
      browser,
    }) => {
      test.setTimeout(150_000);
      const a = await playerFor(browser, profile, 'Alice', false);
      const b = await playerFor(browser, profile, 'Bob');
      const spectator = await playerFor(browser, profile, 'Cara');
      const findings: Finding[] = [];
      try {
        const { link } = await startMatch(a, b);
        // The spectator watches through the share link (no keyboard needed to watch).
        await open(spectator.page, `${link}?watch=1`);
        await expect(spectator.page.getByTestId(TEST_IDS.game.screen)).toBeVisible();
        await expect(spectator.page.getByTestId(TEST_IDS.game.ownName)).toHaveText(a.name);
        await expect(spectator.page.getByTestId(TEST_IDS.game.oppName)).toHaveText(b.name);
        await waitUntilLive(a);
        await waitUntilLive(b);
        await a.page.keyboard.press('Space');
        findings.push(...(await check(spectator.page, profile, 'spectator-game', 'Cara')));

        // Alice leaves for good: Bob wins the series by forfeit; the spectator sees the same card.
        await a.page.keyboard.press('Escape');
        await a.page.getByTestId(TEST_IDS.leaveConfirm.leaveSeries).click();
        for (const player of [b, spectator]) {
          await expect(resultCard(player.page)).toHaveAttribute('data-kind', 'series');
          await expect(player.page.getByTestId(TEST_IDS.result.headline)).toBeFocused();
        }
        findings.push(...(await check(b.page, profile, 'forfeit-series-card', 'Bob')));
        console.log(
          describeMetrics('forfeit series card, winner, short names', await cardMetrics(b.page)),
        );
        findings.push(...(await check(spectator.page, profile, 'spectator-card', 'Cara')));
        console.log(
          describeMetrics('forfeit series card, spectator', await cardMetrics(spectator.page)),
        );
        expect(b.problems).toEqual([]);
        expect(spectator.problems).toEqual([]);
        expectClean(findings, `forfeit card + spectator @ ${profile.label}`);
      } finally {
        await closeAll([a, b, spectator]);
      }
    });

    test('worst-case series card: 16-char names, a best-moment panel, report and chart (forfeit win)', async ({
      browser,
    }) => {
      test.setTimeout(150_000);
      const loser = await playerFor(browser, profile, LONG_A, false);
      const winner = await playerFor(browser, profile, LONG_B);
      try {
        await startMatch(loser, winner);
        await waitUntilLive(loser);
        await waitUntilLive(winner);
        // The winner stacks with the greedy bot until a line clears (a best-moment panel), while
        // the other player idles; then the idle player leaves and the winner holds the series card.
        let board: Board = emptyBoard();
        for (
          let piece = 0;
          piece < 20 && (await ownStat(winner.page, COPY.game.lines)) === 0;
          piece += 1
        ) {
          const next = await placeOnePiece(winner.page, board);
          if (next === null) break;
          board = next;
        }
        expect(
          await ownStat(winner.page, COPY.game.lines),
          'the bot cleared a line',
        ).toBeGreaterThan(0);
        await loser.page.keyboard.press('Escape');
        await loser.page.getByTestId(TEST_IDS.leaveConfirm.leaveSeries).click();
        await expect(resultCard(winner.page)).toHaveAttribute('data-kind', 'series');
        await expect(winner.page.getByTestId(TEST_IDS.result.bestMoment)).toBeVisible();
        await expect(winner.page.getByTestId(TEST_IDS.result.chart)).toBeVisible();
        await expect(winner.page.getByTestId(TEST_IDS.result.headline)).toBeFocused();
        const findings = await check(winner.page, profile, 'forfeit-series-card', 'worst case');
        console.log(
          describeMetrics(
            'WORST-CASE series card (forfeit, 16-char names, best moment, report, chart)',
            await cardMetrics(winner.page),
          ),
        );
        expect(winner.problems).toEqual([]);
        expectClean(findings, `worst-case series card @ ${profile.label}`);
      } finally {
        await closeAll([loser, winner]);
      }
    });

    test('lobby with the Music button, then the spectator-free waiting state', async ({
      browser,
    }) => {
      const a = await playerFor(browser, profile, 'Alice');
      try {
        await createGame(a);
        await expect(a.page.getByTestId(TEST_IDS.lobby.waiting)).toBeVisible();
        const button = a.page.getByTestId(TEST_IDS.music.button);
        await expect(button).toBeVisible();
        await expect(button).toContainText(COPY.music.name);
        const box = await button.boundingBox();
        expect(box, 'music button has a box').not.toBeNull();
        expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(profile.viewport.width);
        expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(profile.viewport.height);
        if (profile.mobile) {
          expect(box?.width ?? 0, 'music button touch width').toBeGreaterThanOrEqual(44);
          expect(box?.height ?? 0, 'music button touch height').toBeGreaterThanOrEqual(44);
        }
        const findings = await check(a.page, profile, 'lobby', 'Alice');
        expect(a.problems).toEqual([]);
        expectClean(findings, `lobby @ ${profile.label}`);
      } finally {
        await closeAll([a]);
      }
    });
  });
}

// The HUD top bar's controls (Music, Leave / Stop watching) must all be reachable on screen. The probe's
// own rules cannot see a control that a clipping parent hides (the page does not scroll, nothing
// overflows vertically, and its touch rule scrolls the clipped parent to reach the button), so this
// asserts it directly: the control's box is inside the viewport and the topmost element at its centre
// is the control itself.
for (const profile of PROFILES) {
  test(`top bar controls (Music, Leave, Stop watching) are on screen at ${profile.label}`, async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const a = await playerFor(browser, profile, 'Alice', false);
    const b = await playerFor(browser, profile, 'Bob');
    const spectator = await playerFor(browser, profile, 'Cara');
    try {
      const { link } = await startMatch(a, b);
      await open(spectator.page, `${link}?watch=1`);
      await expect(spectator.page.getByTestId(TEST_IDS.game.screen)).toBeVisible();
      for (const viewer of [b, spectator]) {
        for (const id of [TEST_IDS.music.button, TEST_IDS.game.leaveButton]) {
          const control = viewer.page.locator('header.topbar').getByTestId(id);
          await expect(control).toBeVisible();
          const where = await control.evaluate((el) => {
            const rect = el.getBoundingClientRect();
            const hit = document.elementFromPoint(
              Math.min(rect.left + rect.width / 2, document.documentElement.clientWidth - 1),
              rect.top + rect.height / 2,
            );
            return {
              left: rect.left,
              right: rect.right,
              hitIsControl: hit !== null && (el === hit || el.contains(hit)),
              width: document.documentElement.clientWidth,
            };
          });
          const what = `${viewer.name}'s ${id} (box ${String(Math.round(where.left))}..${String(Math.round(where.right))} of ${String(where.width)} px)`;
          expect.soft(where.left, `${what}: starts inside the viewport`).toBeGreaterThanOrEqual(0);
          expect
            .soft(where.right, `${what}: ends inside the viewport`)
            .toBeLessThanOrEqual(where.width);
          expect
            .soft(where.hitIsControl, `${what}: is what a tap at its centre reaches`)
            .toBe(true);
        }
      }
    } finally {
      await closeAll([a, b, spectator]);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Probe-can-fail on the new screens: inject layout bugs into the series card, expect red, remove
// them, expect the baseline back.
// ---------------------------------------------------------------------------------------------

function countOf(findings: readonly Finding[], name: CheckName): number {
  return findings.filter((f) => f.check === name).length;
}

const PROBE_CHECKS: readonly CheckName[] = [
  'page-h-overflow',
  'page-v-overflow',
  'unclipped-v-overflow',
  'sibling-overlap',
  'small-touch-target',
  'overlay-offscreen',
  'card-offscreen',
];

function summary(findings: readonly Finding[]): string {
  return PROBE_CHECKS.map((name) => `${name}=${String(countOf(findings, name))}`).join(' ');
}

test.describe('probe can fail on the series card (gate 9d-ii)', () => {
  test('1280x600 series card: a clipped card, a pulled-up footer and an off-screen card turn the probe red', async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const a = await newPlayer(browser, 'Alice', { viewport: DESKTOP });
    const b = await newPlayer(browser, 'Bob', { viewport: DESKTOP });
    try {
      await startMatch(a, b);
      await waitUntilLive(a);
      await waitUntilLive(b);
      await a.page.keyboard.press('Escape');
      await a.page.getByTestId(TEST_IDS.leaveConfirm.leaveSeries).click();
      await expect(resultCard(b.page)).toHaveAttribute('data-kind', 'series');
      const { page } = b;
      await assertHealthy(page, 'series-card probe baseline');
      await settle(page);
      const options: MeasureOptions = {
        touch: false,
        noPageScroll: true,
        mustFit: TEST_IDS.result.card,
      };
      const baseline = await measure(page, options);
      expect(baseline, formatFindings('series card baseline', baseline)).toEqual([]);

      // Bug 1: the card is forced to 240 px and told not to clip: its contents spill out of it.
      // Bug 2: the footer is pulled up over the body (siblings overlap).
      // Bug 3: the whole card is pushed 700 px to the right (off the screen).
      const style = await page.addStyleTag({
        content:
          `[data-testid="${TEST_IDS.result.card}"]{height:240px !important;max-height:240px !important;min-height:0 !important;overflow:visible !important;margin-left:700px !important}` +
          '.result-card__actions{margin-top:-160px !important}',
      });
      const mutation = await page.evaluate((id: string) => {
        const card = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        return {
          clientHeight: card?.clientHeight ?? -1,
          scrollHeight: card?.scrollHeight ?? -1,
          right: card?.getBoundingClientRect().right ?? -1,
        };
      }, TEST_IDS.result.card);
      expect(mutation.clientHeight).toBeLessThanOrEqual(240);
      expect(mutation.scrollHeight).toBeGreaterThan(mutation.clientHeight + 1);
      expect(mutation.right).toBeGreaterThan(DESKTOP.width);

      await frames(page);
      const mutated = await measure(page, options);
      console.log(
        [
          'PROBE-CAN-FAIL series card 1280x600',
          `  card forced to ${String(mutation.clientHeight)} px (scrollHeight ${String(mutation.scrollHeight)}), right edge at ${String(Math.round(mutation.right))} px of ${String(DESKTOP.width)}`,
          `  baseline: ${summary(baseline)}`,
          `  mutated : ${summary(mutated)}`,
        ].join('\n'),
      );
      expect(countOf(mutated, 'unclipped-v-overflow')).toBeGreaterThan(
        countOf(baseline, 'unclipped-v-overflow'),
      );
      expect(countOf(mutated, 'card-offscreen')).toBeGreaterThan(
        countOf(baseline, 'card-offscreen'),
      );
      expect(countOf(mutated, 'sibling-overlap')).toBeGreaterThan(
        countOf(baseline, 'sibling-overlap'),
      );

      // Remove it: back to the baseline.
      await style.evaluate((node) => {
        (node as Element).remove();
      });
      await frames(page);
      const restored = await measure(page, options);
      console.log(`  restored: ${summary(restored)}`);
      expect(restored, formatFindings('series card restored', restored)).toEqual([]);
    } finally {
      await closeAll([a, b]);
    }
  });

  test('390x844 series card: a shrunken New series button turns the touch rule red', async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const a = await newPlayer(browser, 'Alice', { viewport: MOBILE, mobile: true });
    const b = await newPlayer(browser, 'Bob', { viewport: MOBILE, mobile: true });
    try {
      await startMatch(a, b);
      await waitUntilLive(a);
      await waitUntilLive(b);
      await a.page.keyboard.press('Escape');
      await a.page.getByTestId(TEST_IDS.leaveConfirm.leaveSeries).click();
      await expect(resultCard(b.page)).toHaveAttribute('data-kind', 'series');
      const { page } = b;
      await assertHealthy(page, 'series-card mobile probe baseline');
      await settle(page);
      const options: MeasureOptions = {
        touch: true,
        noPageScroll: false,
        mustFit: TEST_IDS.result.card,
      };
      const baseline = await measure(page, options);
      expect(baseline, formatFindings('mobile series card baseline', baseline)).toEqual([]);
      const style = await page.addStyleTag({
        content: `[data-testid="${TEST_IDS.result.backButton}"]{width:20px !important;min-width:0 !important;height:20px !important;min-height:0 !important;padding:0 !important}`,
      });
      await frames(page);
      const mutated = await measure(page, options);
      await resetScroll(page);
      console.log(
        `PROBE-CAN-FAIL series card 390x844: baseline ${summary(baseline)} | mutated ${summary(mutated)}`,
      );
      expect(countOf(mutated, 'small-touch-target')).toBeGreaterThan(
        countOf(baseline, 'small-touch-target'),
      );
      await style.evaluate((node) => {
        (node as Element).remove();
      });
      await frames(page);
      const restored = await measure(page, options);
      expect(restored, formatFindings('mobile series card restored', restored)).toEqual([]);
    } finally {
      await closeAll([a, b]);
    }
  });
});
