/**
 * Room codes and seat tokens (REQ-020, REQ-021, REQ-040). Codes come from `crypto.randomInt` over the
 * protocol alphabet; tokens are 128 random bits. Tokens are compared with `crypto.timingSafeEqual` on
 * equal-length buffers only, so a length mismatch neither throws nor short-circuits.
 */
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  CLOSE_CODES,
  ERROR_CODES,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  SEAT_TOKEN_BYTES,
  isSeatToken,
  type CloseCodeName,
  type ErrorCode,
  type RoomCode,
} from '@stackerist/protocol';

/**
 * The protocol's error codes as a name → name map, derived from `ERROR_CODES`, so call sites write
 * `ERR.NOT_IN_ROOM` and never retype a code literal (architecture §7.4 grep rule).
 */
export const ERR = Object.freeze(Object.fromEntries(ERROR_CODES.map((code) => [code, code]))) as {
  readonly [K in ErrorCode]: K;
};

/** The protocol's close-code names as a name → name map, derived from `CLOSE_CODES`. */
export const CLOSE = Object.freeze(
  Object.fromEntries(Object.keys(CLOSE_CODES).map((name) => [name, name])),
) as { readonly [K in CloseCodeName]: K };

/** Developer-facing error text. The UI maps the code to DESIGN.md copy and never shows this. */
export const ERROR_TEXT: Readonly<Record<ErrorCode, string>> = Object.freeze({
  BAD_MESSAGE: 'Malformed, oversized, binary or unknown message',
  ROOM_NOT_FOUND: 'No live room has that code',
  BAD_TOKEN: 'That seat token matches no seat in this room',
  ROOM_FULL: 'This room has two players and the maximum number of spectators',
  NOT_A_PLAYER: 'Spectators cannot send that message',
  NOT_PLAYING: 'Inputs are accepted only while a round is being played',
  BAD_SEQ: 'Input seq must be greater than the last accepted seq for this seat',
  BAD_TICK: 'Input tick is too far ahead of the server or earlier than the previous stamp',
  ALREADY_IN_ROOM: 'This connection is already in a room',
  NOT_IN_ROOM: 'This connection is not in a room',
  NOT_FINISHED: 'The round is not over yet',
  TOO_MANY_CREATES: 'Too many games created from this network; try again in a minute',
  TOO_MANY_JOINS: 'Too many wrong codes from this network; try again in a minute',
  SERVER_BUSY: 'The server is at its room limit; try again later',
  INTERNAL_ERROR: 'Something went wrong on the server; it was logged',
});

const MAX_CODE_ATTEMPTS = 64;

/** A fresh code that `isTaken` rejects for none of the live rooms. Throws after 64 collisions. */
export function generateRoomCode(isTaken: (code: RoomCode) => boolean): RoomCode {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
      code += ROOM_CODE_ALPHABET.charAt(randomInt(ROOM_CODE_ALPHABET.length));
    }
    if (!isTaken(code)) return code;
  }
  throw new Error('No free room code after repeated attempts');
}

export interface SeatToken {
  /** The wire form: 22 base64url characters. Sent once, never logged. */
  readonly text: string;
  /** The 16 raw bytes the server keeps. */
  readonly bytes: Buffer;
}

export function generateSeatToken(): SeatToken {
  const bytes = randomBytes(SEAT_TOKEN_BYTES);
  return { text: bytes.toString('base64url'), bytes };
}

const ZERO_TOKEN = Buffer.alloc(SEAT_TOKEN_BYTES);

/**
 * True only when `candidate` is the canonical base64url spelling of exactly `stored`. `stored` null
 * means "no seat": the comparison still runs (against zeros) and the answer is false. A malformed
 * candidate is compared as zeros, so every call does the same constant-time work. Any throw → false.
 */
export function tokenMatches(stored: Buffer | null, candidate: string): boolean {
  try {
    const decoded = isSeatToken(candidate) ? Buffer.from(candidate, 'base64url') : null;
    const canonical =
      decoded !== null &&
      decoded.length === SEAT_TOKEN_BYTES &&
      decoded.toString('base64url') === candidate;
    const storedValid = stored !== null && stored.length === SEAT_TOKEN_BYTES;
    const probe = canonical ? decoded : ZERO_TOKEN;
    const reference = storedValid ? stored : ZERO_TOKEN;
    const equal = timingSafeEqual(reference, probe);
    return equal && canonical && storedValid;
  } catch {
    return false;
  }
}
