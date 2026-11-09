/**
 * Name and room-code input rules (REQ-044, REQ-047, REQ-020). Names are validated only through the
 * protocol's `NameSchema`, which trims and counts code points (ruling G5): never with `.length`.
 */
import {
  GAME_PATH_PREFIX,
  NAME_MAX_LENGTH,
  NameSchema,
  normalizeRoomCode,
  ROOM_CODE_LENGTH,
  type RoomCode,
} from '@stackerist/protocol';

/**
 * The name field's hard cap in UTF-16 code units. A code point outside the BMP takes two units, so
 * twice the code-point limit lets every valid name through; `validateName` is the real check.
 */
export const NAME_INPUT_MAX_UNITS = NAME_MAX_LENGTH * 2;

/** The trimmed name, or null when it is empty or longer than the limit. */
export function validateName(raw: string): string | null {
  const result = NameSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * What the code field shows while typing: upper case, without spaces and hyphens, at most 6
 * characters. A pasted share link keeps only the code after `/g/`.
 */
export function sanitizeCodeInput(raw: string): string {
  let text = raw;
  const at = text.lastIndexOf(GAME_PATH_PREFIX);
  if (at !== -1) text = text.slice(at + GAME_PATH_PREFIX.length);
  const end = text.search(/[?#]/);
  if (end !== -1) text = text.slice(0, end);
  return text.replace(/[\s-]/g, '').toUpperCase().slice(0, ROOM_CODE_LENGTH);
}

/** The canonical room code from what the user typed, or null when it isn't one. */
export function parseRoomCodeInput(raw: string): RoomCode | null {
  return normalizeRoomCode(sanitizeCodeInput(raw));
}
