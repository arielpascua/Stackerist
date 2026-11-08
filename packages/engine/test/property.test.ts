import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  PREVIEW_COUNT,
  applyAction,
  createBag,
  createPlayerState,
  fullRows,
  pieceCells,
  receiveGarbage,
  tick,
  type ActionType,
  type EngineEvent,
  type PlayerState,
} from '../src/index.js';
import { deepFreeze } from './helpers.js';

type Step =
  | { readonly kind: 'action'; readonly type: ActionType }
  | { readonly kind: 'tick'; readonly count: number; readonly level: number }
  | { readonly kind: 'garbage'; readonly rows: number; readonly hole: number };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc
      .constantFrom<ActionType>(
        'moveLeft',
        'moveRight',
        'rotateCW',
        'rotateCCW',
        'softDropStart',
        'softDropStop',
        'hardDrop',
      )
      .map((type): Step => ({ kind: 'action', type })),
  },
  {
    weight: 3,
    arbitrary: fc
      .record({ count: fc.integer({ min: 1, max: 32 }), level: fc.integer({ min: 0, max: 12 }) })
      .map(({ count, level }): Step => ({ kind: 'tick', count, level })),
  },
  {
    weight: 1,
    arbitrary: fc
      .record({ rows: fc.integer({ min: 1, max: 4 }), hole: fc.integer({ min: 0, max: 9 }) })
      .map(({ rows, hole }): Step => ({ kind: 'garbage', rows, hole })),
  },
);

const ROW = /^[.IOTSZJLG]{10}$/;

function run(state: PlayerState, step: Step): { state: PlayerState; events: EngineEvent[] } {
  switch (step.kind) {
    case 'action': {
      const result = applyAction(state, deepFreeze({ type: step.type }));
      return { state: result.state, events: [...result.events] };
    }
    case 'tick': {
      let current = state;
      const events: EngineEvent[] = [];
      for (let i = 0; i < step.count; i += 1) {
        const result = tick(current, step.level);
        current = deepFreeze(result.state);
        events.push(...result.events);
      }
      return { state: current, events };
    }
    case 'garbage':
      return {
        state: receiveGarbage(state, deepFreeze({ rows: step.rows, holeColumn: step.hole })),
        events: [],
      };
  }
}

/** The first broken invariant, or null. Plain checks: this runs ~200k times per test. */
function violation(state: PlayerState, events: readonly EngineEvent[]): string | null {
  // The board is always 20 × 10 of valid cells.
  if (state.board.length !== BOARD_HEIGHT) return `board has ${String(state.board.length)} rows`;
  const badRow = state.board.find((row) => !ROW.test(row));
  if (badRow !== undefined) return `malformed row "${badRow}"`;
  // No cell of the active piece is out of bounds or overlaps a filled cell.
  if (state.active !== null) {
    for (const { x, y } of pieceCells(state.active)) {
      if (x < 0 || x >= BOARD_WIDTH || y < 0 || y >= BOARD_HEIGHT) {
        return `active cell (${String(x)}, ${String(y)}) out of bounds`;
      }
      if (state.board[y]?.charAt(x) !== '.') {
        return `active cell (${String(x)}, ${String(y)}) overlaps the stack`;
      }
    }
  }
  // No full row remains after a lock (nor ever: garbage rows always keep a hole).
  const full = fullRows(state.board);
  if (full.length > 0) {
    const afterLock = events.some((event) => event.type === 'locked');
    return `full rows ${full.join(',')} remain${afterLock ? ' after a lock' : ''}`;
  }
  // Server invariants: with a bag the preview is exactly PREVIEW_COUNT, and a bag never starves.
  if (state.queue.length !== PREVIEW_COUNT) return `queue length ${String(state.queue.length)}`;
  if ((state.active === null) !== state.toppedOut) return 'active is null without a top-out';
  return null;
}

describe('REQ-063 source spec §8.1 — property test (fast-check)', () => {
  it(
    'REQ-063 for random action/tick/garbage sequences: nothing out of bounds, no overlap, no full row after a lock, inputs never mutated',
    { timeout: 60_000 },
    () => {
      let steps = 0;
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 0xffffffff }),
          // size 'max': lengths span the whole 0..400 range instead of fast-check's small default.
          fc.array(stepArb, { maxLength: 400, size: 'max' }),
          (seed, plan) => {
            deepFreeze(plan); // the engine must never write to its inputs: a write would throw
            let state = deepFreeze(createPlayerState({ bag: createBag(seed) }));
            expect(violation(state, [])).toBeNull();
            for (const step of plan) {
              const result = run(state, step);
              state = deepFreeze(result.state);
              const problem = violation(state, result.events);
              if (problem !== null) throw new Error(`${problem} after ${JSON.stringify(step)}`);
              steps += 1;
            }
          },
        ),
        { numRuns: 200 },
      );
      expect(steps).toBeGreaterThan(200 * 100); // long sequences really were exercised
    },
  );
});
