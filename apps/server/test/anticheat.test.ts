import { MAX_ACTIONS_PER_TICK } from '@stackerist/engine';
import { CLOSE_CODES, MAX_FRAME_BYTES, MAX_INPUT_LEAD_TICKS } from '@stackerist/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../src/index.js';
import { createAndJoin, startDuel, startTestServer, type Harness } from './helpers/harness.js';
import { hardDropUntilOver } from './helpers/play.js';

let h: Harness;
afterEach(async () => {
  await h.close();
});

describe('REQ-065 source spec §8.2 — anti-cheat (#10–#12)', () => {
  it('REQ-041 #10 inputs with a non-increasing seq are rejected with BAD_SEQ and never applied', async () => {
    h = await startTestServer();
    const { a, code } = await startDuel(h);
    const x0 = h.inspect(code).players.A?.active?.x ?? 0;
    const tick = h.tick(code);
    a.send({ type: 'input', seq: 5, tick, action: { type: 'moveLeft' } });
    a.send({ type: 'input', seq: 5, tick, action: { type: 'moveLeft' } });
    a.send({ type: 'input', seq: 4, tick, action: { type: 'moveLeft' } });
    a.send({ type: 'input', seq: 6, tick, action: { type: 'moveLeft' } });
    await h.settle();
    h.step();
    expect(await a.errorCodes(2)).toEqual(['BAD_SEQ', 'BAD_SEQ']);
    expect(h.inspect(code).players.A?.active?.x).toBe(x0 - 2);
    h.step(); // no lock: the next snapshot is due 2 ticks after the last one
    const snap = await a.snapshotAt(h.tick(code));
    expect(snap.you?.lastAckSeq).toBe(6);
  });

  it('REQ-038 #11 flooding beyond the bucket drops actions silently; sustained flooding disconnects with RATE_LIMITED', async () => {
    h = await startTestServer();
    const { a, b, code } = await startDuel(h);
    const tick = h.tick(code);
    const burst = DEFAULT_LIMITS.inputBurst;
    for (let i = 0; i < burst + 5; i += 1) a.input({ type: 'softDropStop' }, tick);
    await h.settle();
    expect(h.inspect(code).seats.A?.drops).toBe(5);
    expect(h.inspect(code).seats.A?.bufferLength).toBe(burst);
    expect(a.all('error')).toHaveLength(0); // drops are silent
    // Refill is 30/s: 100 ms buys exactly 3 more.
    await h.advance(100);
    for (let i = 0; i < 4; i += 1) a.input({ type: 'softDropStop' }, tick);
    await h.settle();
    expect(h.inspect(code).seats.A?.drops).toBe(6);
    // Sustained flooding: the 200th drop closes the socket with RATE_LIMITED, and the round pauses.
    for (let i = 0; i < DEFAULT_LIMITS.maxDropsPerSeries; i += 1) {
      a.input({ type: 'softDropStop' }, tick);
    }
    const closed = await a.waitClose();
    expect(closed).toEqual({ code: CLOSE_CODES.RATE_LIMITED, reason: 'RATE_LIMITED' });
    expect((await b.next('paused')).seat).toBe('A');
  });

  it('REQ-039 #12 malformed JSON, an unknown type, an unknown key, a binary frame or an oversized frame get BAD_MESSAGE', async () => {
    h = await startTestServer();
    const a = await h.connect();
    a.send('{not json');
    a.send(JSON.stringify({ type: 'teleport' }));
    a.send(JSON.stringify({ type: 'create', name: 'Ann', board: [] }));
    a.send(Buffer.from(JSON.stringify({ type: 'leave' })), { binary: true });
    a.send(JSON.stringify({ type: 'create', name: 'x'.repeat(MAX_FRAME_BYTES) }));
    a.send(JSON.stringify({ type: 'create', name: '' }));
    a.send(JSON.stringify({ type: 'join', code: 'ABCDEF' })); // name required unless spectating
    await h.settle();
    expect(await a.errorCodes(7)).toEqual(Array(7).fill('BAD_MESSAGE'));
    expect(a.closed).toBeNull();
    // A valid message still works on the same socket.
    a.send({ type: 'create', name: 'Ann' });
    await a.next('created');
  });
});

describe('anti-cheat rules', () => {
  it('REQ-039 20 bad messages close the connection with TOO_MANY_BAD_MESSAGES', async () => {
    h = await startTestServer();
    const a = await h.connect();
    for (let i = 0; i < DEFAULT_LIMITS.maxBadMessages - 1; i += 1) a.send('nope');
    await h.settle();
    expect(a.closed).toBeNull();
    a.send('nope');
    const closed = await a.waitClose();
    expect(closed).toEqual({
      code: CLOSE_CODES.TOO_MANY_BAD_MESSAGES,
      reason: 'TOO_MANY_BAD_MESSAGES',
    });
    expect(a.all('error')).toHaveLength(DEFAULT_LIMITS.maxBadMessages);
  });

  it('REQ-039 frames beyond the hard ws limit are closed by ws before the app sees them', async () => {
    h = await startTestServer();
    const a = await h.connect();
    const before = h.testing.framesHandled();
    a.ws.send('x'.repeat(DEFAULT_LIMITS.wsHardMaxPayloadBytes + 1));
    const closed = await a.waitClose();
    expect(closed.code).toBe(1009);
    expect(h.testing.framesHandled()).toBe(before);
  });

  it('REQ-039 a client message carrying game state is not a message: BAD_MESSAGE', async () => {
    h = await startTestServer();
    const { a, code } = await startDuel(h);
    a.send(
      JSON.stringify({
        type: 'input',
        seq: 1,
        tick: h.tick(code),
        action: { type: 'hardDrop' },
        board: Array(20).fill('XXXXXXXXXX'),
      }),
    );
    a.send(JSON.stringify({ type: 'garbage', rows: 4 }));
    await h.settle();
    expect(await a.errorCodes(2)).toEqual(['BAD_MESSAGE', 'BAD_MESSAGE']);
    h.step();
    expect(h.inspect(code).players.A?.piecesPlaced).toBe(0);
  });

  it('REQ-043 inputs before the start, while paused and after game over are rejected with NOT_PLAYING', async () => {
    h = await startTestServer({ limits: { inputBurst: 100_000 } });
    const { a, b, code } = await createAndJoin(h);
    a.input({ type: 'hardDrop' }, 0);
    expect((await a.next('error')).code).toBe('NOT_PLAYING');
    await h.advance(3000);
    b.ws.close();
    await a.next('paused');
    a.input({ type: 'hardDrop' }, h.tick(code));
    expect((await a.next('error')).code).toBe('NOT_PLAYING');
    expect(h.inspect(code).seats.A?.bufferLength).toBe(0);
    // A second room, played to the end.
    const duel = await startDuel(h);
    await hardDropUntilOver(h, duel.code, { A: duel.a });
    duel.b.input({ type: 'hardDrop' }, h.tick(duel.code));
    expect((await duel.b.next('error')).code).toBe('NOT_PLAYING');
  });

  it('REQ-037 REQ-079 a stamp in the past applies at the current tick; a stamp ahead waits for its tick; the server never rewinds', async () => {
    h = await startTestServer({ test: { startTick: 21_600 } }); // level 12: 1 tick per row
    const { a, code } = await startDuel(h);
    const start = h.tick(code);
    h.step(4);
    const y4 = h.inspect(code).players.A?.active?.y ?? 0;
    a.input({ type: 'moveLeft' }, start); // stamped 4 ticks in the past
    a.input({ type: 'moveLeft' }, start + 7); // 3 ticks ahead of the next processed tick
    await h.settle();
    h.step();
    let room = h.inspect(code);
    expect(room.tick).toBe(start + 5);
    expect(room.players.A?.active?.x).toBe(2); // only the past one, applied now
    expect(room.players.A?.active?.y).toBe(y4 + 1); // gravity kept its own clock
    h.step(2);
    expect(h.inspect(code).players.A?.active?.x).toBe(2);
    h.step();
    room = h.inspect(code);
    expect(room.players.A?.active?.x).toBe(1);
    expect(room.tick).toBe(start + 8);
  });

  it('REQ-037 gravity and lock delay run on the server: with no input at all, pieces fall and lock', async () => {
    h = await startTestServer({ test: { startTick: 21_600 } });
    const { code } = await startDuel(h);
    h.step(60);
    expect(h.inspect(code).players.A?.piecesPlaced).toBeGreaterThanOrEqual(1);
    expect(h.inspect(code).players.B?.piecesPlaced).toBe(h.inspect(code).players.A?.piecesPlaced);
  });

  it('REQ-079 stamps more than 30 ticks ahead or before the previous stamp get BAD_TICK, which never counts as a bad message', async () => {
    h = await startTestServer({ limits: { inputBurst: 100_000 } });
    const { a, code } = await startDuel(h);
    const tick = h.tick(code);
    a.input({ type: 'moveLeft' }, tick + MAX_INPUT_LEAD_TICKS); // the edge is allowed
    a.input({ type: 'moveLeft' }, tick + MAX_INPUT_LEAD_TICKS + 1);
    a.input({ type: 'moveLeft' }, tick + 2); // earlier than the previous accepted stamp
    await h.settle();
    expect(await a.errorCodes(2)).toEqual(['BAD_TICK', 'BAD_TICK']);
    for (let i = 0; i < DEFAULT_LIMITS.maxBadMessages + 5; i += 1) a.input({ type: 'moveLeft' }, 0);
    await h.settle();
    const codes = await a.errorCodes(2 + DEFAULT_LIMITS.maxBadMessages + 5);
    expect(codes.every((c) => c === 'BAD_TICK')).toBe(true);
    expect(a.closed).toBeNull();
  });

  it('REQ-038 the bucket is the first input gate: with it empty, a bad-seq or bad-tick input is a silent drop', async () => {
    h = await startTestServer();
    const { a, code } = await startDuel(h);
    const tick = h.tick(code);
    for (let i = 0; i < DEFAULT_LIMITS.inputBurst; i += 1) a.input({ type: 'softDropStop' }, tick);
    await h.settle();
    a.send({ type: 'input', seq: 1, tick, action: { type: 'moveLeft' } }); // would be BAD_SEQ
    a.input({ type: 'moveLeft' }, tick + 999); // would be BAD_TICK
    await h.settle();
    expect(h.inspect(code).seats.A?.drops).toBe(2);
    expect(a.all('error')).toHaveLength(0);
  });

  it('REQ-038 the bucket is charged once at receipt: draining queued inputs never charges it', async () => {
    h = await startTestServer();
    const { a, code } = await startDuel(h);
    const tick = h.tick(code);
    const half = DEFAULT_LIMITS.inputBurst / 2;
    for (let i = 0; i < half; i += 1) a.input({ type: 'softDropStop' }, tick);
    await h.settle();
    h.step(Math.ceil(half / MAX_ACTIONS_PER_TICK)); // drain them all
    expect(h.inspect(code).seats.A?.bufferLength).toBe(0);
    // No time has passed: exactly the other half of the burst is left, because draining charged nothing.
    for (let i = 0; i < half; i += 1) a.input({ type: 'softDropStop' }, h.tick(code));
    await h.settle();
    expect(h.inspect(code).seats.A?.drops).toBe(0);
    a.input({ type: 'softDropStop' }, h.tick(code));
    await h.settle();
    expect(h.inspect(code).seats.A?.drops).toBe(1);
  });

  it('REQ-041 REQ-079 a rejected input writes nothing: its seq can still be used and its stamp is not remembered', async () => {
    h = await startTestServer();
    const { a, code } = await startDuel(h);
    const tick = h.tick(code);
    a.send({ type: 'input', seq: 1, tick, action: { type: 'moveLeft' } });
    a.send({ type: 'input', seq: 2, tick: tick + 999, action: { type: 'moveLeft' } }); // BAD_TICK
    a.send({ type: 'input', seq: 2, tick, action: { type: 'moveLeft' } }); // still a fresh seq
    a.send({ type: 'input', seq: 3, tick: tick + 1, action: { type: 'moveLeft' } });
    await h.settle();
    expect(await a.errorCodes(1)).toEqual(['BAD_TICK']);
    expect(h.inspect(code).seats.A?.bufferLength).toBe(3);
  });

  it('REQ-038 the 200-drop limit counts across the whole series, not per round', async () => {
    h = await startTestServer({
      limits: { inputBurst: 1, inputRefillPerSec: 0, maxDropsPerSeries: 6 },
      test: { startTick: 21_600 }, // level 12: rounds end by gravity alone
    });
    const { a, b, code } = await startDuel(h);
    for (let i = 0; i < 4; i += 1) a.input({ type: 'softDropStop' }, h.tick(code));
    await h.settle();
    expect(h.inspect(code).seats.A?.drops).toBe(3);
    // End round 1 by gravity (identical stacks: a draw, so round 1 is replayed).
    for (let i = 0; i < 40 && h.inspect(code).status === 'playing'; i += 1) h.step(60);
    expect(h.inspect(code).status).toBe('roundOver');
    a.send({ type: 'rematch' });
    b.send({ type: 'rematch' });
    await a.next('countdown');
    await h.advance(3000);
    expect(h.inspect(code).status).toBe('playing');
    expect(h.inspect(code).series.rounds).toHaveLength(1);
    expect(h.inspect(code).seats.A?.drops).toBe(3);
    for (let i = 0; i < 4; i += 1) a.input({ type: 'softDropStop' }, h.tick(code));
    expect((await a.waitClose()).code).toBe(CLOSE_CODES.RATE_LIMITED);
  });
});
