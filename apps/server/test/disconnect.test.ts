import {
  CLOSE_CODES,
  COUNTDOWN_MS,
  GRACE_MS,
  MAX_PAUSES_PER_SERIES,
  SEAT_HOLD_MS,
} from '@stackerist/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MemoryLog,
  createAndJoin,
  startDuel,
  startTestServer,
  until,
  type Harness,
  type TestClient,
} from './helpers/harness.js';
import { hardDropUntilOver, playSafe } from './helpers/play.js';

let h: Harness;
afterEach(async () => {
  await h.close();
});

const FAST_INPUTS = { inputBurst: 100_000 } as const;

/** Closes the client's socket and waits until the server has processed the disconnect. */
async function drop(client: TestClient, code?: string, seat?: 'A' | 'B'): Promise<void> {
  client.ws.close();
  await client.waitClose();
  if (code !== undefined && seat !== undefined) {
    await until(
      () => h.testing.inspect(code)?.seats[seat]?.connected !== true,
      `server to see ${seat} offline`,
    );
  }
}

async function rejoin(code: string, token: string): Promise<TestClient> {
  const client = await h.connect();
  client.send({ type: 'rejoin', code, token });
  await client.next('joined');
  return client;
}

describe('REQ-065 source spec §8.2 — leaving and disconnects (#6–#8)', () => {
  it('REQ-030 #6 leave mid-game: the opponent wins with OPPONENT_LEFT and the series is over', async () => {
    h = await startTestServer({ limits: FAST_INPUTS });
    const { a, b, code } = await startDuel(h);
    await playSafe(h, code, { A: a, B: b });
    a.send({ type: 'leave' });
    for (const client of [a, b]) {
      const over = await client.next('gameOver');
      expect(over).toMatchObject({ winner: 'B', reason: 'OPPONENT_LEFT' });
      expect(over.series).toMatchObject({
        over: true,
        winner: 'B',
        endReason: 'OPPONENT_LEFT',
        score: { A: 0, B: 0 },
      });
      expect(over.series.rounds).toEqual([
        { round: 1, replay: false, winner: 'B', reason: 'OPPONENT_LEFT', durationTicks: 1 },
      ]);
    }
    await b.waitFor((m) => m.type === 'room' && m.status === 'seriesOver', 'room seriesOver');
    expect(b.last('room')?.players).toEqual({ B: { name: 'Ben', connected: true } });
    // The leaver is unbound: its socket stays open and can start over.
    a.send({ type: 'input', seq: 1, tick: 0, action: { type: 'hardDrop' } });
    expect((await a.next('error')).code).toBe('NOT_IN_ROOM');
  });

  it('REQ-031 #7 socket drop pauses; a rejoin within grace resumes from the exact paused state', async () => {
    h = await startTestServer({ limits: FAST_INPUTS });
    const { a, b, code, tokenA } = await startDuel(h);
    for (let i = 0; i < 3; i += 1) await playSafe(h, code, { A: a, B: b });
    h.step(5);
    const before = h.inspect(code);
    b.clear();
    await drop(a, code, 'A');
    const paused = await b.next('paused');
    expect(paused.seat).toBe('A');
    expect(paused.graceEndsAt - paused.serverNow).toBe(GRACE_MS);
    expect(paused.pausesLeft).toBe(MAX_PAUSES_PER_SERIES - 1);
    const pausedRoom = await b.next('room');
    expect(pausedRoom).toMatchObject({ status: 'paused' });
    await b.waitFor(
      (m) => m.type === 'room' && m.players.A?.connected === false,
      'A shown offline',
    );
    // Nothing ticks while paused, and inputs are refused.
    h.step(30);
    b.input({ type: 'hardDrop' }, h.tick(code));
    expect((await b.next('error')).code).toBe('NOT_PLAYING');
    await h.advance(GRACE_MS - 5000);
    expect(h.inspect(code).players).toEqual(before.players);
    expect(h.inspect(code).tick).toBe(before.tick);

    b.clear();
    const a2 = await rejoin(code, tokenA);
    expect(a2.all('joined')[0]?.token).toBeUndefined();
    for (const client of [a2, b]) {
      const snap = await client.next('snapshot');
      expect(snap.tick).toBe(before.tick);
      const resumed = await client.next('resumed');
      expect(resumed.tick).toBe(before.tick);
      expect(resumed.startsAt - resumed.serverNow).toBe(COUNTDOWN_MS);
    }
    expect(h.inspect(code).status).toBe('paused');
    await h.advance(COUNTDOWN_MS);
    expect(h.inspect(code).status).toBe('playing');
    expect(h.inspect(code).players).toEqual(before.players);
    await b.waitFor((m) => m.type === 'room' && m.status === 'playing', 'room playing');
  });

  it('REQ-032 #7 grace expiry forfeits with OPPONENT_DISCONNECTED', async () => {
    h = await startTestServer();
    const { a, b, code } = await startDuel(h);
    await drop(b, code, 'B');
    await a.next('paused');
    await h.advance(GRACE_MS - 1000);
    expect(h.inspect(code).status).toBe('paused');
    await h.advance(1000);
    const over = await a.next('gameOver');
    expect(over).toMatchObject({ winner: 'A', reason: 'OPPONENT_DISCONNECTED' });
    expect(over.series).toMatchObject({
      over: true,
      endReason: 'OPPONENT_DISCONNECTED',
      winner: 'A',
    });
    expect(h.inspect(code).status).toBe('seriesOver');
  });

  it('REQ-032 #8 the 4th disconnect in a series is an immediate forfeit', async () => {
    h = await startTestServer();
    const { a, b, code, tokenB } = await startDuel(h);
    let current = b;
    for (let n = 1; n <= MAX_PAUSES_PER_SERIES; n += 1) {
      await drop(current, code, 'B');
      const paused = await a.next('paused');
      expect(paused.pausesLeft).toBe(MAX_PAUSES_PER_SERIES - n);
      current = await rejoin(code, tokenB);
      await a.next('resumed');
      await h.advance(COUNTDOWN_MS);
      expect(h.inspect(code).status).toBe('playing');
    }
    expect(h.inspect(code).seats.B?.pausesUsed).toBe(MAX_PAUSES_PER_SERIES);
    await drop(current, code, 'B');
    const over = await a.next('gameOver');
    expect(over).toMatchObject({ winner: 'A', reason: 'OPPONENT_DISCONNECTED' });
    expect(a.all('paused')).toHaveLength(MAX_PAUSES_PER_SERIES);
    expect(h.inspect(code).status).toBe('seriesOver');
  });
});

describe('disconnect rules', () => {
  it('REQ-033 both disconnected: the match stays paused and the first grace to expire forfeits', async () => {
    h = await startTestServer();
    const { a, b, code } = await startDuel(h);
    const watcher = await h.connect();
    watcher.send({ type: 'join', code, asSpectator: true });
    await watcher.next('joined');
    await drop(a, code, 'A');
    await watcher.next('paused');
    await h.advance(1000);
    await drop(b, code, 'B');
    await watcher.next('paused');
    expect(h.inspect(code).status).toBe('paused');
    await h.advance(GRACE_MS - 1000);
    const over = await watcher.next('gameOver');
    expect(over).toMatchObject({ winner: 'B', reason: 'OPPONENT_DISCONNECTED' });
    expect(h.inspect(code).status).toBe('seriesOver');
    // The forfeited series never resumes, even when B's own grace would have expired.
    await h.advance(2000);
    expect(h.inspect(code).status).toBe('seriesOver');
    expect(watcher.all('gameOver')).toHaveLength(1);
    expect(watcher.all('resumed')).toHaveLength(0);
  });

  it('REQ-030 a leave during the resume countdown ends the series, and the forfeited series never resumes', async () => {
    h = await startTestServer();
    const { a, b, code, tokenB } = await startDuel(h);
    await drop(b, code, 'B');
    await a.next('paused');
    const b2 = await rejoin(code, tokenB);
    await a.next('resumed');
    a.send({ type: 'leave' });
    const over = await b2.next('gameOver');
    expect(over).toMatchObject({ winner: 'B', reason: 'OPPONENT_LEFT' });
    const mark = b2.mark();
    await h.advance(COUNTDOWN_MS + 1000);
    h.step(10);
    expect(h.inspect(code).status).toBe('seriesOver');
    expect(h.inspect(code).tick).toBe(over.tick);
    await h.advance(1000);
    expect(b2.received.slice(mark).some((m) => m.type === 'room' && m.status === 'playing')).toBe(
      false,
    );
  });

  it('REQ-032 a 4th disconnect during the resume countdown is final, even if the forfeiter rejoins at once', async () => {
    h = await startTestServer();
    const { a, b, code, tokenB } = await startDuel(h);
    let current = b;
    for (let n = 1; n <= MAX_PAUSES_PER_SERIES; n += 1) {
      await drop(current, code, 'B');
      await a.next('paused');
      current = await rejoin(code, tokenB);
      await a.next('resumed');
      if (n < MAX_PAUSES_PER_SERIES) await h.advance(COUNTDOWN_MS);
    }
    // Inside the third resume countdown: the 4th disconnect forfeits…
    await drop(current, code, 'B');
    expect((await a.next('gameOver')).reason).toBe('OPPONENT_DISCONNECTED');
    // …and B coming straight back (its seat is still held) must not revive the round.
    const back = await rejoin(code, tokenB);
    await back.next('gameOver');
    await h.advance(COUNTDOWN_MS + 1000);
    expect(h.inspect(code).status).toBe('seriesOver');
    expect(h.inspect(code).seats.B?.connected).toBe(true);
  });

  it('REQ-033 both graces expiring together end the room as abandoned', async () => {
    const memoryLog = new MemoryLog();
    h = await startTestServer({ memoryLog });
    const { a, b, code } = await startDuel(h);
    const watcher = await h.connect();
    watcher.send({ type: 'join', code, asSpectator: true });
    await watcher.next('joined');
    a.ws.close();
    b.ws.close();
    await a.waitClose();
    await b.waitClose();
    await until(() => watcher.all('paused').length === 2, 'two pauses');
    await h.advance(GRACE_MS);
    const closed = await watcher.waitClose();
    expect(closed.code).toBe(CLOSE_CODES.ROOM_CLOSED);
    expect(h.testing.inspect(code)).toBeNull();
    expect(watcher.all('gameOver')).toHaveLength(0);
    expect(memoryLog.events('room.closed')).toContainEqual(
      expect.objectContaining({ room: code, reason: 'ABANDONED' }),
    );
  });

  it('REQ-034 a disconnect during the countdown returns the room to waiting and holds the seat', async () => {
    h = await startTestServer();
    const { a, b, code, tokenB } = await createAndJoin(h);
    await drop(b, code, 'B');
    await a.waitFor(
      (m) => m.type === 'room' && m.status === 'waiting' && m.players.B?.connected === false,
      'back to waiting',
    );
    await h.advance(COUNTDOWN_MS);
    expect(h.inspect(code).status).toBe('waiting');
    expect(h.inspect(code).seats.B?.connected).toBe(false);
    // A newcomer can't take the held seat.
    const c = await h.connect();
    c.send({ type: 'join', code, name: 'Cy' });
    expect((await c.next('joined')).seat).toBe('spectator');
    // The holder comes back within 2 minutes: a fresh countdown.
    await h.advance(SEAT_HOLD_MS - 10_000);
    a.clear();
    const b2 = await rejoin(code, tokenB);
    await a.next('countdown');
    await b2.next('countdown');
    expect(h.inspect(code).status).toBe('countdown');
    // Gone again and the hold runs out: the seat is free (no round ever started).
    await drop(b2, code, 'B');
    await h.advance(SEAT_HOLD_MS);
    expect(h.inspect(code).seats.B).toBeUndefined();
    expect(h.inspect(code).status).toBe('waiting');
  });

  it('REQ-034 a disconnect between rounds holds the seat 2 minutes without a pause, then the series goes to the opponent', async () => {
    h = await startTestServer({ limits: FAST_INPUTS });
    const { a, b, code, tokenB } = await startDuel(h);
    await hardDropUntilOver(h, code, { A: a });
    await b.next('gameOver');
    expect(h.inspect(code).status).toBe('roundOver');
    await drop(b, code, 'B');
    await a.waitFor((m) => m.type === 'room' && m.players.B?.connected === false, 'B offline');
    expect(a.all('paused')).toHaveLength(0);
    expect(h.inspect(code).seats.B?.pausesUsed).toBe(0);
    // Back within the hold: the result is re-sent (R4).
    await h.advance(60_000);
    const b2 = await rejoin(code, tokenB);
    expect((await b2.next('gameOver')).winner).toBe('B');
    await b2.next('rematchStatus');
    await drop(b2, code, 'B');
    await h.advance(SEAT_HOLD_MS - 1000);
    expect(h.inspect(code).status).toBe('roundOver');
    await h.advance(1000);
    const room = h.inspect(code);
    expect(room.status).toBe('seriesOver');
    expect(room.series).toMatchObject({
      over: true,
      winner: 'A',
      endReason: 'OPPONENT_DISCONNECTED',
      score: { A: 0, B: 1 },
    });
    expect(room.series.rounds).toHaveLength(1); // G1: no summary for a forfeit between rounds
    expect(room.seats.B).toBeUndefined();
  });

  it('REQ-035 a rejoin with the seat token replaces the older socket, which closes with REPLACED', async () => {
    h = await startTestServer();
    const { a, b, code, tokenA } = await startDuel(h);
    const a2 = await rejoin(code, tokenA);
    const closed = await a.waitClose();
    expect(closed).toEqual({ code: CLOSE_CODES.REPLACED, reason: 'REPLACED' });
    await a2.next('snapshot');
    // The replaced socket's close is not a disconnect: no pause.
    await h.advance(1000);
    expect(h.inspect(code).status).toBe('playing');
    expect(b.all('paused')).toHaveLength(0);
    expect(h.inspect(code).seats.A?.connected).toBe(true);
    a2.input({ type: 'moveLeft' }, h.tick(code));
    await h.settle();
    expect(a2.all('error')).toHaveLength(0);
  });
});
