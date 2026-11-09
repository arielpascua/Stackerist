/**
 * REQ-066: two real browser contexts play a real round against the production server.
 * Every id, hook and string is imported from the app (architecture §7.4); canvas state is read from
 * `DATA_HOOKS`, never from pixels.
 */
import { expect, test } from '@playwright/test';
import {
  closeAll,
  COPY,
  createGame,
  DATA_HOOKS,
  fillName,
  hardDropUntilResult,
  joinViaLink,
  newPlayer,
  open,
  oppCanvas,
  ownCanvas,
  ownLinesCleared,
  ownStat,
  resultCard,
  startMatch,
  TEST_IDS,
  verdictOf,
  waitUntilLive,
  type Player,
} from './support/app.ts';

test.describe('two players, one real round', () => {
  test('A creates, B joins by link, both play to a result card', async ({ browser }) => {
    test.setTimeout(120_000);
    const a = await newPlayer(browser, 'Alice');
    const b = await newPlayer(browser, 'Bob');
    try {
      // A: home -> lobby, reads the code and the share link.
      const { code, link } = await createGame(a);
      expect(code).toMatch(/^[A-Z0-9]{6}$/);
      expect(link).toMatch(new RegExp(`/g/${code}$`));
      await expect(a.page.getByTestId(TEST_IDS.lobby.seriesLine)).toHaveText(
        COPY.lobby.seriesIntro,
      );
      await expect(a.page.getByTestId(TEST_IDS.lobby.waiting)).toHaveText(COPY.lobby.waiting);

      // B: opens the link; the code is pre-filled and the name has focus (REQ-058).
      await joinViaLink(b, link, code);

      // Both see the countdown, then two boards.
      for (const player of [a, b]) {
        await expect(player.page.getByTestId(TEST_IDS.game.screen)).toBeVisible();
        await expect(player.page.getByTestId(TEST_IDS.countdown.overlay)).toBeVisible();
        await expect(player.page.getByTestId(TEST_IDS.game.roomCode)).toHaveText(code);
      }
      const own = { a: a.name, b: b.name };
      await test.step("REQ-022 each player's screen names their own board and the opponent's", async () => {
        await expect(a.page.getByTestId(TEST_IDS.game.ownName)).toHaveText(own.a);
        await expect(a.page.getByTestId(TEST_IDS.game.oppName)).toHaveText(own.b);
        await expect(b.page.getByTestId(TEST_IDS.game.ownName)).toHaveText(own.b);
        await expect(b.page.getByTestId(TEST_IDS.game.oppName)).toHaveText(own.a);
      });

      await test.step("REQ-022 each player sees their own and the opponent's board live, a piece falling on both", async () => {
        for (const player of [a, b]) {
          await waitUntilLive(player);
          for (const canvas of [ownCanvas(player.page), oppCanvas(player.page)]) {
            await expect(canvas).toBeVisible();
            await expect(canvas).not.toHaveAttribute(DATA_HOOKS.active, '');
            const box = await canvas.boundingBox();
            expect(box?.width ?? 0).toBeGreaterThan(0);
            expect(box?.height ?? 0).toBeGreaterThan(0);
          }
          await expect(player.page.getByTestId(TEST_IDS.countdown.overlay)).toBeHidden();
        }
      });

      // Hard-drop (Space) on both until somebody tops out.
      const ended = await hardDropUntilResult([a, b]);
      expect(ended, 'no result card inside the budget').toBe(true);
      await expect(resultCard(a.page)).toBeVisible();
      await expect(resultCard(b.page)).toBeVisible();

      // Opposite outcomes, or both Draw.
      const verdicts = [await verdictOf(a.page), await verdictOf(b.page)].sort();
      const pairOk =
        (verdicts[0] === 'lose' && verdicts[1] === 'win') ||
        (verdicts[0] === 'draw' && verdicts[1] === 'draw');
      expect(pairOk, `verdicts were ${verdicts.join(' / ')}`).toBe(true);

      // The series score is shown on both cards and agrees with the verdicts.
      const scoreOf = async (player: Player): Promise<string> =>
        ((await player.page.getByTestId(TEST_IDS.result.seriesScore).textContent()) ?? '').replace(
          /\s+/g,
          ' ',
        );
      const aScore = await scoreOf(a);
      const bScore = await scoreOf(b);
      expect(aScore).toContain(COPY.result.seriesLabel);
      expect(aScore).toContain(own.a);
      expect(aScore).toContain(own.b);
      expect(aScore).toBe(bScore);
      const winsA = (await verdictOf(a.page)) === 'win' ? 1 : 0;
      const winsB = (await verdictOf(b.page)) === 'win' ? 1 : 0;
      expect(aScore).toContain(`${String(winsA)} – ${String(winsB)}`);

      // Each player's best-moment panel is shown iff they cleared a line.
      for (const player of [a, b]) {
        const lines = await ownLinesCleared(player.page);
        const panel = player.page.getByTestId(TEST_IDS.result.bestMoment);
        if (lines > 0) {
          await expect(panel).toBeVisible();
          await expect(panel).toContainText(COPY.result.yourBestMoment);
        } else {
          await expect(panel).toHaveCount(0);
        }
      }

      // The reason line and the stats table are shown.
      for (const player of [a, b]) {
        await expect(player.page.getByTestId(TEST_IDS.result.reason)).not.toBeEmpty();
        await expect(player.page.getByTestId(TEST_IDS.result.statsTable)).toBeVisible();
        await expect(player.page.getByTestId(TEST_IDS.result.primaryButton)).toBeVisible();
      }

      expect(a.problems, 'A console problems').toEqual([]);
      expect(b.problems, 'B console problems').toEqual([]);
    } finally {
      await closeAll([a, b]);
    }
  });
});

test.describe('rejoin, wrong code, full room', () => {
  test('a refresh mid-match puts the player back in their seat', async ({ browser }) => {
    test.setTimeout(90_000);
    const a = await newPlayer(browser, 'Alice');
    const b = await newPlayer(browser, 'Bob');
    try {
      const { code } = await startMatch(a, b);
      await waitUntilLive(a);
      await waitUntilLive(b);

      // Place two pieces so there is a board worth restoring (the stats show it).
      for (const placed of [1, 2]) {
        await a.page.keyboard.press('Space');
        await expect.poll(() => ownStat(a.page, COPY.game.pieces)).toBe(placed);
      }
      const nextBefore = await ownCanvas(a.page).getAttribute(DATA_HOOKS.next);
      const statsBefore = (await a.page.getByTestId(TEST_IDS.game.ownStats).textContent()) ?? '';
      expect(nextBefore).toBeTruthy();

      await a.page.reload();

      // Same URL, same seat, same board: the game screen, A on the left, the same piece queue.
      await expect(a.page).toHaveURL(new RegExp(`/g/${code}$`));
      await expect(a.page.getByTestId(TEST_IDS.game.screen)).toBeVisible();
      await expect(a.page.getByTestId(TEST_IDS.game.ownName)).toHaveText(a.name);
      await expect(a.page.getByTestId(TEST_IDS.game.oppName)).toHaveText(b.name);
      await expect(a.page.getByTestId(TEST_IDS.game.roomCode)).toHaveText(code);
      await expect(ownCanvas(a.page)).not.toHaveAttribute(DATA_HOOKS.active, '');
      await expect(ownCanvas(a.page)).toHaveAttribute(DATA_HOOKS.next, nextBefore ?? '');
      await expect(a.page.getByTestId(TEST_IDS.game.ownStats)).toHaveText(statsBefore);
      // The home form is not what the player sees.
      await expect(a.page.getByTestId(TEST_IDS.home.screen)).toHaveCount(0);

      // The match goes on from there: both are live again and play to a result.
      await waitUntilLive(a);
      await waitUntilLive(b);
      expect(await hardDropUntilResult([a, b])).toBe(true);
      const verdicts = [await verdictOf(a.page), await verdictOf(b.page)].sort();
      expect(['lose,win', 'draw,draw']).toContain(verdicts.join(','));
    } finally {
      await closeAll([a, b]);
    }
  });

  test('a wrong code shows room-not-found and a way back', async ({ browser }) => {
    const a = await newPlayer(browser, 'Alice');
    try {
      const wrong = 'ZZZZZZ';
      await open(a.page, `/g/${wrong}`);
      await expect(a.page.getByTestId(TEST_IDS.home.codeInput)).toHaveValue(wrong);
      await fillName(a.page, a.name);
      await a.page.getByTestId(TEST_IDS.home.joinButton).click();
      await expect(a.page.getByTestId(TEST_IDS.home.codeError)).toHaveText(
        COPY.errors.roomNotFound(wrong),
      );
      // The way back: create a game instead.
      const create = a.page.getByTestId(TEST_IDS.home.createButton);
      await expect(create).toHaveAccessibleName(COPY.home.createInstead);
      await create.click();
      await expect(a.page.getByTestId(TEST_IDS.lobby.screen)).toBeVisible();
      expect(a.problems).toEqual([]);
    } finally {
      await closeAll([a]);
    }
  });

  test('a wrong code typed on the home form shows room-not-found', async ({ browser }) => {
    const a = await newPlayer(browser, 'Alice');
    try {
      const wrong = 'ZZZZZZ';
      await open(a.page, '/');
      await fillName(a.page, a.name);
      await a.page.getByTestId(TEST_IDS.home.codeInput).fill(wrong);
      await a.page.getByTestId(TEST_IDS.home.joinButton).click();
      await expect(a.page.getByTestId(TEST_IDS.home.codeError)).toHaveText(
        COPY.errors.roomNotFound(wrong),
      );
      await expect(a.page.getByTestId(TEST_IDS.home.createButton)).toHaveAccessibleName(
        COPY.home.create,
      );
    } finally {
      await closeAll([a]);
    }
  });

  test('a third player is a spectator; the ninth viewer gets the room-full copy', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const a = await newPlayer(browser, 'Alice');
    const b = await newPlayer(browser, 'Bob');
    const watchers: Player[] = [];
    try {
      const { code, link } = await startMatch(a, b);

      // Third context joins with a name through the normal form: the server seats it as a spectator.
      const third = await newPlayer(browser, 'Cara');
      watchers.push(third);
      await joinViaLink(third, link, code);
      await expect(third.page.getByTestId(TEST_IDS.game.screen)).toBeVisible();
      await expect(third.page.getByTestId(TEST_IDS.game.notice)).toHaveText(
        COPY.errors.joinedAsSpectator,
      );
      await expect(third.page.getByTestId(TEST_IDS.game.leaveButton)).toHaveText(
        COPY.game.stopWatching,
      );
      await expect(a.page.getByTestId(TEST_IDS.game.spectators)).toHaveText(COPY.game.watching(1));

      // Seven more watch links make eight spectators: the cap.
      for (let i = 0; i < 7; i += 1) {
        const watcher = await newPlayer(browser, `Watcher${String(i)}`, {
          viewport: { width: 640, height: 480 },
        });
        watchers.push(watcher);
        await open(watcher.page, `${link}?watch=1`);
        await expect(watcher.page.getByTestId(TEST_IDS.game.screen)).toBeVisible();
      }
      await expect(a.page.getByTestId(TEST_IDS.game.spectators)).toHaveText(COPY.game.watching(8));

      // The ninth is refused, with the room-full copy and the way back on the page.
      const ninth = await newPlayer(browser, 'Ninth');
      watchers.push(ninth);
      await joinViaLink(ninth, link, code);
      await expect(ninth.page.getByTestId(TEST_IDS.home.codeError)).toHaveText(
        COPY.errors.roomFull,
      );
      await expect(ninth.page.getByTestId(TEST_IDS.home.createButton)).toHaveAccessibleName(
        COPY.home.createInstead,
      );
      await expect(a.page.getByTestId(TEST_IDS.game.spectators)).toHaveText(COPY.game.watching(8));
    } finally {
      await closeAll([a, b, ...watchers]);
    }
  });
});
