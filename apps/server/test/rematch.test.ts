import { COUNTDOWN_MS } from '@stackerist/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { MatchSeeds } from '../src/index.js';
import { startDuel, startTestServer, until, type Harness } from './helpers/harness.js';
import { hardDropUntilOver } from './helpers/play.js';

let h: Harness;
afterEach(async () => {
  await h.close();
});

const FAST_INPUTS = { inputBurst: 100_000 } as const;

function countingSeeds(): { provider: () => MatchSeeds; calls: () => number } {
  let n = 0;
  return {
    provider: () => {
      n += 1;
      return { pieceSeed: 1000 + n, holeSeed: 2000 + n };
    },
    calls: () => n,
  };
}

describe('REQ-059 Next round and New series', () => {
  it('REQ-059 REQ-083 Next round starts only when both accept, with new seeds, the same room, seats and code', async () => {
    const seeds = countingSeeds();
    h = await startTestServer({ limits: FAST_INPUTS, seedProvider: seeds.provider });
    const { a, b, code, tokenA } = await startDuel(h);
    const firstPreview = a.all('snapshot')[0]?.you?.next;
    await hardDropUntilOver(h, code, { A: a });
    await a.next('gameOver');
    expect(h.inspect(code).status).toBe('roundOver');

    a.send({ type: 'rematch' });
    for (const client of [a, b]) {
      expect(await client.next('rematchStatus')).toEqual({
        type: 'rematchStatus',
        A: true,
        B: false,
      });
    }
    await h.advance(10_000);
    expect(h.inspect(code).status).toBe('roundOver'); // waiting for the opponent to accept
    expect(seeds.calls()).toBe(1);

    a.clear();
    b.send({ type: 'rematch' });
    await a.next('rematchStatus');
    const room = await a.next('room');
    expect(room).toMatchObject({ code, status: 'countdown' });
    expect(room.series).toMatchObject({ round: 2, score: { A: 0, B: 1 } });
    const snap = await a.next('snapshot');
    expect(snap.you?.next).not.toEqual(firstPreview); // new seeds
    expect(seeds.calls()).toBe(2);
    await a.next('countdown');
    await h.advance(COUNTDOWN_MS);
    expect(h.inspect(code).status).toBe('playing');
    expect(h.inspect(code).series.round).toBe(2);
    // The seat tokens still work.
    const again = await h.connect();
    again.send({ type: 'rejoin', code, token: tokenA });
    expect((await again.next('joined')).seat).toBe('A');
  });

  it('REQ-059 REQ-083 a drawn round is replayed with the same number; two wins end the series; New series restarts at 0–0', async () => {
    h = await startTestServer({ limits: FAST_INPUTS });
    const { a, b, code } = await startDuel(h);
    const both = async (): Promise<void> => {
      a.send({ type: 'rematch' });
      b.send({ type: 'rematch' });
      await until(() => h.inspect(code).status === 'countdown', 'countdown');
      await h.advance(COUNTDOWN_MS);
    };
    await hardDropUntilOver(h, code, { A: a, B: b }); // draw
    expect(h.inspect(code).series).toMatchObject({ round: 1, score: { A: 0, B: 0 } });
    await both();
    expect(h.inspect(code).series).toMatchObject({ round: 1, replay: true });
    await hardDropUntilOver(h, code, { B: b }); // A wins round 1 (replay)
    await both();
    expect(h.inspect(code).series).toMatchObject({
      round: 2,
      replay: false,
      score: { A: 1, B: 0 },
    });
    await hardDropUntilOver(h, code, { B: b }); // A wins round 2: 2–0
    const over = h.inspect(code);
    expect(over.status).toBe('seriesOver');
    expect(over.series).toMatchObject({ over: true, winner: 'A', endReason: 'TWO_WINS' });
    expect(over.series.rounds.map((r) => [r.round, r.replay, r.winner])).toEqual([
      [1, false, null],
      [1, true, 'A'],
      [2, false, 'A'],
    ]);
    await both();
    expect(h.inspect(code).series).toEqual({
      round: 1,
      replay: false,
      score: { A: 0, B: 0 },
      over: false,
      winner: null,
      endReason: null,
      rounds: [],
    });
  });

  it('REQ-059 REQ-032 the pause count lasts the whole series and resets with a New series', async () => {
    h = await startTestServer({ limits: FAST_INPUTS });
    const { a, b, code, tokenB } = await startDuel(h);
    b.ws.close();
    await a.next('paused');
    const b2 = await h.connect();
    b2.send({ type: 'rejoin', code, token: tokenB });
    await b2.next('joined');
    await h.advance(COUNTDOWN_MS);
    await hardDropUntilOver(h, code, { A: a });
    a.send({ type: 'rematch' });
    b2.send({ type: 'rematch' });
    await until(() => h.inspect(code).status === 'countdown', 'round 2');
    expect(h.inspect(code).seats.B?.pausesUsed).toBe(1);
    await h.advance(COUNTDOWN_MS);
    a.send({ type: 'leave' }); // series over by forfeit
    await b2.next('gameOver');
    expect(h.inspect(code).seats.B?.pausesUsed).toBe(1);
  });

  it('REQ-059 after the opponent leaves, the remaining player can press but nothing starts', async () => {
    h = await startTestServer({ limits: FAST_INPUTS });
    const { a, b, code } = await startDuel(h);
    await hardDropUntilOver(h, code, { A: a }); // round 1 to B
    // Finish the series: B wins round 2 as well.
    a.send({ type: 'rematch' });
    b.send({ type: 'rematch' });
    await until(() => h.inspect(code).status === 'countdown', 'round 2');
    await h.advance(COUNTDOWN_MS);
    await hardDropUntilOver(h, code, { A: a });
    expect(h.inspect(code).status).toBe('seriesOver');
    a.send({ type: 'leave' }); // L3
    await b.waitFor((m) => m.type === 'room' && m.players.A === undefined, 'opponent left');
    b.clear();
    const mark = b.mark();
    b.send({ type: 'rematch' });
    expect(await b.next('rematchStatus')).toEqual({ type: 'rematchStatus', A: false, B: true });
    await h.advance(COUNTDOWN_MS);
    expect(h.inspect(code).status).toBe('seriesOver');
    expect(b.typesSince(mark)).not.toContain('countdown');
  });

  it('REQ-059 rematch is refused while playing, from spectators and from unbound sockets', async () => {
    h = await startTestServer();
    const { a, code } = await startDuel(h);
    a.send({ type: 'rematch' });
    expect((await a.next('error')).code).toBe('NOT_FINISHED');
    const lone = await h.connect();
    lone.send({ type: 'rematch' });
    expect((await lone.next('error')).code).toBe('NOT_IN_ROOM');
    expect(h.inspect(code).seats.A?.ready).toBe(false);
  });
});
