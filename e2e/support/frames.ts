/**
 * Protocol-level evidence for the browser flows: the server messages a page's WebSocket received, and
 * the canvas hooks of a game screen. Nothing here retypes an id or a string (architecture §7.4).
 */
import type { Locator, Page } from '@playwright/test';
import { DATA_HOOKS, TEST_IDS } from './app.ts';
import type { GameOverMessage } from '../../packages/protocol/src/index.ts';

/** Every server message the page's WebSockets delivered (also across reloads), oldest first. */
export interface FrameLog {
  readonly messages: Record<string, unknown>[];
  /** The gameOver messages seen so far. */
  gameOvers(): GameOverMessage[];
  /** Messages of one type seen so far. */
  ofType(type: string): Record<string, unknown>[];
}

/** Start listening before the page opens its socket (before `goto`). */
export function watchFrames(page: Page): FrameLog {
  const messages: Record<string, unknown>[] = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      if (typeof frame.payload !== 'string') return;
      try {
        const parsed: unknown = JSON.parse(frame.payload);
        if (typeof parsed === 'object' && parsed !== null) {
          messages.push(parsed as Record<string, unknown>);
        }
      } catch {
        // not JSON: not ours to judge here
      }
    });
  });
  return {
    messages,
    gameOvers: () => messages.filter((m) => m.type === 'gameOver') as unknown as GameOverMessage[],
    ofType: (type) => messages.filter((m) => m.type === type),
  };
}

/** The renderer's data hooks for one canvas, as one comparable object. */
export type CanvasHooks = Readonly<Record<string, string | null>>;

export async function readHooks(canvas: Locator): Promise<CanvasHooks> {
  const out: Record<string, string | null> = {};
  for (const name of [DATA_HOOKS.active, DATA_HOOKS.next, DATA_HOOKS.combo, DATA_HOOKS.pending]) {
    out[name] = await canvas.getAttribute(name);
  }
  return out;
}

/** Both boards of a game screen: hooks plus the own stats text. */
export interface BoardState {
  readonly own: CanvasHooks;
  readonly opp: CanvasHooks;
  readonly ownStats: string;
  readonly oppStats: string;
}

export async function readBoards(page: Page): Promise<BoardState> {
  return {
    own: await readHooks(page.getByTestId(TEST_IDS.game.ownCanvas)),
    opp: await readHooks(page.getByTestId(TEST_IDS.game.oppCanvas)),
    ownStats: ((await page.getByTestId(TEST_IDS.game.ownStats).textContent()) ?? '').trim(),
    oppStats: ((await page.getByTestId(TEST_IDS.game.oppStats).textContent()) ?? '').trim(),
  };
}
