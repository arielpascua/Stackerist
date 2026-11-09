import { MAX_ACTIONS_PER_TICK } from '@stackerist/engine';
import { TICK_MS } from '@stackerist/protocol';
import { describe, expect, it } from 'vitest';
import { ManualClock, type Clock, type TimerId } from '../src/clock.js';
import { DEFAULT_LIMITS } from '../src/config.js';
import { GameLoop } from '../src/loop.js';
import { Match } from '../src/match.js';

class CountingRoom {
  steps = 0;
  stepSafely(): void {
    this.steps += 1;
  }
}

/** A clock whose timers never fire on their own: the test calls `wake()` itself (a stalled event loop). */
class StalledClock implements Clock {
  now = 0;
  nowEpochMs(): number {
    return Math.floor(this.now);
  }
  monotonicMs(): number {
    return this.now;
  }
  setTimeout(): TimerId {
    return Object.freeze({}) as TimerId;
  }
  clearTimeout(): void {}
}

function makeMatch(limits: Partial<typeof DEFAULT_LIMITS> = {}): Match {
  return new Match({
    seeds: { pieceSeed: 12345, holeSeed: 678 },
    startTick: 0,
    holeRng: () => 3,
    limits: { ...DEFAULT_LIMITS, ...limits },
    nowMs: 0,
  });
}

describe('REQ-024 fixed-step loop', () => {
  it('REQ-024 runs at 60 Hz from an accumulator over the monotonic clock', () => {
    const clock = new ManualClock();
    const loop = new GameLoop(clock, { manual: false, maxCatchUpTicks: 5 });
    const room = new CountingRoom();
    loop.add(room);
    clock.advance(1000);
    expect(room.steps).toBeGreaterThanOrEqual(59);
    expect(room.steps).toBeLessThanOrEqual(60);
    clock.advance(1000);
    expect(room.steps).toBeGreaterThanOrEqual(119);
    expect(room.steps).toBeLessThanOrEqual(120);
    loop.remove(room);
    expect(clock.pendingTimers).toBe(0);
    clock.advance(1000);
    expect(room.steps).toBeLessThanOrEqual(120);
  });

  it('REQ-024 catches up at most 5 ticks per wake and drops the backlog', () => {
    const clock = new StalledClock();
    const loop = new GameLoop(clock, { manual: false, maxCatchUpTicks: 5 });
    const room = new CountingRoom();
    loop.add(room);
    clock.now = 500; // a 30-tick stall
    loop.wake();
    expect(room.steps).toBe(5);
    clock.now += 2 * TICK_MS;
    loop.wake();
    expect(room.steps).toBe(7);
  });

  it('REQ-024 manual mode registers no timer and steps only on demand', () => {
    const clock = new ManualClock();
    const loop = new GameLoop(clock, { manual: true, maxCatchUpTicks: 5 });
    const room = new CountingRoom();
    loop.add(room);
    expect(clock.pendingTimers).toBe(0);
    clock.advance(1000);
    expect(room.steps).toBe(0);
    loop.stepAll(3);
    expect(room.steps).toBe(3);
  });

  it('REQ-024 applies at most 10 actions per player per tick; the rest stay queued', () => {
    const match = makeMatch({ inputBurst: 100 });
    for (let seq = 1; seq <= 15; seq += 1) {
      const action = seq % 2 === 0 ? { type: 'moveLeft' as const } : { type: 'moveRight' as const };
      expect(match.receiveInput('A', { seq, tick: 0, action }, 0)).toBe('accepted');
    }
    match.step();
    expect(match.report('A').actions).toBe(MAX_ACTIONS_PER_TICK);
    expect(match.bufferLength('A')).toBe(5);
    expect(match.lastAckSeq('A')).toBe(10);
    match.step();
    expect(match.report('A').actions).toBe(15);
    expect(match.lastAckSeq('A')).toBe(15);
  });

  it('REQ-024 caps each input queue at 60', () => {
    const match = makeMatch({ inputBurst: 100 });
    for (let seq = 1; seq <= 60; seq += 1) {
      expect(match.receiveInput('A', { seq, tick: 30, action: { type: 'moveLeft' } }, 0)).toBe(
        'accepted',
      );
    }
    expect(match.receiveInput('A', { seq: 61, tick: 30, action: { type: 'moveLeft' } }, 0)).toBe(
      'queueFull',
    );
    expect(match.bufferLength('A')).toBe(60);
  });
});
