/**
 * Device checks for the keyboard-needed warning (REQ-058, DESIGN.md "Keyboard-needed warning").
 * Touch-only means no fine pointer and no hover on any input. The first trusted `keydown` proves a
 * keyboard; that proof lives in memory only and is never stored.
 */

export interface PointerCapabilities {
  /** Some input is a fine pointer (mouse, trackpad, pen). */
  readonly finePointer: boolean;
  /** Some input can hover. */
  readonly hover: boolean;
}

export function isTouchOnly(capabilities: PointerCapabilities): boolean {
  return !capabilities.finePointer && !capabilities.hover;
}

export function readPointerCapabilities(win: Window): PointerCapabilities {
  return {
    finePointer: win.matchMedia('(any-pointer: fine)').matches,
    hover: win.matchMedia('(any-hover: hover)').matches,
  };
}

/** Only a physical, trusted key press counts; repeats and synthetic events do not. */
export function isKeyboardProof(event: { readonly isTrusted: boolean; readonly repeat: boolean }) {
  return event.isTrusted && !event.repeat;
}

/** Remembers, for this page load only, that a physical key was pressed. */
export class KeyboardProof {
  #proven = false;
  readonly #listeners = new Set<() => void>();

  get proven(): boolean {
    return this.#proven;
  }

  /** Records a key press; returns true when this press is the one that proved the keyboard. */
  record(event: { readonly isTrusted: boolean; readonly repeat: boolean }): boolean {
    if (this.#proven || !isKeyboardProof(event)) return false;
    this.#proven = true;
    for (const listener of this.#listeners) listener();
    return true;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Listens on the window (capture phase) until the keyboard is proven. */
  attach(win: Window): () => void {
    const onKeyDown = (event: KeyboardEvent) => {
      if (this.record(event)) win.removeEventListener('keydown', onKeyDown, true);
    };
    if (this.#proven) return () => undefined;
    win.addEventListener('keydown', onKeyDown, true);
    return () => win.removeEventListener('keydown', onKeyDown, true);
  }
}

/** macOS (and iPadOS with a keyboard) has no Ctrl rotate; the legend shows Z only. */
export function isApplePlatform(platform: string, userAgent: string): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform !== '' ? platform : userAgent);
}
