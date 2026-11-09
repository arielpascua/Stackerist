import { CLOSE_CODES, COUNTDOWN_MS } from '@stackerist/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../src/index.js';
import {
  MemoryLog,
  createAndJoin,
  startDuel,
  startTestServer,
  until,
  type Harness,
} from './helpers/harness.js';

let h: Harness;
afterEach(async () => {
  await h.close();
});

describe('REQ-029 room lifecycle', () => {
  it('REQ-029 a room with no connected player for 2 minutes is deleted; spectators are closed with ROOM_CLOSED', async () => {
    const memoryLog = new MemoryLog();
    h = await startTestServer({ memoryLog });
    const { a, b, code } = await createAndJoin(h);
    const watcher = await h.connect();
    watcher.send({ type: 'join', code, asSpectator: true });
    await watcher.next('joined');
    a.ws.close();
    b.ws.close();
    await until(() => h.testing.inspect(code)?.seats.A?.connected === false, 'A offline');
    await until(() => h.testing.inspect(code)?.seats.B?.connected === false, 'B offline');
    await h.advance(DEFAULT_LIMITS.emptyRoomTtlMs - 2000);
    expect(h.testing.inspect(code)).not.toBeNull();
    await h.advance(2000);
    expect(h.testing.inspect(code)).toBeNull();
    expect((await watcher.waitClose()).code).toBe(CLOSE_CODES.ROOM_CLOSED);
    expect(memoryLog.events('room.closed')).toContainEqual(
      expect.objectContaining({ room: code, reason: 'EMPTY' }),
    );
    // The code is free again: nobody can join a deleted room.
    const late = await h.connect();
    late.send({ type: 'join', code, name: 'Late' });
    expect((await late.next('error')).code).toBe('ROOM_NOT_FOUND');
  });

  it('REQ-029 a room with a connected player is never deleted as empty; a held seat is freed after 2 minutes', async () => {
    h = await startTestServer();
    const { a, code, tokenA } = await createAndJoin(h);
    a.ws.close();
    await until(() => h.testing.inspect(code)?.seats.A?.connected === false, 'A offline');
    // B is still connected: the room is not empty.
    await h.advance(DEFAULT_LIMITS.emptyRoomTtlMs + 2000);
    expect(h.testing.inspect(code)).not.toBeNull();
    const a2 = await h.connect();
    a2.send({ type: 'rejoin', code, token: tokenA });
    expect((await a2.next('error')).code).toBe('BAD_TOKEN'); // A's hold ran out: the seat is free
  });

  it('REQ-029 a waiting room older than 15 minutes is deleted even with its creator connected', async () => {
    const memoryLog = new MemoryLog();
    h = await startTestServer({ memoryLog });
    const a = await h.connect();
    a.send({ type: 'create', name: 'Ann' });
    const { code } = await a.next('created');
    await h.advance(DEFAULT_LIMITS.waitingRoomTtlMs - 2000);
    expect(h.testing.inspect(code)?.status).toBe('waiting');
    await h.advance(2000);
    expect(h.testing.inspect(code)).toBeNull();
    expect((await a.waitClose()).code).toBe(CLOSE_CODES.ROOM_CLOSED);
    expect(memoryLog.events('room.closed')).toContainEqual(
      expect.objectContaining({ room: code, reason: 'WAITING_EXPIRED' }),
    );
  });

  it('REQ-029 a room whose series has started is not removed by the waiting TTL', async () => {
    h = await startTestServer();
    const { code } = await startDuel(h);
    await h.advance(DEFAULT_LIMITS.waitingRoomTtlMs + COUNTDOWN_MS);
    expect(h.testing.inspect(code)?.status).toBe('playing');
  });
});
