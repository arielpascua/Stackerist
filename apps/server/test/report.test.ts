import { stackHeight } from '@stackerist/engine';
import { HEIGHT_SAMPLE_EVERY_TICKS, RoundReportSchema } from '@stackerist/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../src/config.js';
import { Match } from '../src/match.js';

function makeMatch(overrides: { startTick?: number; maxHeightSamples?: number } = {}): Match {
  return new Match({
    seeds: { pieceSeed: 12345, holeSeed: 678 },
    startTick: overrides.startTick ?? 0,
    holeRng: () => 3,
    limits: {
      ...DEFAULT_LIMITS,
      ...(overrides.maxHeightSamples === undefined
        ? {}
        : { maxHeightSamples: overrides.maxHeightSamples }),
    },
    nowMs: 0,
  });
}

describe('round report (design §5.7)', () => {
  it('REQ-090 REQ-092 samples the stack height at round-relative ticks 0, 30, 60, …', () => {
    const match = makeMatch({ startTick: 500 });
    expect(match.report('A').heightSamples).toEqual([0]);
    for (let i = 0; i < HEIGHT_SAMPLE_EVERY_TICKS - 1; i += 1) match.step();
    expect(match.report('A').heightSamples).toHaveLength(1);
    expect(
      match.receiveInput('A', { seq: 1, tick: match.tick, action: { type: 'hardDrop' } }, 0),
    ).toBe('accepted');
    match.step();
    const afterLock = stackHeight(match.states.A.board);
    expect(afterLock).toBeGreaterThan(0);
    expect(match.report('A').heightSamples).toEqual([0, afterLock]);
    expect(match.report('B').heightSamples).toEqual([0, 0]);
    for (let i = 0; i < 2 * HEIGHT_SAMPLE_EVERY_TICKS; i += 1) match.step();
    expect(match.report('A').heightSamples).toHaveLength(4);
    expect(match.report('A').durationTicks).toBe(3 * HEIGHT_SAMPLE_EVERY_TICKS);
  });

  it('REQ-090 REQ-092 stops sampling at the cap', () => {
    const match = makeMatch({ maxHeightSamples: 3 });
    for (let i = 0; i < 10 * HEIGHT_SAMPLE_EVERY_TICKS; i += 1) match.step();
    expect(match.report('A').heightSamples).toHaveLength(3);
    expect(match.report('A').durationTicks).toBe(10 * HEIGHT_SAMPLE_EVERY_TICKS);
  });

  it('REQ-090 counts applied actions, pieces and garbage stats from the engine state', () => {
    const match = makeMatch();
    const moves = [{ type: 'moveLeft' }, { type: 'rotateCW' }, { type: 'hardDrop' }] as const;
    moves.forEach((action, i) => {
      expect(match.receiveInput('A', { seq: i + 1, tick: 0, action }, 0)).toBe('accepted');
    });
    // A rejected input is never applied, so it is not an action.
    expect(match.receiveInput('A', { seq: 2, tick: 0, action: { type: 'hardDrop' } }, 0)).toBe(
      'badSeq',
    );
    match.step();
    const report = match.report('A');
    expect(report.actions).toBe(3);
    expect(report.piecesPlaced).toBe(1);
    expect(report.garbageSent).toBe(match.states.A.garbageSent);
    expect(report.garbageReceived).toBe(match.states.A.garbageReceived);
    expect(report.garbageCancelled).toBe(match.states.A.garbageCancelled);
    expect(report.durationTicks).toBe(1);
    expect(RoundReportSchema.safeParse(report).success).toBe(true);
    expect(match.report('B').actions).toBe(0);
  });
});
