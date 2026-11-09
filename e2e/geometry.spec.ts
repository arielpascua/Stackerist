/**
 * Design gate 9d: the geometry gate. Measures the rendered box model of every screen at 1280 x 600
 * (desktop) and 390 x 844 (touch phone) against a real production server, and fails on findings.
 * A second group proves the probe can go red (gate 9d-ii) by injecting layout bugs into live pages.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  closeAll,
  COPY,
  createGame,
  DESKTOP,
  fillName,
  hardDropUntilResult,
  MOBILE,
  newPlayer,
  open,
  oppCanvas,
  ownCanvas,
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
  'home' | 'join' | 'join-error' | 'keyboard-warning' | 'lobby' | 'countdown' | 'game' | 'result';

function optionsFor(profile: Profile, screen: Screen): MeasureOptions {
  const arena = screen === 'countdown' || screen === 'game' || screen === 'result';
  return {
    touch: profile.mobile,
    noPageScroll: !profile.mobile && arena,
    mustFit: screen === 'result' ? TEST_IDS.result.card : null,
  };
}

/** Guards the fixture, measures, and returns the findings with their label. */
async function check(page: Page, profile: Profile, screen: Screen): Promise<Finding[]> {
  const label = `${screen} @ ${profile.label}`;
  await assertHealthy(page, label);
  await settle(page);
  const findings = await measure(page, optionsFor(profile, screen));
  const lines = formatFindings(label, findings);
  console.log(lines);
  return findings;
}

function expectClean(findings: readonly Finding[], what: string): void {
  expect(findings, formatFindings(what, findings)).toEqual([]);
}

async function playerFor(browser: Browser, profile: Profile, name: string): Promise<Player> {
  return newPlayer(browser, name, { viewport: profile.viewport, mobile: profile.mobile });
}

for (const profile of PROFILES) {
  test.describe(`geometry ${profile.label}`, () => {
    test('home', async ({ browser }) => {
      const player = await playerFor(browser, profile, 'Alice');
      try {
        await open(player.page, '/');
        await expect(player.page.getByTestId(TEST_IDS.home.screen)).toBeVisible();
        const findings = await check(player.page, profile, 'home');
        expect(player.problems).toEqual([]);
        expectClean(findings, `home @ ${profile.label}`);
      } finally {
        await closeAll([player]);
      }
    });

    test('join page /g/:code, then its error state', async ({ browser }) => {
      const player = await playerFor(browser, profile, 'Alice');
      try {
        const wrong = 'ZZZZZZ';
        await open(player.page, `/g/${wrong}`);
        await expect(player.page.getByTestId(TEST_IDS.home.codeInput)).toHaveValue(wrong);
        await expect(player.page.getByTestId(TEST_IDS.home.nameInput)).toBeFocused();
        const join = await check(player.page, profile, 'join');

        await fillName(player.page, player.name);
        await player.page.getByTestId(TEST_IDS.home.joinButton).click();
        await expect(player.page.getByTestId(TEST_IDS.home.codeError)).toHaveText(
          COPY.errors.roomNotFound(wrong),
        );
        const error = await check(player.page, profile, 'join-error');
        expect(player.problems).toEqual([]);
        expectClean([...join, ...error], `join @ ${profile.label}`);
      } finally {
        await closeAll([player]);
      }
    });

    test('keyboard warning (phone) and lobby', async ({ browser }) => {
      const player = await playerFor(browser, profile, 'Alice');
      const findings: Finding[] = [];
      try {
        await createGame(player, async (page) => {
          findings.push(...(await check(page, profile, 'keyboard-warning')));
        });
        await expect(player.page.getByTestId(TEST_IDS.lobby.waiting)).toBeVisible();
        findings.push(...(await check(player.page, profile, 'lobby')));
        expect(player.problems).toEqual([]);
        expectClean(findings, `lobby @ ${profile.label}`);
      } finally {
        await closeAll([player]);
      }
    });

    test('countdown, live game and result card (two real contexts)', async ({ browser }) => {
      test.setTimeout(120_000);
      const a = await playerFor(browser, profile, 'Alice');
      const b = await playerFor(browser, profile, 'Bob');
      const findings: Finding[] = [];
      try {
        await startMatch(a, b);

        // Countdown: the overlay with a numeral on screen.
        for (const player of [a, b]) {
          await expect(player.page.getByTestId(TEST_IDS.countdown.overlay)).toBeVisible();
          await expect(player.page.getByTestId(TEST_IDS.countdown.numeral)).toHaveText(/^[123]$/);
          findings.push(...(await check(player.page, profile, 'countdown')));
        }

        // Live game: two real boards.
        for (const player of [a, b]) await waitUntilLive(player);
        for (const player of [a, b]) {
          for (const canvas of [ownCanvas(player.page), oppCanvas(player.page)]) {
            const box = await canvas.boundingBox();
            expect(box?.width ?? 0, 'game canvas has no width').toBeGreaterThan(0);
            expect(box?.height ?? 0, 'game canvas has no height').toBeGreaterThan(0);
          }
          findings.push(...(await check(player.page, profile, 'game')));
        }

        // Result card.
        expect(await hardDropUntilResult([a, b])).toBe(true);
        for (const player of [a, b]) {
          await expect(resultCard(player.page)).toBeVisible();
          await expect(player.page.getByTestId(TEST_IDS.result.headline)).toBeFocused();
          findings.push(...(await check(player.page, profile, 'result')));
        }
        expect(a.problems).toEqual([]);
        expect(b.problems).toEqual([]);
        expectClean(findings, `match screens @ ${profile.label}`);
      } finally {
        await closeAll([a, b]);
      }
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Design gate 9d-ii: prove the probe can fail. A probe that has never gone red is not evidence.
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
];

function summary(findings: readonly Finding[]): string {
  return PROBE_CHECKS.map((name) => `${name}=${String(countOf(findings, name))}`).join(' ');
}

test.describe('probe can fail (gate 9d-ii)', () => {
  test('1280x600: a clipped tallest container and an over-wide body turn the probe red', async ({
    browser,
  }) => {
    const player = await newPlayer(browser, 'Alice', { viewport: DESKTOP });
    try {
      await open(player.page, '/');
      await expect(player.page.getByTestId(TEST_IDS.home.screen)).toBeVisible();
      await assertHealthy(player.page, 'probe baseline');
      await settle(player.page);
      const options: MeasureOptions = { touch: false, noPageScroll: true, mustFit: null };
      const baseline = await measure(player.page, options);

      // The tallest container, found at runtime.
      const target = await player.page.evaluate(() => {
        let tallest: Element | null = null;
        let best = 0;
        for (const el of Array.from(
          document.body.querySelectorAll('div, section, main, form, ul'),
        )) {
          if (el.closest('svg') !== null || el.closest('[aria-hidden="true"]') !== null) continue;
          const height = el.getBoundingClientRect().height;
          if (height > best && el.children.length > 0) {
            best = height;
            tallest = el;
          }
        }
        if (tallest === null) throw new Error('no container found');
        tallest.setAttribute('data-probe-target', '');
        return { tag: tallest.tagName.toLowerCase(), cls: tallest.className, height: best };
      });
      expect(target.height).toBeGreaterThan(120);

      const style = await player.page.addStyleTag({
        content:
          '[data-probe-target]{height:120px !important;min-height:0 !important;max-height:120px !important;overflow:visible !important}' +
          'body{width:2000px !important;min-width:2000px !important}',
      });

      // The mutation really took.
      const mutation = await player.page.evaluate(() => {
        const el = document.querySelector('[data-probe-target]');
        const doc = document.documentElement;
        return {
          clientHeight: el?.clientHeight ?? -1,
          scrollHeight: el?.scrollHeight ?? -1,
          overflowY: el === null ? '' : getComputedStyle(el).overflowY,
          docOverflowX: doc.scrollWidth - doc.clientWidth,
        };
      });
      expect(mutation.clientHeight).toBe(120);
      expect(mutation.scrollHeight).toBeGreaterThan(121);
      expect(mutation.overflowY).toBe('visible');
      expect(mutation.docOverflowX).toBeGreaterThan(0);

      const mutated = await measure(player.page, options);
      console.log(
        [
          'PROBE-CAN-FAIL 1280x600',
          `  tallest container: <${target.tag} class="${String(target.cls)}"> ${String(target.height)}px -> clipped to ${String(mutation.clientHeight)}px (scrollHeight ${String(mutation.scrollHeight)}, overflow-y ${mutation.overflowY}); document overflow-x ${String(mutation.docOverflowX)}px`,
          `  baseline: ${summary(baseline)}`,
          `  mutated : ${summary(mutated)}`,
        ].join('\n'),
      );
      expect(countOf(mutated, 'unclipped-v-overflow')).toBeGreaterThan(
        countOf(baseline, 'unclipped-v-overflow'),
      );
      expect(countOf(mutated, 'page-h-overflow')).toBeGreaterThan(
        countOf(baseline, 'page-h-overflow'),
      );

      // Remove it: the probe goes back to where it was.
      await style.evaluate((node) => {
        (node as Element).remove();
      });
      await player.page.evaluate(() => {
        document.querySelector('[data-probe-target]')?.removeAttribute('data-probe-target');
      });
      const restored = await measure(player.page, options);
      console.log(`  restored: ${summary(restored)}`);
      expect(countOf(restored, 'unclipped-v-overflow')).toBe(
        countOf(baseline, 'unclipped-v-overflow'),
      );
      expect(countOf(restored, 'page-h-overflow')).toBe(countOf(baseline, 'page-h-overflow'));
    } finally {
      await closeAll([player]);
    }
  });

  test('1280x600: the no-scroll rule fires on a page forced taller than the viewport', async ({
    browser,
  }) => {
    const player = await newPlayer(browser, 'Alice', { viewport: DESKTOP });
    try {
      await open(player.page, '/');
      await expect(player.page.getByTestId(TEST_IDS.home.screen)).toBeVisible();
      await assertHealthy(player.page, 'probe v baseline');
      const options: MeasureOptions = { touch: false, noPageScroll: true, mustFit: null };
      const baseline = await measure(player.page, options);
      // A page that fits has no page-v-overflow at baseline; the probe must be able to say so.
      const style = await player.page.addStyleTag({
        content: 'body{min-height:1400px !important}',
      });
      const grew = await player.page.evaluate(
        () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
      );
      expect(grew).toBeGreaterThan(0);
      const mutated = await measure(player.page, options);
      console.log(
        `PROBE-CAN-FAIL v-scroll: document scrolls by ${String(grew)}px; baseline ${summary(baseline)} | mutated ${summary(mutated)}`,
      );
      expect(countOf(mutated, 'page-v-overflow')).toBeGreaterThan(
        countOf(baseline, 'page-v-overflow'),
      );
      await style.evaluate((node) => {
        (node as Element).remove();
      });
      const restored = await measure(player.page, options);
      expect(countOf(restored, 'page-v-overflow')).toBe(countOf(baseline, 'page-v-overflow'));
    } finally {
      await closeAll([player]);
    }
  });

  test('390x844: a shrunken button and overlapping siblings turn the probe red', async ({
    browser,
  }) => {
    const player = await newPlayer(browser, 'Alice', { viewport: MOBILE, mobile: true });
    try {
      await open(player.page, '/');
      await expect(player.page.getByTestId(TEST_IDS.home.screen)).toBeVisible();
      await assertHealthy(player.page, 'probe mobile baseline');
      await settle(player.page);
      const options: MeasureOptions = { touch: true, noPageScroll: false, mustFit: null };
      const baseline = await measure(player.page, options);

      // Two in-flow siblings found at runtime: pull the second up over the first.
      const pair = await player.page.evaluate(() => {
        for (const parent of Array.from(document.body.querySelectorAll('form, div, section'))) {
          const kids = Array.from(parent.children).filter(
            (kid) =>
              kid.getBoundingClientRect().height > 30 &&
              getComputedStyle(kid).position === 'static' &&
              !kid.hasAttribute('data-overlay'),
          );
          const second = kids[1];
          if (second !== undefined) {
            second.setAttribute('data-probe-pull', '');
            return {
              parent: parent.tagName.toLowerCase(),
              height: second.getBoundingClientRect().height,
            };
          }
        }
        throw new Error('no sibling pair found');
      });
      const style = await player.page.addStyleTag({
        content:
          `[data-probe-pull]{margin-top:-${String(Math.ceil(pair.height))}px !important}` +
          `[data-testid="${TEST_IDS.home.createButton}"]{width:20px !important;min-width:0 !important;height:20px !important;min-height:0 !important;padding:0 !important}`,
      });
      const button = await player.page.getByTestId(TEST_IDS.home.createButton).evaluate((el) => ({
        w: el.getBoundingClientRect().width,
        h: el.getBoundingClientRect().height,
      }));
      expect(button.w).toBeLessThanOrEqual(21);
      expect(button.h).toBeLessThanOrEqual(21);

      const mutated = await measure(player.page, options);
      console.log(
        [
          'PROBE-CAN-FAIL 390x844',
          `  create button shrunk to ${String(Math.round(button.w))} x ${String(Math.round(button.h))}; a sibling in <${pair.parent}> pulled up by ${String(Math.ceil(pair.height))}px`,
          `  baseline: ${summary(baseline)}`,
          `  mutated : ${summary(mutated)}`,
        ].join('\n'),
      );
      expect(countOf(mutated, 'small-touch-target')).toBeGreaterThan(
        countOf(baseline, 'small-touch-target'),
      );
      expect(countOf(mutated, 'sibling-overlap')).toBeGreaterThan(
        countOf(baseline, 'sibling-overlap'),
      );

      await style.evaluate((node) => {
        (node as Element).remove();
      });
      const restored = await measure(player.page, options);
      console.log(`  restored: ${summary(restored)}`);
      expect(countOf(restored, 'small-touch-target')).toBe(countOf(baseline, 'small-touch-target'));
      expect(countOf(restored, 'sibling-overlap')).toBe(countOf(baseline, 'sibling-overlap'));
    } finally {
      await closeAll([player]);
    }
  });
});
