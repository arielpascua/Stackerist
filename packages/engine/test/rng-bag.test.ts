import { describe, expect, it } from 'vitest';
import {
  PIECE_KINDS,
  createBag,
  createRng,
  drawPiece,
  drawPieces,
  rngInt,
  rngNext,
  seedRng,
  type PieceKind,
} from '../src/index.js';
import { deepFreeze } from './helpers.js';

const TWO_32 = 0x1_0000_0000;

/** The canonical mulberry32 (float form), as published; an independent reference for the integer form. */
function referenceMulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('REQ-063 source spec §8.1 — randomizer', () => {
  it('REQ-008 rngNext is mulberry32 in 32-bit integer maths (matches the reference float form)', () => {
    for (const seed of [0, 1, 42, 12_345, 0x7fffffff, 0xffffffff]) {
      const reference = referenceMulberry32(seed);
      let state = seedRng(seed);
      for (let i = 0; i < 50; i += 1) {
        const step = rngNext(state);
        expect(step.value).toBe(reference() * TWO_32);
        expect(Number.isInteger(step.value)).toBe(true);
        expect(step.value).toBeGreaterThanOrEqual(0);
        expect(step.value).toBeLessThan(TWO_32);
        expect(Number.isInteger(step.state)).toBe(true);
        expect(step.state).toBeGreaterThanOrEqual(0);
        expect(step.state).toBeLessThan(TWO_32);
        state = step.state;
      }
    }
  });

  it('REQ-008 seedRng coerces any number to a uint32 and rngNext is pure', () => {
    expect(seedRng(-1)).toBe(0xffffffff);
    expect(seedRng(TWO_32 + 5)).toBe(5);
    expect(seedRng(7)).toBe(7);
    expect(rngNext(99)).toEqual(rngNext(99));
  });

  it('REQ-008 createRng is the stateful form of the same sequence', () => {
    const next = createRng(678);
    let state = seedRng(678);
    for (let i = 0; i < 20; i += 1) {
      const step = rngNext(state);
      expect(next()).toBe(step.value);
      state = step.state;
    }
  });

  it('REQ-008 rngInt draws uniformly in [0, n) by rejection sampling', () => {
    let state = seedRng(3);
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 7000; i += 1) {
      const step = rngInt(state, 7);
      expect(Number.isInteger(step.value)).toBe(true);
      counts[step.value] = (counts[step.value] ?? 0) + 1;
      state = step.state;
    }
    for (const count of counts) expect(count).toBeGreaterThan(850);
    expect(rngInt(5, 1).value).toBe(0);
    expect(rngInt(5, TWO_32)).toEqual(rngNext(5));
  });

  it('REQ-008 rngInt rejects draws at or above the largest multiple of n and redraws', () => {
    const n = 2 ** 31 + 1; // limit = 2^32 - (2^32 mod n) = n, so about half of all draws are rejected
    let seed = 0;
    while (rngNext(seed).value < n) seed += 1;
    let expected = rngNext(seed);
    let draws = 1;
    while (expected.value >= n) {
      expected = rngNext(expected.state);
      draws += 1;
    }
    expect(draws).toBeGreaterThan(1);
    expect(rngInt(seed, n)).toEqual({ value: expected.value % n, state: expected.state });
  });

  it('REQ-008 rngInt rejects a range outside 1..2^32', () => {
    expect(() => rngInt(1, 0)).toThrow(RangeError);
    expect(() => rngInt(1, 2.5)).toThrow(RangeError);
    expect(() => rngInt(1, TWO_32 + 1)).toThrow(RangeError);
  });

  it('REQ-008 #29 every bag-aligned group of 7 holds all 7 pieces exactly once (100 bags)', () => {
    for (const seed of [1, 2, 12_345, 0xdeadbeef]) {
      const { pieces } = drawPieces(createBag(seed), 700);
      expect(pieces).toHaveLength(700);
      for (let start = 0; start < 700; start += 7) {
        expect([...pieces.slice(start, start + 7)].sort()).toEqual([...PIECE_KINDS].sort());
      }
    }
  });

  it('REQ-008 #30 the same seed yields the identical first 1,000 pieces; different seeds differ', () => {
    const a = drawPieces(createBag(12_345), 1000).pieces;
    const b = drawPieces(createBag(12_345), 1000).pieces;
    expect(a).toEqual(b);
    const sequences = [1, 2, 3, 12_346].map((seed) => drawPieces(createBag(seed), 1000).pieces);
    for (const other of sequences) expect(other).not.toEqual(a);
    expect(sequences[0]).not.toEqual(sequences[1]);
  });

  it('REQ-008 the bag is a Fisher–Yates shuffle of PIECE_KINDS with j = rngInt(state, i + 1), i = 6..1', () => {
    const reference: PieceKind[] = [...PIECE_KINDS];
    let state = seedRng(2024);
    for (let i = reference.length - 1; i >= 1; i -= 1) {
      const step = rngInt(state, i + 1);
      state = step.state;
      const a = reference[i];
      const b = reference[step.value];
      if (a === undefined || b === undefined) throw new Error('index out of range');
      reference[i] = b;
      reference[step.value] = a;
    }
    const drawn = drawPieces(createBag(2024), 7);
    expect(drawn.pieces).toEqual(reference);
    expect(drawn.bag).toEqual({ rng: state, remaining: [] });
  });

  it('REQ-008 drawing is pure: the same bag always yields the same piece and is never mutated', () => {
    const bag = deepFreeze(createBag(77));
    expect(bag).toEqual({ rng: 77, remaining: [] });
    const first = drawPiece(bag);
    const again = drawPiece(bag);
    expect(again).toEqual(first);
    expect(first.bag.remaining).toHaveLength(6);
    const frozen = deepFreeze(first.bag);
    const second = drawPiece(frozen);
    expect(second.bag.remaining).toEqual(frozen.remaining.slice(1));
    expect(second.bag.rng).toBe(frozen.rng);
    expect(drawPieces(bag, 0)).toEqual({ pieces: [], bag });
    expect(() => drawPieces(bag, -1)).toThrow(RangeError);
  });
});
