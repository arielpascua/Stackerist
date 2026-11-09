import { PREVIEW_COUNT } from '@stackerist/engine';
import { SNAPSHOT_EVERY_TICKS } from '@stackerist/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultHoleRngFactory } from '../src/index.js';
import { SEEDS, startDuel, startTestServer, until, type Harness } from './helpers/harness.js';
import {
  hardDropUntilOver,
  mustPlanClear,
  playSafe,
  playTick,
  runPlans,
  stateOf,
} from './helpers/play.js';

let h: Harness;
afterEach(async () => {
  await h.close();
});

const FAST_INPUTS = { inputBurst: 100_000 } as const;
const fixedHole = () => () => 3;

describe('REQ-065 source spec §8.2 — gameplay (#2–#5)', () => {
  it('REQ-023 #2 both players receive the same first 20 spawned pieces', async () => {
    h = await startTestServer({ limits: FAST_INPUTS });
    const { a, b, code } = await startDuel(h);
    for (let i = 0; i < 19; i += 1) await playSafe(h, code, { A: a, B: b });
    const spawned = (client: typeof a): string[] => {
      const kinds: string[] = [];
      let placed = -1;
      for (const snap of client.all('snapshot')) {
        const you = snap.you;
        if (you?.active == null) continue;
        if (you.stats.piecesPlaced !== placed) {
          placed = you.stats.piecesPlaced;
          kinds.push(you.active.kind);
        }
      }
      return kinds;
    };
    await until(() => spawned(a).length >= 20 && spawned(b).length >= 20, '20 spawns each');
    const kindsA = spawned(a);
    const kindsB = spawned(b);
    expect(kindsA).toHaveLength(20);
    expect(kindsB).toEqual(kindsA);
    // The countdown snapshot already previews the same five for both owners.
    const firstA = a.all('snapshot')[0]?.you?.next;
    expect(firstA).toHaveLength(PREVIEW_COUNT);
    expect(b.all('snapshot')[0]?.you?.next).toEqual(firstA);
  });

  it('REQ-017 #3 a scripted 2-line clear by A puts exactly 1 pending garbage row on B', async () => {
    h = await startTestServer({ limits: FAST_INPUTS, holeRngFactory: fixedHole });
    const { a, b, code } = await startDuel(h);
    const plan = mustPlanClear(h, code, 'A', 2);
    await runPlans(h, code, { A: { client: a, plan } });
    await h.settle();
    expect(stateOf(h, code, 'B').pendingGarbage).toEqual([{ rows: 1, holeColumn: 3 }]);
    const snapB = await b.snapshotAt(h.tick(code));
    await a.snapshotAt(h.tick(code));
    expect(snapB.you?.pendingGarbage).toEqual([{ rows: 1, holeColumn: 3 }]);
    expect(snapB.players.B?.pendingGarbage).toBe(1);
    expect(a.last('snapshot')?.players.B?.pendingGarbage).toBe(1);
    expect(snapB.events).toContainEqual(
      expect.objectContaining({ type: 'attack', from: 'A', rows: 1 }),
    );
  });

  it('REQ-017 #3 a scripted 4-line clear by A puts 4 pending garbage rows on B', async () => {
    h = await startTestServer({ limits: FAST_INPUTS, holeRngFactory: fixedHole });
    const { a, b, code } = await startDuel(h);
    const plan = mustPlanClear(h, code, 'A', 4);
    await runPlans(h, code, { A: { client: a, plan } });
    await h.settle();
    expect(stateOf(h, code, 'B').pendingGarbage).toEqual([{ rows: 4, holeColumn: 3 }]);
    expect((await b.snapshotAt(h.tick(code))).you?.pendingGarbage).toEqual([
      { rows: 4, holeColumn: 3 },
    ]);
  });

  it('REQ-026 #4 a top-out ends the round and both clients receive gameOver with the right winner', async () => {
    h = await startTestServer({ limits: FAST_INPUTS });
    const { a, b, code } = await startDuel(h);
    const markA = a.mark();
    await hardDropUntilOver(h, code, { A: a });
    await h.settle();
    for (const client of [a, b]) {
      const over = await client.next('gameOver');
      expect(over).toMatchObject({ winner: 'B', reason: 'TOP_OUT', round: 1, replay: false });
      expect(over.series.score).toEqual({ A: 0, B: 1 });
      expect(over.tick).toBe(h.tick(code));
    }
    // §3.6 round end ordering: final snapshot → gameOver → room{roundOver}.
    const tail = a
      .typesSince(markA)
      .filter((t) => t !== 'ping')
      .slice(-3);
    expect(tail).toEqual(['snapshot', 'gameOver', 'room']);
    expect(a.last('room')?.status).toBe('roundOver');
    expect(a.last('snapshot')?.players.A?.toppedOut).toBe(true);
  });

  it('REQ-026 #5 a simultaneous top-out is a DRAW', async () => {
    h = await startTestServer({ limits: FAST_INPUTS });
    const { a, b, code } = await startDuel(h);
    await hardDropUntilOver(h, code, { A: a, B: b });
    await h.settle();
    for (const client of [a, b]) {
      const over = await client.next('gameOver');
      expect(over).toMatchObject({ winner: null, reason: 'DRAW' });
      expect(over.series.score).toEqual({ A: 0, B: 0 });
    }
    expect(h.inspect(code).status).toBe('roundOver');
  });
});

describe('REQ-065 garbage routing after cancelling', () => {
  it('REQ-065 only the leftover after cancelling reaches the opponent', async () => {
    h = await startTestServer({ limits: FAST_INPUTS, holeRngFactory: fixedHole });
    const { a, b, code } = await startDuel(h);
    const planA = mustPlanClear(h, code, 'A', 2);
    const planB = mustPlanClear(h, code, 'B', 4);
    // Build both stacks, all but each finishing piece.
    await runPlans(
      h,
      code,
      { A: { client: a, plan: planA }, B: { client: b, plan: planB } },
      { A: planA.length - 1, B: planB.length - 1 },
    );
    // A's double: 1 row pending on B.
    await playTick(h, code, { A: { client: a, actions: planA.at(-1) ?? [] } });
    expect(stateOf(h, code, 'B').pendingGarbage).toEqual([{ rows: 1, holeColumn: 3 }]);
    // B's four-line clear attacks 4: 1 cancels B's own pending row, only 3 reach A.
    await playTick(h, code, { B: { client: b, actions: planB.at(-1) ?? [] } });
    await h.settle();
    const stateA = stateOf(h, code, 'A');
    const stateB = stateOf(h, code, 'B');
    expect(stateB.pendingGarbage).toEqual([]);
    expect(stateB.garbageCancelled).toBe(1);
    expect(stateB.garbageSent).toBe(3);
    expect(stateA.pendingGarbage).toEqual([{ rows: 3, holeColumn: 3 }]);
    expect(stateA.garbageReceived).toBe(3);
    const events = (await a.snapshotAt(h.tick(code))).events;
    expect(events).toContainEqual(expect.objectContaining({ type: 'cancel', seat: 'B', rows: 1 }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'attack', from: 'B', rows: 3 }));
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: 'attack', from: 'B', rows: 4 }),
    );

    // REQ-090 the round report carries the same garbage numbers.
    await hardDropUntilOver(h, code, { A: a });
    const over = await a.next('gameOver');
    expect(over.report.B).toMatchObject({
      garbageSent: 3,
      garbageCancelled: 1,
      garbageReceived: 1,
    });
    expect(over.report.A).toMatchObject({ garbageSent: 1, garbageReceived: 3 });
  });
});

describe('server match rules', () => {
  it('REQ-017 every attack takes one value from the server hole RNG, seeded with the hole seed', async () => {
    h = await startTestServer({ limits: FAST_INPUTS });
    const { a, code } = await startDuel(h);
    const plan = mustPlanClear(h, code, 'A', 2);
    await runPlans(h, code, { A: { client: a, plan } });
    const expected = defaultHoleRngFactory(SEEDS.holeSeed)();
    expect(stateOf(h, code, 'B').pendingGarbage).toEqual([{ rows: 1, holeColumn: expected }]);
  });

  it('REQ-023 one server seed, a separate bag per seat: one seat playing never advances the other', async () => {
    h = await startTestServer({ limits: FAST_INPUTS });
    const { a, code } = await startDuel(h);
    const queueB = stateOf(h, code, 'B').queue;
    for (let i = 0; i < 3; i += 1) await playSafe(h, code, { A: a });
    expect(stateOf(h, code, 'A').piecesPlaced).toBe(3);
    expect(stateOf(h, code, 'B').queue).toEqual(queueB);
    expect(stateOf(h, code, 'A').queue.slice(0, PREVIEW_COUNT - 3)).toEqual(queueB.slice(3));
  });

  it('REQ-027 snapshots go out at most every 2 ticks, and immediately after a lock', async () => {
    h = await startTestServer({ limits: FAST_INPUTS });
    const { a, code } = await startDuel(h);
    a.clear();
    const start = a.mark();
    h.step(10);
    await h.settle();
    a.input({ type: 'hardDrop' }, h.tick(code));
    await h.settle();
    h.step(); // tick 10: the lock → a snapshot although the last one was 1 tick ago
    h.step(3);
    await a.snapshotAt(13);
    const ticks = a.received.slice(start).flatMap((m) => (m.type === 'snapshot' ? [m.tick] : []));
    expect(ticks).toEqual([2, 4, 6, 8, 10, 11, 13]);
    for (let i = 1; i < ticks.length; i += 1) {
      const gap = (ticks[i] ?? 0) - (ticks[i - 1] ?? 0);
      if (ticks[i] !== 11) expect(gap).toBeGreaterThanOrEqual(SNAPSHOT_EVERY_TICKS);
    }
    const lockSnap = a.all('snapshot').find((s) => s.tick === 11);
    expect(lockSnap?.you?.stats.piecesPlaced).toBe(1);
  });

  it('REQ-046 gameOver carries lines, garbage sent and cancelled, pieces, best combo and best moment per seat', async () => {
    h = await startTestServer({ limits: FAST_INPUTS, holeRngFactory: fixedHole });
    const { a, b, code } = await startDuel(h);
    const plan = mustPlanClear(h, code, 'A', 2);
    await runPlans(h, code, { A: { client: a, plan } });
    await hardDropUntilOver(h, code, { A: a });
    await h.settle();
    for (const client of [a, b]) {
      const over = await client.next('gameOver');
      const statsA = over.stats.A;
      expect(statsA).toMatchObject({
        linesCleared: 2,
        garbageSent: 1,
        garbageCancelled: 0,
        bestCombo: 1,
      });
      expect(statsA?.piecesPlaced).toBe(stateOf(h, code, 'A').piecesPlaced);
      expect(statsA?.bestMoment).toMatchObject({ combo: 1, linesCleared: 2, attack: 1, sent: 1 });
      expect(statsA?.bestMoment?.clearedRows).toEqual([18, 19]);
      expect(over.stats.B).toMatchObject({ linesCleared: 0, piecesPlaced: 0, bestMoment: null });
      expect(over.report.A?.piecesPlaced).toBe(statsA?.piecesPlaced);
      expect(over.report.A?.heightSamples[0]).toBe(0);
    }
  });
});
