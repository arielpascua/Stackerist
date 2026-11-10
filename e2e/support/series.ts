/**
 * Helpers for the multi-round specs: deterministic round outcomes, the Next round / New series
 * handshake, and reading what a result card shows. Nothing here retypes an id or a string.
 *
 * Determinism: the player who hammers Space (hard drop) tops out within a couple of seconds; the
 * player who presses nothing never does (a piece falls by gravity and a stack in the middle of the
 * board needs far longer than a round). So "A hammers, B idles" is "B wins this round", every time.
 */
import { expect, type Page } from '@playwright/test';
import type { GameOverMessage } from '../../packages/protocol/src/index.ts';
import {
  COPY,
  ownCanvas,
  oppCanvas,
  resultCard,
  sleep,
  TEST_IDS,
  waitUntilLive,
  type DATA_HOOKS,
  type Player,
} from './app.ts';

/** Hard drops `loser` until every page in `watchers` shows a result card (or the budget runs out). */
export async function loseRound(
  loser: Player,
  watchers: readonly Player[],
  budgetMs = 30_000,
): Promise<void> {
  const stop = Date.now() + budgetMs;
  for (;;) {
    let allShowing = true;
    for (const watcher of watchers) {
      if (!(await resultCard(watcher.page).isVisible())) allShowing = false;
    }
    if (allShowing) return;
    if (Date.now() >= stop) throw new Error(`no result card on every page within ${budgetMs} ms`);
    // The loser keeps dropping until its own board has topped out (then the key is simply ignored).
    await loser.page.keyboard.press('Space');
    await sleep(60);
  }
}

/** Both players live, the round played to a result: `loser` hammers, the other idles. */
export async function playRound(a: Player, b: Player, loser: Player): Promise<void> {
  await waitUntilLive(a);
  await waitUntilLive(b);
  await loseRound(loser, [a, b]);
}

/**
 * Presses the card's primary button (Next round / New series) once it is armed. The card ignores
 * activation for its first ~1 s, so the click is retried until the opponent's wait line shows.
 */
export async function pressPrimary(player: Player): Promise<void> {
  const button = player.page.getByTestId(TEST_IDS.result.primaryButton);
  const status = player.page.getByTestId(TEST_IDS.result.status);
  // Registered = "Waiting for opponent to accept…" shows, or (when this was the second accept) the
  // next countdown has already replaced the card.
  await expect
    .poll(
      async () => {
        if ((await resultCard(player.page).count()) === 0) return 'next round started';
        if (await button.isEnabled()) {
          await button.click({ timeout: 1_000 }).catch(() => undefined);
        }
        const text = (await status.textContent({ timeout: 1_000 }).catch(() => null))?.trim();
        return text === COPY.result.waitingAccept ? 'waiting' : 'not pressed';
      },
      { timeout: 15_000, message: 'the primary button never registered the press' },
    )
    .toMatch(/^(waiting|next round started)$/);
}

export interface ReportRows {
  /** Row label -> [this player's column, the opponent's column]. */
  readonly [label: string]: readonly [string, string];
}

/** The round stats table of a result card as text. */
export async function readReport(page: Page): Promise<ReportRows> {
  const rows = page.getByTestId(TEST_IDS.result.statsTable).locator('tbody tr');
  const out: Record<string, readonly [string, string]> = {};
  const count = await rows.count();
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const label = ((await row.locator('th').textContent()) ?? '').trim();
    const cells = row.locator('td');
    out[label] = [
      ((await cells.nth(0).textContent()) ?? '').trim(),
      ((await cells.nth(1).textContent()) ?? '').trim(),
    ];
  }
  return out;
}

/** The series bug as the player reads it: "Alice 1 – 0 Bob" (names and digits, collapsed). */
export async function seriesBugText(page: Page): Promise<string> {
  // The label, the two names and the digits are separate elements laid out by CSS (no whitespace
  // between them in the DOM text), so they are joined here the way they read on screen.
  const parts = await page
    .getByTestId(TEST_IDS.result.seriesScore)
    .locator('p, span')
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => node.children.length === 0)
        .map((node) => (node.textContent ?? '').trim()),
    );
  return parts.join(' ');
}

/** The "Series Alice 1 – 0 Bob" text the card must show for a score. */
export function seriesBug(nameA: string, scoreA: number, scoreB: number, nameB: string): string {
  return `${COPY.result.seriesLabel} ${nameA} ${String(scoreA)} – ${String(scoreB)} ${nameB}`;
}

/** The latest gameOver the page's socket delivered; throws when none has arrived. */
export function lastGameOver(overs: readonly GameOverMessage[]): GameOverMessage {
  const over = overs.at(-1);
  if (over === undefined) throw new Error('no gameOver frame arrived');
  return over;
}

/** The pip counts (rounds won) shown on a player's own and opponent plates on the game HUD. */
export async function pipsOf(page: Page): Promise<{ own: number; opp: number }> {
  const own = await page.getByTestId(TEST_IDS.game.ownPips).getAttribute('data-won');
  const opp = await page.getByTestId(TEST_IDS.game.oppPips).getAttribute('data-won');
  return { own: Number(own), opp: Number(opp) };
}

/** One canvas hook of the own or opponent board of a page. */
export async function hookOf(
  page: Page,
  board: 'own' | 'opp',
  hook: (typeof DATA_HOOKS)[keyof typeof DATA_HOOKS],
): Promise<string | null> {
  const canvas = board === 'own' ? ownCanvas(page) : oppCanvas(page);
  return canvas.getAttribute(hook);
}
