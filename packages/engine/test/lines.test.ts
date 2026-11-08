import { describe, expect, it } from 'vitest';
import { createBag, createPlayerState, playerStats } from '../src/index.js';
import { I_UP_COL0, boardOf, bottom, dropAt, types } from './helpers.js';

/** Bottom 5 rows; the vertical I drops into column 0 and lands on rows 16..19. */
const CASES = [
  {
    name: 'single',
    rows: ['.JJ.......', '.G........', '.G........', '.G........', '.GGGGGGGGG'],
    cleared: [19],
    after: ['.JJ.......', 'IG........', 'IG........', 'IG........'],
  },
  {
    name: 'double',
    rows: ['.JJ.......', '.G........', '.G........', '.GGGGGGGGG', '.GGGGGGGGG'],
    cleared: [18, 19],
    after: ['..........', '.JJ.......', 'IG........', 'IG........'],
  },
  {
    name: 'triple',
    rows: ['.JJ.......', '.G........', '.GGGGGGGGG', '.GGGGGGGGG', '.GGGGGGGGG'],
    cleared: [17, 18, 19],
    after: ['..........', '..........', '.JJ.......', 'IG........'],
  },
  {
    name: 'four-row',
    rows: ['.JJ.......', '.GGGGGGGGG', '.GGGGGGGGG', '.GGGGGGGGG', '.GGGGGGGGG'],
    cleared: [16, 17, 18, 19],
    after: ['..........', '..........', '..........', '.JJ.......'],
  },
] as const;

describe('REQ-063 source spec §8.1 — line clears', () => {
  it.each(CASES)(
    'REQ-006 #17 a $name clear removes the right rows and shifts everything above down',
    ({ rows, cleared, after }) => {
      const start = createPlayerState({ board: boardOf(...rows), bag: createBag(1) });
      const { state, events } = dropAt(start, I_UP_COL0);
      expect(events).toContainEqual({ type: 'linesCleared', count: cleared.length, rows: cleared });
      expect(bottom(state.board, 4)).toEqual(after);
      expect(state.board.slice(0, 16).every((row) => row === '..........')).toBe(true);
      expect(state.linesCleared).toBe(cleared.length);
    },
  );

  it('REQ-006 #18 non-adjacent full rows (17 and 19) clear; the row between is kept and shifted', () => {
    const start = createPlayerState({
      board: boardOf('.JJ.......', '.G........', '.GGGGGGGGG', '.G.GGGGGGG', '.GGGGGGGGG'),
      bag: createBag(1),
    });
    const { state, events } = dropAt(start, I_UP_COL0);
    expect(events).toContainEqual({ type: 'linesCleared', count: 2, rows: [17, 19] });
    expect(bottom(state.board, 4)).toEqual([
      '..........',
      '.JJ.......',
      'IG........',
      'IG.GGGGGGG',
    ]);
  });

  it('REQ-006 #19 a row with one empty cell is not cleared', () => {
    const start = createPlayerState({
      board: boardOf('.G........', '.G........', '.G........', '.GGGGGGGG.'),
      bag: createBag(1),
    });
    const { state, events } = dropAt(start, I_UP_COL0);
    expect(types(events)).toEqual(['locked', 'spawned']);
    expect(bottom(state.board, 4)).toEqual([
      'IG........',
      'IG........',
      'IG........',
      'IGGGGGGGG.',
    ]);
    expect(state.linesCleared).toBe(0);
  });

  it('REQ-006 #20 lines cleared are tracked in stats', () => {
    let state = createPlayerState({
      board: boardOf(...CASES[1].rows),
      bag: createBag(1),
    });
    state = dropAt(state, I_UP_COL0).state; // double
    expect(state.linesCleared).toBe(2);
    // Two I cells are left in column 0 at rows 18–19; another vertical I on top clears nothing.
    state = dropAt(state, I_UP_COL0).state;
    expect(state.linesCleared).toBe(2);
    expect(playerStats(state).linesCleared).toBe(2);
    expect(state.piecesPlaced).toBe(2);
  });
});
