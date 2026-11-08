import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAX_ACTIONS_PER_TICK,
  applyAction,
  createBag,
  createPlayerState,
  levelForTick,
  simulate,
  tick,
  type ActionType,
  type PlayerState,
  type StampedInput,
  type TickedEvent,
} from '../src/index.js';
import { boardOf, deepFreeze, oAt, ticks } from './helpers.js';

function input(seq: number, at: number, type: ActionType): StampedInput {
  return { seq, tick: at, action: { type } };
}

/**
 * The server's per-tick order for one seat (architecture §4.6, decision 9), written independently as a
 * FIFO drain: pop while front.tick ≤ N, up to MAX_ACTIONS_PER_TICK, applyAction each; then
 * tick(state, levelForTick(N)). `inputs` must already be in receipt order (non-decreasing tick, seq).
 */
function serverReference(
  from: PlayerState,
  toTick: number,
  inputs: readonly StampedInput[],
): { state: PlayerState; events: TickedEvent[] } {
  const buffer = [...inputs];
  const events: TickedEvent[] = [];
  let state = from;
  for (let n = from.tick; n < toTick; n += 1) {
    if (state.toppedOut || state.active === null) break;
    for (let drained = 0; drained < MAX_ACTIONS_PER_TICK; drained += 1) {
      const front = buffer[0];
      if (front === undefined || front.tick > n) break;
      buffer.shift();
      const result = applyAction(state, front.action);
      state = result.state;
      events.push(...result.events.map((event) => ({ tick: n, event })));
    }
    const result = tick(state, levelForTick(n));
    state = result.state;
    events.push(...result.events.map((event) => ({ tick: n, event })));
  }
  return { state, events };
}

describe('REQ-054 simulate (engine side of prediction, architecture §2.7)', () => {
  it('REQ-054 returns `from` unchanged when toTick ≤ from.tick', () => {
    const from = createPlayerState({ queue: ['T'], tick: 40 });
    for (const toTick of [40, 39, 0]) {
      const result = simulate(from, toTick, [input(1, 40, 'moveLeft')]);
      expect(result.state).toBe(from);
      expect(result).toMatchObject({
        reachedTick: 40,
        stoppedBy: 'none',
        events: [],
        appliedSeqs: [],
      });
    }
  });

  it('REQ-054 runs tick(state, levelForTick(t)) for t = from.tick … toTick − 1 (level from the absolute tick)', () => {
    // Tick 1800 is level 1 (48 ticks per row); level 0 needs 60. The counter goes 46 → 47 at t = 1799
    // (level 0: no fall) → 48 at t = 1800 (level 1: falls). A wrong level would not fall.
    const from: PlayerState = {
      ...createPlayerState({ queue: ['T'], tick: 1799 }),
      gravityCounter: 46,
    };
    const result = simulate(from, 1801, []);
    expect(result.reachedTick).toBe(1801);
    expect(result.state.tick).toBe(1801);
    expect(result.state.active?.y).toBe(1);
    expect(result.state).toEqual(tick(tick(from, 0).state, 1).state);
    expect(levelForTick(1799)).toBe(0);
    expect(levelForTick(1800)).toBe(1);
  });

  it('REQ-054 applies each stamped input at its tick, before gravity, and tags events with that tick', () => {
    const from = createPlayerState({ queue: ['T'], bag: createBag(3) });
    const inputs = [input(1, 5, 'moveLeft')];
    const before = simulate(from, 5, inputs);
    expect(before.appliedSeqs).toEqual([]);
    expect(before.state.active?.x).toBe(3);
    const after = simulate(from, 6, inputs);
    expect(after.appliedSeqs).toEqual([1]);
    expect(after.state.active?.x).toBe(2);
    expect(after.events).toEqual([{ tick: 5, event: { type: 'moved', dx: -1 } }]);
    expect(after.reachedTick).toBe(6);
    expect(after.stoppedBy).toBe('none');
  });

  it('REQ-054 inputs run before gravity in the same tick (a grounded move saves a piece about to lock)', () => {
    const base = createPlayerState({
      active: { kind: 'T', rotation: 0, x: 3, y: 18 },
      queue: ['O'],
    });
    const from = ticks(base, 29, 0).state; // lockCounter 29: the next grounded tick locks
    expect(from.lockCounter).toBe(29);
    const idle = simulate(from, from.tick + 1, []);
    expect(idle.events.map((e) => e.event.type)).toContain('locked');
    const saved = simulate(from, from.tick + 1, [input(1, from.tick, 'moveLeft')]);
    expect(saved.events.map((e) => e.event.type)).toEqual(['moved']);
    expect(saved.state.lockCounter).toBe(1);
  });

  it('REQ-054 inputs stamped before from.tick are applied at from.tick (late arrivals never rewind)', () => {
    const from = createPlayerState({ queue: ['T'], tick: 100 });
    const result = simulate(from, 101, [input(7, 90, 'moveRight')]);
    expect(result.events).toEqual([{ tick: 100, event: { type: 'moved', dx: 1 } }]);
    expect(result.appliedSeqs).toEqual([7]);
  });

  it('REQ-054 applies at most MAX_ACTIONS_PER_TICK per tick; the rest carry over in (tick, seq) order', () => {
    const from = createPlayerState({ queue: ['T'] });
    const ordered = Array.from({ length: 13 }, (_, i) =>
      input(i + 1, 3, i % 2 === 0 ? 'moveLeft' : 'moveRight'),
    );
    const shuffled = [...ordered.slice(7), ...ordered.slice(0, 7).reverse()];
    const result = simulate(from, 6, deepFreeze(shuffled));
    expect(MAX_ACTIONS_PER_TICK).toBe(10);
    expect(result.appliedSeqs).toEqual(ordered.map((i) => i.seq));
    const movedAt = (t: number): number =>
      result.events.filter((e) => e.tick === t && e.event.type === 'moved').length;
    expect(movedAt(3)).toBe(10);
    expect(movedAt(4)).toBe(3);
    expect(movedAt(5)).toBe(0);
    expect(result.state.active?.x).toBe(2);
  });

  it('REQ-054 inputs stamped at or after toTick are not applied', () => {
    const from = createPlayerState({ queue: ['T'] });
    const result = simulate(from, 4, [input(1, 3, 'moveLeft'), input(2, 4, 'moveLeft')]);
    expect(result.appliedSeqs).toEqual([1]);
    expect(result.state.active?.x).toBe(2);
  });

  it('REQ-054 stops cleanly with active null and a starved event when the preview runs dry', () => {
    const from = createPlayerState({ active: oAt(0), queue: ['O'] }); // bag null: prediction
    const result = simulate(from, 10, [
      input(1, 2, 'hardDrop'), // locks, spawns the last previewed O
      input(2, 4, 'hardDrop'), // locks, nothing left to spawn
      input(3, 5, 'moveLeft'),
    ]);
    expect(result.stoppedBy).toBe('starved');
    expect(result.state.active).toBeNull();
    expect(result.state.toppedOut).toBe(false);
    expect(result.reachedTick).toBe(4); // stopped during the inputs of tick 4; that tick never ran
    expect(result.state.tick).toBe(4);
    expect(result.events.at(-1)).toEqual({ tick: 4, event: { type: 'starved' } });
    expect(result.appliedSeqs).toEqual([1, 2]);
    expect(result.state.piecesPlaced).toBe(2);
  });

  it('REQ-054 stops with stoppedBy toppedOut; a top-out inside tick() still advances that tick', () => {
    const tower = boardOf(...Array.from({ length: 19 }, () => '....G.....'));
    const viaInput = simulate(
      createPlayerState({ board: tower, active: oAt(0), queue: ['T'] }),
      50,
      [input(1, 1, 'hardDrop')],
    );
    expect(viaInput).toMatchObject({ stoppedBy: 'toppedOut', reachedTick: 1 });
    expect(viaInput.state.toppedOut).toBe(true);

    const grounded = createPlayerState({
      board: tower,
      active: { kind: 'O', rotation: 0, x: 0, y: 18 },
      queue: ['T'],
    });
    const viaLockDelay = simulate(grounded, 50, []);
    expect(viaLockDelay.stoppedBy).toBe('toppedOut');
    expect(viaLockDelay.reachedTick).toBe(30); // the lock happened while processing tick 29
    expect(viaLockDelay.events.at(-1)).toEqual({
      tick: 29,
      event: { type: 'toppedOut', reason: 'SPAWN_BLOCKED' },
    });
  });

  it('REQ-054 from an already stopped state it returns at once with the reason', () => {
    const starved = createPlayerState({ tick: 9 });
    expect(simulate(starved, 20, [input(1, 9, 'moveLeft')])).toEqual({
      state: starved,
      reachedTick: 9,
      stoppedBy: 'starved',
      events: [],
      appliedSeqs: [],
    });
    const blocked = createPlayerState({
      board: boardOf(...Array.from({ length: 20 }, () => '....G.....')),
      queue: ['O'],
    });
    expect(simulate(blocked, 5, []).stoppedBy).toBe('toppedOut');
  });

  it('REQ-054 never mutates `from` or the inputs', () => {
    const from = deepFreeze(createPlayerState({ bag: createBag(12), tick: 21_600 }));
    const inputs = deepFreeze([
      input(2, 21_603, 'rotateCW'),
      input(1, 21_601, 'softDropStart'),
      input(3, 21_610, 'hardDrop'),
    ]);
    const snapshot = structuredClone({ from, inputs });
    expect(() => simulate(from, 21_640, inputs)).not.toThrow();
    expect({ from, inputs }).toEqual(snapshot);
  });

  it('REQ-054 is bit-exact with the server per-tick order: inputs (≤ 10), then tick(levelForTick(N))', () => {
    const actionArb = fc.constantFrom<ActionType>(
      'moveLeft',
      'moveRight',
      'rotateCW',
      'rotateCCW',
      'softDropStart',
      'softDropStop',
      'hardDrop',
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.constantFrom(0, 1795, 10_790, 21_600),
        fc.array(fc.record({ gap: fc.integer({ min: 0, max: 6 }), type: actionArb }), {
          maxLength: 120,
          size: 'max',
        }),
        fc.integer({ min: 1, max: 400 }),
        (seed, startTick, plan, span) => {
          const from = createPlayerState({ bag: createBag(seed), tick: startTick });
          let at = startTick - 3; // some inputs arrive late
          const inputs = plan.map(({ gap, type }, i) => {
            at += gap;
            return input(i + 1, at, type);
          });
          const result = simulate(from, startTick + span, inputs);
          // Once stopped, every later input and tick is a no-op that does not advance the tick, so
          // running the reference to the same toTick must land on exactly the same state.
          const reference = serverReference(from, startTick + span, inputs);
          expect(result.state).toEqual(reference.state);
          expect(result.events).toEqual(reference.events);
          if (result.stoppedBy === 'none') expect(result.reachedTick).toBe(startTick + span);
        },
      ),
      { numRuns: 150 },
    );
  });
});
