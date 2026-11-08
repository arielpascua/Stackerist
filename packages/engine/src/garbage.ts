/**
 * Attack maths, cancelling and incoming garbage (design §5.2–5.3, source spec §3.8).
 */
import { BOARD_WIDTH, COMBO_BONUS_CAP, LINE_ATTACK } from './config.js';
import type { GarbageAttack, PlayerState } from './types.js';

/** min(COMBO_BONUS_CAP, floor(combo / 2)): c1:0, c2:1, c3:1, c4:2, c5:2, c6:3, c7:3, c8+:4. */
export function comboBonus(combo: number): number {
  return Math.min(COMBO_BONUS_CAP, Math.max(0, Math.floor(combo / 2)));
}

/** LINE_ATTACK[linesCleared] + comboBonus(combo). Throws RangeError unless linesCleared is 0..4. */
export function attackFor(linesCleared: number, combo: number): number {
  const base = Number.isInteger(linesCleared) ? LINE_ATTACK[linesCleared] : undefined;
  if (base === undefined) {
    throw new RangeError(`Lines cleared must be 0..4, got ${String(linesCleared)}.`);
  }
  return base + comboBonus(combo);
}

/** Total rows across all pending attacks. */
export function pendingTotal(pending: readonly GarbageAttack[]): number {
  return pending.reduce((sum, attack) => sum + attack.rows, 0);
}

/**
 * Spends `attack` on the pending garbage, oldest first. A partly cancelled entry keeps its holeColumn
 * and its remaining rows. `leftover` is what is left to send to the opponent.
 */
export function cancelGarbage(
  pending: readonly GarbageAttack[],
  attack: number,
): {
  readonly pending: readonly GarbageAttack[];
  readonly cancelled: number;
  readonly leftover: number;
} {
  if (attack <= 0) return { pending, cancelled: 0, leftover: 0 };
  let left = attack;
  const kept: GarbageAttack[] = [];
  for (const entry of pending) {
    if (left >= entry.rows) {
      left -= entry.rows;
    } else if (left > 0) {
      kept.push({ rows: entry.rows - left, holeColumn: entry.holeColumn });
      left = 0;
    } else {
      kept.push(entry);
    }
  }
  const cancelled = attack - left;
  return { pending: cancelled === 0 ? pending : kept, cancelled, leftover: left };
}

/**
 * Appends an incoming attack to pendingGarbage and counts it in garbageReceived.
 * No-op (same reference) when toppedOut. Throws RangeError for rows < 1 or a hole outside 0..9.
 */
export function receiveGarbage(state: PlayerState, attack: GarbageAttack): PlayerState {
  if (state.toppedOut) return state;
  const { rows, holeColumn } = attack;
  if (!Number.isInteger(rows) || rows < 1) {
    throw new RangeError(`Garbage rows must be an integer ≥ 1, got ${String(rows)}.`);
  }
  if (!Number.isInteger(holeColumn) || holeColumn < 0 || holeColumn >= BOARD_WIDTH) {
    throw new RangeError(
      `Hole column must be 0..${String(BOARD_WIDTH - 1)}, got ${String(holeColumn)}.`,
    );
  }
  return {
    ...state,
    pendingGarbage: [...state.pendingGarbage, { rows, holeColumn }],
    garbageReceived: state.garbageReceived + rows,
  };
}
