import { NAME_MAX_LENGTH } from '@stackerist/protocol';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/ui/copy.ts';
import {
  NAME_INPUT_MAX_UNITS,
  parseRoomCodeInput,
  sanitizeCodeInput,
  validateName,
} from '../../src/ui/names.ts';
import { createMemoryRouter, parseRoute, roomPath, splitLocation } from '../../src/ui/router.ts';

describe('REQ-047 routes: /, /g/:code and ?watch=1 (architecture §5.7)', () => {
  it('REQ-047 / is home', () => {
    expect(parseRoute('/', '')).toEqual({ name: 'home' });
  });

  it('REQ-047 /g/:code pre-fills a canonical code, in either case', () => {
    expect(parseRoute('/g/k7qm4x', '')).toEqual({ name: 'room', code: 'K7QM4X', watch: false });
    expect(parseRoute('/g/K7QM4X/', '')).toEqual({ name: 'room', code: 'K7QM4X', watch: false });
  });

  it('REQ-047 ?watch=1 marks a watch link', () => {
    expect(parseRoute('/g/K7QM4X', '?watch=1')).toEqual({
      name: 'room',
      code: 'K7QM4X',
      watch: true,
    });
    expect(parseRoute('/g/K7QM4X', '?watch=0')).toMatchObject({ watch: false });
  });

  it('REQ-047 a malformed path is notFound, never a throw', () => {
    expect(parseRoute('/g/%', '')).toEqual({ name: 'notFound' });
    expect(parseRoute('/g/%E0%A4%A', '')).toEqual({ name: 'notFound' });
    expect(parseRoute('/g/ABC', '')).toEqual({ name: 'notFound' });
    expect(parseRoute('/g/ABCDE0', '')).toEqual({ name: 'notFound' });
    expect(parseRoute('/g/ABCDEF/extra', '')).toEqual({ name: 'notFound' });
    expect(parseRoute('/elsewhere', '')).toEqual({ name: 'notFound' });
  });

  it('REQ-047 roomPath builds the share path and the watch path', () => {
    expect(roomPath('K7QM4X')).toBe('/g/K7QM4X');
    expect(roomPath('K7QM4X', true)).toBe('/g/K7QM4X?watch=1');
    expect(splitLocation('/g/K7QM4X?watch=1')).toEqual({
      pathname: '/g/K7QM4X',
      search: '?watch=1',
    });
  });

  it('REQ-047 the memory router notifies on navigation only when the location changes', () => {
    const router = createMemoryRouter('/');
    let calls = 0;
    const off = router.subscribe(() => {
      calls += 1;
    });
    router.navigate('/g/K7QM4X');
    router.navigate('/g/K7QM4X');
    off();
    router.navigate('/');
    expect(calls).toBe(1);
    expect(router.getLocation()).toBe('/');
  });
});

describe('REQ-047 room-code field: upper case as you type, spaces and hyphens stripped', () => {
  it('REQ-047 accepts lower case and strips spaces and hyphens, at most 6 characters', () => {
    expect(sanitizeCodeInput('k7qm4x')).toBe('K7QM4X');
    expect(sanitizeCodeInput(' k7q-m4x ')).toBe('K7QM4X');
    expect(sanitizeCodeInput('K7QM4XYZ')).toBe('K7QM4X');
  });

  it('REQ-047 a pasted share link keeps only the code', () => {
    expect(sanitizeCodeInput('https://stackerist.up.railway.app/g/k7qm4x?watch=1')).toBe('K7QM4X');
  });

  it('REQ-047 only a real room code parses', () => {
    expect(parseRoomCodeInput('k7qm4x')).toBe('K7QM4X');
    expect(parseRoomCodeInput('K7QM')).toBeNull();
    expect(parseRoomCodeInput('K7QM40')).toBeNull();
  });
});

describe('REQ-044 names: trimmed, 1–16 code points, validated only by NameSchema (G5)', () => {
  it('REQ-044 trims and accepts 1 to 16 characters', () => {
    expect(validateName('  Ariel  ')).toBe('Ariel');
    expect(validateName('A')).toBe('A');
    expect(validateName('x'.repeat(NAME_MAX_LENGTH))).toBe('x'.repeat(NAME_MAX_LENGTH));
  });

  it('REQ-044 rejects an empty or whitespace name and a 17-character one', () => {
    expect(validateName('')).toBeNull();
    expect(validateName('   ')).toBeNull();
    expect(validateName('x'.repeat(NAME_MAX_LENGTH + 1))).toBeNull();
  });

  it('REQ-044 counts code points, so 16 astral letters are a valid name and the input cap lets them in', () => {
    const letter = String.fromCodePoint(0x20000); // CJK Extension B ideograph: a letter, 2 UTF-16 units
    const sixteen = letter.repeat(NAME_MAX_LENGTH);
    expect(validateName(sixteen)).toBe(sixteen);
    expect(validateName(letter.repeat(NAME_MAX_LENGTH + 1))).toBeNull();
    // Each of these letters is two UTF-16 units; the field's hard cap must not cut a valid name.
    expect(sixteen.length).toBeLessThanOrEqual(NAME_INPUT_MAX_UNITS);
  });

  it('REQ-044 the name error states the limit from the protocol constant', () => {
    expect(COPY.errors.nameInvalid(NAME_MAX_LENGTH)).toBe(
      'Enter your name (1–16 characters) to play.',
    );
  });
});
