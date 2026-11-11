/**
 * Security re-review N4 / REQ-044 "better name readability". Every sample is an explicit list built at
 * runtime from code points; none is typed as a literal character and none reuses the schema's patterns.
 * Out of scope on purpose: homoglyph spoofing (a Cyrillic letter that looks Latin is a legal letter).
 */
import { describe, expect, it } from 'vitest';
import { CreateMessageSchema, NAME_MAX_LENGTH, NameSchema } from '../src/index.js';

const ch = (...codePoints: number[]): string => String.fromCodePoint(...codePoints);
const rep = (codePoint: number, n: number): string => String.fromCodePoint(codePoint).repeat(n);

const REFUSED: Readonly<Record<string, string>> = {
  'Hangul filler U+3164 alone': ch(0x3164),
  'Hangul filler U+3164 inside a name': `Jo${ch(0x3164)}hn`,
  'halfwidth Hangul filler U+FFA0': ch(0xffa0),
  'Hangul choseong filler U+115F': ch(0x115f),
  'Hangul jungseong filler U+1160': ch(0x1160),
  'fillers only, sixteen of them': rep(0x3164, 16),
  'braille blank U+2800': ch(0x2800),
  'braille blank between letters': `a${ch(0x2800)}b`,
  'Khmer inherent vowel U+17B4': `a${ch(0x17b4)}`,
  'Khmer inherent vowel U+17B5': `a${ch(0x17b5)}`,
  'a lone combining acute': ch(0x301),
  'a lone combining grapheme joiner': ch(0x34f),
  'combining marks only': ch(0x301, 0x302),
  'private use U+E000': `a${ch(0xe000)}`,
  'private use U+F8FF': ch(0xf8ff, 0x61),
  'private use plane 15': `a${ch(0xf0000)}`,
  'private use plane 16': `a${ch(0x10fffd)}`,
  'unassigned U+0378': `a${ch(0x378)}`,
  'noncharacter U+FFFF': `a${ch(0xffff)}`,
  'a lone high surrogate': `a${String.fromCharCode(0xd800)}`,
  'a lone low surrogate': `${String.fromCharCode(0xdc00)}a`,
  'zalgo: a letter and 15 marks': `a${ch(0x300, 0x301, 0x302, 0x303, 0x304, 0x305, 0x306, 0x307, 0x308, 0x30a, 0x30b, 0x30c, 0x30d, 0x30e, 0x30f)}`,
  'a letter and exactly 3 marks': `a${ch(0x300, 0x301, 0x302)}`,
  'three marks in the middle of a name': `Jo${ch(0x300, 0x301, 0x302)}hn`,
  'Arabic ligature U+FDFD alone': ch(0xfdfd),
  'Arabic ligature U+FDFD x16': rep(0xfdfd, 16),
  'Arabic ligature U+FDFD after a letter': `a${ch(0xfdfd)}`,
  'Arabic ligature U+FDFC': ch(0xfdfc),
  'punctuation only': '---',
  'symbols only': '#*$',
  'dots and spaces': '. . .',
  'normalizes to more than 16 code points (6 x U+3392 is 18)': rep(0x3392, 6),
  'a letter, then an emoji': `a${ch(0x1f600)}`,
  'an emoji alone': ch(0x1f600),
};

describe('REQ-044 N4 NameSchema refuses blank-looking, unreadable and spoofable names', () => {
  for (const [label, raw] of Object.entries(REFUSED)) {
    it(`REQ-044 N4 refuses ${label}`, () => {
      expect(NameSchema.safeParse(raw).success).toBe(false);
      expect(CreateMessageSchema.safeParse({ type: 'create', name: raw }).success).toBe(false);
    });
  }

  it('REQ-044 N4 the refusal for a missing letter or digit is a character rule, not a length rule', () => {
    const result = NameSchema.safeParse('---');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.every((i) => i.code === 'custom')).toBe(true);
  });
});

describe('REQ-044 N4 NameSchema accepts real names, normalized to NFKC', () => {
  const same: Readonly<Record<string, string>> = {
    'a Thai name': ch(0xe2a, 0xe21, 0xe0a, 0xe32, 0xe22),
    'Thai with a vowel and a tone mark in a row (two marks)': ch(0xe01, 0xe23, 0xe38, 0xe4a, 0xe1b),
    'a Hindi name': ch(0x905, 0x928, 0x93f, 0x932),
    'Hindi with a virama and a vowel sign': ch(0x936, 0x94d, 0x930, 0x940),
    'Vietnamese, precomposed': `Nguy${ch(0x1ec5)}n`,
    'Vietnamese, decomposed (two marks stacked on e)': `Nguy${ch(0x65, 0x302, 0x303)}n`.normalize(
      'NFKC',
    ),
    'Vietnamese with a horn and a dot below, precomposed': ch(0x1ef1, 0x6e),
    'a letter and exactly 2 marks': `a${ch(0x301, 0x302)}`.normalize('NFKC'),
    'two letters, each with 2 marks': `a${ch(0x301, 0x302)}b${ch(0x301, 0x302)}`.normalize('NFKC'),
    'Cyrillic O look-alike is a legal letter (homoglyph spoofing is out of scope)': `Y${ch(0x41e)}U`,
    'Latin with accents': `Jos${ch(0xe9)}`,
    CJK: ch(0x674e, 0x5c0f, 0x9f8d),
    Cyrillic: ch(0x414, 0x43c, 0x438, 0x442, 0x440, 0x438, 0x439),
    Arabic: ch(0x627, 0x62d, 0x645, 0x62f),
    'digits only': '12345',
    'one letter': 'x',
    'a letter and punctuation': "O'Brien-Jr.",
  };
  for (const [label, raw] of Object.entries(same)) {
    it(`REQ-044 N4 accepts ${label}`, () => {
      expect(NameSchema.parse(raw)).toBe(raw);
    });
  }

  it('REQ-044 N4 Vietnamese typed decomposed (two stacked marks) is accepted as written', () => {
    const decomposed = `Nguy${ch(0x65, 0x302, 0x303)}n`;
    expect(NameSchema.safeParse(decomposed).success).toBe(true);
    expect(NameSchema.parse(decomposed)).toBe(`Nguy${ch(0x1ec5)}n`);
  });

  it('REQ-044 N4 a letter with 2 marks is accepted, with 3 it is not (written out, not composed)', () => {
    expect(NameSchema.safeParse(`a${ch(0x301, 0x302)}`).success).toBe(true);
    expect(NameSchema.safeParse(`a${ch(0x301, 0x302, 0x303)}`).success).toBe(false);
  });

  const normalized: readonly (readonly [string, string, string])[] = [
    ['full-width Latin', ch(0xff21, 0xff52, 0xff49, 0xff45, 0xff4c), 'Ariel'],
    ['mathematical bold Latin', ch(0x1d400, 0x1d42b, 0x1d422, 0x1d41e, 0x1d425), 'Ariel'],
    ['a ligature', `o${ch(0xfb01)}ce`, 'ofice'],
    ['decomposed accents compose', `Jose${ch(0x301)}`, `Jos${ch(0xe9)}`],
    ['full-width digits', ch(0xff11, 0xff12), '12'],
    ['five MHz signs (15 code points once normalized)', rep(0x3392, 5), 'MHz'.repeat(5)],
  ];
  for (const [label, raw, want] of normalized) {
    it(`REQ-044 N4 ${label} is accepted and comes out as ${JSON.stringify(want)}`, () => {
      expect(NameSchema.parse(raw)).toBe(want);
      expect(CreateMessageSchema.parse({ type: 'create', name: raw }).name).toBe(want);
    });
  }

  it('REQ-044 N4 length is counted after normalization: 16 full-width letters pass, 17 do not', () => {
    expect(NameSchema.parse(rep(0xff41, NAME_MAX_LENGTH))).toBe('a'.repeat(NAME_MAX_LENGTH));
    expect(NameSchema.safeParse(rep(0xff41, NAME_MAX_LENGTH + 1)).success).toBe(false);
  });

  it('REQ-044 N4 trimming happens first and again after normalizing; parsing is idempotent', () => {
    expect(NameSchema.parse(`  ${ch(0xff21)}b  `)).toBe('Ab');
    const once = NameSchema.parse(`${ch(0x3000)}${ch(0xff21, 0xff22)}${ch(0x3000)}`);
    expect(once).toBe('AB');
    expect(NameSchema.parse(once)).toBe(once);
  });

  it('REQ-044 N4 emoji stay refused', () => {
    expect(NameSchema.safeParse(`a${ch(0x1f600)}`).success).toBe(false);
    expect(NameSchema.safeParse(ch(0x1f600)).success).toBe(false);
  });

  it('REQ-044 N4 the emoji blocks are refused by explicit range, not only by the Unicode data of the Node build', () => {
    // Emoji added in recent Unicode versions (U+1FA89, U+1FAE8), a mahjong tile and a playing card.
    for (const code of [0x1fa89, 0x1fae8, 0x1f004, 0x1f0cf, 0x1f300, 0x1faff, 0x1f1e6]) {
      expect(NameSchema.safeParse(`Sam${ch(code)}`).success, code.toString(16)).toBe(false);
    }
  });
});

/**
 * Linear time on hostile input: a 16 KB name (the largest the protocol could be handed) of combining
 * marks, fillers and other worst cases is refused in a few milliseconds. The previous security fix once
 * introduced a regular-expression backtracking bug, so every new pattern gets a timing test.
 */
describe('REQ-044 N4 hostile 16 KB names are refused in under 5 ms', () => {
  const SIZE = 16 * 1024;
  const hostile: Readonly<Record<string, string>> = {
    'a base letter then combining marks': `a${rep(0x301, SIZE - 1)}`,
    'combining marks with alternating classes (worst case for reordering)': `a${ch(0x316, 0x301).repeat(SIZE / 2)}`,
    'Hangul fillers': rep(0x3164, SIZE),
    'Braille blanks': rep(0x2800, SIZE),
    'U+FDFD': rep(0xfdfd, SIZE),
    'letters with a mark tail': `${'a'.repeat(SIZE - 4)} ${ch(0x301)} ${ch(0x301)}`,
    'astral letters': rep(0x20000, SIZE / 2),
    unassigned: rep(0x378, SIZE),
    'private use': rep(0xe000, SIZE),
    emoji: rep(0x1f600, SIZE / 2),
    spaces: ' '.repeat(SIZE),
    'a 16-letter name followed by 16 KB of marks': `${'a'.repeat(16)}${rep(0x301, SIZE)}`,
  };
  const parseMs = (raw: string): number => {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 5; i += 1) {
      const t0 = performance.now();
      NameSchema.safeParse(raw);
      best = Math.min(best, performance.now() - t0);
    }
    return best;
  };

  for (const [label, raw] of Object.entries(hostile)) {
    it(`REQ-044 N4 ${label}`, () => {
      NameSchema.safeParse('warm up 123'); // JIT warm-up: time the schema, not the first call
      expect(NameSchema.safeParse(raw).success).toBe(false);
      expect(parseMs(raw)).toBeLessThan(5);
    });
  }
});
