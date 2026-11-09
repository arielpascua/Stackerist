import { CLOSE_CODES, COUNTDOWN_MS, PING_INTERVAL_MS, PONG_TIMEOUT_MS } from '@stackerist/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { startDuel, startTestServer, until, type Harness } from './helpers/harness.js';

let h: Harness;
afterEach(async () => {
  await h.close();
});

describe('REQ-080 ping, pong and RTT', () => {
  it('REQ-080 pings on open and every 3 s; rtt is null until measured, then the measured round trip', async () => {
    h = await startTestServer();
    const a = await h.connect({ autoPong: false });
    const first = await a.next('ping');
    expect(first.rtt).toBeNull();
    expect(first.t).toBe(Math.round(h.clock.monotonicMs()));
    // The pong comes back 150 ms later.
    h.clock.advance(150);
    a.send({ type: 'pong', t: first.t });
    await h.settle();
    h.clock.advance(PING_INTERVAL_MS - 150);
    const second = await a.next('ping');
    expect(second.t - first.t).toBe(PING_INTERVAL_MS);
    expect(second.rtt).toBe(150);
    // A pong with a forged future timestamp is ignored for RTT (liveness only).
    a.send({ type: 'pong', t: second.t + 50_000 });
    await h.settle();
    h.clock.advance(PING_INTERVAL_MS);
    expect((await a.next('ping')).rtt).toBe(150);
  });

  it('REQ-080 the countdown and resumed messages carry the start tick', async () => {
    h = await startTestServer({ test: { startTick: 1234 } });
    const { a, b, code, tokenB } = await startDuel(h);
    expect(a.all('countdown')[0]?.tick).toBe(1234);
    h.step(10);
    b.ws.close();
    await a.next('paused');
    const b2 = await h.connect();
    b2.send({ type: 'rejoin', code, token: tokenB });
    const resumed = await b2.next('resumed');
    expect(resumed.tick).toBe(1244);
    expect(resumed.startsAt - resumed.serverNow).toBe(COUNTDOWN_MS);
  });
});

describe('REQ-031 pong timeout', () => {
  it('REQ-031 no pong for 10 s closes the socket with PONG_TIMEOUT and pauses the match', async () => {
    h = await startTestServer();
    const { a, b, code } = await startDuel(h);
    a.autoPong = false; // A goes silent
    const silentSince = h.clock.monotonicMs();
    await h.advance(PONG_TIMEOUT_MS - 1000);
    expect(a.closed).toBeNull();
    await h.advance(PING_INTERVAL_MS + 1000);
    const closed = await a.waitClose();
    expect(closed).toEqual({ code: CLOSE_CODES.PONG_TIMEOUT, reason: 'PONG_TIMEOUT' });
    expect(h.clock.monotonicMs() - silentSince).toBeGreaterThan(PONG_TIMEOUT_MS);
    const paused = await b.next('paused');
    expect(paused.seat).toBe('A');
    await until(() => h.inspect(code).status === 'paused', 'paused');
    expect(b.closed).toBeNull();
  });
});
