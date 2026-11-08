/**
 * Room codes, seat tokens, links and storage keys (architecture §3.1). Codes are canonicalised where
 * they are consumed: every function here that takes a code runs it through the one validator,
 * `RoomCodeSchema`, so `abc234`, ` ABC234 ` and `ABC234` all mean the same room (REQ-020).
 */
import { GAME_PATH_PREFIX, TOKEN_STORAGE_PREFIX } from './constants.js';
import type { RoomCode } from './messages.js';
import { RoomCodeSchema, SeatTokenSchema } from './schemas.js';

/** Trim, upper-case, then check the 31-character alphabet at length 6. null when it doesn't pass. */
export function normalizeRoomCode(input: string): RoomCode | null {
  const result = RoomCodeSchema.safeParse(input);
  return result.success ? result.data : null;
}

/** True for exactly SEAT_TOKEN_LENGTH (22) base64url characters, no padding. */
export function isSeatToken(value: unknown): value is string {
  return SeatTokenSchema.safeParse(value).success;
}

function canonicalCode(code: string): RoomCode {
  const canonical = normalizeRoomCode(code);
  if (canonical === null) {
    throw new RangeError('Not a room code: expected 6 characters of the room-code alphabet');
  }
  return canonical;
}

/** `/g/<CODE>` with the canonical code. Throws RangeError for something that isn't a room code. */
export function gamePath(code: string): string {
  return `${GAME_PATH_PREFIX}${canonicalCode(code)}`;
}

/**
 * The share link `<origin>/g/<CODE>`. `origin` is scheme + host (`location.origin`); a trailing slash is
 * dropped. Throws RangeError for something that isn't a room code.
 */
export function shareUrl(origin: string, code: string): string {
  let end = origin.length;
  while (end > 0 && origin[end - 1] === '/') {
    end -= 1;
  }
  return `${origin.slice(0, end)}${gamePath(code)}`;
}

/** sessionStorage key for a seat token: `token:<CODE>` (REQ-021). Throws RangeError for a non-code. */
export function tokenStorageKey(code: string): string {
  return `${TOKEN_STORAGE_PREFIX}${canonicalCode(code)}`;
}
