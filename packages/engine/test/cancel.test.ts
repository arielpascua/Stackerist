import { describe, expect, it } from 'vitest';
import { cancelGarbage, createBag, createPlayerState, pendingTotal } from '../src/index.js';
import { I_UP_COL0, boardOf, deepFreeze, dropAt, types } from './helpers.js';

describe('REQ-064 garbage cancelling', () => {
  it('REQ-015 full cancel: an attack at least as big as the pending entry removes it', () => {
    const pending = deepFreeze([{ rows: 2, holeColumn: 3 }]);
    expect(cancelGarbage(pending, 2)).toEqual({ pending: [], cancelled: 2, leftover: 0 });
  });

  it('REQ-015 partial cancel: the entry keeps its hole column and its remaining rows', () => {
    const pending = deepFreeze([{ rows: 3, holeColumn: 7 }]);
    expect(cancelGarbage(pending, 1)).toEqual({
      pending: [{ rows: 2, holeColumn: 7 }],
      cancelled: 1,
      leftover: 0,
    });
  });

  it('REQ-015 cancelling spends the attack on the oldest entries first', () => {
    const pending = deepFreeze([
      { rows: 1, holeColumn: 1 },
      { rows: 2, holeColumn: 2 },
      { rows: 3, holeColumn: 3 },
    ]);
    expect(cancelGarbage(pending, 2)).toEqual({
      pending: [
        { rows: 1, holeColumn: 2 },
        { rows: 3, holeColumn: 3 },
      ],
      cancelled: 2,
      leftover: 0,
    });
    expect(cancelGarbage(pending, 3)).toEqual({
      pending: [{ rows: 3, holeColumn: 3 }],
      cancelled: 3,
      leftover: 0,
    });
  });

  it('REQ-015 only the leftover beyond all pending rows is sent', () => {
    const pending = deepFreeze([
      { rows: 1, holeColumn: 0 },
      { rows: 1, holeColumn: 9 },
    ]);
    expect(cancelGarbage(pending, 5)).toEqual({ pending: [], cancelled: 2, leftover: 3 });
    expect(cancelGarbage([], 4)).toEqual({ pending: [], cancelled: 0, leftover: 4 });
    const none = cancelGarbage(pending, 0);
    expect(none.pending).toBe(pending);
    expect(none).toMatchObject({ cancelled: 0, leftover: 0 });
    expect(pendingTotal(pending)).toBe(2);
    expect(pendingTotal([])).toBe(0);
  });

  it('REQ-015 a clearing lock cancels own pending garbage first and attacks with the leftover only', () => {
    const start = createPlayerState({
      board: boardOf('.GGGGGGGGG', '.GGGGGGGGG', '.GGGGGGGGG', '.GGGGGGGGG'),
      pendingGarbage: [
        { rows: 1, holeColumn: 3 },
        { rows: 2, holeColumn: 5 },
      ],
      bag: createBag(8),
    });
    const { state, events } = dropAt(start, I_UP_COL0); // four rows at c1: attack 4
    expect(types(events)).toEqual([
      'locked',
      'linesCleared',
      'combo',
      'garbageCancelled',
      'attack',
      'spawned',
    ]);
    expect(events).toContainEqual({ type: 'garbageCancelled', rows: 3 });
    expect(events).toContainEqual({ type: 'attack', rows: 1 });
    expect(state.pendingGarbage).toEqual([]);
    expect(state.garbageCancelled).toBe(3);
    expect(state.garbageSent).toBe(1);
  });

  it('REQ-015 a small clearing attack partly cancels and sends nothing', () => {
    const start = createPlayerState({
      board: boardOf('.G........', '.G........', '.GGGGGGGGG', '.GGGGGGGGG'),
      pendingGarbage: [{ rows: 3, holeColumn: 5 }],
      bag: createBag(8),
    });
    const { state, events } = dropAt(start, I_UP_COL0); // double at c1: attack 1
    expect(types(events)).not.toContain('attack');
    expect(events).toContainEqual({ type: 'garbageCancelled', rows: 1 });
    expect(state.pendingGarbage).toEqual([{ rows: 2, holeColumn: 5 }]);
    expect(state.garbageSent).toBe(0);
    expect(state.garbageCancelled).toBe(1);
  });
});
