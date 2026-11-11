/**
 * Gaps found by mutation testing (gate 10a, Stryker): each test pins a behaviour that a mutant of the
 * engine source could change without any earlier test noticing. Titles carry the REQ id they protect.
 */
import { describe, expect, it } from 'vitest';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  MAX_LOCK_RESETS,
  PIECE_KINDS,
  PREVIEW_COUNT,
  applyAction,
  attackFor,
  cancelGarbage,
  cellAt,
  createBag,
  createPlayerState,
  drawPieces,
  emptyBoard,
  insertGarbage,
  isBlocked,
  parseBoard,
  pieceCells,
  receiveGarbage,
  rngInt,
  rngNext,
  simulate,
  spawnPiece,
  tick,
  writeCells,
  type Action,
  type ActivePiece,
  type Board,
} from '../src/index.js';
import { boardOf, must } from './helpers.js';

const ROTATIONS = [0, 1, 2, 3] as const;

function withCell(rows: readonly string[], x: number, y: number, kind: string): string[] {
  const out = [...rows];
  const row = must(out[y]);
  out[y] = row.slice(0, x) + kind + row.slice(x + 1);
  return out;
}

describe('mutation gaps: board', () => {
  it('REQ-001 a non-integer coordinate is blocked and reads as empty-outside, never as the rounded cell', () => {
    const board = boardOf('.T........');
    expect(cellAt(board, 1, 19)).toBe('T');
    expect(cellAt(board, 1.5, 19)).toBeNull();
    expect(cellAt(board, 1, 19.5)).toBeNull();
    expect(isBlocked(board, 1.5, 19)).toBe(true);
    expect(isBlocked(board, 0.5, 5)).toBe(true);
    expect(isBlocked(board, 5, 0.5)).toBe(true);
  });

  it('REQ-001 cellAt returns the kind of a filled cell, null for an empty cell and null on every side outside', () => {
    const board = parseBoard(
      withCell(withCell([...emptyBoard()], 0, 0, 'I'), BOARD_WIDTH - 1, BOARD_HEIGHT - 1, 'Z'),
    );
    expect(cellAt(board, 0, 0)).toBe('I');
    expect(cellAt(board, BOARD_WIDTH - 1, BOARD_HEIGHT - 1)).toBe('Z');
    expect(cellAt(board, 1, 0)).toBeNull();
    expect(cellAt(board, 0, 1)).toBeNull();
    expect(cellAt(board, -1, 0)).toBeNull();
    expect(cellAt(board, BOARD_WIDTH, 0)).toBeNull();
    expect(cellAt(board, 0, -1)).toBeNull();
    expect(cellAt(board, 0, BOARD_HEIGHT)).toBeNull();
    expect(isBlocked(board, -1, 0)).toBe(true);
    expect(isBlocked(board, BOARD_WIDTH, 0)).toBe(true);
    expect(isBlocked(board, 0, -1)).toBe(true);
    expect(isBlocked(board, 0, BOARD_HEIGHT)).toBe(true);
    expect(isBlocked(board, 1, 0)).toBe(false);
  });

  it('REQ-012 writeCells rejects every cell outside the board on each side, and non-integers', () => {
    const board = emptyBoard();
    for (const [x, y] of [
      [-1, 0],
      [BOARD_WIDTH, 0],
      [0, -1],
      [0, BOARD_HEIGHT],
      [1.5, 0],
      [0, 1.5],
    ] as const) {
      expect(() => writeCells(board, [{ x, y }], 'T')).toThrow(RangeError);
      expect(() => writeCells(board, [{ x, y }], 'T')).toThrow(/is outside the board/);
    }
    // The valid corners still write.
    const written = writeCells(
      board,
      [
        { x: 0, y: 0 },
        { x: BOARD_WIDTH - 1, y: BOARD_HEIGHT - 1 },
      ],
      'O',
    );
    expect(written[0]).toBe('O.........');
    expect(written[BOARD_HEIGHT - 1]).toBe('.........O');
  });

  it('REQ-012 parseBoard names the offending row count and row index in its error', () => {
    expect(() => parseBoard(emptyBoard().slice(1))).toThrow(/20 rows, got 19/);
    const bad = [...emptyBoard()];
    bad[3] = '...x......';
    expect(() => parseBoard(bad)).toThrow(/Row 3 must be 10 characters/);
  });

  it('REQ-017 insertGarbage names the bad argument: rows must be a non-negative integer', () => {
    const board = emptyBoard();
    expect(() => insertGarbage(board, -1, 0)).toThrow(/non-negative integer, got -1/);
    expect(() => insertGarbage(board, 1.5, 0)).toThrow(/non-negative integer/);
  });

  it('REQ-017 insertGarbage rejects a hole column below 0, above 9 or fractional, saying 0..9', () => {
    const board = emptyBoard();
    for (const hole of [-1, BOARD_WIDTH, BOARD_WIDTH + 1, 1.5]) {
      expect(() => insertGarbage(board, 1, hole)).toThrow(/Hole column must be 0\.\.9/);
    }
    expect(insertGarbage(board, 1, 0).board[BOARD_HEIGHT - 1]).toBe('.GGGGGGGGG');
    expect(insertGarbage(board, 1, 9).board[BOARD_HEIGHT - 1]).toBe('GGGGGGGGG.');
  });

  it('REQ-017 insertGarbage of zero rows returns the very same board and no overflow', () => {
    const board = boardOf('GGGG.GGGGG');
    const result = insertGarbage(board, 0, 3);
    expect(result.board).toBe(board);
    expect(result.overflow).toBe(false);
  });
});

describe('mutation gaps: pieces and bag', () => {
  it('REQ-002 pieceCells lists the four cells in reading order (top row first, then left to right) for every kind and rotation', () => {
    for (const kind of PIECE_KINDS) {
      for (const rotation of ROTATIONS) {
        const cells = pieceCells({ kind, rotation, x: 3, y: 5 });
        expect(cells).toHaveLength(4);
        const sorted = [...cells].sort((a, b) => a.y - b.y || a.x - b.x);
        expect(cells, `${kind} rotation ${String(rotation)}`).toEqual(sorted);
      }
    }
  });

  it('REQ-008 drawPieces rejects a negative or fractional count and says so', () => {
    const bag = createBag(1);
    expect(() => drawPieces(bag, -1)).toThrow(/non-negative integer, got -1/);
    expect(() => drawPieces(bag, 2.5)).toThrow(/non-negative integer/);
    expect(drawPieces(bag, 0).pieces).toEqual([]);
  });
});

describe('mutation gaps: rng', () => {
  it('REQ-008 rngInt names the bad range in its error', () => {
    expect(() => rngInt(1, 0)).toThrow(/range must be an integer in 1\.\.2\^32, got 0/);
    expect(() => rngInt(1, 2 ** 32 + 1)).toThrow(/1\.\.2\^32/);
  });

  it('REQ-008 rngInt rejects a draw exactly equal to the largest multiple of n (value === limit), not only above it', () => {
    // State 3543772583 makes mulberry32 output 0xFFFFFFFF. For n = 3 the largest multiple of 3 that fits
    // in 2^32 is 2^32 - 1 = limit, so that draw must be thrown away (accepting it would bias value 0).
    const state = 3543772583;
    const first = rngNext(state);
    expect(first.value).toBe(0xffffffff);
    const second = rngNext(first.state);
    expect(second.value).toBeLessThan(0xffffffff);
    const drawn = rngInt(state, 3);
    expect(drawn.value).toBe(second.value % 3);
    expect(drawn.state).toBe(second.state);
  });
});

describe('mutation gaps: garbage', () => {
  it('REQ-017 attackFor names the bad line count in its error', () => {
    expect(() => attackFor(5, 1)).toThrow(/Lines cleared must be 0\.\.4, got 5/);
    expect(() => attackFor(1.5, 1)).toThrow(/Lines cleared must be 0\.\.4/);
  });

  it('REQ-017 cancelGarbage with a non-positive attack cancels and sends nothing, never a negative leftover', () => {
    const pending = [{ rows: 2, holeColumn: 3 }];
    expect(cancelGarbage(pending, 0)).toEqual({ pending, cancelled: 0, leftover: 0 });
    const negative = cancelGarbage(pending, -1);
    expect(negative.cancelled).toBe(0);
    expect(negative.leftover).toBe(0);
    expect(negative.pending).toEqual(pending);
  });

  it('REQ-017 receiveGarbage names the bad rows or hole column in its error', () => {
    const state = createPlayerState({ queue: ['T'] });
    expect(() => receiveGarbage(state, { rows: 0, holeColumn: 1 })).toThrow(/integer ≥ 1, got 0/);
    expect(() => receiveGarbage(state, { rows: 1.5, holeColumn: 1 })).toThrow(/integer ≥ 1/);
    expect(() => receiveGarbage(state, { rows: 1, holeColumn: BOARD_WIDTH })).toThrow(
      /Hole column must be 0\.\.9, got 10/,
    );
    expect(() => receiveGarbage(state, { rows: 1, holeColumn: -1 })).toThrow(
      /Hole column must be 0\.\.9/,
    );
    expect(() => receiveGarbage(state, { rows: 1, holeColumn: 0.5 })).toThrow(/Hole column/);
  });
});

describe('mutation gaps: player state', () => {
  it('REQ-007 createPlayerState rejects a negative or fractional tick, naming it', () => {
    expect(() => createPlayerState({ tick: -1 })).toThrow(/tick must be an integer ≥ 0, got -1/);
    expect(() => createPlayerState({ tick: 0.5, queue: ['T'] })).toThrow(/tick must be an integer/);
  });

  it('REQ-007 with a bag and an explicit active piece the queue is still topped up to PREVIEW_COUNT', () => {
    const state = createPlayerState({ bag: createBag(7), active: spawnPiece('T') });
    expect(state.queue).toHaveLength(PREVIEW_COUNT);
    expect(state.active).toEqual(spawnPiece('T'));
  });

  it('REQ-007 an explicit null active piece gives an idle state at lowestY 0 without throwing', () => {
    const state = createPlayerState({ active: null, queue: ['T'] });
    expect(state.active).toBeNull();
    expect(state.lowestY).toBe(0);
    expect(state.toppedOut).toBe(false);
    expect(state.queue).toEqual(['T']);
  });

  it('REQ-007 applyAction ignores a malformed action: same state, no events, no throw', () => {
    const state = createPlayerState({ queue: ['T'] });
    const result = applyAction(state, { type: 'bogus' } as unknown as Action);
    expect(result.state).toBe(state);
    expect(result.events).toEqual([]);
  });
});

describe('mutation gaps: lock delay bookkeeping', () => {
  // T pointing up at (3, 10); blocks at (3, 10) and (4, 12) force the SRS 0>1 kick index 4, which moves
  // the piece two rows DOWN to (2, 12). The piece is grounded before the rotation (its cell (4, 11) rests on (4, 12)).
  const T_UP: ActivePiece = { kind: 'T', rotation: 0, x: 3, y: 10 };
  const kickBoard = (): Board => {
    let rows = [...emptyBoard()];
    rows = withCell(rows, 3, 10, 'G');
    rows = withCell(rows, 4, 12, 'G');
    return parseBoard(rows);
  };

  it('REQ-010 #16 a rotation whose kick reaches a new lowest row sets lowestY and zeroes the lock-reset count', () => {
    const base = createPlayerState({ board: kickBoard(), active: T_UP, queue: ['O'] });
    const state = { ...base, lowestY: 10, lockResets: 3, lockCounter: 5 };
    const { state: after, events } = applyAction(state, { type: 'rotateCW' });
    expect(events).toEqual([{ type: 'rotated', rotation: 1, kickIndex: 4 }]);
    expect(after.active).toEqual({ kind: 'T', rotation: 1, x: 2, y: 12 });
    expect(after.lowestY).toBe(12);
    expect(after.lockResets).toBe(0);
    expect(after.lockCounter).toBe(0);
  });

  it('REQ-010 #16 gravity falling onto a row that is not below the lowest reached keeps the lock-reset count and lowestY', () => {
    const base = createPlayerState({
      active: { kind: 'O', rotation: 0, x: 0, y: 5 },
      queue: ['T'],
    });
    // Equal to lowestY: no reset.
    const atLowest = { ...base, lowestY: 6, lockResets: 7, gravityCounter: 1000 };
    const a = tick(atLowest, 0).state;
    expect(must(a.active).y).toBe(6);
    expect(a.lowestY).toBe(6);
    expect(a.lockResets).toBe(7);
    // Above lowestY (the piece was kicked upward earlier): lowestY must not move back up.
    const aboveLowest = { ...base, lowestY: 9, lockResets: 4, gravityCounter: 1000 };
    const b = tick(aboveLowest, 0).state;
    expect(must(b.active).y).toBe(6);
    expect(b.lowestY).toBe(9);
    expect(b.lockResets).toBe(4);
    // Below lowestY (a genuinely new lowest row): lowestY follows and the count resets.
    const newLowest = { ...base, lowestY: 5, lockResets: MAX_LOCK_RESETS, gravityCounter: 1000 };
    const c = tick(newLowest, 0).state;
    expect(c.lowestY).toBe(6);
    expect(c.lockResets).toBe(0);
  });
});

describe('mutation gaps: simulate', () => {
  /** Row 0 is almost full so the next spawn is blocked, and the I fits in column 0 without clearing it. */
  const blockedTop = (): Board =>
    parseBoard(
      Array.from({ length: BOARD_HEIGHT }, (_, y) => (y === 0 ? 'GGGGGGGGG.' : '..........')),
    );
  const I_COL0: ActivePiece = { kind: 'I', rotation: 1, x: -2, y: 0 };

  it('REQ-082 simulate to a tick at or before from.tick returns from untouched and reports stoppedBy none, even for a topped-out state', () => {
    const toppedOut = createPlayerState({ board: blockedTop(), queue: ['O'] });
    expect(toppedOut.toppedOut).toBe(true);
    for (const toTick of [toppedOut.tick, toppedOut.tick - 1]) {
      const result = simulate(toppedOut, toTick, []);
      expect(result.state).toBe(toppedOut);
      expect(result.stoppedBy).toBe('none');
      expect(result.reachedTick).toBe(toppedOut.tick);
      expect(result.events).toEqual([]);
      expect(result.appliedSeqs).toEqual([]);
    }
    const starved = createPlayerState({ queue: [] });
    expect(starved.active).toBeNull();
    expect(simulate(starved, starved.tick, []).stoppedBy).toBe('none');
  });

  it('REQ-082 once an input tops the player out, the inputs after it in the same tick are not applied or listed', () => {
    const state = createPlayerState({ board: blockedTop(), active: I_COL0, queue: ['O'] });
    const result = simulate(state, 3, [
      { seq: 1, tick: 0, action: { type: 'hardDrop' } },
      { seq: 2, tick: 0, action: { type: 'moveRight' } },
      { seq: 3, tick: 1, action: { type: 'moveRight' } },
    ]);
    expect(result.stoppedBy).toBe('toppedOut');
    expect(result.appliedSeqs).toEqual([1]);
  });

  it('REQ-082 once an input leaves the player starved (no active piece), the inputs after it are not applied or listed', () => {
    const state = createPlayerState({ active: I_COL0, queue: [] });
    const result = simulate(state, 3, [
      { seq: 1, tick: 0, action: { type: 'hardDrop' } },
      { seq: 2, tick: 0, action: { type: 'moveRight' } },
    ]);
    expect(result.stoppedBy).toBe('starved');
    expect(result.appliedSeqs).toEqual([1]);
  });
});
