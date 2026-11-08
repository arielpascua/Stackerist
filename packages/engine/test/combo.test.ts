import { describe, expect, it } from 'vitest';
import {
  COMBO_BONUS_CAP,
  LINE_ATTACK,
  attackFor,
  comboBonus,
  createBag,
  createPlayerState,
  playerStats,
  type EngineEvent,
} from '../src/index.js';
import { I_FLAT_RIGHT, boardOf, dropAt, oAt, singleMachine } from './helpers.js';

function eventsOf<T extends EngineEvent['type']>(
  events: readonly EngineEvent[],
  type: T,
): Extract<EngineEvent, { type: T }>[] {
  return events.filter((event): event is Extract<EngineEvent, { type: T }> => event.type === type);
}

describe('REQ-064 combo counting and the combo bonus', () => {
  it('REQ-013 combo rises by one on every clearing lock and resets to 0 on a non-clearing lock', () => {
    let state = createPlayerState({ board: boardOf(...singleMachine(3)), bag: createBag(2) });
    expect(state.combo).toBe(0);

    let step = dropAt(state, I_FLAT_RIGHT);
    expect(eventsOf(step.events, 'combo')).toEqual([{ type: 'combo', count: 1 }]);
    expect(step.state.combo).toBe(1);
    state = step.state;

    step = dropAt(state, I_FLAT_RIGHT);
    expect(eventsOf(step.events, 'combo')).toEqual([{ type: 'combo', count: 2 }]);
    expect(step.state.combo).toBe(2);
    state = step.state;

    step = dropAt(state, oAt(0)); // clears nothing
    expect(eventsOf(step.events, 'combo')).toEqual([]);
    expect(step.state.combo).toBe(0);
    state = step.state;

    step = dropAt(state, I_FLAT_RIGHT);
    expect(eventsOf(step.events, 'combo')).toEqual([{ type: 'combo', count: 1 }]);
    expect(step.state.combo).toBe(1);
    expect(step.state.bestCombo).toBe(2);
    expect(playerStats(step.state).bestCombo).toBe(2);
  });

  it('REQ-014 combo bonus: c1..c8+ = 0,1,1,2,2,3,3,4 (min(4, floor(c / 2)))', () => {
    const table = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 4]; // index = combo count (c0..c11)
    table.forEach((bonus, combo) => {
      expect(comboBonus(combo), `c${String(combo)}`).toBe(bonus);
    });
    expect(comboBonus(100)).toBe(COMBO_BONUS_CAP);
    expect(comboBonus(-3)).toBe(0);
  });

  it('REQ-014 attack = line attack (1→0, 2→1, 3→2, 4→4) + combo bonus, for every lines/combo pair', () => {
    for (let lines = 1; lines <= 4; lines += 1) {
      for (let combo = 1; combo <= 10; combo += 1) {
        expect(attackFor(lines, combo)).toBe(
          (LINE_ATTACK[lines] ?? Number.NaN) + Math.min(4, Math.floor(combo / 2)),
        );
      }
    }
    expect(attackFor(4, 8)).toBe(8);
    expect(attackFor(0, 0)).toBe(0);
    expect(() => attackFor(5, 1)).toThrow(RangeError);
    expect(() => attackFor(-1, 1)).toThrow(RangeError);
    expect(() => attackFor(1.5, 1)).toThrow(RangeError);
  });

  it('REQ-014 a chain of nine singles attacks 0,1,1,2,2,3,3,4,4 — every step of the bonus table', () => {
    let state = createPlayerState({ board: boardOf(...singleMachine(9)), bag: createBag(11) });
    const perLock: number[] = [];
    for (let lock = 1; lock <= 9; lock += 1) {
      const step = dropAt(state, I_FLAT_RIGHT);
      expect(eventsOf(step.events, 'combo')).toEqual([{ type: 'combo', count: lock }]);
      perLock.push(eventsOf(step.events, 'attack').reduce((sum, event) => sum + event.rows, 0));
      state = step.state;
    }
    expect(perLock).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(state.garbageSent).toBe(20);
    expect(state.linesCleared).toBe(9);
    expect(state.bestCombo).toBe(9);
  });
});
