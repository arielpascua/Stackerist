/**
 * REQ-044 (owner decision, 2026-11-10: refuse emoji for name readability): the Home name field says
 * what is wrong and how to fix it. Every emoji below is built from code points at runtime.
 */
import { NAME_MAX_LENGTH } from '@stackerist/protocol';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/ui/copy.ts';
import { KeyboardProof } from '../../src/ui/device.ts';
import { nameErrorText, nameProblem, validateName } from '../../src/ui/names.ts';
import { Home } from '../../src/ui/screens/Home.tsx';
import { TEST_IDS } from '../../src/ui/testIds.ts';

const ch = (...codePoints: number[]): string => String.fromCodePoint(...codePoints);

const REFUSED_FOR_SYMBOLS: Readonly<Record<string, string>> = {
  emoji: ch(0x1f600),
  'name with an emoji': `Sam${ch(0x1f600)}`,
  'ZWJ sequence': ch(0x1f469, 0x200d, 0x1f680),
  flag: ch(0x1f1f5, 0x1f1ed),
  'skin tone': ch(0x1f44d, 0x1f3fd),
  keycap: ch(0x31, 0xfe0f, 0x20e3),
  'heart with VS16': ch(0x2764, 0xfe0f),
  'a bidi override': `a${ch(0x202e)}b`,
  'a 17-character name that also has an emoji': `${'a'.repeat(16)}${ch(0x1f600)}`,
};

describe('REQ-044 the name field refuses emoji and says how to fix it', () => {
  for (const [label, raw] of Object.entries(REFUSED_FOR_SYMBOLS)) {
    it(`REQ-044 ${label}: refused, and the problem is the characters`, () => {
      expect(validateName(raw)).toBeNull();
      expect(nameProblem(raw)).toBe('characters');
      expect(nameErrorText('characters')).toBe(COPY.errors.nameSymbols);
    });
  }

  it('REQ-044 the symbols message names the problem and the fix', () => {
    expect(COPY.errors.nameSymbols).toBe(
      "Names can't include emoji or special symbols. Use letters, numbers and punctuation.",
    );
  });

  it('REQ-044 an empty or too-long name keeps the length message', () => {
    for (const raw of ['', '   ', 'x'.repeat(NAME_MAX_LENGTH + 1)]) {
      expect(nameProblem(raw)).toBe('length');
      expect(nameErrorText('length')).toBe(COPY.errors.nameInvalid(NAME_MAX_LENGTH));
    }
  });

  it('REQ-044 a valid name has no problem', () => {
    for (const raw of ['Ariel', 'José', ch(0x674e, 0x96f7), "O'Brien-Jr", '#1 Player', 'A*B']) {
      expect(nameProblem(raw)).toBeNull();
      expect(validateName(raw)).toBe(raw);
    }
  });

  it('REQ-044 the Home name field keeps its error slot, hidden until a refusal', () => {
    const html = renderToStaticMarkup(
      createElement(Home, {
        mode: 'create',
        initialCode: '',
        busy: null,
        error: null,
        onCreate: () => undefined,
        onJoin: () => undefined,
        onWatch: () => undefined,
        needsKeyboardWarning: () => false,
        keyboard: new KeyboardProof(),
      }),
    );
    expect(html).toContain(TEST_IDS.home.nameInput);
    expect(html).not.toContain(TEST_IDS.home.nameError);
  });
});
