/**
 * REQ-066, the other half of the best-moment rule: a player who really clears a line (driven with
 * the keyboard by a small stacker) gets a best-moment panel on the result card, and the opponent who
 * did not clear one does not.
 */
import { expect, test } from '@playwright/test';
import { emptyBoard, type Board } from '../packages/engine/src/index.ts';
import {
  closeAll,
  COPY,
  hardDropUntilResult,
  newPlayer,
  ownLinesCleared,
  ownStat,
  resultCard,
  sleep,
  startMatch,
  TEST_IDS,
  verdictOf,
  waitUntilLive,
} from './support/app.ts';
import { placeOnePiece } from './support/bot.ts';

test('a real line clear earns a best-moment panel; no clear, no panel', async ({ browser }) => {
  test.setTimeout(150_000);
  const a = await newPlayer(browser, 'Alice');
  const b = await newPlayer(browser, 'Bob');
  let bPlaying = true;
  try {
    await startMatch(a, b);
    await waitUntilLive(a);
    await waitUntilLive(b);

    // B plays slowly (a hard drop every 1.4 s) so it cannot top out before A has stacked.
    const slowB = (async () => {
      while (bPlaying) {
        await b.page.keyboard.press('Space');
        await sleep(1400);
      }
    })();

    let board: Board = emptyBoard();
    for (let piece = 0; piece < 14 && (await ownStat(a.page, COPY.game.lines)) === 0; piece += 1) {
      const next = await placeOnePiece(a.page, board);
      if (next === null) break;
      board = next;
    }
    expect(await ownStat(a.page, COPY.game.lines), 'the stacker cleared no line').toBeGreaterThan(
      0,
    );
    bPlaying = false;
    await slowB;

    // Now end the round the quick way: both hammer Space until somebody tops out.
    expect(await hardDropUntilResult([a, b])).toBe(true);
    await expect(resultCard(a.page)).toBeVisible();
    await expect(resultCard(b.page)).toBeVisible();

    // A's stats table agrees with the HUD, so A's panel is the "shown" case.
    expect(await ownLinesCleared(a.page)).toBeGreaterThan(0);
    const panel = a.page.getByTestId(TEST_IDS.result.bestMoment);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(COPY.result.yourBestMoment);
    const canvas = a.page.getByTestId(TEST_IDS.result.bestMomentCanvas);
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);

    // B cleared nothing, so B's card has no panel.
    expect(await ownLinesCleared(b.page)).toBe(0);
    await expect(b.page.getByTestId(TEST_IDS.result.bestMoment)).toHaveCount(0);

    // Opposite outcomes (or a draw), as in the smoke test.
    const verdicts = [await verdictOf(a.page), await verdictOf(b.page)].sort();
    expect(['lose,win', 'draw,draw']).toContain(verdicts.join(','));
    expect(a.problems).toEqual([]);
    expect(b.problems).toEqual([]);
  } finally {
    bPlaying = false;
    await closeAll([a, b]);
  }
});
