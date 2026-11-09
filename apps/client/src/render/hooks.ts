/**
 * `DATA_HOOKS`: the canvas `data-*` attributes the renderer keeps current (architecture §5.5, §7.4).
 * This file is their only definition; e2e imports it and reads canvas state through these attributes
 * instead of judging pixels. Values are written when they change, not every frame.
 *
 * On each board canvas (`left`, `right`):
 * - `data-active`: the falling piece as `kind:rotation:x:y` (box origin, cells), '' when there is none
 * - `data-ghost`: the ghost piece in the same form, '' when none is drawn
 * - `data-next`: the preview letters, next first ('' when empty)
 * - `data-combo`: the combo count
 * - `data-danger`: 'true' | 'false' (stack height + pending ≥ the danger rows)
 * - `data-pending`: pending garbage rows
 * - `data-fx`: effects running on this board now (flashes + nudges)
 * - `data-flash-count`, `data-nudge-count`: effects started on this board since the arena mounted
 * On the fx canvas:
 * - `data-fx`: effects running on the fx canvas now
 * - `data-projectile-count`: projectiles launched since the arena mounted
 */
import type { ActivePiece } from '@stackerist/engine';
import type { BoardModel } from '../game/contract.ts';

export const DATA_HOOKS = {
  active: 'data-active',
  ghost: 'data-ghost',
  next: 'data-next',
  combo: 'data-combo',
  danger: 'data-danger',
  pending: 'data-pending',
  fx: 'data-fx',
  flashCount: 'data-flash-count',
  nudgeCount: 'data-nudge-count',
  projectileCount: 'data-projectile-count',
} as const;

export type DataHook = (typeof DATA_HOOKS)[keyof typeof DATA_HOOKS];
export type HookValues = Partial<Record<DataHook, string>>;

/** `kind:rotation:x:y`, or '' for no piece. */
export function pieceHook(piece: ActivePiece | null): string {
  return piece === null
    ? ''
    : `${piece.kind}:${String(piece.rotation)}:${String(piece.x)}:${String(piece.y)}`;
}

export interface BoardEffectCounts {
  readonly active: number;
  readonly flashes: number;
  readonly nudges: number;
}

/** Every board-canvas hook for one board (an empty seat reads as an empty board). */
export function boardHookValues(model: BoardModel | null, fx: BoardEffectCounts): HookValues {
  return {
    [DATA_HOOKS.active]: pieceHook(model?.active ?? null),
    [DATA_HOOKS.ghost]: pieceHook(model?.ghost ?? null),
    [DATA_HOOKS.next]: (model?.next ?? []).join(''),
    [DATA_HOOKS.combo]: String(model?.combo ?? 0),
    [DATA_HOOKS.danger]: String(model?.danger ?? false),
    [DATA_HOOKS.pending]: String(model?.pendingGarbage ?? 0),
    [DATA_HOOKS.fx]: String(fx.active),
    [DATA_HOOKS.flashCount]: String(fx.flashes),
    [DATA_HOOKS.nudgeCount]: String(fx.nudges),
  };
}

/** The fx-canvas hooks. */
export function fxHookValues(activeFx: number, projectilesLaunched: number): HookValues {
  return {
    [DATA_HOOKS.fx]: String(activeFx),
    [DATA_HOOKS.projectileCount]: String(projectilesLaunched),
  };
}

export interface AttributeTarget {
  setAttribute(name: string, value: string): void;
}

/** Writes hook attributes to one element, touching the DOM only for values that changed. */
export class HookWriter {
  readonly #target: AttributeTarget;
  readonly #written = new Map<string, string>();

  constructor(target: AttributeTarget) {
    this.#target = target;
  }

  write(values: HookValues): void {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined || this.#written.get(name) === value) continue;
      this.#written.set(name, value);
      this.#target.setAttribute(name, value);
    }
  }
}
