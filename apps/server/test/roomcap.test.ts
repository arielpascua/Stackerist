/**
 * Security re-review N1, N2 and N5 (the probes are roomcap-bypass.mjs and roomcap2.mjs).
 *  - N1: a room counts against its creator's IP from creation until deletion, so parking rooms (create,
 *    close the socket, create again) cannot lift the per-IP cap; every limit is an injectable `Limits`.
 *  - N2: IPv6 is keyed by /64, and every /48 also has an aggregate budget (4x the per-key limits).
 *  - N5: the maximum room age never closes a match in progress.
 */
import { CLOSE_CODES, RECOVERABLE_CLOSE_CODES } from '@stackerist/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, resolveClientIp, type ClientIpConfig } from '../src/index.js';
import { resolveClientIpDetailed } from '../src/clientIp.js';
import {
  MemoryLog,
  startDuel,
  startTestServer,
  TestClient,
  until,
  type Harness,
} from './helpers/harness.js';
import { hardDropUntilOver } from './helpers/play.js';

let h: Harness;
afterEach(async () => {
  await h.close();
});

const IP_1 = '203.0.113.7';
const IP_2 = '198.51.100.9';
const MINUTE = 60_000;
const as = (ip: string) => ({ headers: { 'X-Real-IP': ip } });

async function create(ip: string): Promise<TestClient> {
  const c = await h.connect(as(ip));
  c.send({ type: 'create', name: 'Ann' });
  await c.waitFor((m) => m.type === 'created' || m.type === 'error', 'create reply');
  return c;
}
const created = (c: TestClient): boolean => c.all('created').length === 1;

/** Closes the creator's socket and waits until the server has processed the close. */
async function park(c: TestClient): Promise<void> {
  const before = h.server.app.websocketServer.clients.size;
  c.ws.close();
  await c.waitClose();
  await until(() => h.server.app.websocketServer.clients.size < before, 'the server to see it');
}

describe('N1 rooms are charged to their creator until deleted (roomcap-bypass.mjs)', () => {
  it('N1 the defaults', async () => {
    h = await startTestServer();
    expect(DEFAULT_LIMITS).toMatchObject({
      maxLiveRoomsPerIp: 6,
      maxLiveRoomsPerNetwork: 24,
      maxSocketsPerIp: 40,
      maxSocketsPerNetwork: 160,
      maxRoomAgeMs: 3 * 60 * MINUTE,
    });
  });

  it('N1 parking rooms (create, close the socket, repeat, then rejoin them all) never lifts one IP above the cap', async () => {
    h = await startTestServer({ clientIp: { source: 'x-real-ip' } });
    const parked: { code: string; token: string }[] = [];
    let refused = 0;
    for (let i = 0; i < 10; i += 1) {
      const c = await create(IP_1);
      const reply = c.all('created')[0];
      if (reply === undefined) {
        refused += 1;
        continue;
      }
      parked.push({ code: reply.code, token: reply.token });
      await park(c);
    }
    expect(parked).toHaveLength(DEFAULT_LIMITS.maxLiveRoomsPerIp);
    expect(refused).toBe(10 - DEFAULT_LIMITS.maxLiveRoomsPerIp);
    // Rejoining all of them gives nothing more: the rooms were already counted.
    let rejoined = 0;
    for (const { code, token } of parked) {
      const c = await h.connect(as(IP_1));
      c.send({ type: 'rejoin', code, token });
      await c.waitFor((m) => m.type === 'joined' || m.type === 'error', 'rejoin reply');
      if (c.all('joined').length === 1) rejoined += 1;
    }
    expect(rejoined).toBeLessThanOrEqual(DEFAULT_LIMITS.maxLiveRoomsPerIp);
    const further = await create(IP_1);
    expect(further.all('error')[0]?.code).toBe('TOO_MANY_CREATES');
    expect(created(await create(IP_2))).toBe(true); // another household is unaffected
  });

  it('N1 an empty room holds its creator slot for its whole 2-minute TTL and releases it on deletion, every time (no leak)', async () => {
    h = await startTestServer({
      clientIp: { source: 'x-real-ip' },
      limits: { maxLiveRoomsPerIp: 2, maxCreatesPerIpPerMin: 1000 },
    });
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const codes: string[] = [];
      for (let i = 0; i < 2; i += 1) {
        const c = await create(IP_1);
        expect(created(c)).toBe(true);
        codes.push(c.all('created')[0]?.code ?? '');
        await park(c);
      }
      const blocked = await create(IP_1);
      expect(blocked.all('error')[0]?.code).toBe('TOO_MANY_CREATES');
      await h.advance(DEFAULT_LIMITS.emptyRoomTtlMs - 2000);
      const stillBlocked = await create(IP_1);
      expect(stillBlocked.all('error')[0]?.code).toBe('TOO_MANY_CREATES');
      await h.advance(4000);
      for (const code of codes) expect(h.testing.inspect(code)).toBeNull();
    }
    expect(created(await create(IP_1))).toBe(true);
  });

  it('N1 a family playing series after series (create, play, leave, create again) is never refused', async () => {
    h = await startTestServer({
      clientIp: { source: 'x-real-ip' },
      limits: { inputBurst: 100_000 },
    });
    for (let series = 0; series < DEFAULT_LIMITS.maxLiveRoomsPerIp + 3; series += 1) {
      const a = await create(IP_1);
      expect(created(a)).toBe(true);
      const code = a.all('created')[0]?.code ?? '';
      const b = await h.connect(as(IP_1));
      b.send({ type: 'join', code, name: 'Ben' });
      await b.next('joined');
      await h.advance(3000);
      await hardDropUntilOver(h, code, { A: a });
      a.send({ type: 'leave' });
      b.send({ type: 'leave' });
      await h.settle();
      await h.advance(DEFAULT_LIMITS.emptyRoomTtlMs + 1000); // both left: the room is gone after its TTL
      expect(h.testing.inspect(code)).toBeNull();
    }
    expect(created(await create(IP_1))).toBe(true);
  });
});

describe('N2 IPv6: a /64 is one key, and a /48 is one aggregate', () => {
  const v6 = (s48: number, s64: number, host = 1): string =>
    `2001:db8:${s48.toString(16)}:${s64.toString(16)}::${host.toString(16)}`;

  it('N2 the resolved network key is the /48 for IPv6 and the address itself for IPv4', () => {
    const cfg: ClientIpConfig = { source: 'socket' };
    const net = (a: string) =>
      resolveClientIpDetailed({ headers: {}, socket: { remoteAddress: a } }, cfg).network;
    expect(net(v6(1, 2))).toBe(net(v6(1, 3)));
    expect(net(v6(1, 2))).toBe(net('2001:0db8:0001:ffff:aaaa:bbbb:cccc:dddd'));
    expect(net(v6(1, 2))).not.toBe(net(v6(2, 2)));
    expect(net('203.0.113.7')).toBe('203.0.113.7');
    expect(net('::ffff:203.0.113.7')).toBe('203.0.113.7');
    // the per-client key is unchanged: still the /64
    const key = (a: string) => resolveClientIp({ headers: {}, socket: { remoteAddress: a } }, cfg);
    expect(key(v6(1, 2, 5))).toBe(key(v6(1, 2, 9)));
    expect(key(v6(1, 2))).not.toBe(key(v6(1, 3)));
  });

  it('N2 eight addresses in one /64 share one room budget', async () => {
    h = await startTestServer({
      clientIp: { source: 'x-real-ip' },
      limits: { maxLiveRoomsPerIp: 3, maxCreatesPerIpPerMin: 1000 },
    });
    const results: boolean[] = [];
    for (let i = 1; i <= 8; i += 1) results.push(created(await create(v6(1, 1, i))));
    expect(results.filter(Boolean)).toHaveLength(3);
  });

  it('N2 eight different /64s inside one /48 hit the aggregate room cap; another /48 is unaffected', async () => {
    h = await startTestServer({
      clientIp: { source: 'x-real-ip' },
      limits: { maxLiveRoomsPerIp: 1, maxLiveRoomsPerNetwork: 4 },
    });
    const results: boolean[] = [];
    for (let i = 1; i <= 8; i += 1) results.push(created(await create(v6(1, i))));
    expect(results.filter(Boolean)).toHaveLength(4);
    const refused = await create(v6(1, 9));
    expect(refused.all('error')[0]?.code).toBe('TOO_MANY_CREATES');
    expect(created(await create(v6(2, 1)))).toBe(true); // a different /48
  });

  it('N2 the default aggregate is 4x the per-/64 room cap and parked rooms count toward it', async () => {
    h = await startTestServer({
      clientIp: { source: 'x-real-ip' },
      limits: { maxCreatesPerIpPerMin: 1000, maxLiveRooms: 1000 },
    });
    let made = 0;
    for (let i = 1; i <= 30; i += 1) {
      const c = await create(v6(1, i));
      if (created(c)) {
        made += 1;
        await park(c);
      }
    }
    expect(made).toBe(DEFAULT_LIMITS.maxLiveRoomsPerIp * 4);
  });

  it('N2 eight different /64s inside one /48 hit the aggregate socket cap; another /48 and IPv4 are unaffected', async () => {
    h = await startTestServer({
      clientIp: { source: 'x-real-ip' },
      limits: { maxSocketsPerIp: 2, maxSocketsPerNetwork: 4 },
    });
    for (let i = 1; i <= 4; i += 1) await h.connect(as(v6(1, i)));
    const refused = await TestClient.open(h.wsUrl, as(v6(1, 5)));
    h.clients.push(refused);
    expect((await refused.next('error')).code).toBe('SERVER_BUSY');
    expect((await refused.waitClose()).code).toBe(RECOVERABLE_CLOSE_CODES.TRY_AGAIN_LATER);
    await h.connect(as(v6(2, 1)));
    await h.connect(as(IP_1));
    await h.connect(as(IP_1));
    // IPv4 is only ever limited per address: the aggregate never applies to it
    const fourth = await TestClient.open(h.wsUrl, as(IP_1));
    h.clients.push(fourth);
    expect((await fourth.next('error')).code).toBe('SERVER_BUSY');
  });

  it('N2 the socket slot of the aggregate is released when a socket closes (no leak)', async () => {
    h = await startTestServer({
      clientIp: { source: 'x-real-ip' },
      limits: { maxSocketsPerIp: 2, maxSocketsPerNetwork: 2 },
    });
    for (let i = 0; i < 8; i += 1) {
      const c = await h.connect(as(v6(1, i + 1)));
      c.ws.close();
      await c.waitClose();
      await until(() => h.server.app.websocketServer.clients.size === 0, 'the server to drop it');
    }
    await h.connect(as(v6(1, 20)));
    await h.connect(as(v6(1, 21)));
  });
});

describe('N5 the maximum room age never closes a match in progress', () => {
  const LIMITS = {
    inputBurst: 100_000,
    maxRoomAgeMs: 120_000,
    maxRoomAgeRecheckMs: 5000,
    idleFinishedRoomTtlMs: 60 * MINUTE,
  } as const;

  it('N5 a round in progress survives past the age; once it is over the room closes MAX_AGE', async () => {
    const memoryLog = new MemoryLog();
    h = await startTestServer({ limits: LIMITS, memoryLog });
    const { a, b, code } = await startDuel(h);
    await h.advance(LIMITS.maxRoomAgeMs + 30_000);
    expect(h.inspect(code).status).toBe('playing');
    expect(h.testing.inspect(code)).not.toBeNull();
    await hardDropUntilOver(h, code, { A: a });
    expect(h.inspect(code).status).toBe('roundOver');
    await h.advance(LIMITS.maxRoomAgeRecheckMs + 1000);
    expect(h.testing.inspect(code)).toBeNull();
    expect((await a.waitClose()).code).toBe(CLOSE_CODES.ROOM_CLOSED);
    expect((await b.waitClose()).code).toBe(CLOSE_CODES.ROOM_CLOSED);
    expect(memoryLog.events('room.closed').map((l) => l.reason)).toEqual(['MAX_AGE']);
  });

  it('N5 a room between rounds (roundOver) is closed at the age', async () => {
    h = await startTestServer({ limits: { ...LIMITS, maxRoomAgeMs: 300_000 } });
    const { a, code } = await startDuel(h);
    await hardDropUntilOver(h, code, { A: a });
    expect(h.inspect(code).status).toBe('roundOver');
    await h.advance(300_000 - 20_000);
    expect(h.testing.inspect(code)).not.toBeNull();
    await h.advance(30_000);
    expect(h.testing.inspect(code)).toBeNull();
  });

  it('N5 a waiting room is closed at the age (and frees its creator slot)', async () => {
    h = await startTestServer({
      clientIp: { source: 'x-real-ip' },
      limits: { ...LIMITS, maxLiveRoomsPerIp: 1 },
    });
    const a = await create(IP_1);
    const code = a.all('created')[0]?.code ?? '';
    await h.advance(LIMITS.maxRoomAgeMs - 4000);
    expect(h.testing.inspect(code)).not.toBeNull();
    await h.advance(8000);
    expect(h.testing.inspect(code)).toBeNull();
    expect((await a.waitClose()).code).toBe(CLOSE_CODES.ROOM_CLOSED);
    expect(created(await create(IP_1))).toBe(true);
  });
});
