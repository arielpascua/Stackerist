/**
 * Security review F7: a name is visible text, never control, format or bidi characters. Every
 * invisible character below is built from a code point at runtime, so none sits in this source file.
 */
import { describe, expect, it } from 'vitest';
import { CreateMessageSchema, NAME_MAX_LENGTH, nameHasEmoji, NameSchema } from '../src/index.js';

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
    // Astral letters (CJK Extension B) count one code point each, and are letters, so they pass.
    expect(NameSchema.safeParse(ch(0x20000).repeat(NAME_MAX_LENGTH)).success).toBe(true);
    expect(NameSchema.safeParse(ch(0x20000).repeat(NAME_MAX_LENGTH + 1)).success).toBe(false);
  });
});

/**
 * REQ-044 (owner decision, 2026-11-10: "refuse emoji for better name readability"). Every sample is
 * an explicit list built from code points at runtime; none reuses the schema's own pattern.
 * Known, accepted side effect: text-style symbols that Unicode also marks pictographic are refused.
 */
const EMOJI_REFUSED: Readonly<Record<string, string>> = {
  'grinning face': ch(0x1f600),
  'astronaut (ZWJ sequence)': ch(0x1f469, 0x200d, 0x1f680),
  'flag (regional indicators)': ch(0x1f1f5, 0x1f1ed),
  'a lone regional indicator': ch(0x1f1f5),
  'thumbs up with a skin tone': ch(0x1f44d, 0x1f3fd),
  'a lone skin-tone modifier': ch(0x1f3fd),
  'keycap 1 (digit, VS16, keycap)': ch(0x31, 0xfe0f, 0x20e3),
  'a bare combining keycap': `1${ch(0x20e3)}`,
  'red heart with VS16': ch(0x2764, 0xfe0f),
  'a lone variation selector-16': `a${ch(0xfe0f)}b`,
  'a lone variation selector-15': `a${ch(0xfe0e)}b`,
  'black star': ch(0x2605),
  'black heart suit': ch(0x2665),
  'white smiling face': ch(0x263a),
  copyright: ch(0xa9),
  registered: ch(0xae),
  'trade mark': ch(0x2122),
  'emoji at the end': `Sam${ch(0x1f600)}`,
  'emoji at the start': `${ch(0x1f600)}Sam`,
  'emoji in the middle': `Sa${ch(0x1f3ae)}m`,
  'game controller after a space': `Sam ${ch(0x1f3ae)}`,
  'rocket in a CJK name': `${ch(0x674e, 0x96f7)}${ch(0x1f680)}`,
};

const PLAIN_ACCEPTED: readonly string[] = [
  'Ariel',
  'José',
  ch(0x674e, 0x96f7), // CJK
  ch(0x414, 0x43c, 0x438, 0x442, 0x440, 0x438, 0x439), // Cyrillic
  ch(0x645, 0x62d, 0x645, 0x62f), // Arabic
  ch(0x939, 0x93f, 0x928, 0x94d, 0x926, 0x940), // Devanagari
  "O'Brien-Jr",
  'Mary Ann',
  'J. R. R.',
  '#1 Player',
  'A*B',
  'R2-D2',
  '0123456789',
  'a'.repeat(16),
  ch(0x4e2d).repeat(16), // sixteen CJK characters
  ch(0x20000).repeat(16), // sixteen astral CJK characters
];

describe('REQ-044 NameSchema refuses emoji for readability', () => {
  for (const [label, raw] of Object.entries(EMOJI_REFUSED)) {
    it(`REQ-044 refuses ${label}`, () => {
      expect(NameSchema.safeParse(raw).success).toBe(false);
      expect(CreateMessageSchema.safeParse({ type: 'create', name: raw }).success).toBe(false);
    });
  }

  it('REQ-044 refuses an emoji even when the name is padded with spaces', () => {
    expect(NameSchema.safeParse(`  ${ch(0x1f600)}  `).success).toBe(false);
  });

  it('REQ-044 refuses an emoji inside an otherwise full-length name', () => {
    expect(NameSchema.safeParse(`${'a'.repeat(15)}${ch(0x1f600)}`).success).toBe(false);
  });
});

describe('REQ-044 NameSchema keeps accepting real names', () => {
  for (const raw of PLAIN_ACCEPTED) {
    it(`REQ-044 accepts ${JSON.stringify(raw)}`, () => {
      expect(NameSchema.parse(raw)).toBe(raw);
    });
  }
});

describe('REQ-044 the exported emoji pattern (for the client to pre-validate)', () => {
  it('REQ-044 nameHasEmoji tells an emoji refusal from other refusals', () => {
    expect(nameHasEmoji(ch(0x1f600))).toBe(true);
    expect(nameHasEmoji(`Sam${ch(0x1f600)}`)).toBe(true);
    expect(nameHasEmoji(ch(0x2605))).toBe(true);
    expect(nameHasEmoji('Ariel')).toBe(false);
    expect(nameHasEmoji('#1 *')).toBe(false);
    expect(nameHasEmoji(`a${ch(0x202e)}b`)).toBe(false); // a bidi override is refused, but not as emoji
    expect(nameHasEmoji('')).toBe(false);
  });
});
