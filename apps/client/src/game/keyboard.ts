/**
 * The DOM side of the keyboard (REQ-053, architecture §5.4): window capture listeners that feed the
 * pure `InputController`.
 *
 * - While a round is live, game keys always go to the game and get `preventDefault`, even when focus
 *   is on a HUD button, so Space can never press one and arrows never scroll the page (DESIGN.md).
 * - Keys typed into text fields are ignored.
 * - M toggles music in a room (lobby, game, result), ignoring OS repeat and modifier chords.
 * - Esc is left to the UI (Leave confirm).
 * - Window blur releases every key (softDropStop).
 */
import { gameKeyForCode, type InputController } from './input.ts';

const MUSIC_KEY_CODE = 'KeyM';
const TEXT_ENTRY_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** The part of a KeyboardEvent the binding reads (duck-typed, so tests need no DOM). */
export interface KeyEventLike {
  readonly code: string;
  readonly repeat: boolean;
  readonly target: unknown;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  preventDefault(): void;
}

export interface KeyboardOptions {
  readonly controller: Pick<InputController, 'keyDown' | 'keyUp' | 'blur'>;
  /** True while this player's round is on screen (countdown, playing, paused): game keys are captured. */
  capturingGameKeys(): boolean;
  /** True while M may toggle music (bound to a room: lobby, game or result). */
  musicKeyActive(): boolean;
  onMusicKey(): void;
}

export interface KeyHandlers {
  keydown(event: KeyEventLike): void;
  keyup(event: KeyEventLike): void;
  blur(): void;
}

/** A text field, select or contenteditable element: keys typed there belong to it. */
export function isTextEntryTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const element = target as { readonly tagName?: unknown; readonly isContentEditable?: unknown };
  return (
    (typeof element.tagName === 'string' && TEXT_ENTRY_TAGS.has(element.tagName.toUpperCase())) ||
    element.isContentEditable === true
  );
}

function hasModifier(event: KeyEventLike): boolean {
  return event.ctrlKey === true || event.metaKey === true || event.altKey === true;
}

export function createKeyHandlers(options: KeyboardOptions): KeyHandlers {
  return {
    keydown(event) {
      if (isTextEntryTarget(event.target)) return;
      if (event.code === MUSIC_KEY_CODE) {
        if (!event.repeat && !hasModifier(event) && options.musicKeyActive()) {
          options.onMusicKey();
        }
        return;
      }
      if (gameKeyForCode(event.code) === null) return;
      if (options.capturingGameKeys()) event.preventDefault();
      options.controller.keyDown(event.code, event.repeat);
    },
    keyup(event) {
      if (gameKeyForCode(event.code) === null) return;
      if (options.capturingGameKeys()) event.preventDefault();
      options.controller.keyUp(event.code);
    },
    blur() {
      options.controller.blur();
    },
  };
}

/** The listener surface of `window` that the binding uses. */
export type KeyTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

/** Installs the window listeners (key events in the capture phase); returns the unbind function. */
export function bindKeyboard(target: KeyTarget, handlers: KeyHandlers): () => void {
  const keydown = (event: KeyEventLike): void => {
    handlers.keydown(event);
  };
  const keyup = (event: KeyEventLike): void => {
    handlers.keyup(event);
  };
  const blur = (): void => {
    handlers.blur();
  };
  target.addEventListener('keydown', keydown, true);
  target.addEventListener('keyup', keyup, true);
  target.addEventListener('blur', blur, false);
  return () => {
    target.removeEventListener('keydown', keydown, true);
    target.removeEventListener('keyup', keyup, true);
    target.removeEventListener('blur', blur, false);
  };
}
