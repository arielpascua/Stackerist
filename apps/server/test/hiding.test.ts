import { PREVIEW_COUNT } from '@stackerist/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { startDuel, startTestServer, type Harness } from './helpers/harness.js';
import { mustPlanClear, playSafe, runPlans } from './helpers/play.js';

let h: Harness;
afterEach(async () => {
  await h.close();
});

const PIECE_SEED = 987_654_321;
const HOLE_SEED = 123_456_789;
const FORBIDDEN_KEYS = /"(seed|pieceSeed|holeSeed|bag|rng|remaining|queue)"/;

describe('REQ-065 source spec §8.2 — information hiding (#14)', () => {
  it('REQ-028 #14 the opponent view never has more than 1 upcoming piece and no message ever contains a seed', async () => {
    h = await startTestServer({
      limits: { inputBurst: 100_000 },
      seedProvider: () => ({ pieceSeed: PIECE_SEED, holeSeed: HOLE_SEED }),
    });
    const { a, b, code } = await startDuel(h);
    const watcher = await h.connect();
    watcher.send({ type: 'join', code, asSpectator: true });
    await watcher.next('joined');
    const plan = mustPlanClear(h, code, 'A', 2);
    await runPlans(h, code, { A: { client: a, plan } });
    for (let i = 0; i < 4; i += 1) await playSafe(h, code, { A: a, B: b });
    h.step(10);
    await watcher.snapshotAt(h.tick(code));
    await a.snapshotAt(h.tick(code));
    await b.snapshotAt(h.tick(code));

    for (const client of [a, b, watcher]) {
      for (const text of client.raw) {
        expect(text).not.toMatch(FORBIDDEN_KEYS);
        expect(text).not.toContain(String(PIECE_SEED));
        expect(text).not.toContain(String(HOLE_SEED));
      }
      for (const snap of client.all('snapshot')) {
        for (const view of [snap.players.A, snap.players.B]) {
          expect(view?.next.length).toBeLessThanOrEqual(1);
          expect(typeof view?.pendingGarbage).toBe('number');
        }
      }
    }
    expect(watcher.all('snapshot').every((s) => s.you === undefined)).toBe(true);
  });
});

describe('REQ-028 what each recipient receives', () => {
  it('REQ-028 the owner gets board, active piece, next 5, pending garbage with holes, lastAckSeq, stats and tick', async () => {
    h = await startTestServer({ limits: { inputBurst: 100_000 }, holeRngFactory: () => () => 3 });
    const { a, b, code } = await startDuel(h);
    const plan = mustPlanClear(h, code, 'A', 2);
    await runPlans(h, code, { A: { client: a, plan } });
    const snapB = await b.snapshotAt(h.tick(code));
    const you = snapB.you;
    expect(you?.board).toHaveLength(20);
    expect(you?.active).not.toBeNull();
    expect(you?.next).toHaveLength(PREVIEW_COUNT);
    expect(you?.pendingGarbage).toEqual([{ rows: 1, holeColumn: 3 }]);
    expect(you?.lastAckSeq).toBe(0);
    expect(you?.stats).toMatchObject({ garbageReceived: 1 });
    expect(snapB.tick).toBe(h.tick(code));
    // The opponent's view of B: total only, one next piece, no hole column anywhere.
    const snapA = await a.snapshotAt(h.tick(code));
    expect(snapA.players.B?.pendingGarbage).toBe(1);
    expect(snapA.players.B?.next).toHaveLength(1);
    expect(JSON.stringify(snapA.players.B)).not.toContain('holeColumn');
    expect(snapA.you?.lastAckSeq).toBe(a.seq);
  });
});
