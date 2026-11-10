/**
 * Shared helpers for the two-browser specs. Every test id, copy string and canvas hook comes from the
 * app's single sources (architecture §7.4): nothing here retypes one.
 */
import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { DATA_HOOKS } from '../../apps/client/src/render/hooks.ts';
import { COPY } from '../../apps/client/src/ui/copy.ts';
import { TEST_IDS } from '../../apps/client/src/ui/testIds.ts';

export { COPY, DATA_HOOKS, TEST_IDS };

/** One browser context with one page, plus everything the page complained about. */
export interface Player {
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
  /** `pageerror` and `console.error` texts. */
  readonly problems: string[];
  /** A touch phone: the home screen asks for a physical key press before it continues. */
  readonly mobile: boolean;
}

/** Called while the keyboard-needed warning is on screen (touch phones only). */
export type WarningHook = (page: Page) => Promise<void>;

export interface PlayerOptions {
  readonly viewport?: { readonly width: number; readonly height: number };
  /** Emulate a touch phone (isMobile + hasTouch). */
  readonly mobile?: boolean;
  /** `prefers-reduced-motion: reduce` for this player. */
  readonly reducedMotion?: boolean;
}

export const DESKTOP = { width: 1280, height: 600 } as const;
export const MOBILE = { width: 390, height: 844 } as const;

/**
 * Every context gets its own client address (the server runs with CLIENT_IP_SOURCE=x-real-ip, see
 * playwright.config.ts), because the server rate-limits creates per client IP (REQ-081: 10 a minute) and a
 * suite that opens dozens of rooms from one address would trip its own limiter and fail at random.
 */
let clientCounter = Math.floor(Math.random() * 60_000);
function nextClientIp(): string {
  clientCounter = (clientCounter + 1) % 65_536;
  return `10.${String(1 + (clientCounter >> 8))}.${String(clientCounter & 255)}.${String(1 + (clientCounter % 250))}`;
}

export async function newPlayer(
  browser: Browser,
  name: string,
  options: PlayerOptions = {},
): Promise<Player> {
  const context = await browser.newContext({
    viewport: options.viewport ?? DESKTOP,
    extraHTTPHeaders: { 'x-real-ip': nextClientIp() },
    ...(options.reducedMotion === true ? { reducedMotion: 'reduce' as const } : {}),
    ...(options.mobile === true
      ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
      : { deviceScaleFactor: 1 }),
  });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
  });
  return { name, context, page, problems, mobile: options.mobile === true };
}

/**
 * A touch-only phone sees the keyboard-needed warning after Create / Join; a physical key press
 * proves a keyboard and continues. Desktop players skip this.
 */
export async function passKeyboardWarning(player: Player, onWarning?: WarningHook): Promise<void> {
  if (!player.mobile) return;
  const { page } = player;
  await expect(page.getByTestId(TEST_IDS.keyboard.warning)).toBeVisible();
  await expect(page.getByTestId(TEST_IDS.keyboard.title)).toHaveText(COPY.keyboard.title);
  if (onWarning !== undefined) await onWarning(page);
  await page.keyboard.press('Shift');
}

export async function closeAll(players: readonly Player[]): Promise<void> {
  for (const player of players) await player.context.close();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Opens a URL and fails loudly if the server did not answer 200. */
export async function open(page: Page, url: string): Promise<void> {
  const response = await page.goto(url);
  expect(response, `no response for ${url}`).not.toBeNull();
  expect(response?.ok(), `${url} answered ${String(response?.status())}`).toBe(true);
}

export async function fillName(page: Page, name: string): Promise<void> {
  await page.getByTestId(TEST_IDS.home.nameInput).fill(name);
}

export interface Created {
  readonly code: string;
  readonly link: string;
}

/** A: opens `/`, enters a name, clicks Create game, reads the code and share link from the lobby. */
export async function createGame(player: Player, onWarning?: WarningHook): Promise<Created> {
  const { page } = player;
  await open(page, '/');
  await expect(page.getByTestId(TEST_IDS.home.screen)).toBeVisible();
  await fillName(page, player.name);
  await page.getByTestId(TEST_IDS.home.createButton).click();
  await passKeyboardWarning(player, onWarning);
  await expect(page.getByTestId(TEST_IDS.lobby.screen)).toBeVisible();
  await expect(page.getByTestId(TEST_IDS.lobby.code)).toHaveText(/^[A-Z0-9]{6}$/);
  const code = (await page.getByTestId(TEST_IDS.lobby.code).textContent())?.trim() ?? '';
  const link = (await page.getByTestId(TEST_IDS.lobby.shareLink).textContent())?.trim() ?? '';
  return { code, link };
}

/** B: opens the share link, checks the code is pre-filled and the name is focused, joins. */
export async function joinViaLink(
  player: Player,
  link: string,
  code: string,
  onWarning?: WarningHook,
): Promise<void> {
  const { page } = player;
  await open(page, link);
  await expect(page.getByTestId(TEST_IDS.home.screen)).toBeVisible();
  await expect(page.getByTestId(TEST_IDS.home.codeInput)).toHaveValue(code);
  await expect(page.getByTestId(TEST_IDS.home.nameInput)).toBeFocused();
  await fillName(page, player.name);
  await page.getByTestId(TEST_IDS.home.joinButton).click();
  await passKeyboardWarning(player, onWarning);
}

/** Both players in a started round: A creates, B joins by link; both reach the game screen. */
export async function startMatch(a: Player, b: Player): Promise<Created> {
  const created = await createGame(a);
  await joinViaLink(b, created.link, created.code);
  for (const player of [a, b]) {
    await expect(player.page.getByTestId(TEST_IDS.game.screen)).toBeVisible();
    await expect(player.page.getByTestId(TEST_IDS.countdown.overlay)).toBeVisible();
  }
  return created;
}

/** One value from a player's own stats block (Lines, Sent, Pieces), as a number. */
export async function ownStat(page: Page, label: string): Promise<number> {
  const value = page
    .getByTestId(TEST_IDS.game.ownStats)
    .locator('dt')
    .filter({ hasText: label })
    .locator('xpath=following-sibling::dd[1]');
  return Number((await value.textContent()) ?? Number.NaN);
}

export function ownCanvas(page: Page): Locator {
  return page.getByTestId(TEST_IDS.game.ownCanvas);
}

export function oppCanvas(page: Page): Locator {
  return page.getByTestId(TEST_IDS.game.oppCanvas);
}

/**
 * Waits until input is live: the standoff overlay has painted DUEL! and gone (the frame loop hides
 * it in the same frame input is enabled) and a piece is falling on this player's own board. Callers
 * assert the overlay was visible first, so "hidden" cannot be the page's pre-countdown state.
 */
export async function waitUntilLive(player: Player): Promise<void> {
  await expect(player.page.getByTestId(TEST_IDS.countdown.overlay)).toBeHidden({
    timeout: 15_000,
  });
  await expect(ownCanvas(player.page)).not.toHaveAttribute(DATA_HOOKS.active, '');
}

export function resultCard(page: Page): Locator {
  return page.getByTestId(TEST_IDS.result.card);
}

/**
 * Space (hard drop) on every player every `paceMs` until any result card is on screen. Bounded by
 * `budgetMs`; returns false when the budget ran out without a result.
 */
export async function hardDropUntilResult(
  players: readonly Player[],
  budgetMs = 60_000,
  paceMs = 60,
): Promise<boolean> {
  const stop = Date.now() + budgetMs;
  while (Date.now() < stop) {
    for (const player of players) {
      if (await resultCard(player.page).isVisible()) return true;
      await player.page.keyboard.press('Space');
    }
    await sleep(paceMs);
  }
  return false;
}

export type Verdict = 'win' | 'lose' | 'draw';

/** The two result cards: one round's verdict, or the series winner screen (REQ-084). */
export type CardKind = 'round' | 'series';

/** Who is looking and who they play: a series headline names the winner, so it needs both. */
export interface Names {
  readonly me: string;
  readonly opponent: string;
}

export async function cardKind(page: Page): Promise<CardKind> {
  const kind = await resultCard(page).getAttribute('data-kind');
  if (kind !== 'round' && kind !== 'series') {
    throw new Error(`unexpected card kind: ${String(kind)}`);
  }
  return kind;
}

/** The series headline as the UI words it for `winner`: with or without the rounds score. */
export function seriesHeadlines(winner: string): readonly string[] {
  return [
    COPY.result.series.headline(winner, null),
    COPY.result.series.headline(winner, { won: 2, lost: 0 }),
    COPY.result.series.headline(winner, { won: 2, lost: 1 }),
  ];
}

/**
 * What this player's result card says: "You win" / "You lose" / "Draw" on a round card, and on the
 * series winner card the winner's name ("Bob wins the series"), which `names` turns into win / lose.
 * Throws on any other headline, so a wrong or empty card never passes as a verdict.
 */
export async function verdictOf(page: Page, names?: Names): Promise<Verdict> {
  const text = ((await page.getByTestId(TEST_IDS.result.headline).textContent()) ?? '').trim();
  if ((await cardKind(page)) === 'round') {
    if (text === COPY.result.youWin) return 'win';
    if (text === COPY.result.youLose) return 'lose';
    if (text === COPY.result.draw) return 'draw';
    throw new Error(`unexpected round headline: ${JSON.stringify(text)}`);
  }
  if (names === undefined) throw new Error('a series card names its winner: pass { me, opponent }');
  if (seriesHeadlines(names.me).includes(text)) return 'win';
  if (seriesHeadlines(names.opponent).includes(text)) return 'lose';
  throw new Error(`unexpected series headline: ${JSON.stringify(text)}`);
}

/** The "Lines" cell of this player's own column in the stats table. */
export async function ownLinesCleared(page: Page): Promise<number> {
  const row = page
    .getByTestId(TEST_IDS.result.statsTable)
    .locator('tbody tr')
    .filter({ has: page.getByRole('rowheader', { name: COPY.result.rows.lines, exact: true }) });
  const text = (await row.locator('td').first().textContent()) ?? '';
  return Number(text.trim());
}
