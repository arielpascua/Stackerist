/**
 * Security review F2: one client IP can't fill the room cap or the socket pool and hold it. Every limit is
 * an injectable `Limits` field, so the cases below use small values and the manual clock; the defaults
 * are pinned in their own test. Client IPs come from `X-Real-IP` (the production source on Railway).
 */
import { CLOSE_CODES, RECOVERABLE_CLOSE_CODES, WS_PATH } from '@stackerist/protocol';
import type {} from '@fastify/websocket'; // types `app.websocketServer`
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../src/index.js';
import { startDuel, startTestServer, TestClient, until, type Harness } from './helpers/harness.js';
import { hardDropUntilOver } from './helpers/play.js';

let h: Harness;
afterEach(async () => {
  await h.close();
});

const IP_1 = '203.0.113.7';
const IP_2 = '198.51.100.9';
const FAST_INPUTS = { inputBurst: 100_000 } as const;
const MINUTE = 60_000;

const as = (ip: string) => ({ headers: { 'X-Real-IP': ip } });

async function create(ip: string): Promise<TestClient> {
  const c = await h.connect(as(ip));
  c.send({ type: 'create', name: 'Ann' });
  await c.waitFor((m) => m.type === 'created' || m.type === 'error', 'create reply');
  return c;
}

const created = (c: TestClient): boolean => c.all('created').length === 1;

/** A raw socket that is allowed to be refused (no first ping to wait for). */
async function rawOpen(ip: string): Promise<TestClient> {
  const c = await TestClient.open(h.wsUrl, as(ip));
  h.clients.push(c);
  return c;
}

describe('F2 defaults', () => {
  it('F2 the shipped limits', async () => {
    h = await startTestServer();
    expect(DEFAULT_LIMITS).toMatchObject({
      maxLiveRoomsPerIp: 6,
      maxSocketsPerIp: 40,
      maxSockets: 2000,
      idleFinishedRoomTtlMs: 10 * MINUTE,
      maxRoomAgeMs: 3 * 60 * MINUTE,
      maxLiveRooms: 500,
    });
  });
});

describe('F2 live rooms per client IP', () => {
  it('F2 the 7th live room from one IP is refused with TOO_MANY_CREATES; another IP is unaffected', async () => {
    h = await startTestServer({ clientIp: { source: 'x-real-ip' } });
    for (let i = 0; i < DEFAULT_LIMITS.maxLiveRoomsPerIp; i += 1) {
      expect(created(await create(IP_1))).toBe(true);
    }
    const seventh = await create(IP_1);
    expect(created(seventh)).toBe(false);
    expect(seventh.all('error')[0]?.code).toBe('TOO_MANY_CREATES');
    expect(created(await create(IP_2))).toBe(true); // a legitimate second household
  });

  it('F2 the refusal charges nothing: the per-minute create window is not used up by refused attempts', async () => {
    h = await startTestServer({
      clientIp: { source: 'x-real-ip' },
      limits: { maxLiveRoomsPerIp: 1, maxCreatesPerIpPerMin: 3, emptyRoomTtlMs: 10_000 },
    });
    const owner = await create(IP_1);
    const spammer = await h.connect(as(IP_1));
    for (let i = 0; i < 5; i += 1) spammer.send({ type: 'create', name: 'Ann' });
    expect(new Set(await spammer.errorCodes(5))).toEqual(new Set(['TOO_MANY_CREATES']));
    // The room goes away; 5 refusals did not eat the window (1 real create + 5 charged would be 6 >= 3).
    owner.send({ type: 'leave' });
    await h.settle();
    await h.advance(11_000);
    spammer.clear();
    spammer.send({ type: 'create', name: 'Ann' });
    await spammer.next('created');
  });

  it('F2 a room releases its slot when it is deleted (waiting TTL) and when its players are gone (disconnect, leave)', async () => {
    h = await startTestServer({
      clientIp: { source: 'x-real-ip' },
      limits: { maxLiveRoomsPerIp: 1, maxCreatesPerIpPerMin: 1000 },
    });
    // 1. a connected room holds the slot until the waiting-room TTL deletes it
    const first = await create(IP_1);
    expect(created(first)).toBe(true);
    const blocked = await create(IP_1);
    expect(blocked.all('error')[0]?.code).toBe('TOO_MANY_CREATES');
    await h.advance(DEFAULT_LIMITS.waitingRoomTtlMs + 1000);
    await first.waitClose();
    // 2. the creator disconnects: the room is only on its empty-room TTL, and the slot is free at once
    const second = await create(IP_1);
    expect(created(second)).toBe(true);
    second.ws.close();
    await second.waitClose();
    await until(
      () => h.server.app.websocketServer.clients.size === 1,
      'the server to see the close',
    );
    // 3. leaving frees it too
    const third = await create(IP_1);
    expect(created(third)).toBe(true);
    third.send({ type: 'leave' });
    await h.settle();
    expect(created(await create(IP_1))).toBe(true);
  });
});

describe('F2 sockets per client IP and per process', () => {
  it('F2 the 41st socket from one IP is refused (SERVER_BUSY, then close 1013); another IP is fine', async () => {
    h = await startTestServer({
      clientIp: { source: 'x-real-ip' },
      limits: { maxSocketsPerIp: 4 },
    });
    for (let i = 0; i < 4; i += 1) await h.connect(as(IP_1));
    const refused = await rawOpen(IP_1);
    expect((await refused.next('error')).code).toBe('SERVER_BUSY');
    expect((await refused.waitClose()).code).toBe(RECOVERABLE_CLOSE_CODES.TRY_AGAIN_LATER);
    await h.connect(as(IP_2));
  });

  it('F2 the slot is released when a socket closes, however it closes (no leak)', async () => {
    h = await startTestServer({
      clientIp: { source: 'x-real-ip' },
      limits: { maxSocketsPerIp: 2 },
    });
    for (let i = 0; i < 12; i += 1) {
      const c = await h.connect(as(IP_1));
      if (i % 2 === 0) c.ws.close();
      else c.ws.terminate();
      await c.waitClose();
      await until(() => h.server.app.websocketServer.clients.size === 0, 'the server to drop it');
    }
    const a = await h.connect(as(IP_1));
    const b = await h.connect(as(IP_1));
    expect(a.closed ?? b.closed).toBeNull();
  });

  it('F2 the process-wide socket cap applies across IPs', async () => {
    h = await startTestServer({ clientIp: { source: 'x-real-ip' }, limits: { maxSockets: 3 } });
    await h.connect(as('192.0.2.1'));
    await h.connect(as('192.0.2.2'));
    await h.connect(as('192.0.2.3'));
    const refused = await rawOpen('192.0.2.4');
    expect((await refused.next('error')).code).toBe('SERVER_BUSY');
    expect((await refused.waitClose()).code).toBe(RECOVERABLE_CLOSE_CODES.TRY_AGAIN_LATER);
  });

  it('F2 a refused socket never gets near a room: connflood from one IP leaves a second IP untouched', async () => {
    h = await startTestServer({
      clientIp: { source: 'x-real-ip' },
      limits: { maxSocketsPerIp: 10 },
    });
    const flood: TestClient[] = [];
    for (let i = 0; i < 60; i += 1) flood.push(await rawOpen(IP_1));
    await until(
      () => flood.filter((c) => c.closed !== null).length >= 50,
      'the surplus sockets to be closed',
    );
    expect(flood.filter((c) => c.closed === null)).toHaveLength(10);
    const victim = await create(IP_2);
    expect(created(victim)).toBe(true);
    expect(WS_PATH).toBe('/ws');
  });
});

describe('F2 finished rooms and room age', () => {
  const LIMITS = {
    ...FAST_INPUTS,
    idleFinishedRoomTtlMs: 30_000,
    maxRoomAgeMs: 120_000,
  } as const;

  it('F2 a room left in roundOver is deleted after the idle TTL, and its sockets are closed ROOM_CLOSED', async () => {
    h = await startTestServer({ limits: LIMITS });
    const { a, b, code } = await startDuel(h);
    await hardDropUntilOver(h, code, { A: a });
    expect(h.inspect(code).status).toBe('roundOver');
    await h.advance(LIMITS.idleFinishedRoomTtlMs - 2000);
    expect(h.testing.inspect(code)).not.toBeNull();
    await h.advance(4000);
    expect(h.testing.inspect(code)).toBeNull();
    for (const c of [a, b]) {
      expect(await c.waitClose()).toEqual({ code: CLOSE_CODES.ROOM_CLOSED, reason: 'ROOM_CLOSED' });
    }
  });

  it('F2 activity (a rematch) restarts the idle clock', async () => {
    h = await startTestServer({ limits: LIMITS });
    const { a, code } = await startDuel(h);
    await hardDropUntilOver(h, code, { A: a });
    await h.advance(LIMITS.idleFinishedRoomTtlMs - 4000);
    a.send({ type: 'rematch' });
    await h.settle();
    await h.advance(LIMITS.idleFinishedRoomTtlMs - 4000); // 26 s later: past the first deadline
    expect(h.testing.inspect(code)).not.toBeNull();
    await h.advance(8000);
    expect(h.testing.inspect(code)).toBeNull();
  });

  it('F2 a room that is playing is not an idle room', async () => {
    h = await startTestServer({ limits: LIMITS });
    const { code } = await startDuel(h);
    await h.advance(LIMITS.idleFinishedRoomTtlMs * 2);
    expect(h.inspect(code).status).toBe('playing');
  });

  it('F2 no room outlives the maximum age, whatever its state, and it frees its owner slot', async () => {
    h = await startTestServer({
      clientIp: { source: 'x-real-ip' },
      limits: { ...LIMITS, maxLiveRoomsPerIp: 1 },
    });
    const a = await create(IP_1);
    const b = await h.connect(as(IP_1));
    const code = a.all('created')[0]?.code ?? '';
    b.send({ type: 'join', code, name: 'Ben' });
    await b.next('joined');
    await h.advance(3000); // countdown over: playing
    expect(h.inspect(code).status).toBe('playing');
    await h.advance(LIMITS.maxRoomAgeMs - 5000);
    expect(h.testing.inspect(code)).not.toBeNull();
    await h.advance(6000);
    expect(h.testing.inspect(code)).toBeNull();
    expect((await a.waitClose()).code).toBe(CLOSE_CODES.ROOM_CLOSED);
    expect((await b.waitClose()).code).toBe(CLOSE_CODES.ROOM_CLOSED);
    expect(created(await create(IP_1))).toBe(true); // the per-IP slot came back
  });
});

describe('F2 the reviewer scenario (roomcap.mjs): one IP keeps creating and joining its own rooms', () => {
  it('F2 the attacker never holds more than the per-IP cap, every room ages out, and a victim IP creates throughout', async () => {
    h = await startTestServer({
      clientIp: { source: 'x-real-ip' },
      limits: { maxRoomAgeMs: 4 * MINUTE, idleFinishedRoomTtlMs: MINUTE },
    });
    const attackerRooms: string[] = [];
    let refused = 0;
    let peak = 0;
    const live = (): number => attackerRooms.filter((c) => h.testing.inspect(c) !== null).length;
    for (let minute = 0; minute < 6; minute += 1) {
      for (let i = 0; i < 11; i += 1) {
        const owner = await create(IP_1);
        const reply = owner.all('created')[0];
        if (reply === undefined) {
          refused += 1;
          owner.ws.terminate();
          continue;
        }
        const guest = await h.connect(as(IP_1));
        guest.send({ type: 'join', code: reply.code, name: 'y' });
        await guest.next('joined');
        attackerRooms.push(reply.code);
        peak = Math.max(peak, live());
      }
      expect(created(await create(IP_2))).toBe(true); // the victim, every minute
      await h.advance(MINUTE);
    }
    expect(peak).toBeLessThanOrEqual(DEFAULT_LIMITS.maxLiveRoomsPerIp);
    expect(refused).toBeGreaterThan(0);
    await h.advance(5 * MINUTE);
    expect(live()).toBe(0); // nothing is held "indefinitely" any more
  });
});
