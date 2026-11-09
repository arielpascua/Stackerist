import { COUNTDOWN_MS } from '@stackerist/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../src/index.js';
import {
  createAndJoin,
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

async function watch(code: string, asSpectator = true): Promise<TestClient> {
  const c = await h.connect();
  c.send(
    asSpectator ? { type: 'join', code, asSpectator: true } : { type: 'join', code, name: 'Cy' },
  );
  return c;
}

describe('REQ-065 source spec §8.2 — spectators (#13)', () => {
  it('REQ-042 REQ-062 #13 a third joiner becomes a spectator; spectator inputs get NOT_A_PLAYER', async () => {
    h = await startTestServer();
    const { a, code } = await startDuel(h);
    const c = await watch(code, false);
    expect(await c.next('joined')).toEqual({ type: 'joined', code, seat: 'spectator' });
    const room = await c.next('room');
    expect(room.players).toEqual({
      A: { name: 'Ann', connected: true },
      B: { name: 'Ben', connected: true },
    });
    expect(room.spectators).toBe(1);
    const snap = await c.next('snapshot');
    expect(snap.you).toBeUndefined();
    expect(Object.keys(snap.players).sort()).toEqual(['A', 'B']);
    await a.waitFor((m) => m.type === 'room' && m.spectators === 1, 'players see the count');

    const before = h.inspect(code).players;
    c.send({ type: 'input', seq: 1, tick: h.tick(code), action: { type: 'hardDrop' } });
    expect((await c.next('error')).code).toBe('NOT_A_PLAYER');
    c.send({ type: 'rematch' });
    expect((await c.next('error')).code).toBe('NOT_A_PLAYER');
    h.step();
    expect(h.inspect(code).players.A?.piecesPlaced).toBe(before.A?.piecesPlaced);
    expect(h.inspect(code).players.B?.piecesPlaced).toBe(before.B?.piecesPlaced);
  });
});

describe('spectators', () => {
  it('REQ-062 watch=1 joins as a spectator even when a seat is free', async () => {
    h = await startTestServer();
    const a = await h.connect();
    a.send({ type: 'create', name: 'Ann' });
    const { code } = await a.next('created');
    const c = await watch(code);
    expect((await c.next('joined')).seat).toBe('spectator');
    expect(h.inspect(code).seats.B).toBeUndefined();
    expect(h.inspect(code).spectators).toBe(1);
  });

  it('REQ-062 at most 8 spectators per room; the next one gets ROOM_FULL and is not bound', async () => {
    h = await startTestServer();
    const { a, code } = await startDuel(h);
    for (let i = 0; i < DEFAULT_LIMITS.maxSpectatorsPerRoom; i += 1) {
      const c = await watch(code);
      expect((await c.next('joined')).seat).toBe('spectator');
    }
    const extra = await watch(code);
    expect((await extra.next('error')).code).toBe('ROOM_FULL');
    expect(h.inspect(code).spectators).toBe(DEFAULT_LIMITS.maxSpectatorsPerRoom);
    await a.waitFor(
      (m) => m.type === 'room' && m.spectators === DEFAULT_LIMITS.maxSpectatorsPerRoom,
      'players see 8 spectators',
    );
    extra.send({ type: 'leave' });
    extra.send({ type: 'input', seq: 1, tick: 0, action: { type: 'moveLeft' } });
    expect((await extra.next('error')).code).toBe('NOT_IN_ROOM');
    // A third player joining a full room is a spectator too, so it is refused as well.
    const third = await watch(code, false);
    expect((await third.next('error')).code).toBe('ROOM_FULL');
  });

  it('REQ-062 a spectator leaving or dropping updates the count', async () => {
    h = await startTestServer();
    const { a, code } = await startDuel(h);
    const c1 = await watch(code);
    const c2 = await watch(code);
    await c1.next('joined');
    await c2.next('joined');
    c1.send({ type: 'leave' });
    c2.ws.close();
    await until(() => h.inspect(code).spectators === 0, 'spectators gone');
    await a.waitFor((m) => m.type === 'room' && m.spectators === 0, 'count back to 0');
    expect(h.inspect(code).status).toBe('playing');
  });
});

describe('catch-up anchors (gap ruling G4)', () => {
  it('REQ-062 G4 a spectator joining during the countdown gets the snapshot and the countdown anchor', async () => {
    h = await startTestServer();
    const { a, code } = await createAndJoin(h);
    const original = a.last('countdown');
    await h.advance(1000);
    const c = await watch(code);
    await c.next('joined');
    await c.next('room');
    const snap = await c.next('snapshot');
    expect(snap.tick).toBe(0);
    const countdown = await c.next('countdown');
    expect(countdown.startsAt).toBe(original?.startsAt);
    expect(countdown.serverNow).toBe(h.clock.nowEpochMs());
    expect(countdown.tick).toBe(0);
  });

  it('REQ-035 G4 a player rejoining during the countdown gets the countdown anchor', async () => {
    h = await startTestServer();
    const { a, code, tokenA } = await createAndJoin(h);
    const original = a.last('countdown');
    const a2 = await h.connect();
    a2.send({ type: 'rejoin', code, token: tokenA });
    await a2.next('joined');
    await a2.next('snapshot');
    expect((await a2.next('countdown')).startsAt).toBe(original?.startsAt);
    expect(h.inspect(code).status).toBe('countdown');
  });

  it('REQ-031 G4 a spectator joining during a resume countdown gets the snapshot and the resumed anchor; during a pause, the paused message', async () => {
    h = await startTestServer();
    const { a, b, code, tokenB } = await startDuel(h);
    b.ws.close();
    await a.next('paused');
    const c1 = await watch(code);
    await c1.next('joined');
    await c1.next('snapshot');
    const paused = await c1.next('paused');
    expect(paused.seat).toBe('B');

    const b2 = await h.connect();
    b2.send({ type: 'rejoin', code, token: tokenB });
    const resumed = await a.next('resumed');
    await h.advance(1000);
    const c2 = await watch(code);
    await c2.next('joined');
    await c2.next('snapshot');
    const anchor = await c2.next('resumed');
    expect(anchor.startsAt).toBe(resumed.startsAt);
    expect(anchor.tick).toBe(resumed.tick);
    expect(c2.all('paused')).toHaveLength(0);
    await h.advance(COUNTDOWN_MS);
    expect(h.inspect(code).status).toBe('playing');
  });
});
