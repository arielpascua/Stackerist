/**
 * Compile-time proof that the wire shapes and the engine's types are mutually assignable
 * (architecture §3.7). `pnpm typecheck` fails here the moment either side drifts.
 */
import type {
  Action,
  ActivePiece,
  Cell,
  GarbageAttack,
  PieceKind,
  Rotation,
  StampedInput,
} from '@stackerist/engine';
import type {
  InputMessage,
  WireAction,
  WireActivePiece,
  WireCell,
  WireGarbageAttack,
  WirePieceKind,
  WireRotation,
} from './messages.js';

/**
 * true iff A and B are mutually assignable. Wrapped in tuples so unions aren't distributed. Property
 * `readonly` modifiers don't affect assignability, so they are ignored by design.
 */
export type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** A compile error unless T is exactly `true`. */
type Assert<T extends true> = T;

/** Each entry fails to compile if its pair stops matching. */
export type WireMatchesEngine = [
  Assert<Same<WireAction, Action>>,
  Assert<Same<WireAction['type'], Action['type']>>,
  Assert<Same<WirePieceKind, PieceKind>>,
  Assert<Same<WireRotation, Rotation>>,
  Assert<Same<WireGarbageAttack, GarbageAttack>>,
  Assert<Same<WireActivePiece, ActivePiece>>,
  Assert<Same<WireCell, Cell>>,
  /** `input` carries exactly a StampedInput: seq, tick and action (REQ-036). */
  Assert<Same<Omit<InputMessage, 'type'>, StampedInput>>,
];
