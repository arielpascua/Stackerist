/**
 * Seat tokens in sessionStorage (REQ-021, architecture §5.3). The key is always the protocol's
 * `tokenStorageKey(code)` (`token:<CODE>`), so a refresh in the same tab finds its seat again and a new
 * tab does not. Storage can be missing or throw (privacy modes, quota); every helper degrades to "no
 * token" instead of throwing into the UI.
 */
import { isSeatToken, normalizeRoomCode, tokenStorageKey } from '@stackerist/protocol';

/** The slice of the Web Storage API the session needs (sessionStorage in the browser). */
export interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function keyFor(code: string): string | null {
  return normalizeRoomCode(code) === null ? null : tokenStorageKey(code);
}

/** The stored seat token for `code`, or null when there is none, it is malformed, or storage fails. */
export function loadToken(storage: TokenStorage | null, code: string): string | null {
  const key = keyFor(code);
  if (storage === null || key === null) return null;
  try {
    const value = storage.getItem(key);
    return isSeatToken(value) ? value : null;
  } catch {
    return null;
  }
}

/** Stores the seat token for `code`. A malformed token or code is not stored. */
export function saveToken(storage: TokenStorage | null, code: string, token: string): void {
  const key = keyFor(code);
  if (storage === null || key === null || !isSeatToken(token)) return;
  try {
    storage.setItem(key, token);
  } catch {
    // Storage full or blocked: the seat still works until the tab reloads.
  }
}

/** Forgets the seat token for `code` (leave, or a rejoin the server refused). */
export function clearToken(storage: TokenStorage | null, code: string): void {
  const key = keyFor(code);
  if (storage === null || key === null) return;
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to do: the token simply stays until the tab closes.
  }
}

/** `window.sessionStorage`, or null where reading it throws (some privacy modes). */
export function browserSessionStorage(): TokenStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
