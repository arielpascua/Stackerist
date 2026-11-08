import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  GAME_PATH_PREFIX,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  RoomCodeSchema,
  SEAT_TOKEN_BYTES,
  SEAT_TOKEN_LENGTH,
  TOKEN_STORAGE_PREFIX,
  WATCH_QUERY_PARAM,
  gamePath,
  isSeatToken,
  normalizeRoomCode,
  parseClientMessage,
  parseServerMessage,
  shareUrl,
  tokenStorageKey,
} from '../src/index.js';
import { roomCodeArb, seatTokenArb } from './arbitraries.js';

const CANONICAL = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${String(ROOM_CODE_LENGTH)}}$`);

describe('REQ-020 room codes are case-insensitive on input and canonical everywhere', () => {
  it('REQ-020 the alphabet is the 31 characters without 0, O, 1, I or L', () => {
    expect(ROOM_CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
    expect(ROOM_CODE_ALPHABET).toHaveLength(31);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(31);
    expect(ROOM_CODE_LENGTH).toBe(6);
  });

  it('REQ-020 a lowercase or space-padded code parses to the canonical code', () => {
    expect(normalizeRoomCode('k7qm4x')).toBe('K7QM4X');
    expect(normalizeRoomCode('  K7qM4x  ')).toBe('K7QM4X');
    expect(normalizeRoomCode('\tk7qm4x\n')).toBe('K7QM4X');
    expect(normalizeRoomCode('K7QM4X')).toBe('K7QM4X');
    expect(RoomCodeSchema.parse(' abc234 ')).toBe('ABC234');
  });

  it('REQ-020 any case mix and whitespace padding of a valid code normalises to it', () => {
    fc.assert(
      fc.property(
        roomCodeArb,
        fc.array(fc.boolean(), { minLength: ROOM_CODE_LENGTH, maxLength: ROOM_CODE_LENGTH }),
        fc.string({ unit: fc.constantFrom(' ', '\t', '\n', ' ', '　') }),
        fc.string({ unit: fc.constantFrom(' ', '\t', '\r\n') }),
        (code, lower, before, after) => {
          const typed = code
            .split('') // ASCII only
            .map((c, i) => (lower[i] === true ? c.toLowerCase() : c))
            .join('');
          expect(normalizeRoomCode(`${before}${typed}${after}`)).toBe(code);
        },
      ),
    );
  });

  it('REQ-020 characters outside the alphabet, wrong lengths and inner spaces are rejected', () => {
    for (const bad of [
      '',
      'K7QM4',
      'K7QM4XX',
      'K7Q M4X',
      'ABC0EF',
      'ABCOEF',
      'ABC1EF',
      'ABCIEF',
      'ABCLEF',
      'abcoef', // o → O, not in the alphabet
      'abclef', // l → L, not in the alphabet
      'ABC-EF',
    ]) {
      expect(normalizeRoomCode(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('REQ-020 non-ASCII look-alikes are never folded into a valid code', () => {
    // U+017F (long s) upper-cases to "S" and U+FB06 (ligature st) to "ST"; fullwidth and the
    // Kelvin sign look like ASCII. None of them may pass as a room code.
    for (const bad of ['ABCſ23', 'ABCﬆ23', 'ＡＢＣ２３４', 'ABC23K', 'ABC2​34']) {
      expect(normalizeRoomCode(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('REQ-020 the output is always null or a canonical code', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string({ maxLength: 10 }), fc.string({ unit: 'binary', maxLength: 10 })),
        (raw) => {
          const code = normalizeRoomCode(raw);
          expect(code === null || CANONICAL.test(code)).toBe(true);
        },
      ),
    );
  });

  it('REQ-020 join/rejoin carry the raw code, so a typo is ROOM_NOT_FOUND (server) not BAD_MESSAGE', () => {
    const typo = parseClientMessage(JSON.stringify({ type: 'join', code: 'nope', name: 'Sam' }));
    expect(typo.ok).toBe(true);
    if (typo.ok && typo.msg.type === 'join') {
      expect(normalizeRoomCode(typo.msg.code)).toBeNull();
    }
    const lower = parseClientMessage(JSON.stringify({ type: 'join', code: ' k7qm4x', name: 'S' }));
    expect(lower.ok && lower.msg.type === 'join' && normalizeRoomCode(lower.msg.code)).toBe(
      'K7QM4X',
    );
    const tooLong = { type: 'rejoin', code: 'x'.repeat(17), token: 'A'.repeat(22) };
    expect(parseClientMessage(JSON.stringify(tooLong))).toEqual({
      ok: false,
      reason: 'BAD_SCHEMA',
    });
    expect(parseClientMessage(JSON.stringify({ type: 'join', code: '', name: 'S' })).ok).toBe(
      false,
    );
  });

  it('REQ-020 server messages carry the canonical code (one schema for both directions)', () => {
    const created = { type: 'created', code: 'k7qm4x', token: 'A'.repeat(22), seat: 'A' };
    expect(parseServerMessage(JSON.stringify(created))).toEqual({ ...created, code: 'K7QM4X' });
    expect(parseServerMessage(JSON.stringify({ ...created, code: 'K7QM40' }))).toBeNull();
  });

  it('REQ-020 the share link and game path use the canonical code', () => {
    expect(GAME_PATH_PREFIX).toBe('/g/');
    expect(gamePath('k7qm4x')).toBe('/g/K7QM4X');
    expect(shareUrl('https://stackerist.up.railway.app', 'K7QM4X')).toBe(
      'https://stackerist.up.railway.app/g/K7QM4X',
    );
    expect(shareUrl('http://localhost:5173//', ' k7qm4x ')).toBe('http://localhost:5173/g/K7QM4X');
    expect(WATCH_QUERY_PARAM).toBe('watch');
    expect(() => gamePath('nope')).toThrow(RangeError);
    expect(() => shareUrl('https://x', 'K7QM40')).toThrow(RangeError);
  });

  it('REQ-020 the seat-token storage key is token:<CANONICAL CODE>', () => {
    expect(tokenStorageKey('K7QM4X')).toBe('token:K7QM4X');
    expect(tokenStorageKey(' k7qm4x ')).toBe('token:K7QM4X');
    expect(tokenStorageKey('k7qm4x')).toBe(`${TOKEN_STORAGE_PREFIX}K7QM4X`);
    expect(() => tokenStorageKey('')).toThrow(RangeError);
  });

  it('REQ-020 seat tokens are 22 base64url characters (128-bit, no padding)', () => {
    expect(SEAT_TOKEN_LENGTH).toBe(Math.ceil((SEAT_TOKEN_BYTES * 8) / 6));
    fc.assert(
      fc.property(seatTokenArb, (token) => {
        expect(isSeatToken(token)).toBe(true);
      }),
    );
    for (const bad of [
      'A'.repeat(21),
      'A'.repeat(23),
      `${'A'.repeat(21)}=`,
      `${'A'.repeat(21)}+`,
      `${'A'.repeat(21)}/`,
      ` ${'A'.repeat(22)}`,
      42,
      null,
    ]) {
      expect(isSeatToken(bad), String(bad)).toBe(false);
    }
  });
});
