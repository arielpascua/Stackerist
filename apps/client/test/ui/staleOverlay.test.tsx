/**
 * REQ-031 / REQ-050: the opponent-disconnected overlay (and its live region) never outlives the pause.
 * After a grace expiry the server sends gameOver (OPPONENT_DISCONNECTED); the overlay must be gone
 * under the result card, not left announcing "disconnected 0 s".
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ClientState, CoreServices, Music } from '../../src/game/contract.ts';
import { COPY } from '../../src/ui/copy.ts';
import { deriveResult, type ResultView } from '../../src/ui/result.ts';
import { Game } from '../../src/ui/screens/Game.tsx';
import { TEST_IDS } from '../../src/ui/testIds.ts';
import { FakeStore } from './harness/fakeStore.ts';
import { makeClientState, makeGameOver, makeRoom, makeSeries } from './fixtures.ts';

// The viewport hooks read window; server rendering has none, so give the screen a fixed 1280x600.
vi.mock('../../src/ui/hooks.ts', () => ({
  useViewport: () => ({ width: 1280, height: 600 }),
  useReducedMotion: () => false,
  useFitScale: () => 1,
}));

const noop = () => undefined;
const music: Music = {
  unlock: noop,
  start: noop,
  setLevel: noop,
  stop: noop,
  status: () => 'on',
  toggle: noop,
  subscribe: () => noop,
  preference: () => 'on',
  lastToggleSource: () => null,
};

const names = { A: 'Ariel', B: 'Sam' } as const;
const PAUSED = { seat: 'B', graceEndsAtMs: 20_000, pausesLeft: 2 } as const;

function forfeit(): ReturnType<typeof makeGameOver> {
  return makeGameOver({
    reason: 'OPPONENT_DISCONNECTED',
    series: makeSeries({
      score: { A: 1, B: 0 },
      over: true,
      winner: 'A',
      endReason: 'OPPONENT_DISCONNECTED',
    }),
  });
}

function resultFor(result: ReturnType<typeof makeGameOver>): ResultView {
  return deriveResult({
    result,
    role: 'A',
    names,
    series: result.series,
    status: 'seriesOver',
    ready: { A: false, B: false },
    opponentSeated: true,
    opponentConnected: false,
    roundStartTick: 0,
  });
}

function render(
  state: Partial<ClientState>,
  status: 'paused' | 'seriesOver',
  result: ResultView | null,
): string {
  const full = makeClientState({
    code: 'K7QM4X',
    role: 'A',
    ...state,
  });
  const store = new FakeStore(full, { left: null, right: null, standoff: null });
  const services: CoreServices = {
    store,
    mountArena: () => ({ destroy: noop }),
    drawBestMoment: noop,
    music,
  };
  return renderToStaticMarkup(
    <Game
      services={services}
      state={full}
      room={makeRoom({
        status,
        players: { A: { name: 'Ariel', connected: true }, B: { name: 'Sam', connected: false } },
      })}
      role="A"
      names={names}
      result={result}
      notice={null}
      apple={false}
      onLeave={noop}
      onPrimary={noop}
      onBackHome={noop}
    />,
  );
}

describe('REQ-031 the disconnect overlay shows while the opponent is paused out', () => {
  it('REQ-031 control: a pause with no result shows the overlay and its title', () => {
    const html = render({ paused: PAUSED }, 'paused', null);
    expect(html).toContain(TEST_IDS.disconnect.overlay);
    expect(html).toContain(TEST_IDS.disconnect.title);
  });
});

describe('REQ-050 a forfeit after the grace expiry leaves no stale overlay under the result card', () => {
  it('REQ-050 a result is present: the overlay and its live region are not rendered', () => {
    const over = forfeit();
    const html = render({ paused: PAUSED, result: over }, 'seriesOver', resultFor(over));
    expect(html).toContain(TEST_IDS.result.card);
    expect(html).not.toContain(TEST_IDS.disconnect.overlay);
    expect(html).not.toContain(TEST_IDS.disconnect.title);
  });

  it('REQ-031 gameOver has arrived but the room still says paused: no overlay either', () => {
    const html = render({ paused: PAUSED, result: forfeit() }, 'paused', null);
    expect(html).not.toContain(TEST_IDS.disconnect.overlay);
    expect(html).not.toContain(COPY.disconnect.title('Sam'));
  });
});
