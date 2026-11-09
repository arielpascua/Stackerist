/**
 * The `Music` service seam (architecture §5.6, DESIGN.md Music control). W2 ships the persisted on/off
 * preference so the UI can wire the Music button and the M key now; the Web Audio lookahead scheduler
 * (REQ-089: `bpmForLevel`, unlock, blocked/unavailable states) replaces the no-op playback in W4.
 *
 * Preference: `localStorage[MUSIC_STORAGE_KEY]` = 'on' | 'off', default 'on'.
 */
import { MUSIC_STORAGE_KEY } from '@stackerist/protocol';
import type { Music, MusicStatus } from '../game/contract.ts';

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type Preference = Extract<MusicStatus, 'on' | 'off'>;
const ON: Preference = 'on';
const OFF: Preference = 'off';

function readPreference(storage: PreferenceStorage | null): Preference {
  try {
    return storage?.getItem(MUSIC_STORAGE_KEY) === OFF ? OFF : ON;
  } catch {
    return ON;
  }
}

export function createMusic(storage: PreferenceStorage | null): Music {
  let preference = readPreference(storage);
  const listeners = new Set<() => void>();
  return {
    unlock() {},
    start() {},
    setLevel() {},
    stop() {},
    status: () => preference,
    toggle() {
      preference = preference === ON ? OFF : ON;
      try {
        storage?.setItem(MUSIC_STORAGE_KEY, preference);
      } catch {
        // Storage blocked: the toggle still applies for this page.
      }
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** `window.localStorage`, or null where reading it throws. */
export function browserLocalStorage(): PreferenceStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
