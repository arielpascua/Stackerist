/**
 * What the UI remembers across store updates: the last known name per seat (a player who left is
 * gone from `room.players`, but the series bug still names them) and whether the socket has ever been
 * open (only then does a closed socket mean "connection lost"). Memory only; nothing is stored.
 */
import type { RoomCode, Seat } from '@stackerist/protocol';
import type { ClientState, GameStore } from '../game/contract.ts';

export interface MemorySnapshot {
  readonly code: RoomCode | null;
  readonly names: { readonly A: string | null; readonly B: string | null };
  readonly everOpen: boolean;
}

const EMPTY: MemorySnapshot = { code: null, names: { A: null, B: null }, everOpen: false };

/** The next snapshot for a state; returns `prev` itself when nothing changed. */
export function rememberState(prev: MemorySnapshot, state: ClientState): MemorySnapshot {
  const everOpen = prev.everOpen || state.connection === 'open';
  const sameRoom = state.code === null || state.code === prev.code;
  const code = state.code ?? prev.code;
  const names = { ...(sameRoom ? prev.names : EMPTY.names) };
  const learn = (seat: Seat, name: string | undefined) => {
    if (name !== undefined && name !== '') names[seat] = name;
  };
  learn('A', state.room?.players.A?.name);
  learn('B', state.room?.players.B?.name);
  for (const side of [state.hud.left, state.hud.right]) {
    if (side !== null) learn(side.seat, side.name);
  }
  if (
    everOpen === prev.everOpen &&
    code === prev.code &&
    names.A === prev.names.A &&
    names.B === prev.names.B
  ) {
    return prev;
  }
  return { code, names, everOpen };
}

export class SessionMemory {
  #snapshot: MemorySnapshot = EMPTY;
  readonly #listeners = new Set<() => void>();
  readonly #store: GameStore;

  constructor(store: GameStore) {
    this.#store = store;
    this.#snapshot = rememberState(EMPTY, store.getState());
  }

  readonly get = (): MemorySnapshot => this.#snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Starts following the store; returns the unsubscribe. */
  attach(): () => void {
    const update = () => {
      const next = rememberState(this.#snapshot, this.#store.getState());
      if (next === this.#snapshot) return;
      this.#snapshot = next;
      for (const listener of this.#listeners) listener();
    };
    update();
    return this.#store.subscribe(update);
  }
}
