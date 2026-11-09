import {
  COUNTDOWN_MS,
  GAME_PATH_PREFIX,
  SEAT_TOKEN_LENGTH,
  gamePath,
  normalizeRoomCode,
} from '@stackerist/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { createAndJoin, startTestServer, type Harness } from './helpers/harness.js';

let h: Harness;
afterEach(async () => {
  await h.close();
});

describe('REQ-065 source spec §8.2 — lobby (#1, #9)', () => {
  it('REQ-020 REQ-025 #1 create → code and token; join with the code → both get room with both players; countdown starts', async () => {
    h = await startTestServer();
    const a = await h.connect();
    a.send({ type: 'create', name: '  Ann  ' });
    const created = await a.next('created');
    expect(created.seat).toBe('A');
    expect(normalizeRoomCode(created.code)).toBe(created.code);
    expect(created.token).toHaveLength(SEAT_TOKEN_LENGTH);
    expect(gamePath(created.code)).toBe(`${GAME_PATH_PREFIX}${created.code}`);
    const waiting = await a.next('room');
    expect(waiting.status).toBe('waiting');
    expect(waiting.players).toEqual({ A: { name: 'Ann', connected: true } });

    const b = await h.connect();
    const markA = a.mark();
    b.send({ type: 'join', code: ` ${created.code.toLowerCase()} `, name: 'Ben' });
    const joined = await b.next('joined');
    expect(joined).toMatchObject({ code: created.code, seat: 'B' });
    expect(joined.token).toHaveLength(SEAT_TOKEN_LENGTH);
    expect(joined.token).not.toBe(created.token);

    for (const client of [a, b]) {
      const both = await client.next('room');
      expect(both.players).toEqual({
        A: { name: 'Ann', connected: true },
        B: { name: 'Ben', connected: true },
      });
      const countdownRoom = await client.next('room');
      expect(countdownRoom.status).toBe('countdown');
      const countdown = await client.next('countdown');
      expect(countdown.serverNow).toBe(h.clock.nowEpochMs());
      expect(countdown.startsAt - countdown.serverNow).toBe(COUNTDOWN_MS);
      expect(countdown.tick).toBe(0);
    }
    // §3.6 round start ordering: room{countdown} → snapshot → countdown.
    expect(a.typesSince(markA).filter((t) => t !== 'ping')).toEqual([
      'room',
      'room',
      'snapshot',
      'countdown',
    ]);
    expect(h.inspect(created.code).status).toBe('countdown');
    await h.advance(COUNTDOWN_MS - 1);
    expect(h.inspect(created.code).status).toBe('countdown');
    await h.advance(1);
    expect(h.inspect(created.code).status).toBe('playing');
    expect((await a.next('room')).status).toBe('playing');
  });

  it('REQ-040 #9 rejoin with a wrong token is rejected and binds nothing', async () => {
    h = await startTestServer();
    const { code, tokenA } = await createAndJoin(h);
    const c = await h.connect();
    // Same shape, wrong bytes.
    const wrong = tokenA.startsWith('A') ? `B${tokenA.slice(1)}` : `A${tokenA.slice(1)}`;
    c.send({ type: 'rejoin', code, token: wrong });
    expect((await c.next('error')).code).toBe('BAD_TOKEN');
    // A case-flipped token is a different token.
    const flipped = tokenA.replace(/[a-z]/, (ch) => ch.toUpperCase());
    if (flipped !== tokenA) {
      c.send({ type: 'rejoin', code, token: flipped });
      expect((await c.next('error')).code).toBe('BAD_TOKEN');
    }
    // Unknown and malformed codes are ROOM_NOT_FOUND (never BAD_MESSAGE).
    c.send({ type: 'rejoin', code: 'ZZZZZZ', token: tokenA });
    expect((await c.next('error')).code).toBe('ROOM_NOT_FOUND');
    c.send({ type: 'rejoin', code: 'O0I1L!', token: tokenA });
    expect((await c.next('error')).code).toBe('ROOM_NOT_FOUND');
    // Nothing was bound: the socket is still outside every room.
    c.send({ type: 'input', seq: 1, tick: 0, action: { type: 'moveLeft' } });
    expect((await c.next('error')).code).toBe('NOT_IN_ROOM');
    expect(h.inspect(code).seats.A?.connected).toBe(true);
    expect(c.all('joined')).toHaveLength(0);
  });
});

describe('rooms and codes', () => {
  it('REQ-020 a code is case-insensitive on input; a malformed code is ROOM_NOT_FOUND, not BAD_MESSAGE', async () => {
    h = await startTestServer();
    const a = await h.connect();
    a.send({ type: 'create', name: 'Ann' });
    const { code } = await a.next('created');
    const typo = await h.connect();
    typo.send({ type: 'join', code: 'not-a-code', name: 'Cy' });
    expect((await typo.next('error')).code).toBe('ROOM_NOT_FOUND');
    typo.send({ type: 'join', code: code.toLowerCase(), name: 'Cy' });
    expect(await typo.next('joined')).toMatchObject({ code, seat: 'B' });
    expect(typo.all('error').map((e) => e.code)).not.toContain('BAD_MESSAGE');
  });

  it('REQ-025 the countdown starts only once both seats are connected', async () => {
    h = await startTestServer();
    const a = await h.connect();
    a.send({ type: 'create', name: 'Ann' });
    const { code } = await a.next('created');
    await h.advance(10_000);
    expect(h.inspect(code).status).toBe('waiting');
    expect(a.all('countdown')).toHaveLength(0);
  });

  it('REQ-040 a socket acts only on its own seat', async () => {
    h = await startTestServer();
    const { a, code } = await createAndJoin(h);
    await h.advance(COUNTDOWN_MS);
    const before = h.inspect(code).players;
    a.input({ type: 'moveLeft' }, h.tick(code));
    await h.settle();
    h.step();
    const after = h.inspect(code).players;
    expect(after.A?.active?.x).toBe((before.A?.active?.x ?? 0) - 1);
    expect(after.B?.active?.x).toBe(before.B?.active?.x);
  });
});
