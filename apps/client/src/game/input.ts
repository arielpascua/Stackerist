/**
 * The pure keyboard core (REQ-053, architecture §5.4): key codes → engine actions, with our own DAS/ARR.
 * No DOM here; `keyboard.ts` feeds it window key events and `timers` drives the repeat.
 *
 * - ← / → move once on press, again after DAS, then every ARR; the last-pressed direction wins, and
 *   releasing it hands back to a still-held direction after a fresh DAS.
 * - ↑ / X rotate clockwise; Z / Ctrl rotate counter-clockwise; Space hard-drops: once per press.
 * - ↓ sends softDropStart on press and softDropStop on release and on window blur.
 * - `repeat` key events (the OS's auto-repeat) are ignored.
 * - While disabled (input not live) presses are dropped, not queued. A soft drop that was started and
 *   then released while disabled is stopped as soon as input is live again.
 * - A new round starts from a fresh engine state (no soft drop): a ↓ that stays held across the round
 *   boundary sends softDropStart again when input goes live; one released meanwhile owes nothing.
 */
import type { Action } from '@stackerist/engine';
import type { Timers } from './timers.ts';

/** Delayed auto shift: hold time before a held arrow starts repeating, ms (REQ-053). */
export const DAS_MS = 170;
/** Auto-repeat rate: interval between repeated moves once DAS has elapsed, ms (REQ-053). */
export const ARR_MS = 50;

export type GameKey = 'moveLeft' | 'moveRight' | 'rotateCW' | 'rotateCCW' | 'softDrop' | 'hardDrop';
type Direction = 'moveLeft' | 'moveRight';

/** `KeyboardEvent.code` → game key: physical keys, so the bindings survive keyboard layouts. */
const KEY_BINDINGS: ReadonlyMap<string, GameKey> = new Map<string, GameKey>([
  ['ArrowLeft', 'moveLeft'],
  ['ArrowRight', 'moveRight'],
  ['ArrowUp', 'rotateCW'],
  ['KeyX', 'rotateCW'],
  ['KeyZ', 'rotateCCW'],
  ['ControlLeft', 'rotateCCW'],
  ['ControlRight', 'rotateCCW'],
  ['ArrowDown', 'softDrop'],
  ['Space', 'hardDrop'],
]);

export function gameKeyForCode(code: string): GameKey | null {
  return KEY_BINDINGS.get(code) ?? null;
}

function isDirection(key: GameKey): key is Direction {
  return key === 'moveLeft' || key === 'moveRight';
}

export interface InputControllerOptions {
  readonly emit: (action: Action) => void;
  readonly timers: Timers;
}

export class InputController {
  readonly #emit: (action: Action) => void;
  readonly #timers: Timers;
  #enabled = false;
  /** Directions pressed while enabled and still held, oldest first; the last one is active. */
  #directions: Direction[] = [];
  #repeatTimer: number | null = null;
  /** ↓ is physically down (tracked even while disabled). */
  #downHeld = false;
  /** We sent softDropStart and still owe a softDropStop. */
  #softDropOn = false;
  /** A new round began while ↓ was held and a soft drop was on: start it again at the next go. */
  #restartSoftDrop = false;

  constructor(options: InputControllerOptions) {
    this.#emit = options.emit;
    this.#timers = options.timers;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  keyDown(code: string, repeat: boolean): void {
    const key = gameKeyForCode(code);
    if (key === null) return;
    if (key === 'softDrop') this.#downHeld = true;
    if (repeat || !this.#enabled) return;
    if (isDirection(key)) {
      this.#directions = [...this.#directions.filter((d) => d !== key), key];
      this.#emit({ type: key });
      this.#startRepeat(key);
    } else if (key === 'softDrop') {
      if (!this.#softDropOn) {
        this.#softDropOn = true;
        this.#emit({ type: 'softDropStart' });
      }
    } else {
      this.#emit({ type: key });
    }
  }

  keyUp(code: string): void {
    const key = gameKeyForCode(code);
    if (key === null) return;
    if (key === 'softDrop') {
      this.#downHeld = false;
      this.#restartSoftDrop = false;
      this.#stopSoftDropIfOwed();
      return;
    }
    if (!isDirection(key) || !this.#directions.includes(key)) return;
    const wasActive = this.#directions.at(-1) === key;
    this.#directions = this.#directions.filter((d) => d !== key);
    if (!wasActive) return;
    this.#cancelRepeat();
    const next = this.#directions.at(-1);
    if (next !== undefined) this.#startRepeat(next);
  }

  /** Window blur: every key counts as released. */
  blur(): void {
    this.#cancelRepeat();
    this.#directions = [];
    this.#downHeld = false;
    this.#restartSoftDrop = false;
    this.#stopSoftDropIfOwed();
  }

  /**
   * A new round's countdown arrived: its engine state has no soft drop, so none is owed a stop, and a
   * ↓ still held (with a soft drop on) is started again when input goes live.
   */
  newRound(): void {
    this.#restartSoftDrop = this.#softDropOn && this.#downHeld;
    this.#softDropOn = false;
  }

  /** Input goes live (the DUEL! frame) or stops (pause, round end, unmount). */
  setEnabled(enabled: boolean): void {
    if (enabled === this.#enabled) return;
    this.#enabled = enabled;
    if (!enabled) {
      this.#cancelRepeat();
      this.#directions = [];
      return;
    }
    if (!this.#downHeld) this.#stopSoftDropIfOwed();
    if (this.#restartSoftDrop) {
      this.#softDropOn = true;
      this.#emit({ type: 'softDropStart' });
    }
    this.#restartSoftDrop = false;
  }

  #stopSoftDropIfOwed(): void {
    if (this.#softDropOn && this.#enabled) {
      this.#softDropOn = false;
      this.#emit({ type: 'softDropStop' });
    }
  }

  #startRepeat(direction: Direction): void {
    this.#cancelRepeat();
    this.#repeatTimer = this.#timers.set(() => {
      this.#repeat(direction);
    }, DAS_MS);
  }

  #repeat(direction: Direction): void {
    this.#repeatTimer = null;
    if (!this.#enabled || this.#directions.at(-1) !== direction) return;
    this.#emit({ type: direction });
    this.#repeatTimer = this.#timers.set(() => {
      this.#repeat(direction);
    }, ARR_MS);
  }

  #cancelRepeat(): void {
    if (this.#repeatTimer !== null) {
      this.#timers.clear(this.#repeatTimer);
      this.#repeatTimer = null;
    }
  }
}
