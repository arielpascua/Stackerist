import { describe, expect, it } from 'vitest';
import { createBag, createPlayerState, playerStats, serializeBoard } from '../src/index.js';
import {
  I_FLAT_RIGHT,
  I_UP_COL0,
  I_UP_COL9,
  boardOf,
  dropAt,
  must,
  oAt,
  singleMachine,
  ticks,
} from './helpers.js';

describe('REQ-064 best moment', () => {
  it('REQ-019 a player who never cleared a line has no best moment (null)', () => {
    let state = createPlayerState({ bag: createBag(1) });
    expect(state.bestMoment).toBeNull();
    state = dropAt(state, oAt(0)).state;
    state = dropAt(state, oAt(4)).state;
    expect(state.piecesPlaced).toBe(2);
    expect(state.bestMoment).toBeNull();
    expect(playerStats(state).bestMoment).toBeNull();
  });

  it('REQ-019 records the board before removal, cleared rows, piece cells, combo, lines, attack, sent, cancelled and tick', () => {
    const board = boardOf('.GGGGGGGGG', '.GGGGGGGGG', '.GGGGGGGGG', '.GGGGGGGGG');
    const start = createPlayerState({
      board,
      pendingGarbage: [{ rows: 1, holeColumn: 2 }],
      bag: createBag(1),
      tick: 1234,
    });
    const { state } = dropAt(start, I_UP_COL0);
    const best = must(state.bestMoment);
    expect(serializeBoard(best.board)).toEqual([
      ...Array.from({ length: 16 }, () => '..........'),
      'IGGGGGGGGG',
      'IGGGGGGGGG',
      'IGGGGGGGGG',
      'IGGGGGGGGG',
    ]);
    expect(best).toEqual({
      board: best.board,
      clearedRows: [16, 17, 18, 19],
      pieceCells: [
        { x: 0, y: 16 },
        { x: 0, y: 17 },
        { x: 0, y: 18 },
        { x: 0, y: 19 },
      ],
      combo: 1,
      linesCleared: 4,
      attack: 4,
      sent: 3,
      cancelled: 1,
      tick: 1234,
    });
    expect(playerStats(state)).toEqual({
      linesCleared: 4,
      garbageSent: 3,
      garbageCancelled: 1,
      piecesPlaced: 1,
      bestCombo: 1,
      bestMoment: best,
    });
  });

  it('REQ-019 a higher combo replaces the best moment even with a lower attack', () => {
    let state = createPlayerState({
      board: boardOf('GGGGGG....', 'GGGGGGGGG.', 'GGGGGGGGG.', 'GGGGGGGGG.', 'GGGGGGGG..'),
      bag: createBag(1),
    });
    state = dropAt(state, I_UP_COL9).state; // triple, c1, attack 2
    expect(must(state.bestMoment)).toMatchObject({ combo: 1, linesCleared: 3, attack: 2 });
    state = dropAt(state, I_FLAT_RIGHT).state; // single, c2, attack 1
    expect(must(state.bestMoment)).toMatchObject({ combo: 2, linesCleared: 1, attack: 1 });
  });

  it('REQ-019 tie-break 1: equal combo, the higher attack replaces', () => {
    let state = createPlayerState({ board: boardOf(...singleMachine(4)), bag: createBag(1) });
    state = dropAt(state, I_FLAT_RIGHT).state; // single, c1, attack 0
    const first = must(state.bestMoment);
    expect(first).toMatchObject({ combo: 1, attack: 0 });
    state = dropAt(state, oAt(6)).state; // clears nothing: combo back to 0
    expect(state.combo).toBe(0);
    expect(state.bestMoment).toBe(first);
    state = dropAt(state, oAt(8)).state; // double, c1, attack 1
    expect(must(state.bestMoment)).toMatchObject({
      combo: 1,
      linesCleared: 2,
      attack: 1,
      clearedRows: [18, 19],
    });
  });

  it('REQ-019 tie-break 2: equal combo and equal attack, the earlier lock is kept', () => {
    let state = createPlayerState({
      board: boardOf(...singleMachine(4)),
      bag: createBag(1),
      tick: 500,
    });
    state = dropAt(state, I_FLAT_RIGHT).state; // single at tick 500
    const first = must(state.bestMoment);
    expect(first.tick).toBe(500);
    state = ticks(state, 3, 0).state;
    state = dropAt(state, oAt(0)).state; // clears nothing
    state = dropAt(state, I_FLAT_RIGHT).state; // single at tick 503: same combo and attack
    expect(state.linesCleared).toBe(2);
    expect(state.bestMoment).toBe(first);
  });

  it('REQ-019 a lower combo never replaces the best moment, even with a higher attack', () => {
    let state = createPlayerState({
      board: boardOf(
        'GGGGGG....',
        'GGGGGG....',
        'GGGGGGGGG.',
        'GGGGGGGGG.',
        'GGGGGGGGG.',
        'GGGGGGGGG.',
      ),
      bag: createBag(1),
    });
    state = dropAt(state, I_FLAT_RIGHT).state; // single, c1
    state = dropAt(state, I_FLAT_RIGHT).state; // single, c2: attack 1
    const best = must(state.bestMoment);
    expect(best).toMatchObject({ combo: 2, attack: 1 });
    state = dropAt(state, oAt(0)).state; // breaks the chain
    const four = dropAt(state, I_UP_COL9); // four rows, c1: attack 4
    expect(four.events).toContainEqual({ type: 'attack', rows: 4 });
    expect(four.state.bestMoment).toBe(best);
  });
});
