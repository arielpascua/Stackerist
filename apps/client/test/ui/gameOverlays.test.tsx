/**
 * The game screen's overlays.
 * REQ-031 / REQ-050: the opponent-disconnected overlay (and its live region) never outlives the pause.
 * After a grace expiry the server sends gameOver (OPPONENT_DISCONNECTED); the overlay must be gone
 * under the result card, not left announcing "disconnected 0 s".
 * REQ-021 / REQ-049: after a slow-consumer close the lost-connection overlay names the problem and the
 * recovery while the socket reconnects.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { RECOVERABLE_CLOSE_CODES } from '@stackerist/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { ClientState, CoreServices, Music } from '../../src/game/contract.ts';
import { COPY } from '../../src/ui/copy.ts';
import { reconnectNotice } from '../../src/ui/errors.ts';
import { ConnectionBanner } from '../../src/ui/components/Notices.tsx';
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
  status: 'paused' | 'playing' | 'seriesOver',
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
      onRetry={noop}
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

describe('REQ-021 the slow-connection notice shows while the socket reconnects', () => {
  const reconnecting = (code: number | null) => ({
    connection: 'reconnecting' as const,
    recoverableClose: code as ClientState['recoverableClose'],
  });

  it('REQ-049 the lost-connection overlay says the connection is too slow and that it is reconnecting', () => {
    const html = render(reconnecting(RECOVERABLE_CLOSE_CODES.SLOW_CONSUMER), 'playing', null);
    expect(html).toContain(TEST_IDS.disconnect.overlay);
    expect(html).toContain(COPY.disconnect.connectionLostTitle);
    expect(html).toContain(COPY.errors.slowConnection);
    expect(html).not.toContain(COPY.disconnect.connectionLostLine(20));
  });

  it('REQ-049 try-again-later shows the busy copy; an unnamed drop keeps the generic line', () => {
    const busy = render(reconnecting(RECOVERABLE_CLOSE_CODES.TRY_AGAIN_LATER), 'playing', null);
    expect(busy).toContain(COPY.errors.serverBusy);
    const plain = render(reconnecting(null), 'playing', null);
    expect(plain).toContain(COPY.disconnect.connectionLostLine(20));
    expect(plain).not.toContain(COPY.errors.slowConnection);
  });

  it('REQ-021 the notice is gone once the connection is open again', () => {
    const html = render(
      { connection: 'open', recoverableClose: RECOVERABLE_CLOSE_CODES.SLOW_CONSUMER },
      'playing',
      null,
    );
    expect(html).not.toContain(COPY.errors.slowConnection);
    expect(html).not.toContain(TEST_IDS.disconnect.overlay);
  });

  it('REQ-049 outside a live match the reconnect banner carries the same notice', () => {
    const notice = reconnectNotice(
      makeClientState(reconnecting(RECOVERABLE_CLOSE_CODES.SLOW_CONSUMER)),
    );
    expect(notice).toBe(COPY.errors.slowConnection);
    const banner = renderToStaticMarkup(
      <ConnectionBanner failed={false} reason={notice} onRetry={noop} onHome={noop} />,
    );
    expect(banner).toContain(COPY.errors.slowConnection);
    expect(banner).toContain('role="status"');
    expect(banner).not.toContain(COPY.errors.connectionLost);
    const plain = renderToStaticMarkup(
      <ConnectionBanner failed={false} reason={null} onRetry={noop} onHome={noop} />,
    );
    expect(plain).toContain(COPY.errors.connectionLost);
  });

  it('REQ-021 reconnectNotice is null for no code, an unknown code, or a connection that is not retrying', () => {
    expect(reconnectNotice(makeClientState(reconnecting(null)))).toBeNull();
    expect(
      reconnectNotice(
        makeClientState({
          connection: 'open',
          recoverableClose: RECOVERABLE_CLOSE_CODES.SLOW_CONSUMER,
        }),
      ),
    ).toBeNull();
  });
});
