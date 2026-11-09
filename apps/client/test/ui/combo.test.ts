import { describe, expect, it } from 'vitest';
import { BANNER_HIDDEN, type BannerState, comboSubline, stepBanner } from '../../src/ui/combo.ts';
import { countdownAnnouncement } from '../../src/ui/screens/game/framePaint.ts';

const timing = { inMs: 160, holdMs: 800, outMs: 200 };
const chain = (sent: number, cancelled: number) => ({ sent, cancelled });

function run(steps: readonly [number, number | null][]): BannerState[] {
  let state = BANNER_HIDDEN;
  return steps.map(([now, combo]) => {
    state = stepBanner(
      state,
      combo === null ? null : { combo, chain: chain(combo, 0) },
      now,
      timing,
    );
    return state;
  });
}

describe('REQ-052 combo banner: shown while a combo is ×2 or more', () => {
  it('REQ-052 stays hidden at combo 0 and 1', () => {
    const states = run([
      [0, 0],
      [16, 1],
      [32, null],
    ]);
    expect(states.map((s) => s.phase)).toEqual(['hidden', 'hidden', 'hidden']);
  });

  it('REQ-052 wipes in at ×2, then shows; a growing combo keeps it shown with the new count', () => {
    const states = run([
      [0, 2],
      [100, 2],
      [170, 2],
      [300, 3],
    ]);
    expect(states.map((s) => s.phase)).toEqual(['in', 'in', 'shown', 'shown']);
    expect(states[3]?.combo).toBe(3);
  });

  it('REQ-052 a broken combo holds the final count, then wipes out, then hides', () => {
    const states = run([
      [0, 4],
      [200, 4],
      [300, 0],
      [1000, 0],
      [1100, 0],
      [1250, 0],
      [1310, 0],
    ]);
    expect(states.map((s) => s.phase)).toEqual([
      'in',
      'shown',
      'hold',
      'hold',
      'out',
      'out',
      'hidden',
    ]);
    expect(states[3]?.combo).toBe(4);
  });

  it('REQ-052 a new chain during the hold wipes in again', () => {
    const states = run([
      [0, 2],
      [200, 2],
      [300, 0],
      [400, 2],
    ]);
    expect(states[3]?.phase).toBe('in');
  });

  it('REQ-052 returns the same object when nothing changed (no DOM writes)', () => {
    const shown = run([
      [0, 2],
      [200, 2],
    ])[1];
    if (shown === undefined) throw new Error('missing state');
    expect(stepBanner(shown, { combo: 2, chain: chain(2, 0) }, 400, timing)).toBe(shown);
  });

  it('REQ-052 the sub-line shows each running total only when above 0', () => {
    expect(comboSubline(3, 1)).toBe('+3 sent · 1 cancelled');
    expect(comboSubline(2, 0)).toBe('+2 sent');
    expect(comboSubline(0, 2)).toBe('2 cancelled');
    expect(comboSubline(0, 0)).toBe('');
  });
});

describe('REQ-050 countdown overlay announcements (polite, four updates)', () => {
  const intro = 'Round 1. Ariel versus Sam.';

  it('REQ-050 announces the round on entry, then each numeral, then Duel!', () => {
    expect(countdownAnnouncement(null, 'dim', intro)).toBe(intro);
    expect(countdownAnnouncement('dim', '3', intro)).toBe('3');
    expect(countdownAnnouncement('3', '2', intro)).toBe('2');
    expect(countdownAnnouncement('2', '1', intro)).toBe('1');
    expect(countdownAnnouncement('1', 'duel', intro)).toBe('Duel!');
  });

  it('REQ-050 joining mid-countdown still hears the round first', () => {
    expect(countdownAnnouncement(null, '2', intro)).toBe(`${intro} 2`);
  });

  it('REQ-050 says nothing when the phase is unchanged or the overlay closes', () => {
    expect(countdownAnnouncement('2', '2', intro)).toBeNull();
    expect(countdownAnnouncement('duel', null, intro)).toBeNull();
  });
});
