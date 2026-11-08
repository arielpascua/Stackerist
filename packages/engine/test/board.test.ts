import { describe, expect, it } from 'vitest';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  EMPTY_ROW,
  cellAt,
  collides,
  emptyBoard,
  fullRows,
  insertGarbage,
  isBlocked,
  parseBoard,
  removeRows,
  serializeBoard,
  stackHeight,
  writeCells,
} from '../src/index.js';
import { boardOf, bottom } from './helpers.js';

describe('board', () => {
  it('REQ-001 the board is 10 columns by 20 rows with no hidden rows', () => {
    expect(BOARD_WIDTH).toBe(10);
    expect(BOARD_HEIGHT).toBe(20);
    expect(EMPTY_ROW).toBe('..........');
    const board = emptyBoard();
    expect(board).toHaveLength(20);
    expect(board.every((row) => row === '..........')).toBe(true);
    expect(Object.isFrozen(board)).toBe(true);
  });

  it('REQ-001 any cell with x < 0, x > 9, y < 0 or y > 19 counts as a collision', () => {
    const board = emptyBoard();
    for (const [x, y] of [
      [-1, 5],
      [10, 5],
      [5, -1],
      [5, 20],
      [-1, -1],
      [10, 20],
    ] as const) {
      expect(isBlocked(board, x, y), `(${String(x)}, ${String(y)})`).toBe(true);
      expect(cellAt(board, x, y)).toBeNull();
    }
    for (const [x, y] of [
      [0, 0],
      [9, 0],
      [0, 19],
      [9, 19],
    ] as const) {
      expect(isBlocked(board, x, y)).toBe(false);
    }
    expect(
      collides(board, [
        { x: 0, y: 0 },
        { x: 9, y: 19 },
      ]),
    ).toBe(false);
    expect(
      collides(board, [
        { x: 0, y: 0 },
        { x: 9, y: 20 },
      ]),
    ).toBe(true);
    expect(collides(board, [{ x: 4, y: -1 }])).toBe(true);
  });

  it('REQ-001 filled cells collide and empty cells do not', () => {
    const board = boardOf('....G.....', 'T........I');
    expect(isBlocked(board, 4, 18)).toBe(true);
    expect(isBlocked(board, 5, 18)).toBe(false);
    expect(cellAt(board, 0, 19)).toBe('T');
    expect(cellAt(board, 9, 19)).toBe('I');
    expect(cellAt(board, 4, 18)).toBe('G');
    expect(cellAt(board, 1, 19)).toBeNull();
    expect(collides(board, [{ x: 5, y: 18 }])).toBe(false);
    expect(
      collides(board, [
        { x: 5, y: 18 },
        { x: 4, y: 18 },
      ]),
    ).toBe(true);
  });

  it('REQ-012 parseBoard reads 20 strings of 10 characters and serializeBoard writes them back', () => {
    const rows = [
      ...Array.from({ length: 16 }, () => '..........'),
      'IIII......',
      'OO.TTT.SSZ',
      'ZJJJLLLG..',
      'GGGGGGGGG.',
    ];
    const board = parseBoard(rows);
    expect(serializeBoard(board)).toEqual(rows);
    expect(cellAt(board, 0, 16)).toBe('I');
    expect(cellAt(board, 1, 17)).toBe('O');
    expect(cellAt(board, 3, 17)).toBe('T');
    expect(cellAt(board, 7, 17)).toBe('S');
    expect(cellAt(board, 9, 17)).toBe('Z');
    expect(cellAt(board, 1, 18)).toBe('J');
    expect(cellAt(board, 4, 18)).toBe('L');
    expect(cellAt(board, 7, 18)).toBe('G');
    expect(cellAt(board, 9, 19)).toBeNull();
  });

  it('REQ-012 parseBoard rejects a wrong row count, a wrong width or an unknown character with RangeError', () => {
    const ok = Array.from({ length: 20 }, () => '..........');
    expect(() => parseBoard(ok.slice(1))).toThrow(RangeError);
    expect(() => parseBoard([...ok, '..........'])).toThrow(RangeError);
    expect(() => parseBoard([...ok.slice(1), '.........'])).toThrow(RangeError);
    expect(() => parseBoard([...ok.slice(1), '...........'])).toThrow(RangeError);
    expect(() => parseBoard([...ok.slice(1), '....X.....'])).toThrow(RangeError);
    expect(() => parseBoard([...ok.slice(1), '....t.....'])).toThrow(RangeError);
    expect(() => parseBoard([...ok.slice(1), '.... .....'])).toThrow(RangeError);
  });

  it('REQ-012 parseBoard returns a frozen copy and serializeBoard a fresh mutable copy', () => {
    const rows = Array.from({ length: 20 }, () => '..........');
    const board = parseBoard(rows);
    expect(board).not.toBe(rows);
    expect(Object.isFrozen(board)).toBe(true);
    rows[0] = 'GGGGGGGGGG';
    expect(board[0]).toBe('..........');
    const out = serializeBoard(board);
    expect(out).not.toBe(board);
    expect(Object.isFrozen(out)).toBe(false);
    out[0] = 'GGGGGGGGGG';
    expect(board[0]).toBe('..........');
  });

  it('REQ-012 writeCells writes a kind into a new board and rejects cells outside the board', () => {
    const board = emptyBoard();
    const next = writeCells(
      board,
      [
        { x: 0, y: 19 },
        { x: 9, y: 19 },
        { x: 4, y: 0 },
      ],
      'S',
    );
    expect(next).not.toBe(board);
    expect(board[19]).toBe('..........');
    expect(next[19]).toBe('S........S');
    expect(next[0]).toBe('....S.....');
    expect(Object.isFrozen(next)).toBe(true);
    expect(() => writeCells(board, [{ x: 10, y: 0 }], 'S')).toThrow(RangeError);
    expect(() => writeCells(board, [{ x: 0, y: -1 }], 'S')).toThrow(RangeError);
  });

  it('REQ-006 fullRows lists every full row in ascending order, adjacent or not', () => {
    const board = boardOf('GGGGGGGGGG', 'G.GGGGGGGG', 'TTTTTTTTTT', 'IIIIIIIIIG');
    expect(fullRows(board)).toEqual([16, 18, 19]);
    expect(fullRows(emptyBoard())).toEqual([]);
  });

  it('REQ-006 removeRows drops the rows, shifts everything above down and adds empty rows on top', () => {
    const board = boardOf('.J........', 'GGGGGGGGGG', 'G.GGGGGGGG', 'TTTTTTTTTT');
    const next = removeRows(board, [17, 19]);
    expect(bottom(next, 4)).toEqual(['..........', '..........', '.J........', 'G.GGGGGGGG']);
    expect(next).toHaveLength(20);
    expect(removeRows(board, [])).toBe(board);
  });

  it('REQ-017 insertGarbage adds rows of nine G and one hole at the bottom and pushes the stack up', () => {
    const board = boardOf('.T........', 'TTT.......');
    const { board: next, overflow } = insertGarbage(board, 2, 3);
    expect(overflow).toBe(false);
    expect(bottom(next, 4)).toEqual(['.T........', 'TTT.......', 'GGG.GGGGGG', 'GGG.GGGGGG']);
    expect(next).toHaveLength(20);
    for (const row of bottom(next, 2)) {
      expect(row.split('').filter((c) => c === 'G')).toHaveLength(9);
      expect(row.indexOf('.')).toBe(3);
    }
  });

  it('REQ-017 insertGarbage validates the row count and the hole column', () => {
    const board = emptyBoard();
    expect(insertGarbage(board, 0, 4)).toEqual({ board, overflow: false });
    expect(() => insertGarbage(board, -1, 4)).toThrow(RangeError);
    expect(() => insertGarbage(board, 1.5, 4)).toThrow(RangeError);
    expect(() => insertGarbage(board, 1, -1)).toThrow(RangeError);
    expect(() => insertGarbage(board, 1, 10)).toThrow(RangeError);
    expect(() => insertGarbage(board, 1, 2.5)).toThrow(RangeError);
  });

  it('REQ-018 insertGarbage reports overflow when a filled cell is pushed above row 0', () => {
    const tower = parseBoard([
      '..........',
      '..........',
      '....Z.....',
      ...Array.from({ length: 17 }, () => '..........'),
    ]);
    expect(insertGarbage(tower, 2, 0).overflow).toBe(false);
    const pushed = insertGarbage(tower, 3, 0);
    expect(pushed.overflow).toBe(true);
    expect(pushed.board).toHaveLength(20);
    expect(pushed.board[0]).toBe('..........');
    expect(insertGarbage(emptyBoard(), 20, 0).overflow).toBe(false);
    const tooMany = insertGarbage(emptyBoard(), 21, 5);
    expect(tooMany.overflow).toBe(true);
    expect(tooMany.board.every((row) => row === 'GGGGG.GGGG')).toBe(true);
  });

  it('stackHeight counts rows from the floor to the highest filled cell (0 when empty)', () => {
    expect(stackHeight(emptyBoard())).toBe(0);
    expect(stackHeight(boardOf('G.........'))).toBe(1);
    expect(stackHeight(boardOf('...L......', '..........', 'G.........'))).toBe(3);
    expect(stackHeight(parseBoard(Array.from({ length: 20 }, () => '.........G')))).toBe(20);
  });
});
