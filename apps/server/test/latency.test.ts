import { TICK_MS } from '@stackerist/protocol';
import { describe, expect, it } from 'vitest';
import {
  compareRun,
  predictionWindowTicks,
  runDuel,
  type Comparison,
  type DuelRun,
} from './helpers/latency.js';

function summarize(run: DuelRun, cmp: Comparison): string {
  const comparable = cmp.landings.filter((l) => l.comparable);
  const landed = comparable.filter((l) => l.equal).length;
  const pieceOk = cmp.pieces.filter((p) => p.cellsEqual && p.tickEqual && p.boardEqual).length;
  return (
    `[${run.mode} rtt=${String(run.rttMs)}ms level@start=${String(run.startTick / 1800)}] ` +
    `rtt used ${String(run.rttUsed)}ms, ${String(run.ticksPlayed)} ticks, ` +
    `${String(run.serverLocks.length)} server locks, ${String(run.client.locks.length)} predicted locks; ` +
    `hard-drop landing shown==locked ${String(landed)}/${String(comparable.length)} ` +
    `(${String(cmp.landings.length - comparable.length)} not comparable); ` +
    `predicted lock (cells,tick,board)==server ${String(pieceOk)}/${String(cmp.pieces.length)}`
  );
}

const PIECES = 12;

describe('REQ-082 predicting client at 150 ms RTT, top speed', () => {
  it('REQ-082 every placed piece locks in exactly the cells the predicting client displayed', async () => {
    const run = await runDuel({ rttMs: 150, level: 12, mode: 'predict' });
    const cmp = compareRun(run);
    console.info(summarize(run, cmp));

    expect(run.completed).toBe(true);
    // The estimator was fed the server's own ping.rtt, which crossed the 150 ms link both ways.
    expect(run.rttUsed).toBeGreaterThanOrEqual(150);
    expect(run.rttUsed).toBeLessThanOrEqual(152);
    // 12 hard drops, plus the pieces that locked by gravity while the script waited out its tail.
    expect(run.serverLocks.length).toBeGreaterThanOrEqual(PIECES);
    // The skewed client clock never pushed a stamp outside the server's window.
    expect(run.client.inbox.filter((m) => m.type === 'error')).toEqual([]);
    expect(run.client.presses.filter((p) => p.action === 'hardDrop')).toHaveLength(PIECES);

    // Per lock: the predicted `locked` event (first time the player saw it) vs what the server locked.
    for (const row of cmp.pieces) {
      expect(
        row.serverCells,
        `piece ${String(row.index)}: server cells are unambiguous`,
      ).not.toBeNull();
      expect(row.predictedCells, `piece ${String(row.index)} cells`).toBe(row.serverCells);
      expect(row.predictedTick, `piece ${String(row.index)} lock tick`).toBe(row.lockTick);
      expect(row.boardEqual, `piece ${String(row.index)} board after the lock`).toBe(true);
    }
    // Per hard drop: the landing the player was shown (the ghost) vs the cells the server locked, in
    // the tick the server applied the drop.
    expect(cmp.landings).toHaveLength(PIECES);
    for (const row of cmp.landings) {
      expect(row.comparable, `hard drop ${String(row.seq)} has unambiguous server cells`).toBe(
        true,
      );
      expect(row.shown, `hard drop ${String(row.seq)} landing`).toBe(row.serverCells);
      expect(row.lockTick, `hard drop ${String(row.seq)} lock tick`).toBe(row.appliedTick);
    }
    // Every stamp reached the server before its tick: nothing was applied late.
    for (const press of run.client.presses) {
      expect(
        press.arrivalTick ?? Infinity,
        `seq ${String(press.seq)} arrived in time`,
      ).toBeLessThanOrEqual(press.stamp);
    }
  }, 120_000);

  it('REQ-082 negative control: a client that does not run ahead mismatches at the same latency and speed', async () => {
    const run = await runDuel({ rttMs: 150, level: 12, mode: 'naive', maxTicks: 900 });
    const cmp = compareRun(run);
    console.info(summarize(run, cmp));

    const comparable = cmp.landings.filter((l) => l.comparable);
    const mismatched = comparable.filter((l) => !l.equal);
    expect(comparable.length).toBeGreaterThanOrEqual(6);
    // The harness can fail: at least half of the landings the player was shown are wrong.
    expect(mismatched.length).toBeGreaterThanOrEqual(Math.ceil(comparable.length / 2));
    // And the cause is lateness: the naive stamps reach the server after the tick they name.
    const late = run.client.presses.filter((p) => (p.arrivalTick ?? 0) > p.stamp);
    expect(late.length).toBeGreaterThan(0);
  }, 120_000);
});

describe('REQ-082 second control', () => {
  it('REQ-082 negative control: running ahead but stamping the current server tick also mismatches', async () => {
    const run = await runDuel({ rttMs: 150, level: 12, mode: 'late-stamp', maxTicks: 900 });
    const cmp = compareRun(run);
    console.info(summarize(run, cmp));
    const bad = cmp.pieces.filter((p) => !(p.cellsEqual && p.tickEqual && p.boardEqual));
    expect(bad.length).toBeGreaterThan(0);
    expect(run.client.presses.some((p) => (p.arrivalTick ?? 0) > p.stamp)).toBe(true);
  }, 120_000);
});

describe('REQ-082 garbage inside the prediction window is the only exception', () => {
  it('REQ-082 a piece mismatches only when garbage reached the server inside the window', async () => {
    const window = predictionWindowTicks(150);
    let mismatchedInWindow = 0;
    let matchedOutside = 0;
    for (const delay of [0, 4, 8, 12, 16]) {
      const run = await runDuel({
        rttMs: 150,
        level: 12,
        mode: 'predict',
        attackDelayTicks: delay,
      });
      const cmp = compareRun(run);
      console.info(
        `${summarize(run, cmp)} attacks at ticks ${run.attacks.map((a) => `${String(a.tick - run.startTick)}(+${String(a.rows)})`).join(',')}`,
      );
      expect(run.completed).toBe(true);
      expect(run.attacks.length, 'B delivered garbage').toBeGreaterThanOrEqual(1);
      for (const row of cmp.pieces) {
        const same = row.cellsEqual && row.tickEqual && row.boardEqual;
        if (row.garbageInWindow) {
          if (!same) {
            mismatchedInWindow += 1;
            // Garbage only moves rows up under the piece: where it lands and when are still right.
            expect(row.cellsEqual, `piece ${String(row.index)} cells`).toBe(true);
            expect(row.tickEqual, `piece ${String(row.index)} lock tick`).toBe(true);
            expect(row.boardEqual, `piece ${String(row.index)} board differs`).toBe(false);
          }
        } else {
          matchedOutside += 1;
          expect(
            same,
            `delay ${String(delay)}: piece ${String(row.index)} (lock tick ${String(row.lockTick - run.startTick)}) is outside every ${String(window)}-tick window after an attack, so it must match`,
          ).toBe(true);
        }
      }
    }
    // The exception is real, not vacuous: the sweep produced at least one in-window mismatch...
    expect(mismatchedInWindow).toBeGreaterThan(0);
    // ...and plenty of pieces outside the window matched.
    expect(matchedOutside).toBeGreaterThan(20);
  }, 300_000);
});

describe('REQ-082 holds at any alignment between render frames and server ticks', () => {
  it('REQ-082 every piece matches for five frame phases at 150 ms', async () => {
    for (const framePhaseMs of [0, 4, 8, 12, 16]) {
      const run = await runDuel({ rttMs: 150, level: 12, mode: 'predict', framePhaseMs });
      const cmp = compareRun(run);
      console.info(`phase ${String(framePhaseMs)} ms: ${summarize(run, cmp)}`);
      expect(run.completed).toBe(true);
      expect(cmp.pieces.every((p) => p.cellsEqual && p.tickEqual && p.boardEqual)).toBe(true);
      expect(cmp.landings.every((l) => l.comparable && l.equal)).toBe(true);
    }
  }, 120_000);
});

describe('REQ-069 own inputs show instantly and land where shown', () => {
  it('REQ-069 lands every piece in the shown cells at levels 0, 3, 6, 9 and 12 (150 ms)', async () => {
    for (const level of [0, 3, 6, 9, 12]) {
      const run = await runDuel({ rttMs: 150, level, mode: 'predict' });
      const cmp = compareRun(run);
      console.info(summarize(run, cmp));
      expect(run.completed, `level ${String(level)} finished`).toBe(true);
      expect(cmp.landings, `level ${String(level)} hard drops`).toHaveLength(PIECES);
      for (const row of cmp.pieces) {
        expect(
          row.cellsEqual && row.tickEqual && row.boardEqual,
          `level ${String(level)} piece ${String(row.index)}`,
        ).toBe(true);
      }
      for (const row of cmp.landings) {
        expect(
          row.comparable && row.equal,
          `level ${String(level)} hard drop ${String(row.seq)}`,
        ).toBe(true);
      }
    }
  }, 300_000);

  for (const rttMs of [0, 50, 150]) {
    it(`REQ-069 shows each input's effect within two ticks and before any server acknowledgement at ${String(rttMs)} ms RTT`, async () => {
      const run = await runDuel({ rttMs, level: 12, mode: 'predict' });
      const effects = run.client.effects;
      const delays = effects.map((e) => (e.visibleAtMs ?? Infinity) - e.pressedAtMs);
      console.info(
        `[rtt ${String(rttMs)} ms] ${String(effects.length)} move/rotate inputs, max time to appear on the display ${String(Math.max(...delays).toFixed(1))} ms ` +
          `(one round trip would be ${String(rttMs)} ms); acknowledged before shown: ${String(effects.filter((e) => e.ackedBeforeVisible).length)}`,
      );
      expect(run.completed).toBe(true);
      const cmp = compareRun(run);
      expect(cmp.pieces.every((p) => p.cellsEqual && p.tickEqual && p.boardEqual)).toBe(true);
      expect(cmp.landings.every((l) => l.comparable && l.equal)).toBe(true);
      expect(effects.length).toBeGreaterThan(20);
      for (const effect of effects) {
        expect(
          effect.visibleAtMs,
          `seq ${String(effect.seq)} ${effect.action} became visible`,
        ).not.toBeNull();
        // The display runs at 60 Hz: an input stamped for the next server tick shows one frame later.
        expect(effect.visibleAtMs! - effect.pressedAtMs).toBeLessThanOrEqual(2 * TICK_MS + 1);
        if (rttMs > 0) {
          expect(effect.ackedBeforeVisible, `seq ${String(effect.seq)} shown before its ack`).toBe(
            false,
          );
          expect(effect.visibleAtMs! - effect.pressedAtMs).toBeLessThan(rttMs);
        }
      }
    }, 120_000);
  }
});
