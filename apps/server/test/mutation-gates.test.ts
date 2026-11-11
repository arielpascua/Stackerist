/**
 * Gaps found by mutation testing (gate 10a, Stryker, target "gates": the create/join/rejoin/input/rematch/
 * pong gates in connection.ts and the seat, leave and rematch rules in rooms.ts). Titles carry the REQ id.
 */
import { COUNTDOWN_MS, MAX_INPUT_LEAD_TICKS, PONG_TIMEOUT_MS } from '@stackerist/protocol';
import type { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { Connection } from '../src/connection.js';
import { DEFAULT_LIMITS, ManualClock } from '../src/index.js';
import {
  MemoryLog,
  createAndJoin,
  startDuel,
  startTestServer,
  until,
  type Harness,
} from './helpers/harness.js';
import { hardDropUntilOver } from './helpers/play.js';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

function server(): Harness {
  if (h === null) throw new Error('server not started');
  return h;
}

// ---------------------------------------------------------------- pong bookkeeping (unit)

describe('mutation gaps: outstanding pings (REQ-031, F1)', () => {
  function bareConnection(): Connection {
    return new Connection(
      1,
      {} as unknown as WebSocket,
      { ip: '198.51.100.1', network: '198.51.100.1' },
      new ManualClock(),
      {
        maxBufferedBytes: 1_000_000,
        nonInputBurst: 10,
        nonInputRefillPerSec: 10,
        onOverflow: () => undefined,
      },
    );
  }

  it('REQ-031 a ping stays answerable while newer pings are sent, but only once', () => {
    const conn = bareConnection();
    conn.recordPing(5000, 5000);
    conn.recordPing(8000, 8000);
    expect(conn.consumePing(5000, 8500)).toBe(true); // the older ping is still outstanding
    expect(conn.consumePing(5000, 8500)).toBe(false); // ...and a replay of it is not
    expect(conn.consumePing(8000, 8500)).toBe(true);
    expect(conn.consumePing(8000, 8500)).toBe(false);
    expect(conn.consumePing(1234, 8500)).toBe(false); // never sent
  });

  it('REQ-031 a ping is answerable up to exactly PONG_TIMEOUT_MS after it was sent, not a millisecond later', () => {
    const conn = bareConnection();
    conn.recordPing(0, 0);
    conn.recordPing(PONG_TIMEOUT_MS, PONG_TIMEOUT_MS); // the first one is exactly at the limit: kept
    expect(conn.consumePing(0, PONG_TIMEOUT_MS)).toBe(true);

    const late = bareConnection();
    late.recordPing(0, 0);
    expect(late.consumePing(0, PONG_TIMEOUT_MS + 1)).toBe(false);
    const stale = bareConnection();
    stale.recordPing(0, 0);
    stale.recordPing(PONG_TIMEOUT_MS + 1, PONG_TIMEOUT_MS + 1); // the first one expired and is forgotten
    expect(stale.consumePing(0, PONG_TIMEOUT_MS + 1)).toBe(false);
    expect(stale.consumePing(PONG_TIMEOUT_MS + 1, PONG_TIMEOUT_MS + 1)).toBe(true);
  });
});

// ---------------------------------------------------------------- rtt from pong

describe('mutation gaps: rtt reporting (REQ-080)', () => {
  it('REQ-080 a pong answered in the same millisecond reports an rtt of 0, not "unknown"', async () => {
    h = await startTestServer();
    const c = await server().connect(); // auto-pong answers the first ping at once
    await server().advance(3000);
    await until(() => c.pings >= 2, 'the second ping');
    expect(c.last('ping')?.rtt).toBe(0);
  });

  it('REQ-080 a pong answered exactly PONG_TIMEOUT_MS later is still a measurement', async () => {
    h = await startTestServer();
    const c = await server().connect({ autoPong: false });
    const first = await c.next('ping');
    server().clock.advance(PONG_TIMEOUT_MS); // pings at 3, 6 and 9 s go unanswered; none is late enough to close
    await until(() => c.pings >= 4, 'the pings of the silent interval');
    c.send({ type: 'pong', t: first.t });
    await server().settle();
    server().clock.advance(2000); // the next ping carries the measurement
    await until(() => c.pings >= 5, 'the next ping');
    expect(c.closed).toBeNull();
    expect(c.last('ping')?.rtt).toBe(PONG_TIMEOUT_MS);
  });
});

// ---------------------------------------------------------------- gates for an unbound connection

describe('mutation gaps: unbound connections (REQ-036)', () => {
  it('REQ-036 an input or a rematch from a connection that is in no room is refused with NOT_IN_ROOM', async () => {
    h = await startTestServer();
    const c = await server().connect();
    c.send({ type: 'input', seq: 1, tick: 0, action: { type: 'moveLeft' } });
    c.send({ type: 'rematch' });
    expect(await c.errorCodes(2)).toEqual(['NOT_IN_ROOM', 'NOT_IN_ROOM']);
    c.send({ type: 'leave' }); // leaving nothing is not an error
    await server().settle();
    expect(c.all('error')).toHaveLength(2);
    expect(c.closed).toBeNull();
  });

  it('REQ-036 a rejoin with an unknown, malformed or wrong-token code is refused with the right error and never crashes', async () => {
    h = await startTestServer();
    const { code, tokenA } = await createAndJoin(server());
    const c = await server().connect();
    c.send({ type: 'rejoin', code: 'AAAAAA', token: tokenA }); // well-formed, no such room
    c.send({ type: 'rejoin', code: '!!!', token: tokenA }); // not a room code at all
    c.send({ type: 'rejoin', code, token: 'A'.repeat(22) }); // a real room, not a real token
    expect(await c.errorCodes(3)).toEqual(['ROOM_NOT_FOUND', 'ROOM_NOT_FOUND', 'BAD_TOKEN']);
    expect(c.all('joined')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- seats, leaving, spectators

describe('mutation gaps: seats and leaving (REQ-029, REQ-048)', () => {
  it('REQ-029 a player who leaves during the countdown returns the room to waiting and frees the seat for the next joiner', async () => {
    h = await startTestServer();
    const { a, b, code } = await createAndJoin(server());
    a.clear();
    b.clear();
    a.send({ type: 'leave' });
    await until(() => server().inspect(code).status === 'waiting', 'the room to return to waiting');
    const room = server().inspect(code);
    expect(room.seats.A).toBeUndefined();
    expect(room.seats.B).toBeDefined();
    expect(room.tick).toBeNull(); // the pending match is gone
    const update = await b.next('room');
    expect(update.status).toBe('waiting');
    expect(update.players.A).toBeUndefined();
    expect(update.players.B?.name).toBe('Ben');

    const c = await server().connect();
    c.send({ type: 'join', code, name: 'Cy' });
    expect((await c.next('joined')).seat).toBe('A'); // the free seat is A, not a spectator place
    await c.next('countdown');
    expect(server().inspect(code).status).toBe('countdown');
  });

  it('REQ-029 a creator who leaves a waiting room frees the seat and the room stays waiting', async () => {
    h = await startTestServer();
    const a = await server().connect();
    a.send({ type: 'create', name: 'Ann' });
    const { code } = await a.next('created');
    a.send({ type: 'leave' });
    await until(() => server().inspect(code).seats.A === undefined, 'the seat to be freed');
    expect(server().inspect(code).status).toBe('waiting');
    expect(server().inspect(code).seats.B).toBeUndefined();
  });

  it('REQ-048 a spectator who leaves is removed and everyone is told the new spectator count', async () => {
    h = await startTestServer();
    const { a, code } = await startDuel(server());
    const watcher = await server().connect();
    watcher.send({ type: 'join', code, asSpectator: true });
    await watcher.next('joined');
    await a.waitFor((m) => m.type === 'room' && m.spectators === 1, 'one spectator');
    const mark = a.mark(); // only messages after the leave count
    watcher.send({ type: 'leave' });
    await until(() => server().inspect(code).spectators === 0, 'the spectator to be removed');
    await until(
      () => a.received.slice(mark).some((m) => m.type === 'room' && m.spectators === 0),
      'a room message with 0 spectators',
    );
    // The leaver is unbound: it can join again.
    watcher.send({ type: 'join', code, asSpectator: true });
    await watcher.next('joined');
    expect(server().inspect(code).spectators).toBe(1);
  });
});

describe('mutation gaps: finished-room idle clock (F2)', () => {
  it('F2 a spectator leaving a finished room counts as activity and restarts the idle clock', async () => {
    h = await startTestServer({ limits: { inputBurst: 100_000 } });
    const { a, code } = await startDuel(server());
    const watcher = await server().connect();
    watcher.send({ type: 'join', code, asSpectator: true });
    await watcher.next('joined');
    await hardDropUntilOver(server(), code, { A: a });
    const ttl = DEFAULT_LIMITS.idleFinishedRoomTtlMs;
    await server().advance(ttl - 20_000);
    watcher.send({ type: 'leave' }); // someone acted: the clock restarts here
    await until(() => server().inspect(code).spectators === 0, 'the spectator to leave');
    await server().advance(40_000); // past the original deadline
    expect(server().testing.inspect(code)).not.toBeNull();
    await server().advance(ttl); // a full TTL after the leave
    expect(server().testing.inspect(code)).toBeNull();
  });
});

describe('mutation gaps: rematch (REQ-059)', () => {
  const FAST = { inputBurst: 100_000 } as const;

  it('REQ-059 the second player pressing first does not start the next round until the first player presses too', async () => {
    h = await startTestServer({ limits: FAST });
    const { a, b, code } = await startDuel(server());
    await hardDropUntilOver(server(), code, { A: a });
    expect(server().inspect(code).status).toBe('roundOver');
    b.send({ type: 'rematch' });
    await b.next('rematchStatus');
    await server().advance(5000);
    expect(server().inspect(code).status).toBe('roundOver');
    expect(server().inspect(code).seats.B?.ready).toBe(true);
    expect(server().inspect(code).seats.A?.ready).toBe(false);
    a.send({ type: 'rematch' });
    await until(() => server().inspect(code).status === 'countdown', 'round 2 to count down');
  });

  it('REQ-059 a rematch with the opponent gone is recorded but starts nothing and raises no error', async () => {
    h = await startTestServer({ limits: FAST });
    const { a, b, code } = await startDuel(server());
    b.send({ type: 'leave' }); // forfeit: the series is over, B's seat is freed
    await a.next('gameOver');
    expect(server().inspect(code).status).toBe('seriesOver');
    expect(server().inspect(code).seats.B).toBeUndefined();
    a.send({ type: 'rematch' });
    await a.next('rematchStatus');
    await server().advance(5000);
    expect(server().inspect(code).status).toBe('seriesOver');
    expect(a.all('error')).toHaveLength(0);
  });

  it("REQ-059 REQ-032 a New series clears every seat's pause count and drop count", async () => {
    h = await startTestServer({ limits: FAST });
    const { a, b, code, tokenB } = await startDuel(server());
    // B drops out and comes back: one pause used.
    b.ws.close();
    await a.next('paused');
    const b2 = await server().connect();
    b2.send({ type: 'rejoin', code, token: tokenB });
    await b2.next('joined');
    await server().advance(COUNTDOWN_MS);
    // A overfills its input queue with inputs stamped far ahead: three are dropped.
    const tick = server().tick(code);
    for (let i = 0; i < DEFAULT_LIMITS.maxQueuedInputs + 3; i += 1) {
      a.input({ type: 'moveLeft' }, tick + MAX_INPUT_LEAD_TICKS);
    }
    await server().settle();
    expect(server().inspect(code).seats.A?.drops).toBe(3);
    // Round 1 to B, round 2 to B: the series is over.
    await hardDropUntilOver(server(), code, { A: a });
    for (const client of [a, b2]) client.send({ type: 'rematch' });
    await until(() => server().inspect(code).status === 'countdown', 'round 2');
    await server().advance(COUNTDOWN_MS);
    await hardDropUntilOver(server(), code, { A: a });
    expect(server().inspect(code).status).toBe('seriesOver');
    expect(server().inspect(code).seats.B?.pausesUsed).toBe(1);
    expect(server().inspect(code).seats.A?.drops).toBeGreaterThanOrEqual(3); // kept for the whole series
    for (const client of [a, b2]) client.send({ type: 'rematch' });
    await until(() => server().inspect(code).status === 'countdown', 'the new series');
    const fresh = server().inspect(code);
    expect(fresh.series).toMatchObject({ round: 1, score: { A: 0, B: 0 }, over: false });
    expect(fresh.seats.A).toMatchObject({ pausesUsed: 0, drops: 0 });
    expect(fresh.seats.B).toMatchObject({ pausesUsed: 0, drops: 0 });
  });
});

// ---------------------------------------------------------------- the anti-cheat trail

describe('mutation gaps: the anti-cheat log (REQ-038, REQ-071)', () => {
  const rules = (log: MemoryLog): string[] =>
    log.events('anticheat').map((line) => String(line.rule));

  it('REQ-071 a bad seq, a bad tick, a full queue and a flood each leave one anticheat line naming the room and the seat', async () => {
    const memoryLog = new MemoryLog();
    h = await startTestServer({ memoryLog });
    const { a, code } = await startDuel(server());
    const tick = server().tick(code);
    a.send({ type: 'input', seq: 1, tick, action: { type: 'moveLeft' } });
    a.send({ type: 'input', seq: 1, tick, action: { type: 'moveLeft' } }); // BAD_SEQ
    a.send({
      type: 'input',
      seq: 2,
      tick: tick + MAX_INPUT_LEAD_TICKS + 1,
      action: { type: 'moveLeft' },
    }); // BAD_TICK
    await server().settle();
    expect(rules(memoryLog)).toEqual(expect.arrayContaining(['BAD_SEQ', 'BAD_TICK']));
    for (const rule of ['BAD_SEQ', 'BAD_TICK']) {
      expect(memoryLog.events('anticheat').find((l) => l.rule === rule)).toMatchObject({
        room: code,
        seat: 'A',
      });
    }
  });

  it('REQ-071 a full input queue and an empty bucket are logged as different rules, each naming the room and the seat', async () => {
    const queueLog = new MemoryLog();
    h = await startTestServer({ memoryLog: queueLog, limits: { inputBurst: 100_000 } });
    const duel = await startDuel(server());
    const tick = server().tick(duel.code);
    // The stamps are in the future, so nothing drains: the queue fills and the next input is dropped.
    for (let i = 0; i < DEFAULT_LIMITS.maxQueuedInputs + 1; i += 1) {
      duel.a.input({ type: 'moveLeft' }, tick + MAX_INPUT_LEAD_TICKS);
    }
    await server().settle();
    expect(rules(queueLog)).toContain('QUEUE_FULL');
    expect(rules(queueLog)).not.toContain('RATE_LIMIT_DROP');
    expect(queueLog.events('anticheat').find((l) => l.rule === 'QUEUE_FULL')).toMatchObject({
      room: duel.code,
      seat: 'A',
    });
    await h?.close();

    const bucketLog = new MemoryLog();
    h = await startTestServer({ memoryLog: bucketLog });
    const second = await startDuel(server());
    const now = server().tick(second.code);
    for (let i = 0; i < DEFAULT_LIMITS.inputBurst + 3; i += 1) {
      second.a.input({ type: 'softDropStop' }, now);
    }
    await server().settle();
    expect(rules(bucketLog)).toContain('RATE_LIMIT_DROP');
    expect(rules(bucketLog)).not.toContain('QUEUE_FULL');
    expect(bucketLog.events('anticheat').find((l) => l.rule === 'RATE_LIMIT_DROP')).toMatchObject({
      room: second.code,
      seat: 'A',
    });
  });

  it('REQ-038 REQ-071 the drop that reaches the cap kicks the seat with RATE_LIMITED and logs it', async () => {
    const memoryLog = new MemoryLog();
    h = await startTestServer({ memoryLog });
    const { a, b, code } = await startDuel(server());
    const tick = server().tick(code);
    for (let i = 0; i < DEFAULT_LIMITS.inputBurst + DEFAULT_LIMITS.maxDropsPerSeries; i += 1) {
      a.input({ type: 'softDropStop' }, tick);
    }
    await a.waitClose();
    expect((await b.next('paused')).seat).toBe('A');
    expect(rules(memoryLog)).toContain('RATE_LIMITED_KICK');
    expect(memoryLog.events('anticheat').find((l) => l.rule === 'RATE_LIMITED_KICK')).toMatchObject(
      {
        room: code,
        seat: 'A',
      },
    );
  });
});
