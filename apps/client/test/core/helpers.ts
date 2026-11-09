/** DOM-free test doubles for CORE (Vitest `environment: 'node'`, architecture §8.1 decision 42). */
import type { Timers } from '../../src/game/timers.ts';
import type { TokenStorage } from '../../src/net/session.ts';

/** A hand-driven clock and timer queue: `advance(ms)` runs every timer due by then, in order. */
export class ManualTimers implements Timers {
  now = 0;
  #nextHandle = 1;
  #queue = new Map<number, { readonly at: number; readonly fn: () => void }>();

  set(fn: () => void, ms: number): number {
    const handle = this.#nextHandle;
    this.#nextHandle += 1;
    this.#queue.set(handle, { at: this.now + ms, fn });
    return handle;
  }

  clear(handle: number): void {
    this.#queue.delete(handle);
  }

  get pending(): number {
    return this.#queue.size;
  }

  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      let due: { handle: number; at: number; fn: () => void } | null = null;
      for (const [handle, timer] of this.#queue) {
        if (timer.at <= end && (due === null || timer.at < due.at)) {
          due = { handle, at: timer.at, fn: timer.fn };
        }
      }
      if (due === null) break;
      this.#queue.delete(due.handle);
      this.now = due.at;
      due.fn();
    }
    this.now = end;
  }
}

/** An in-memory Web Storage stand-in; `failing` makes every call throw like a blocked storage. */
export class MemoryStorage implements TokenStorage {
  readonly map = new Map<string, string>();
  failing = false;

  getItem(key: string): string | null {
    if (this.failing) throw new Error('blocked');
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failing) throw new Error('blocked');
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    if (this.failing) throw new Error('blocked');
    this.map.delete(key);
  }
}

/** A valid 22-character base64url seat token. */
export const TOKEN = 'abcdefghijklmnopqrstuv';
export const OTHER_TOKEN = 'ABCDEFGHIJKLMNOPQRSTUV';
