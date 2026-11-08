import { describe, expect, it } from 'vitest';
import { createBag, createPlayerState, receiveGarbage } from '../src/index.js';
import { I_FLAT_RIGHT, boardOf, bottom, dropAt, oAt, singleMachine, types } from './helpers.js';

describe('REQ-064 garbage held back during a combo', () => {
  it('REQ-016 pending garbage waits behind a live combo and lands the moment the chain breaks', () => {
    let state = createPlayerState({
      board: boardOf(...singleMachine(4)),
      pendingGarbage: [{ rows: 3, holeColumn: 0 }],
      bag: createBag(9),
    });

    // c1: a single, attack 0 — nothing cancelled, nothing inserted.
    let step = dropAt(state, I_FLAT_RIGHT);
    expect(types(step.events)).toEqual(['locked', 'linesCleared', 'combo', 'spawned']);
    expect(step.state.pendingGarbage).toEqual([{ rows: 3, holeColumn: 0 }]);
    state = step.state;

    // c2: attack 1 cancels one pending row; the rest is still held.
    step = dropAt(state, I_FLAT_RIGHT);
    expect(types(step.events)).toEqual([
      'locked',
      'linesCleared',
      'combo',
      'garbageCancelled',
      'spawned',
    ]);
    expect(step.state.pendingGarbage).toEqual([{ rows: 2, holeColumn: 0 }]);
    state = step.state;

    // c3: attack 1 again.
    step = dropAt(state, I_FLAT_RIGHT);
    expect(step.state.combo).toBe(3);
    expect(step.state.pendingGarbage).toEqual([{ rows: 1, holeColumn: 0 }]);
    expect(step.state.garbageInserted).toBe(0);
    expect(step.state.board).not.toContain('.GGGGGGGGG');
    state = step.state;

    // The chain breaks: a non-clearing lock inserts what is left.
    step = dropAt(state, oAt(0));
    expect(types(step.events)).toEqual(['locked', 'garbageInserted', 'spawned']);
    expect(step.events).toContainEqual({ type: 'garbageInserted', rows: 1 });
    expect(step.state.combo).toBe(0);
    expect(step.state.pendingGarbage).toEqual([]);
    expect(bottom(step.state.board, 4)).toEqual([
      'OO........',
      'OO........',
      'GGGGGG....',
      '.GGGGGGGGG',
    ]);
    expect(step.state.garbageCancelled).toBe(2);
    expect(step.state.garbageInserted).toBe(1);
    expect(step.state.garbageSent).toBe(0);
  });

  it('REQ-016 garbage that arrives mid-combo is held too, then lands oldest-first with its own hole', () => {
    let state = createPlayerState({ board: boardOf(...singleMachine(3)), bag: createBag(4) });
    state = dropAt(state, I_FLAT_RIGHT).state; // c1
    state = receiveGarbage(state, { rows: 1, holeColumn: 8 });
    state = receiveGarbage(state, { rows: 1, holeColumn: 1 });
    expect(state.garbageReceived).toBe(2);
    state = dropAt(state, I_FLAT_RIGHT).state; // c2: attack 1 cancels the oldest entry
    expect(state.pendingGarbage).toEqual([{ rows: 1, holeColumn: 1 }]);
    const broken = dropAt(state, oAt(0));
    expect(bottom(broken.state.board, 1)).toEqual(['G.GGGGGGGG']);
  });
});
