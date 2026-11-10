/**
 * Security review F9: a per-connection bucket for the non-input messages (create, join, rejoin, leave,
 * rematch, pong), so join/leave churn and rematch spam can't fan out unboundedly. A dropped message
 * answers BAD_MESSAGE and counts toward the 20-bad-message disconnect; honest traffic never gets near it.
 */
import { CLOSE_CODES, PING_INTERVAL_MS } from '@stackerist/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../src/index.js';
import { MemoryLog, startDuel, startTestServer, until, type Harness } from './helpers/harness.js';
import { hardDropUntilOver } from './helpers/play.js';

let h: Harness;
afterEach(async () => {
  await h.close();
});

const BURST = DEFAULT_LIMITS.nonInputBurst;

describe('F9 the non-input message bucket', () => {
  it('F9 the shipped numbers: burst 20, 5 per second', async () => {
    h = await startTestServer();
    expect(DEFAULT_LIMITS.nonInputBurst).toBe(20);
    expect(DEFAULT_LIMITS.nonInputRefillPerSec).toBe(5);
  });

  it('F9 the burst is allowed, the next message is dropped with BAD_MESSAGE, and tokens refill 5 per second', async () => {
    h = await startTestServer();
    const c = await h.connect({ autoPong: false });
    for (let i = 0; i < BURST; i += 1) c.send({ type: 'leave' }); // an unbound leave is a silent no-op
    await h.settle();
    expect(c.all('error')).toHaveLength(0);
    c.send({ type: 'leave' });
    expect(await c.errorCodes(1)).toEqual(['BAD_MESSAGE']);
    h.clock.advance(1000); // +5 tokens
    for (let i = 0; i < 5; i += 1) c.send({ type: 'leave' });
    await h.settle();
    expect(c.all('error')).toHaveLength(1);
    c.send({ type: 'leave' });
    expect(await c.errorCodes(2)).toEqual(['BAD_MESSAGE', 'BAD_MESSAGE']);
  });

  it('F9 spectator join/leave churn fans out at most the burst, then the connection is closed', async () => {
    const log = new MemoryLog();
    h = await startTestServer({ memoryLog: log });
    const { a, code } = await startDuel(h);
    const churn = await h.connect({ autoPong: false });
    const before = a.all('room').length;
    for (let i = 0; i < 60; i += 1) {
      churn.send({ type: 'join', code, asSpectator: true });
      churn.send({ type: 'leave' });
    }
    expect((await churn.waitClose()).code).toBe(CLOSE_CODES.TOO_MANY_BAD_MESSAGES);
    await h.settle();
    // Without the bucket: one `room` message per accepted join and per leave (~120).
    expect(a.all('room').length - before).toBeLessThanOrEqual(BURST);
    expect(log.events('anticheat').some((l) => l.rule === 'NON_INPUT_DROP')).toBe(true);
    expect(h.inspect(code).spectators).toBe(0);
  });

  it('F9 rematch spam is dropped before it reaches the room', async () => {
    h = await startTestServer({ limits: { inputBurst: 100_000 } });
    const { a, b, code } = await startDuel(h);
    await hardDropUntilOver(h, code, { A: a });
    b.clear();
    for (let i = 0; i < 200; i += 1) a.send({ type: 'rematch' });
    expect((await a.waitClose()).code).toBe(CLOSE_CODES.TOO_MANY_BAD_MESSAGES);
    expect(b.all('rematchStatus').length).toBeLessThanOrEqual(BURST + 1);
  });

  it('F9 honest use is untouched: pongs every 3 s, joins, a rematch and leaves across a long session', async () => {
    h = await startTestServer({ limits: { inputBurst: 100_000 } });
    const { a, b, code } = await startDuel(h);
    await hardDropUntilOver(h, code, { A: a });
    await h.advance(60_000); // 20 pings, 20 pongs each
    a.send({ type: 'rematch' });
    b.send({ type: 'rematch' });
    await h.settle();
    expect(h.inspect(code).status).toBe('countdown');
    for (const c of [a, b]) {
      expect(c.all('error')).toHaveLength(0);
      expect(c.closed).toBeNull();
    }
    expect(PING_INTERVAL_MS * 20).toBe(60_000);
  });

  it('F9 inputs are not charged to this bucket', async () => {
    h = await startTestServer({ limits: { inputBurst: 100_000 } });
    const { a, b, code } = await startDuel(h);
    const tick = h.tick(code);
    for (let i = 0; i < 60; i += 1) a.input({ type: 'moveLeft' }, tick);
    await h.settle();
    b.send({ type: 'leave' }); // a non-input message still has its whole burst
    await h.settle();
    expect(a.all('error').filter((e) => e.code === 'BAD_MESSAGE')).toHaveLength(0);
    await until(() => h.inspect(code).status !== 'playing', 'the leaver to forfeit');
  });
});
