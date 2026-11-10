/**
 * Security review F1: the send buffer of a slow reader is bounded, and a blind `pong` is not liveness.
 * The deterministic cases forge the server-side socket's `bufferedAmount` (a real `ws` socket, a real
 * client); one case stalls a real reader for real and replays the reviewer's probe.
 */
import {
  CLOSE_CODES,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  RECOVERABLE_CLOSE_CODES,
} from '@stackerist/protocol';
import type {} from '@fastify/websocket'; // types `app.websocketServer`
import type { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../src/index.js';
import {
  startDuel,
  startTestServer,
  until,
  type Harness,
  type TestClient,
} from './helpers/harness.js';

let h: Harness;
afterEach(async () => {
  await h.close();
});

const CAP = DEFAULT_LIMITS.maxBufferedBytes;

/** The server's end of `client`'s socket (clients connect one after another, so the order matches). */
function serverSocketOf(client: TestClient): WebSocket {
  const sockets = [...h.server.app.websocketServer.clients];
  const socket = sockets[h.clients.indexOf(client)];
  if (socket === undefined) throw new Error('no server-side socket');
  return socket;
}

/** Makes the server believe `socket` has `bytes` queued, and counts every frame it is asked to send. */
function stall(socket: WebSocket, bytes: number): { readonly sends: () => number } {
  let sends = 0;
  const realSend = socket.send.bind(socket) as (...args: unknown[]) => void;
  Object.defineProperty(socket, 'bufferedAmount', { get: () => bytes, configurable: true });
  Object.defineProperty(socket, 'send', {
    value: (...args: unknown[]) => {
      sends += 1;
      realSend(...args);
    },
    configurable: true,
  });
  return { sends: () => sends };
}

async function spectate(code: string): Promise<TestClient> {
  const c = await h.connect();
  c.send({ type: 'join', code, asSpectator: true });
  await c.next('joined');
  return c;
}

describe('F1 send buffer cap', () => {
  it('F1 the default cap is 512 KB and is an injectable limit', async () => {
    h = await startTestServer();
    expect(CAP).toBe(512 * 1024);
    expect(RECOVERABLE_CLOSE_CODES.SLOW_CONSUMER).toBe(4005);
    expect(Object.values(CLOSE_CODES)).not.toContain(RECOVERABLE_CLOSE_CODES.SLOW_CONSUMER);
  });

  it('F1 a spectator whose buffer is over the cap is closed SLOW_CONSUMER, and nothing more is sent to it', async () => {
    h = await startTestServer();
    const { a, code } = await startDuel(h);
    const spectator = await spectate(code);
    const stalled = stall(serverSocketOf(spectator), CAP + 1);
    h.step(4);
    expect(await spectator.waitClose()).toEqual({
      code: RECOVERABLE_CLOSE_CODES.SLOW_CONSUMER,
      reason: 'SLOW_CONSUMER',
    });
    expect(stalled.sends()).toBe(0);
    h.step(20);
    expect(stalled.sends()).toBe(0);
    await until(() => h.inspect(code).spectators === 0, 'the spectator to leave the room');
    // The rest of the room is untouched.
    expect(a.closed).toBeNull();
    expect(h.inspect(code).status).toBe('playing');
    await a.snapshotAt(h.tick(code));
  });

  it('F1 a player over the cap is an unexpected disconnect (paused, not forfeited) and rejoins with its token', async () => {
    h = await startTestServer();
    const { a, b, code, tokenA } = await startDuel(h);
    stall(serverSocketOf(a), CAP + 1);
    h.step(2);
    expect((await a.waitClose()).code).toBe(RECOVERABLE_CLOSE_CODES.SLOW_CONSUMER);
    expect((await b.next('paused')).seat).toBe('A');
    await until(() => h.inspect(code).status === 'paused', 'the room to pause');
    const a2 = await h.connect();
    a2.send({ type: 'rejoin', code, token: tokenA });
    expect((await a2.next('joined')).seat).toBe('A');
    await b.next('resumed');
  });

  it('F1 exactly at the cap is fine; one byte over is not; the limit is injectable', async () => {
    h = await startTestServer({ limits: { maxBufferedBytes: 1000 } });
    const { code } = await startDuel(h);
    const spectator = await spectate(code);
    stall(serverSocketOf(spectator), 1000);
    h.step(4);
    await h.settle();
    expect(spectator.closed).toBeNull();
    stall(serverSocketOf(spectator), 1001);
    h.step(4);
    expect((await spectator.waitClose()).code).toBe(RECOVERABLE_CLOSE_CODES.SLOW_CONSUMER);
  });

  it('F1 the reviewer scenario: stalled readers with blind pong and rematch spam stay under the cap and get closed', async () => {
    const cap = 64 * 1024;
    h = await startTestServer({ limits: { maxBufferedBytes: cap, nonInputBurst: 1_000_000 } });
    const { a, b, code } = await startDuel(h);
    const spectators: TestClient[] = [];
    for (let i = 0; i < 4; i += 1) spectators.push(await spectate(code));
    for (const s of spectators) {
      s.autoPong = false;
      s.ws.pause(); // the reader stops reading; the kernel buffers fill, then the server's queue grows
    }
    const serverSockets = spectators.map(serverSocketOf);
    let worst = 0;
    const largestFrame = 32 * 1024;
    for (let round = 0; round < 400 && serverSockets.some((s) => s.readyState === 1); round += 1) {
      for (const s of spectators) {
        s.send({ type: 'pong', t: 0 }); // blind liveness
        s.send({ type: 'rematch' });
      }
      a.send({ type: 'rematch' });
      b.send({ type: 'rematch' });
      h.step(2);
      for (const s of serverSockets) worst = Math.max(worst, s.bufferedAmount);
      if (h.inspect(code).status !== 'playing') break;
    }
    // Whatever happened, the buffered bytes never passed the cap by more than one frame.
    expect(worst).toBeLessThanOrEqual(cap + largestFrame);
    expect(h.inspect(code).status).toBe('playing');
    // ...and every stalled reader was cut off rather than buffered for.
    expect(serverSockets.map((s) => s.readyState)).not.toContain(1);
    for (const s of spectators) s.ws.terminate(); // a paused client would never answer the close handshake
  });
});

describe('F1 a pong is liveness only if it answers an outstanding ping', () => {
  it('F1 blind pongs (wrong t) do not extend the deadline: the 10 s pong timeout still fires', async () => {
    h = await startTestServer();
    const c = await h.connect({ autoPong: false });
    for (let i = 0; i < 8; i += 1) {
      h.clock.advance(2000);
      c.send({ type: 'pong', t: 0 });
      c.send({ type: 'pong', t: Math.round(h.clock.monotonicMs()) + 1 }); // near, but not a ping we sent
      await h.settle();
    }
    expect(await c.waitClose()).toEqual({
      code: CLOSE_CODES.PONG_TIMEOUT,
      reason: 'PONG_TIMEOUT',
    });
  });

  it('F1 a replayed pong (an old ping answered twice) is not liveness either', async () => {
    h = await startTestServer();
    const c = await h.connect({ autoPong: false });
    const first = await c.next('ping');
    c.send({ type: 'pong', t: first.t }); // the one honest answer
    await h.settle();
    for (let i = 0; i < 7; i += 1) {
      h.clock.advance(2000);
      c.send({ type: 'pong', t: first.t });
      await h.settle();
    }
    expect((await c.waitClose()).code).toBe(CLOSE_CODES.PONG_TIMEOUT);
  });

  it('F1 an honest client that answers every ping is never timed out; a stalled one still is at 10 s', async () => {
    h = await startTestServer();
    const honest = await h.connect();
    const stalled = await h.connect({ autoPong: false });
    await h.advance(PONG_TIMEOUT_MS * 3);
    expect(honest.closed).toBeNull();
    expect((await stalled.waitClose()).code).toBe(CLOSE_CODES.PONG_TIMEOUT);
    expect(h.clock.monotonicMs()).toBeGreaterThan(PONG_TIMEOUT_MS + PING_INTERVAL_MS);
  });
});
