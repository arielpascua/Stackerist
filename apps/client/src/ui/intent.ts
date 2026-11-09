/**
 * What the user last asked the store to do. The store answers asynchronously (`created`, `joined`,
 * `error`), and the UI needs the question to place the answer: a ROOM_NOT_FOUND after a rejoin reads
 * "your seat expired", after a join "there's no game with that code". A tiny external store, so React
 * reads it with useSyncExternalStore.
 */
import type { RoomCode } from '@stackerist/protocol';

export type Intent =
  | { readonly kind: 'idle' }
  | { readonly kind: 'create' }
  | { readonly kind: 'join'; readonly code: RoomCode; readonly asSpectator: boolean }
  | { readonly kind: 'resume'; readonly code: RoomCode };

export type IntentKind = Intent['kind'];

const IDLE: Intent = { kind: 'idle' };

export class IntentStore {
  #intent: Intent = IDLE;
  readonly #listeners = new Set<() => void>();

  readonly get = (): Intent => this.#intent;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  set(intent: Intent): void {
    if (intent === this.#intent) return;
    this.#intent = intent;
    for (const listener of this.#listeners) listener();
  }

  reset(): void {
    this.set(IDLE);
  }
}

/** The code an intent is about, if any. */
export function intentCode(intent: Intent): RoomCode | null {
  return intent.kind === 'join' || intent.kind === 'resume' ? intent.code : null;
}
