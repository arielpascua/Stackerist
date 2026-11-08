import type { Action, GarbageAttack, PieceKind, Rotation } from '@stackerist/engine';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  InputMessage,
  WireAction,
  WireGarbageAttack,
  WirePieceKind,
  WireRotation,
} from '../src/index.js';
import type { Same, WireMatchesEngine } from '../src/typeAssertions.js';

describe('REQ-045 the wire types match the engine types (compile-time, typeAssertions.ts)', () => {
  it('REQ-045 Same<> holds for every wire/engine pair', () => {
    const checks: WireMatchesEngine = [true, true, true, true, true, true, true, true];
    expect(checks.every(Boolean)).toBe(true);
    expectTypeOf<WireAction['type']>().toEqualTypeOf<Action['type']>();
    expectTypeOf<WirePieceKind>().toEqualTypeOf<PieceKind>();
    expectTypeOf<WireRotation>().toEqualTypeOf<Rotation>();
    expectTypeOf<WireGarbageAttack>().toEqualTypeOf<{ rows: number; holeColumn: number }>();
    expectTypeOf<keyof InputMessage>().toEqualTypeOf<'type' | 'seq' | 'tick' | 'action'>();
    const garbage: Same<WireGarbageAttack, GarbageAttack> = true;
    expect(garbage).toBe(true);
  });

  it('REQ-045 Same<> is not vacuous: it rejects each kind of drift', () => {
    // Each line below must be a compile error; `pnpm typecheck` fails if Same<> ever accepts one.
    // @ts-expect-error an extra action type
    const extraAction: Same<WireAction | { type: 'hold' }, Action> = true;
    // @ts-expect-error a missing piece kind
    const missingPiece: Same<Exclude<WirePieceKind, 'L'>, PieceKind> = true;
    // @ts-expect-error a widened rotation
    const widened: Same<number, Rotation> = true;
    // @ts-expect-error an extra field on the attack
    const extraField: Same<WireGarbageAttack & { seed: number }, GarbageAttack> = true;
    expect([extraAction, missingPiece, widened, extraField]).toHaveLength(4);
  });
});
