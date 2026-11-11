/**
 * U1 (UX review 9a): after a mid-match drop the screen must not lie.
 * REQ-049: the ping reads "— ms" with the hollow ring while the socket is not open.
 * REQ-031 / REQ-021: when reconnecting gives up the lost-connection overlay stays, with the catalogue
 * copy "Can't reach Stackerist…" and 44 px Try again / Back to home buttons.
 * REQ-049: the match clock holds its last value, dimmed, while the connection is down.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ClientState, CoreServices, Music } from '../../src/game/contract.ts';
import { COPY } from '../../src/ui/copy.ts';
import { Game } from '../../src/ui/screens/Game.tsx';
import { paintClock } from '../../src/ui/screens/game/framePaint.ts';
import { TEST_IDS } from '../../src/ui/testIds.ts';
import { FakeStore } from './harness/fakeStore.ts';
import { makeClientState, makeRoom } from './fixtures.ts';

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

function render(state: Partial<ClientState>): string {
  const full = makeClientState({ code: 'K7QM4X', role: 'A', ...state });
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
        status: 'playing',
        players: { A: { name: 'Ariel', connected: true }, B: { name: 'Sam', connected: true } },
      })}
      role="A"
      names={names}
      result={null}
      notice={null}
      apple={false}
      onLeave={noop}
      onPrimary={noop}
      onBackHome={noop}
      onRetry={noop}
    />,
  );
}

function ping(html: string): string {
  const start = html.indexOf(`data-testid="${TEST_IDS.game.ping}"`);
  expect(start).toBeGreaterThan(-1);
  const open = html.lastIndexOf('<p', start);
  return html.slice(open, html.indexOf('</p>', start));
}

describe('REQ-049 the ping never shows a stale number while the socket is not open', () => {
  it('REQ-049 open: the measured ping shows', () => {
    const p = ping(render({ connection: 'open', rttMs: 3 }));
    expect(p).toContain('3 ms');
    expect(p).toContain('data-quality="good"');
  });

  it.each(['reconnecting', 'connecting', 'closed'] as const)(
    'REQ-049 %s: "— ms" with the hollow ring, even if a number is still in the state',
    (connection) => {
      const p = ping(render({ connection, rttMs: 3 }));
      expect(p).toContain('— ms');
      expect(p).not.toContain('3 ms');
      expect(p).toContain('data-quality="unknown"');
      expect(p).toContain(COPY.game.pingOffline);
    },
  );
});

describe('REQ-031 the lost-connection overlay stays until the connection is back', () => {
  it('REQ-031 reconnecting: the overlay shows the generic line and no buttons yet', () => {
    const html = render({ connection: 'reconnecting' });
    expect(html).toContain(TEST_IDS.disconnect.overlay);
    expect(html).toContain(COPY.disconnect.connectionLostTitle);
    expect(html).not.toContain(TEST_IDS.disconnect.tryAgain);
  });

  it('REQ-021 gave up: the overlay stays with "Can\'t reach Stackerist" and both buttons', () => {
    const html = render({ connection: 'closed' });
    expect(html).toContain(TEST_IDS.disconnect.overlay);
    expect(html).toContain(COPY.disconnect.connectionLostTitle);
    expect(html).toContain(COPY.errors.cantReach.replace("'", '&#x27;'));
    expect(html).toContain(TEST_IDS.disconnect.tryAgain);
    expect(html).toContain(TEST_IDS.disconnect.backHome);
    expect(html).toContain(COPY.errors.tryAgain);
    expect(html).toContain(COPY.errors.backToHome);
    expect(html).toContain('role="alert"');
  });

  it('REQ-021 the two buttons use the 44 px secondary size, not the 32 px HUD size', () => {
    const html = render({ connection: 'closed' });
    const buttons = html.match(/<button[^>]*data-testid="disconnect-(?:try-again|back-home)"/g);
    expect(buttons).toHaveLength(2);
    for (const button of buttons ?? []) {
      expect(button).toContain('btn--secondary');
      expect(button).not.toContain('btn--hud');
    }
  });

  it('REQ-021 a retry in progress (connecting) keeps the overlay up, never a live-looking board', () => {
    const html = render({ connection: 'connecting' });
    expect(html).toContain(TEST_IDS.disconnect.overlay);
    expect(html).not.toContain(TEST_IDS.disconnect.tryAgain);
  });

  it('REQ-031 reconnected: the overlay is gone', () => {
    const html = render({ connection: 'open' });
    expect(html).not.toContain(TEST_IDS.disconnect.overlay);
  });
});

interface FakeClock {
  textContent: string;
  readonly dataset: Record<string, string | undefined>;
}

describe('REQ-049 the match clock does not run while disconnected', () => {
  const el = (): FakeClock => ({ textContent: '', dataset: {} });

  it('REQ-049 connected: it follows the elapsed time', () => {
    const clock = el();
    const shown = paintClock(clock as unknown as HTMLElement, '', 65_000, true);
    expect(shown).toBe('01:05');
    expect(clock.textContent).toBe('01:05');
    expect(clock.dataset.stale).toBeUndefined();
  });

  it('REQ-049 disconnected: the digits freeze at the last value and the box is dimmed', () => {
    const clock = el();
    let shown = paintClock(clock as unknown as HTMLElement, '', 65_000, true);
    shown = paintClock(clock as unknown as HTMLElement, shown, 70_000, false);
    expect(shown).toBe('01:05');
    expect(clock.textContent).toBe('01:05');
    expect(clock.dataset.stale).toBe('true');
  });

  it('REQ-049 reconnected: it resumes from the live value and the dimming goes', () => {
    const clock = el();
    let shown = paintClock(clock as unknown as HTMLElement, '', 65_000, true);
    shown = paintClock(clock as unknown as HTMLElement, shown, 70_000, false);
    shown = paintClock(clock as unknown as HTMLElement, shown, 71_000, true);
    expect(shown).toBe('01:11');
    expect(clock.textContent).toBe('01:11');
    expect(clock.dataset.stale).toBeUndefined();
  });
});
