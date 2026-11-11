/**
 * Gaps found by mutation testing (gate 10a, Stryker): each test pins a behaviour that a mutant of the
 * protocol source could change without any earlier test noticing. Titles carry the REQ id they protect.
 * Characters that are invisible, combining or compatibility forms are built with String.fromCodePoint.
 */
import { PREVIEW_COUNT, createBag, createPlayerState } from '@stackerist/engine';
import type { ActionType, StampedInput } from '@stackerist/engine';
import { describe, expect, it } from 'vitest';
import {
  BoardSchema,
  JoinMessageSchema,
  JoinedMessageSchema,
  NameSchema,
  OwnViewSchema,
  Predictor,
  SeriesViewSchema,
  TICK_SAMPLE_WINDOW,
  TickEstimator,
  WireBestMomentSchema,
  WireCellSchema,
  gamePath,
  toOwnView,
  tokenStorageKey,
  type ClockAnchor,
} from '../src/index.js';
import { BEST_MOMENT, SERIES_IN_PROGRESS } from './fixtures.js';

const cp = (...points: number[]): string => String.fromCodePoint(...points);

function messages(result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}): string[] {
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

describe('mutation gaps: names (REQ-044)', () => {
  it('REQ-044 an empty name is refused with the length rule only, not also "no letter or digit"', () => {
    const result = NameSchema.safeParse('');
    expect(result.success).toBe(false);
    const all = messages(result);
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((m) => /letter or digit/.test(m))).toBe(false);
    // Whitespace-only trims to the same empty name.
    expect(messages(NameSchema.safeParse('   ')).some((m) => /letter or digit/.test(m))).toBe(
      false,
    );
  });

  it('REQ-044 a name with no letter or digit says so', () => {
    expect(messages(NameSchema.safeParse('...'))).toContain(
      'A name needs at least one letter or digit',
    );
    expect(messages(NameSchema.safeParse('?!'))).toContain(
      'A name needs at least one letter or digit',
    );
    expect(NameSchema.safeParse('a.').success).toBe(true);
  });

  it('REQ-044 a refused character class says what a name is (stage one: as typed)', () => {
    const emoji = NameSchema.safeParse(`a${cp(0x1f600)}`);
    expect(messages(emoji).join('|')).toMatch(/readable text: letters, numbers and punctuation/);
    const bidi = NameSchema.safeParse(`a${cp(0x202e)}b`);
    expect(messages(bidi).join('|')).toMatch(/readable text/);
  });

  it('REQ-044 a name that only becomes refusable after NFKC (second stage) is refused with the same message', () => {
    // U+0344 canonically decomposes to U+0308 U+0301: two marks as typed (allowed), four after NFKC (refused).
    const stacked = `a${cp(0x344, 0x344)}`;
    const result = NameSchema.safeParse(stacked);
    expect(result.success).toBe(false);
    expect(messages(result).join('|')).toMatch(/readable text: letters, numbers and punctuation/);
  });

  it('REQ-044 the NFKC form is trimmed again: a compatibility space that normalizes to a blank edge does not survive', () => {
    // U+00A8 DIAERESIS compatibility-decomposes to U+0020 U+0308; the leading space must be trimmed off.
    const parsed = NameSchema.parse(`${cp(0xa8)}a`);
    expect(Array.from(parsed, (ch) => ch.codePointAt(0))).toEqual([0x308, 0x61]);
  });
});

describe('mutation gaps: wire shapes', () => {
  it('REQ-012 BoardSchema accepts exactly 20 rows of 10 characters from . I O T S Z J L G', () => {
    const row = '.IOTSZJLG.';
    const ok = Array.from({ length: 20 }, () => row);
    expect(BoardSchema.safeParse(ok).success).toBe(true);
    const withRow = (value: string): string[] => [value, ...ok.slice(1)];
    for (const bad of [
      '.........x',
      '.........t', // lowercase piece letter
      '......... ', // a space
      '.........!',
      '.........S'.replace('S', 'Q'),
      '.........', // 9 characters
      '...........', // 11 characters
      '',
    ]) {
      expect(BoardSchema.safeParse(withRow(bad)).success, JSON.stringify(bad)).toBe(false);
    }
    expect(BoardSchema.safeParse(ok.slice(1)).success).toBe(false); // 19 rows
    expect(BoardSchema.safeParse([...ok, row]).success).toBe(false); // 21 rows
  });

  it('REQ-001 a wire cell is a column 0..9 and a row 0..19, nothing outside', () => {
    expect(WireCellSchema.safeParse({ x: 9, y: 19 }).success).toBe(true);
    expect(WireCellSchema.safeParse({ x: 0, y: 0 }).success).toBe(true);
    for (const bad of [
      { x: 10, y: 0 },
      { x: 11, y: 0 },
      { x: 0, y: 20 },
      { x: 0, y: 21 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
    ]) {
      expect(WireCellSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('REQ-051 a best moment clears 1..4 rows: five is refused for linesCleared and for clearedRows', () => {
    expect(WireBestMomentSchema.safeParse(BEST_MOMENT).success).toBe(true);
    expect(WireBestMomentSchema.safeParse({ ...BEST_MOMENT, linesCleared: 4 }).success).toBe(true);
    expect(WireBestMomentSchema.safeParse({ ...BEST_MOMENT, linesCleared: 5 }).success).toBe(false);
    expect(WireBestMomentSchema.safeParse({ ...BEST_MOMENT, linesCleared: 0 }).success).toBe(false);
    expect(
      WireBestMomentSchema.safeParse({ ...BEST_MOMENT, clearedRows: [16, 17, 18, 19] }).success,
    ).toBe(true);
    expect(
      WireBestMomentSchema.safeParse({ ...BEST_MOMENT, clearedRows: [15, 16, 17, 18, 19] }).success,
    ).toBe(false);
  });

  it('REQ-083 a series view has winner and endReason set exactly when it is over, and says so', () => {
    expect(SeriesViewSchema.safeParse(SERIES_IN_PROGRESS).success).toBe(true);
    const over = { ...SERIES_IN_PROGRESS, over: true, winner: 'A', endReason: 'TWO_WINS' };
    expect(SeriesViewSchema.safeParse(over).success).toBe(true);
    const bad = [
      { ...over, endReason: null }, // winner without a reason
      { ...over, winner: null }, // reason without a winner
      { ...SERIES_IN_PROGRESS, endReason: 'TWO_WINS' }, // reason while still live
      { ...SERIES_IN_PROGRESS, winner: 'B' }, // winner while still live
    ];
    for (const view of bad) {
      const result = SeriesViewSchema.safeParse(view);
      expect(result.success, JSON.stringify(view)).toBe(false);
      expect(messages(result)).toContain(
        'winner and endReason are set exactly when the series is over',
      );
    }
  });

  it('REQ-044 join needs a name unless it is a spectator join, and says so', () => {
    const noName = JoinMessageSchema.safeParse({ type: 'join', code: 'ABC234' });
    expect(noName.success).toBe(false);
    expect(messages(noName)).toContain('name is required unless asSpectator is true');
    expect(
      JoinMessageSchema.safeParse({ type: 'join', code: 'ABC234', asSpectator: true }).success,
    ).toBe(true);
    expect(JoinMessageSchema.safeParse({ type: 'join', code: 'ABC234', name: 'Ann' }).success).toBe(
      true,
    );
  });

  it('REQ-024 a joined message for a spectator carries no token, and says so', () => {
    const token = 'A'.repeat(22);
    const spectator = JoinedMessageSchema.safeParse({
      type: 'joined',
      code: 'ABC234',
      seat: 'spectator',
      token,
    });
    expect(spectator.success).toBe(false);
    expect(messages(spectator)).toContain('a spectator gets no token');
    expect(
      JoinedMessageSchema.safeParse({ type: 'joined', code: 'ABC234', seat: 'spectator' }).success,
    ).toBe(true);
    expect(
      JoinedMessageSchema.safeParse({ type: 'joined', code: 'ABC234', seat: 'A', token }).success,
    ).toBe(true);
  });

  it('REQ-020 code helpers refuse a non-code with a message that says what a room code is', () => {
    expect(() => gamePath('nope')).toThrow(/Not a room code: expected 6 characters/);
    expect(() => tokenStorageKey('0O1I!!')).toThrow(/Not a room code/);
  });
});

describe('mutation gaps: prediction (REQ-054, REQ-082)', () => {
  const wire = (ack: number): ReturnType<typeof OwnViewSchema.parse> => {
    const state = createPlayerState({ bag: createBag(3), tick: 0 });
    expect(state.queue).toHaveLength(PREVIEW_COUNT);
    return OwnViewSchema.parse(JSON.parse(JSON.stringify(toOwnView(state, ack))));
  };
  const stamp = (seq: number, tick: number, type: ActionType): StampedInput => ({
    seq,
    tick,
    action: { type },
  });

  it('REQ-054 display refuses a fractional target tick and says what it expected', () => {
    const p = new Predictor();
    expect(() => p.display(1.5)).toThrow(/targetTick must be an integer match tick, got 1\.5/);
  });

  it('REQ-054 an input added after a tick was already displayed changes the state but never re-delivers events of the past', () => {
    const p = new Predictor();
    p.onOwnSnapshot(wire(0), 0);
    const first = p.display(10);
    expect(first?.newEvents).toEqual([]);
    const x0 = first?.state.active?.x ?? Number.NaN;
    p.addInput(stamp(1, 3, 'moveLeft')); // lands on tick 3: ten ticks were already shown without it
    const second = p.display(10);
    expect(second?.state.active?.x).toBe(x0 - 1);
    expect(second?.newEvents).toEqual([]); // the 'moved' event belongs to tick 3, already past
    // A later tick still delivers its own events once.
    p.addInput(stamp(2, 12, 'moveLeft'));
    const third = p.display(14);
    expect(third?.newEvents.map((e) => e.tick)).toEqual([12]);
  });
});

describe('mutation gaps: tick estimator (REQ-080)', () => {
  function countdown(): ClockAnchor {
    return { startsAt: 1_003_000, serverNow: 1_000_000, tick: 0 };
  }

  it('REQ-080 without an anchor a snapshot is used even at a negative local time', () => {
    const est = new TickEstimator();
    est.observeSnapshot(10, -100);
    // best = (tick 10, recv -100): 10 + floor((50 ms of one-way delay) * 60 / 1000) = 13.
    expect(est.serverTick(-100)).toBe(13);
  });

  it('REQ-080 after an anchor, a snapshot received after go-time drives the estimate (not the anchor formula)', () => {
    const est = new TickEstimator();
    est.anchor(countdown(), 500); // goAt = 3450, anchor-only estimate at 5000 = floor(1550 * 0.06) = 93
    expect(est.serverTick(5000)).toBe(93);
    est.observeSnapshot(100, 4500); // a snapshot says the server is ahead of the anchor's estimate
    expect(est.serverTick(5000)).toBe(100 + Math.floor((550 * 60) / 1000)); // 133
  });

  it('REQ-080 a snapshot received exactly at go-time counts; one a millisecond earlier does not', () => {
    const exact = new TickEstimator();
    exact.anchor(countdown(), 500);
    expect(exact.goAtLocalMs()).toBe(3450);
    exact.observeSnapshot(100, 3450);
    expect(exact.serverTick(3450)).toBe(100 + Math.floor((50 * 60) / 1000)); // 103

    const early = new TickEstimator();
    early.anchor(countdown(), 500);
    early.observeSnapshot(100, 3449);
    expect(early.serverTick(3450)).toBe(0); // still the anchor's estimate
  });

  it('REQ-080 when the least-delayed sample leaves the window, the best of the rest takes over (not the newest, not the oldest)', () => {
    const est = new TickEstimator();
    // Sample k: tick 6k, so tick * 1000 / 60 = 100k exactly; s = recv - 100k.
    // Sample 0 has s = 0 (the least delayed); sample 60 has s = 50; every other one has s = 100.
    const recv = (k: number): number => 100 * k + (k === 0 ? 0 : k === 60 ? 50 : 100);
    for (let k = 0; k <= TICK_SAMPLE_WINDOW; k += 1) est.observeSnapshot(6 * k, recv(k));
    // 121 samples were fed: sample 0 was dropped, so sample 60 is the best of the remaining 120.
    const local = 20_000;
    const expected = 360 + Math.floor(((local - recv(60) + 50) * 60) / 1000);
    expect(est.serverTick(local)).toBe(expected);
  });

  it('REQ-080 the best sample is kept while the window is not yet full', () => {
    const est = new TickEstimator();
    const recv = (k: number): number => 100 * k + (k === 0 ? 0 : 100);
    for (let k = 0; k < TICK_SAMPLE_WINDOW; k += 1) est.observeSnapshot(6 * k, recv(k));
    const local = 20_000;
    expect(est.serverTick(local)).toBe(0 + Math.floor(((local - recv(0) + 50) * 60) / 1000));
  });
});
