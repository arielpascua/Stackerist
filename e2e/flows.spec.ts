/**
 * REQ-030 / REQ-031 / REQ-022 in real browsers: explicit leave, disconnect -> pause -> resume, grace
 * expiry, and the opponent's board being live. Every flow is bounded by hard timeouts; there is no
 * `waitForTimeout` anywhere. Ids come from TEST_IDS, strings from COPY, canvas state from DATA_HOOKS.
 * Protocol facts (the gameOver reason, the series winner, paused / resumed) are read from the frames the
 * page's own WebSocket received, so a UI that maps the wrong reason to the right words still fails.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  closeAll,
  COPY,
  DATA_HOOKS,
  newPlayer,
  oppCanvas,
  ownCanvas,
  ownStat,
  resultCard,
  startMatch,
  TEST_IDS,
  verdictOf,
  waitUntilLive,
  type Player,
} from './support/app.ts';
import { readBoards, watchFrames, type CanvasHooks } from './support/frames.ts';

/** A and B in a running round, both live, with the frame watchers attached before the sockets open. */
async function liveDuel(browser: Browser) {
  const a = await newPlayer(browser, 'Alice');
  const b = await newPlayer(browser, 'Bob');
  const framesA = watchFrames(a.page);
  const framesB = watchFrames(b.page);
  await startMatch(a, b);
  await waitUntilLive(a);
  await waitUntilLive(b);
  return { a, b, framesA, framesB };
}

/** Hard-drops `count` pieces (Space), waiting for the Pieces counter to move after each one. */
async function placePieces(player: Player, count: number): Promise<void> {
  const start = await ownStat(player.page, COPY.game.pieces);
  for (let n = 1; n <= count; n += 1) {
    await player.page.keyboard.press('Space');
    await expect
      .poll(() => ownStat(player.page, COPY.game.pieces), { timeout: 10_000 })
      .toBe(start + n);
  }
}

/**
 * Hard-drops once and waits until the Pieces counter has gone up. For a running match where gravity can
 * lock a piece of its own at any moment: `placePieces` insists on exactly one more and would fail then.
 */
async function placeAtLeastOne(player: Player): Promise<void> {
  const start = await ownStat(player.page, COPY.game.pieces);
  await player.page.keyboard.press('Space');
  await expect
    .poll(() => ownStat(player.page, COPY.game.pieces), { timeout: 10_000 })
    .toBeGreaterThan(start);
}

/** One value from the OPPONENT's stats block, as a number. */
async function oppStat(page: Page, label: string): Promise<number> {
  const value = page
    .getByTestId(TEST_IDS.game.oppStats)
    .locator('dt')
    .filter({ hasText: label })
    .locator('xpath=following-sibling::dd[1]');
  return Number((await value.textContent()) ?? Number.NaN);
}

/** What one board shows of a piece: the same in the owner's view and in the opponent's view of it. */
function expectSameBoard(owner: CanvasHooks, viewedByOpponent: CanvasHooks, what: string): void {
  expect(owner[DATA_HOOKS.active], `${what}: falling piece`).toBe(
    viewedByOpponent[DATA_HOOKS.active],
  );
  expect(owner[DATA_HOOKS.combo], `${what}: combo`).toBe(viewedByOpponent[DATA_HOOKS.combo]);
  expect(owner[DATA_HOOKS.pending], `${what}: pending garbage`).toBe(
    viewedByOpponent[DATA_HOOKS.pending],
  );
  // The owner sees five upcoming pieces, the opponent one: the opponent's is the owner's first.
  const next = owner[DATA_HOOKS.next] ?? '';
  const publicNext = viewedByOpponent[DATA_HOOKS.next] ?? '';
  expect(publicNext.length, `${what}: opponent sees one next piece`).toBe(1);
  expect(next.startsWith(publicNext), `${what}: next ${next} vs ${publicNext}`).toBe(true);
}

test.describe('REQ-030 explicit leave', () => {
  test('REQ-030 A leaves and confirms: B sees OPPONENT_LEFT and the series; A lands on home', async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const { a, b, framesB } = await liveDuel(browser);
    try {
      await a.page.getByTestId(TEST_IDS.game.leaveButton).click();
      const dialog = a.page.getByTestId(TEST_IDS.leaveConfirm.dialog);
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(COPY.leaveConfirm.question(b.name));
      await a.page.getByTestId(TEST_IDS.leaveConfirm.leaveSeries).click();

      // B: the result card at once, with the leave reason, and the series is theirs.
      await expect(resultCard(b.page)).toBeVisible({ timeout: 5_000 });
      // A forfeit ends the series, so B is shown the series winner card (not a round verdict): the
      // winner's name in the headline, the leave reason, the 0 – 0 score, and the series is over.
      await expect(resultCard(b.page)).toHaveAttribute('data-kind', 'series');
      expect(await verdictOf(b.page, { me: b.name, opponent: a.name })).toBe('win');
      await expect(b.page.getByTestId(TEST_IDS.result.headline)).toHaveText(
        COPY.result.series.headline(b.name, null),
      );
      await expect(b.page.getByTestId(TEST_IDS.result.finalLabel)).toHaveText(
        COPY.result.series.final,
      );
      await expect(b.page.getByTestId(TEST_IDS.result.reason)).toHaveText(
        COPY.result.series.opponentLeftYours(a.name),
      );
      const score = b.page.getByTestId(TEST_IDS.result.seriesScore);
      await expect(score).toContainText(a.name);
      await expect(score).toContainText(b.name);
      await expect(score).toContainText('0 – 0');
      // Series over: New series is the action (never Next round); A has left, so it cannot be pressed.
      const primary = b.page.getByTestId(TEST_IDS.result.primaryButton);
      await expect(primary).toHaveText(COPY.result.newSeries);
      await expect(b.page.getByRole('button', { name: COPY.result.nextRound })).toHaveCount(0);
      await expect(primary).toBeDisabled();
      await expect(b.page.getByTestId(TEST_IDS.result.status)).toHaveText(COPY.result.opponentLeft);
      await expect.poll(() => framesB.gameOvers().length, { timeout: 5_000 }).toBe(1);
      const over = framesB.gameOvers()[0];
      expect(over?.reason).toBe('OPPONENT_LEFT');
      expect(over?.winner).toBe('B');
      expect(over?.series.over).toBe(true);
      expect(over?.series.winner).toBe('B');
      expect(over?.series.endReason).toBe('OPPONENT_LEFT');
      // A forfeit adds no round win (decision 25): the series is awarded, the score stays truthful.
      expect(over?.series.score).toEqual({ A: 0, B: 0 });

      // A: back on the home screen, and no longer in the room (a reload does not put A back).
      await expect(a.page.getByTestId(TEST_IDS.home.screen)).toBeVisible();
      await expect(a.page).toHaveURL(/\/$/);
      await a.page.reload();
      await expect(a.page.getByTestId(TEST_IDS.home.screen)).toBeVisible();
      await expect(a.page.getByTestId(TEST_IDS.game.screen)).toHaveCount(0);
      expect(a.problems, 'A console problems').toEqual([]);
      expect(b.problems, 'B console problems').toEqual([]);
    } finally {
      await closeAll([a, b]);
    }
  });

  test('REQ-030 cancelling the leave confirm keeps the match running', async ({ browser }) => {
    test.setTimeout(90_000);
    const { a, b, framesA, framesB } = await liveDuel(browser);
    try {
      await a.page.getByTestId(TEST_IDS.game.leaveButton).click();
      await expect(a.page.getByTestId(TEST_IDS.leaveConfirm.dialog)).toBeVisible();
      await a.page.getByTestId(TEST_IDS.leaveConfirm.keepPlaying).click();
      await expect(a.page.getByTestId(TEST_IDS.leaveConfirm.dialog)).toBeHidden();

      // Still in the game and still live: A places a piece, nobody has a result, the opponent never
      // saw a leave.
      await expect(a.page.getByTestId(TEST_IDS.game.screen)).toBeVisible();
      await waitUntilLive(a);
      await placePieces(a, 1);
      await expect(resultCard(a.page)).toHaveCount(0);
      await expect(resultCard(b.page)).toHaveCount(0);
      await expect(b.page.getByTestId(TEST_IDS.disconnect.overlay)).toHaveCount(0);
      expect(framesA.gameOvers()).toEqual([]);
      expect(framesB.gameOvers()).toEqual([]);
      expect(a.problems, 'A console problems').toEqual([]);
    } finally {
      await closeAll([a, b]);
    }
  });
});

test.describe('REQ-031 disconnect, pause, resume, forfeit', () => {
  test('REQ-031 A drops: B sees the live timer; A rejoins; both resume on the same boards', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const { a, b, framesB } = await liveDuel(browser);
    try {
      // A board worth restoring on each side.
      await placePieces(a, 2);
      await placePieces(b, 1);

      // A's connection drops without a Leave. The server notices through its own ping/pong, so the
      // match keeps running for up to 10 s after the drop and a falling piece can lock in that
      // window. Nothing below compares against the state before the drop: the reference is the state
      // at the `paused` message (the exact state the server froze).
      await a.context.setOffline(true);
      const overlay = b.page.getByTestId(TEST_IDS.disconnect.overlay);
      await expect(overlay).toBeVisible({ timeout: 30_000 });
      await expect(b.page.getByTestId(TEST_IDS.disconnect.title)).toHaveText(
        COPY.disconnect.title(a.name),
      );
      await expect(overlay).toContainText(COPY.disconnect.waitingPlayer(a.name));

      // The timer is live: it shows seconds out of 20 and counts down.
      const timer = b.page.getByTestId(TEST_IDS.disconnect.timer);
      const seconds = async (): Promise<number> =>
        Number(((await timer.textContent()) ?? '').replace(/\D+/g, ''));
      const first = await seconds();
      expect(first).toBeGreaterThan(0);
      expect(first).toBeLessThanOrEqual(20);
      await expect.poll(seconds, { timeout: 8_000 }).toBeLessThan(first);

      // The server's own words: seat A paused, a 20 s grace.
      const paused = framesB.ofType('paused').at(-1);
      expect(paused?.seat).toBe('A');
      // The paused state in protocol terms: the last snapshot B received before `paused`. A lock always
      // sends a snapshot at once, so the piece counts in it are exact.
      const pausedAt = framesB.messages.findIndex((m) => m.type === 'paused');
      const pausedSnapshot = framesB.messages
        .slice(0, pausedAt)
        .filter((m) => m.type === 'snapshot')
        .at(-1);
      expect(pausedSnapshot, 'B received a snapshot before `paused`').toBeDefined();
      const pausedPieces = (seat: 'A' | 'B'): number => {
        const players = pausedSnapshot?.players as
          Record<string, { stats: { piecesPlaced: number } } | undefined> | undefined;
        return players?.[seat]?.stats.piecesPlaced ?? Number.NaN;
      };
      const graceMs = Number(paused?.graceEndsAt) - Number(paused?.serverNow);
      expect(graceMs).toBeGreaterThanOrEqual(19_900);
      expect(graceMs).toBeLessThanOrEqual(20_100);

      // Nothing moves while paused: B's two boards are the same a few seconds on.
      const pausedB = await readBoards(b.page);
      await expect.poll(() => readBoards(b.page), { timeout: 3_000 }).toEqual(pausedB);

      // A comes back inside the grace period with the same session (sessionStorage survives a reload).
      await a.context.setOffline(false);
      await a.page.reload();
      await expect(a.page.getByTestId(TEST_IDS.game.screen)).toBeVisible();
      for (const player of [a, b]) {
        await expect(player.page.getByTestId(TEST_IDS.countdown.overlay)).toBeVisible();
      }
      await expect(overlay).toBeHidden();

      // Same board state as at the `paused` message. Stats are exact (a lock always sends a snapshot):
      // A's own stats are what B showed of A while paused, the piece counts are the ones the paused
      // snapshot carried, and B's stats did not move either.
      const resumedB = await readBoards(b.page);
      const resumedA = await readBoards(a.page);
      expect(resumedA.ownStats).toBe(pausedB.oppStats);
      expect(resumedA.oppStats).toBe(pausedB.ownStats);
      expect(resumedB.ownStats).toBe(pausedB.ownStats);
      expect(resumedB.oppStats).toBe(pausedB.oppStats);
      expect(await ownStat(a.page, COPY.game.pieces), "A's pieces at resume").toBe(
        pausedPieces('A'),
      );
      expect(await ownStat(b.page, COPY.game.pieces), "B's pieces at resume").toBe(
        pausedPieces('B'),
      );

      // The resume anchor continues the same tick count: no ticks lost or gained across the pause.
      const resumed = framesB.ofType('resumed').at(-1);
      expect(resumed, 'B received `resumed`').toBeDefined();
      const gapTicks = Number(resumed?.tick) - Number(pausedSnapshot?.tick);
      expect(gapTicks).toBeGreaterThanOrEqual(0);
      expect(gapTicks).toBeLessThanOrEqual(2);

      // Snapshots go out every second tick, so the paused snapshot can be up to 2 ticks behind the
      // freeze and gravity may have moved a falling piece one row in them (never the preview, the combo
      // or the pending garbage). With no tick in between, B's two boards are identical to the paused ones.
      const withoutActive = (hooks: CanvasHooks): CanvasHooks => ({
        ...hooks,
        [DATA_HOOKS.active]: null,
      });
      expect(withoutActive(resumedB.own)).toEqual(withoutActive(pausedB.own));
      expect(withoutActive(resumedB.opp)).toEqual(withoutActive(pausedB.opp));
      if (gapTicks === 0) expect(resumedB).toEqual(pausedB);
      // Both screens were rebuilt from the same resume snapshot, so they agree exactly.
      expectSameBoard(resumedA.own, resumedB.opp, "A's board, A's view against B's view");
      expectSameBoard(resumedB.own, resumedA.opp, "B's board, B's view against A's view");

      // After the 3 s countdown both are live again and the game goes on from there.
      await waitUntilLive(a);
      await waitUntilLive(b);
      await expect
        .poll(() => ownCanvas(a.page).getAttribute(DATA_HOOKS.active), { timeout: 10_000 })
        .not.toBe(resumedA.own[DATA_HOOKS.active]);
      // The match is running again, so a piece may also lock by gravity: "goes on" means each player
      // can place another piece, not that the count is exactly one more.
      await placeAtLeastOne(a);
      await placeAtLeastOne(b);
      expect(await ownStat(a.page, COPY.game.pieces)).toBeGreaterThan(pausedPieces('A'));
      await expect(resultCard(a.page)).toHaveCount(0);
      await expect(resultCard(b.page)).toHaveCount(0);
      expect(framesB.gameOvers()).toEqual([]);
      expect(b.problems, 'B console problems').toEqual([]);
    } finally {
      await closeAll([a, b]);
    }
  });

  // The grace period is the protocol constant GRACE_MS = 20 s, and the production server that Playwright
  // starts takes no option to shorten it (createServer's `limits` has no grace entry, `index.ts` reads
  // only PORT/HOST/LOG_LEVEL/client-IP settings). Waiting 20 s in every run is not acceptable, so this
  // flow is opt-in: `E2E_SLOW=1 pnpm e2e` runs it (about 40 s). The same rule is proven in milliseconds
  // at server level (apps/server/test/disconnect.test.ts); only the browser rendering needs this.
  test('REQ-031 grace expiry forfeits the series with OPPONENT_DISCONNECTED (slow: E2E_SLOW=1)', async ({
    browser,
  }) => {
    test.skip(
      process.env.E2E_SLOW !== '1',
      'testability gap: GRACE_MS (20 s) cannot be shortened for the e2e web server; set E2E_SLOW=1',
    );
    test.setTimeout(120_000);
    const { a, b, framesB } = await liveDuel(browser);
    try {
      await a.context.setOffline(true);
      await expect(b.page.getByTestId(TEST_IDS.disconnect.overlay)).toBeVisible({
        timeout: 30_000,
      });
      // 20 s of grace after the server noticed, with a little slack.
      await expect(resultCard(b.page)).toBeVisible({ timeout: 35_000 });
      expect(await verdictOf(b.page, { me: b.name, opponent: a.name })).toBe('win');
      await expect(b.page.getByTestId(TEST_IDS.result.reason)).toHaveText(
        COPY.result.series.opponentDisconnectedYours(a.name),
      );
      // DEFECT (QA pass 2, owner apps/client/src/game/store.ts `gameOver` case + ui DisconnectOverlay):
      // the store keeps `paused` after `gameOver`, so the "Alice disconnected ... 0 s" overlay stays in the
      // DOM (and its live region keeps announcing) under the result card. Soft, so the rest still runs.
      await expect
        .soft(
          b.page.getByTestId(TEST_IDS.disconnect.overlay),
          'the disconnect overlay is gone once the forfeit result is shown',
        )
        .toBeHidden();
      await expect.poll(() => framesB.gameOvers().length, { timeout: 5_000 }).toBe(1);
      const over = framesB.gameOvers()[0];
      expect(over?.reason).toBe('OPPONENT_DISCONNECTED');
      expect(over?.winner).toBe('B');
      expect(over?.series.over).toBe(true);
      expect(over?.series.winner).toBe('B');
      expect(over?.series.endReason).toBe('OPPONENT_DISCONNECTED');
    } finally {
      await closeAll([a, b]);
    }
  });
});

test.describe('REQ-022 both boards, live', () => {
  test('REQ-022 each player sees the other play: stats and falling piece update on both screens', async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const { a, b } = await liveDuel(browser);
    try {
      expect(await oppStat(a.page, COPY.game.pieces)).toBe(0);
      expect(await oppStat(b.page, COPY.game.pieces)).toBe(0);
      const nextOnA = await oppCanvas(a.page).getAttribute(DATA_HOOKS.next);

      // B plays one piece: A's opponent board shows it (the counter moves, the queue moves on).
      await placePieces(b, 1);
      await expect.poll(() => oppStat(a.page, COPY.game.pieces), { timeout: 5_000 }).toBe(1);
      await expect
        .poll(() => oppCanvas(a.page).getAttribute(DATA_HOOKS.next), { timeout: 5_000 })
        .not.toBe(nextOnA);

      // And the other way round.
      const nextOnB = await oppCanvas(b.page).getAttribute(DATA_HOOKS.next);
      await placePieces(a, 1);
      await expect.poll(() => oppStat(b.page, COPY.game.pieces), { timeout: 5_000 }).toBe(1);
      await expect
        .poll(() => oppCanvas(b.page).getAttribute(DATA_HOOKS.next), { timeout: 5_000 })
        .not.toBe(nextOnB);

      // Each page's opponent board is the other page's own board: the stats text agrees both ways.
      await expect
        .poll(
          async () => {
            const boardsA = await readBoards(a.page);
            const boardsB = await readBoards(b.page);
            return boardsA.oppStats === boardsB.ownStats && boardsB.oppStats === boardsA.ownStats;
          },
          { timeout: 5_000 },
        )
        .toBe(true);
    } finally {
      await closeAll([a, b]);
    }
  });
});
