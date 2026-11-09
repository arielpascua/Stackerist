import {
  MAX_ACTIONS_PER_TICK,
  PREVIEW_COUNT,
  applyAction,
  createBag,
  createPlayerState,
  levelForTick,
  simulate,
  spawnPiece,
  tick as engineTick,
  type ActionType,
  type PlayerState,
  type StampedInput,
  type TickedEvent,
} from '@stackerist/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  OwnViewSchema,
  Predictor,
  ownViewToPlayerState,
  toOwnView,
  type DisplayResult,
  type OwnView,
} from '../src/index.js';

// ---- Helpers ----

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`missing ${what}`);
  }
  return value;
}

/** A server-side seat: a real bag, so the queue refills exactly as on the server. */
function serverState(seed: number, startTick: number): PlayerState {
  return createPlayerState({ bag: createBag(seed), tick: startTick });
}

/** The owner's view as it arrives: built by the server's view function, then sent over the wire. */
function wireView(state: PlayerState, lastAckSeq: number): OwnView {
  return OwnViewSchema.parse(JSON.parse(JSON.stringify(toOwnView(state, lastAckSeq))));
}

function stamp(seq: number, tick: number, type: ActionType): StampedInput {
  return { seq, tick, action: { type } };
}

interface ServerRun {
  /** The state AT each tick (before processing it), start..untilTick. */
  readonly states: ReadonlyMap<number, PlayerState>;
  /** lastAckSeq the server would put in a snapshot at each tick (architecture §4.6). */
  readonly acks: ReadonlyMap<number, number>;
  readonly events: readonly TickedEvent[];
}

/**
 * The server's order for one seat (architecture §4.6), written out independently of `simulate`: the
 * inputs sit in a FIFO in receipt order = (tick, seq) order; on tick N pop while front.tick ≤ N, at most
 * MAX_ACTIONS_PER_TICK, applyAction each; then tick(state, levelForTick(N)). No garbage (one seat).
 */
function runServer(
  start: PlayerState,
  inputs: readonly StampedInput[],
  untilTick: number,
): ServerRun {
  const states = new Map<number, PlayerState>([[start.tick, start]]);
  const acks = new Map<number, number>([[start.tick, 0]]);
  const events: TickedEvent[] = [];
  let state = start;
  let head = 0;
  const lastSeen = inputs.at(-1)?.seq ?? 0;
  for (let n = start.tick; n < untilTick; n += 1) {
    for (let applied = 0; applied < MAX_ACTIONS_PER_TICK; applied += 1) {
      const next = inputs[head];
      if (next === undefined || next.tick > n) break;
      head += 1;
      const result = applyAction(state, next.action);
      state = result.state;
      for (const event of result.events) events.push({ tick: n, event });
    }
    const result = engineTick(state, levelForTick(n));
    state = result.state;
    for (const event of result.events) events.push({ tick: n, event });
    states.set(n + 1, state);
    const front = inputs[head];
    acks.set(n + 1, front === undefined ? lastSeen : front.seq - 1);
  }
  return { states, acks, events };
}

/** Everything the display shows and the server owns, minus what prediction cannot know by design. */
function comparable(state: PlayerState): Omit<PlayerState, 'bag' | 'queue' | 'bestMoment'> {
  const { bag: _bag, queue: _queue, bestMoment: _best, ...rest } = state;
  return rest;
}

const ACTIONS: readonly ActionType[] = [
  'moveLeft',
  'moveRight',
  'rotateCW',
  'rotateCCW',
  'softDropStart',
  'softDropStop',
  'hardDrop',
];
const actionArb: fc.Arbitrary<ActionType> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom<ActionType>('moveLeft', 'moveRight') },
  { weight: 3, arbitrary: fc.constantFrom<ActionType>('rotateCW', 'rotateCCW') },
  { weight: 2, arbitrary: fc.constantFrom<ActionType>('softDropStart', 'softDropStop') },
  { weight: 1, arbitrary: fc.constant<ActionType>('hardDrop') },
);
/** Client-like inputs: seq 1, 2, 3 …; stamps non-decreasing from `start` (bursts on one tick included). */
function inputsArb(start: number): fc.Arbitrary<StampedInput[]> {
  const dtArb = fc.oneof(
    { weight: 2, arbitrary: fc.constant(0) },
    { weight: 3, arbitrary: fc.nat({ max: 8 }) },
  );
  return fc.array(fc.tuple(dtArb, actionArb), { maxLength: 60 }).map((steps) => {
    let at = start;
    return steps.map(([dt, type], i) => {
      at += dt;
      return stamp(i + 1, at, type);
    });
  });
}
const startTickArb = fc.oneof(
  fc.constantFrom(0, 1800, 10_800, 21_600),
  fc.integer({ min: 0, max: 30_000 }),
);

// ---- Tests ----

describe('REQ-054 REQ-069 run-ahead prediction over the engine simulate', () => {
  it('REQ-054 display(T) equals simulate(ownViewToPlayerState(view, tick), T, pending)', () => {
    const server = serverState(42, 0);
    const view = wireView(server, 0);
    const inputs = [
      stamp(1, 2, 'moveLeft'),
      stamp(2, 2, 'rotateCW'),
      stamp(3, 5, 'hardDrop'),
      stamp(4, 9, 'moveRight'),
      stamp(5, 12, 'softDropStart'),
    ];
    const p = new Predictor();
    p.onOwnSnapshot(view, server.tick);
    for (const input of inputs) p.addInput(input);
    for (const target of [0, 1, 3, 6, 10, 30, 45]) {
      const expected = simulate(ownViewToPlayerState(view, server.tick), target, inputs).state;
      expect(must(p.display(target), 'display').state, `T=${String(target)}`).toEqual(expected);
    }
  });

  it('REQ-054 display equals simulate for any snapshot, pending inputs and target', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        startTickArb.chain((start) => fc.tuple(fc.constant(start), inputsArb(start))),
        fc.nat({ max: 60 }),
        (seed, [start, inputs], lead) => {
          const view = wireView(serverState(seed, start), 0);
          const p = new Predictor();
          p.onOwnSnapshot(view, start);
          for (const input of inputs) p.addInput(input);
          const target = start + lead;
          const expected = simulate(ownViewToPlayerState(view, start), target, inputs);
          const shown = must(p.display(target), 'display');
          expect(shown.state).toEqual(expected.state);
          expect(shown.newEvents).toEqual(expected.events);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('REQ-069 an own input shows in the display before any acknowledgement', () => {
    const server = serverState(7, 0);
    const p = new Predictor();
    p.onOwnSnapshot(wireView(server, 0), 0);
    const x0 = must(server.active, 'active').x;
    p.addInput(stamp(1, 3, 'moveLeft'));
    expect(must(p.display(3), 'display').state.active?.x).toBe(x0); // state AT 3: not yet applied
    expect(must(p.display(4), 'display').state.active?.x).toBe(x0 - 1); // applied on tick 3
    expect(p.pendingCount).toBe(1);
  });

  it('REQ-054 a snapshot drops the inputs with seq ≤ lastAckSeq', () => {
    const inputs = [
      stamp(1, 1, 'moveLeft'),
      stamp(2, 2, 'moveLeft'),
      stamp(3, 6, 'moveRight'),
      stamp(4, 8, 'rotateCW'),
    ];
    const run = runServer(serverState(3, 0), inputs, 12);
    expect(run.acks.get(5)).toBe(2);
    const p = new Predictor();
    for (const input of inputs) p.addInput(input);
    expect(p.pendingCount).toBe(4);
    const view = wireView(must(run.states.get(5), 'state@5'), 2);
    p.onOwnSnapshot(view, 5);
    expect(p.pendingCount).toBe(2);
    p.addInput(inputs[1] ?? stamp(2, 2, 'moveLeft')); // a late duplicate of an acknowledged seq
    expect(p.pendingCount).toBe(2);
    const shown = must(p.display(12), 'display').state;
    expect(shown).toEqual(simulate(ownViewToPlayerState(view, 5), 12, inputs.slice(2)).state);
    expect(comparable(shown)).toEqual(comparable(must(run.states.get(12), 'state@12')));
  });

  it('REQ-054 memoised on (base, pending length, targetTick): no re-simulation, one stable object', () => {
    const server = serverState(11, 0);
    const p = new Predictor();
    expect(p.display(5)).toBeNull(); // nothing to predict from yet
    p.onOwnSnapshot(wireView(server, 0), 0);
    p.addInput(stamp(1, 1, 'hardDrop'));
    const first = must(p.display(4), 'display');
    expect(first.newEvents.length).toBeGreaterThan(0);
    const second = must(p.display(4), 'display');
    const third = must(p.display(4), 'display');
    expect(second.state).toBe(first.state); // the same simulated state object: not re-simulated
    expect(third).toBe(second); // one stable object per key
    expect(second.newEvents).toHaveLength(0); // and its events are never delivered twice
    const quiet = must(p.display(5), 'display');
    expect(must(p.display(5), 'display')).toBe(quiet);
    p.addInput(stamp(2, 6, 'moveLeft'));
    expect(must(p.display(5), 'display').state).not.toBe(quiet.state); // pending length changed
    p.onOwnSnapshot(wireView(server, 0), 0);
    expect(must(p.display(5), 'display').state).not.toBe(quiet.state); // new base
    expect(() => p.display(5.5)).toThrow(RangeError);
  });

  it('REQ-054 REQ-069 newEvents fire once: none repeated across calls, none lost', () => {
    const server = serverState(5, 600);
    const view = wireView(server, 0);
    const inputs = [
      stamp(1, 601, 'moveLeft'),
      stamp(2, 603, 'rotateCW'),
      stamp(3, 603, 'hardDrop'),
      stamp(4, 610, 'moveRight'),
      stamp(5, 611, 'hardDrop'),
      stamp(6, 620, 'rotateCCW'),
      stamp(7, 625, 'hardDrop'),
    ];
    const p = new Predictor();
    p.onOwnSnapshot(view, 600);
    const delivered: TickedEvent[] = [];
    let previousMax = Number.NEGATIVE_INFINITY;
    for (let target = 600; target <= 640; target += 1) {
      for (const input of inputs.filter((i) => i.tick === target)) p.addInput(input);
      for (let repeat = 0; repeat < 2; repeat += 1) {
        const { newEvents } = must(p.display(target), 'display');
        for (const event of newEvents) expect(event.tick).toBeGreaterThan(previousMax);
        previousMax = Math.max(previousMax, ...newEvents.map((e) => e.tick));
        delivered.push(...newEvents);
      }
    }
    const all = simulate(ownViewToPlayerState(view, 600), 640, inputs).events;
    expect(all.filter((e) => e.event.type === 'locked')).toHaveLength(3);
    expect(delivered).toEqual(all);
  });

  it('REQ-054 newEvents never repeats a tick across calls, whatever arrives in between', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        inputsArb(100),
        fc.array(fc.tuple(fc.nat({ max: 3 }), fc.boolean(), fc.nat({ max: 12 })), {
          maxLength: 80,
        }),
        (seed, inputs, frames) => {
          const run = runServer(serverState(seed, 100), inputs, 100 + 3 * 80 + 1);
          const p = new Predictor();
          p.onOwnSnapshot(wireView(serverState(seed, 100), 0), 100);
          let target = 100;
          let snapTick = 100;
          let delivered = Number.NEGATIVE_INFINITY;
          let sent = 0;
          for (const [advance, snapshot, lag] of frames) {
            target += advance;
            while (sent < inputs.length && (inputs[sent]?.tick ?? Infinity) <= target) {
              p.addInput(must(inputs[sent], 'input'));
              sent += 1;
            }
            const at = Math.max(snapTick, target - lag);
            if (snapshot && at > snapTick) {
              snapTick = at;
              const state = must(run.states.get(at), `state@${String(at)}`);
              p.onOwnSnapshot(wireView(state, must(run.acks.get(at), 'ack')), state.tick);
            }
            const result: DisplayResult = must(p.display(target), 'display');
            for (const event of result.newEvents) expect(event.tick).toBeGreaterThan(delivered);
            delivered = Math.max(delivered, ...result.newEvents.map((e) => e.tick));
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it('REQ-054 clear() forgets the base, the pending inputs and the high-water mark', () => {
    const server = serverState(9, 0);
    const p = new Predictor();
    p.onOwnSnapshot(wireView(server, 0), 0);
    p.addInput(stamp(1, 1, 'hardDrop'));
    p.addInput(stamp(2, 2, 'moveLeft'));
    const before = must(p.display(10), 'display');
    expect(before.newEvents.length).toBeGreaterThan(0);
    p.clear();
    expect(p.display(10)).toBeNull();
    expect(p.pendingCount).toBe(0);
    // A new round: the same seqs are valid again, and its events fire even at already-seen ticks.
    p.onOwnSnapshot(wireView(server, 0), 0);
    expect(must(p.display(10), 'display').state).toEqual(
      simulate(ownViewToPlayerState(wireView(server, 0), 0), 10, []).state,
    );
    p.addInput(stamp(1, 10, 'hardDrop'));
    expect(p.pendingCount).toBe(1);
    const again = must(p.display(12), 'display');
    expect(again.newEvents.some((e) => e.event.type === 'locked' && e.tick === 10)).toBe(true);
  });

  it('REQ-054 a hard drop is predicted through the lock; the next piece comes from the preview', () => {
    const server = serverState(21, 0);
    const view = wireView(server, 0);
    const p = new Predictor();
    p.onOwnSnapshot(view, 0);
    p.addInput(stamp(1, 1, 'hardDrop'));
    const { state, newEvents } = must(p.display(2), 'display');
    const next = must(view.next[0], 'preview');
    expect(state.piecesPlaced).toBe(view.stats.piecesPlaced + 1);
    expect(state.active).toEqual(spawnPiece(next));
    expect(state.queue).toEqual(view.next.slice(1));
    expect(state.bag).toBeNull();
    const types = newEvents.map((e) => e.event.type);
    expect(types.indexOf('locked')).toBeLessThan(types.indexOf('spawned'));
    expect(newEvents.find((e) => e.event.type === 'spawned')?.event).toEqual({
      type: 'spawned',
      kind: next,
    });
    expect(state.board.join('').replaceAll('.', '')).toHaveLength(4);
  });

  it('REQ-054 prediction stops cleanly when the preview runs dry (starved)', () => {
    const server = serverState(13, 0);
    const view: OwnView = { ...wireView(server, 0), next: ['O'] };
    const p = new Predictor();
    p.onOwnSnapshot(view, 0);
    p.addInput(stamp(1, 1, 'hardDrop')); // locks the active piece, spawns the O
    p.addInput(stamp(2, 2, 'hardDrop')); // locks the O; nothing left to spawn
    p.addInput(stamp(3, 3, 'moveLeft')); // nothing to move
    const shown = must(p.display(30), 'display');
    expect(shown.state.active).toBeNull();
    expect(shown.state.toppedOut).toBe(false);
    expect(shown.state.tick).toBe(2);
    expect(shown.state.piecesPlaced).toBe(2);
    expect(shown.newEvents.at(-1)).toEqual({ tick: 2, event: { type: 'starved' } });
    const later = must(p.display(45), 'display');
    expect(later.state).toEqual(shown.state);
    expect(later.newEvents).toHaveLength(0); // the starve is not reported twice
    // The next snapshot brings a fresh preview and prediction carries on.
    p.onOwnSnapshot(wireView(server, 0), 0);
    expect(must(p.display(45), 'display').state.active).not.toBeNull();
  });

  it('REQ-054 garbage reaches the own board only through snapshots, with their hole columns', () => {
    const server = serverState(17, 0);
    const view: OwnView = { ...wireView(server, 0), pendingGarbage: [{ rows: 2, holeColumn: 3 }] };
    const p = new Predictor();
    p.onOwnSnapshot(view, 0);
    p.addInput(stamp(1, 1, 'hardDrop')); // a non-clearing lock on an empty board
    const { state } = must(p.display(2), 'display');
    expect(state.board.slice(18)).toEqual(['GGG.GGGGGG', 'GGG.GGGGGG']);
    expect(state.pendingGarbage).toEqual([]);
    expect(state.garbageInserted).toBe(2);
    // Without garbage in the snapshot, no input stream ever produces any.
    fc.assert(
      fc.property(inputsArb(0), fc.nat({ max: 200 }), (inputs, lead) => {
        const q = new Predictor();
        q.onOwnSnapshot(wireView(server, 0), 0);
        for (const input of inputs) q.addInput(input);
        const shown = must(q.display(lead), 'display').state;
        expect(shown.board.join('')).not.toContain('G');
        expect(shown.pendingGarbage).toEqual([]);
        expect(shown.garbageReceived).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('REQ-054 REQ-069 for random action streams (no garbage) the prediction at T equals the server at T', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        startTickArb.chain((start) => fc.tuple(fc.constant(start), inputsArb(start))),
        fc.nat({ max: 150 }),
        fc.nat({ max: 40 }),
        fc.boolean(),
        (seed, [start, inputs], snapAfter, lead, inputsFirst) => {
          const snapTick = start + snapAfter;
          const target = snapTick + lead;
          const run = runServer(serverState(seed, start), inputs, target);
          const atSnap = must(run.states.get(snapTick), 'snapshot state');
          const p = new Predictor();
          const feed = (): void => {
            for (const input of inputs) p.addInput(input);
          };
          if (inputsFirst) feed();
          p.onOwnSnapshot(wireView(atSnap, must(run.acks.get(snapTick), 'ack')), atSnap.tick);
          if (!inputsFirst) feed();

          const shown = must(p.display(target), 'display');
          const reached = shown.state.tick;
          const serverEvents = run.events.filter((e) => e.tick >= atSnap.tick);
          const starved = shown.state.active === null && !shown.state.toppedOut;
          if (starved) {
            // Only possible when the server spawned more pieces than the 5-piece preview held.
            const spawns = serverEvents.filter(
              (e) => e.tick <= reached && e.event.type === 'spawned',
            );
            expect(spawns.length).toBeGreaterThan(PREVIEW_COUNT);
            const before = shown.newEvents.slice(0, -1);
            expect(serverEvents.slice(0, before.length)).toEqual(before);
            expect(shown.newEvents.at(-1)?.event).toEqual({ type: 'starved' });
            return;
          }
          const server = must(run.states.get(reached), `server@${String(reached)}`);
          expect(comparable(shown.state)).toEqual(comparable(server));
          expect(server.queue.slice(0, shown.state.queue.length)).toEqual(shown.state.queue);
          expect(shown.newEvents).toEqual(serverEvents.filter((e) => e.tick < reached));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('REQ-054 a burst beyond MAX_ACTIONS_PER_TICK carries over across a snapshot exactly as on the server', () => {
    const moves = Array.from({ length: MAX_ACTIONS_PER_TICK + 4 }, (_, i) =>
      stamp(i + 1, 3, ACTIONS[i % 4] ?? 'moveLeft'),
    );
    const run = runServer(serverState(29, 0), moves, 10);
    expect(run.acks.get(4)).toBe(MAX_ACTIONS_PER_TICK); // 4 inputs still queued at the snapshot
    const p = new Predictor();
    for (const input of moves) p.addInput(input);
    p.onOwnSnapshot(wireView(must(run.states.get(4), 'state@4'), MAX_ACTIONS_PER_TICK), 4);
    expect(p.pendingCount).toBe(4);
    const shown = must(p.display(10), 'display').state;
    expect(comparable(shown)).toEqual(comparable(must(run.states.get(10), 'state@10')));
  });
});
