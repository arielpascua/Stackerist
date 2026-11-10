/**
 * Security review F7: a name is visible text, never control, format or bidi characters. Every
 * invisible character below is built from a code point at runtime, so none sits in this source file.
 */
import { describe, expect, it } from 'vitest';
import { CreateMessageSchema, NAME_MAX_LENGTH, NameSchema } from '../src/index.js';

const ch = (...codePoints: number[]): string => String.fromCodePoint(...codePoints);

const REJECTED: Readonly<Record<string, string>> = {
  'right-to-left override': `${ch(0x202e)}evil`,
  'left-to-right override': `ab${ch(0x202d)}cd`,
  'right-to-left embedding / pop': `a${ch(0x202b)}b${ch(0x202c)}`,
  'bidi isolates': `a${ch(0x2066, 0x2067, 0x2068, 0x2069)}b`,
  'left-to-right mark': `a${ch(0x200e)}b`,
  'right-to-left mark': `a${ch(0x200f)}b`,
  'arabic letter mark': `a${ch(0x61c)}b`,
  'zero-width space': `a${ch(0x200b)}b`,
  'zero-width only': ch(0x200b, 0x200b),
  'zero-width non-joiner': `a${ch(0x200c)}b`,
  'word joiner': `a${ch(0x2060)}b`,
  'byte order mark (inside; at the edge it is whitespace and gets trimmed)': `na${ch(0xfeff)}me`,
  'soft hyphen': `a${ch(0xad)}b`,
  'language tag': `a${ch(0xe0041)}b`,
  NUL: `a${ch(0)}b`,
  'NUL alone': ch(0),
  BEL: `a${ch(7)}b`,
  newline: `a${ch(10)}b`,
  'carriage return': `a${ch(13)}b`,
  tab: `a${ch(9)}b`,
  ESC: `a${ch(0x1b)}[31m`,
  DEL: `a${ch(0x7f)}b`,
  'C1 control (NEL)': `a${ch(0x85)}b`,
  'line separator': `a${ch(0x2028)}b`,
  'paragraph separator': `a${ch(0x2029)}b`,
};

const ACCEPTED: readonly string[] = [
  'Ariel',
  'a b',
  'José',
  'Zoë',
  'Ünal',
  'Åsa Ørsted',
  ch(0x674e, 0x5c0f, 0x9f8d), // CJK
  ch(0x3053, 0x3093, 0x306b, 0x3061, 0x306f), // hiragana
  ch(0x5e9, 0x5dc, 0x5d5, 0x5dd), // Hebrew letters (a right-to-left script is fine; controls are not)
  ch(0x627, 0x62d, 0x645, 0x62f), // Arabic letters
  ch(0x1f600), // an emoji
  `Sam ${ch(0x1f3ae)}`,
  `x${ch(0x2764, 0xfe0f)}`, // heart + variation selector-16
  "O'Brien-Smith.",
  '<b>',
];

describe('F7 NameSchema rejects control, format and bidi characters', () => {
  for (const [label, raw] of Object.entries(REJECTED)) {
    it(`rejects ${label}`, () => {
      expect(NameSchema.safeParse(raw).success).toBe(false);
      expect(CreateMessageSchema.safeParse({ type: 'create', name: raw }).success).toBe(false);
    });
  }

  it('rejects a forbidden character in the middle even when the length is fine', () => {
    expect(NameSchema.safeParse(`ok${ch(0x202e)}ok`).success).toBe(false);
  });

  it('checks the trimmed name: surrounding whitespace (including a newline) is trimmed first, then the rest must be clean', () => {
    expect(NameSchema.parse(`  Ariel${ch(10)}`)).toBe('Ariel');
    expect(NameSchema.safeParse(`  Ar${ch(10)}iel `).success).toBe(false);
  });
});

describe('F7 NameSchema still accepts ordinary names', () => {
  for (const raw of ACCEPTED) {
    it(`accepts ${JSON.stringify(raw)}`, () => {
      expect(NameSchema.parse(raw)).toBe(raw);
    });
  }

  it('keeps the 1..16 code point rule', () => {
    expect(NameSchema.safeParse('').success).toBe(false);
    expect(NameSchema.safeParse('x'.repeat(NAME_MAX_LENGTH)).success).toBe(true);
    expect(NameSchema.safeParse('x'.repeat(NAME_MAX_LENGTH + 1)).success).toBe(false);
    expect(NameSchema.safeParse(ch(0x1f600).repeat(NAME_MAX_LENGTH)).success).toBe(true);
    expect(NameSchema.safeParse(ch(0x1f600).repeat(NAME_MAX_LENGTH + 1)).success).toBe(false);
  });
});
