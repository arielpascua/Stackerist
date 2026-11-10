/**
 * REQ-044 player names, through the real UI and the production server: names that must be accepted
 * show up in the lobby as text (never interpreted as HTML), names that must be refused stop at the home
 * form with the visible error and never reach a lobby.
 *
 * Every string comes from the app (`COPY`, `TEST_IDS`) and the protocol (`NAME_MAX_LENGTH`). Every
 * name that is not plain ASCII, and every invisible or direction-changing character, is built at
 * runtime from code points: no such character is typed in this file (an editor or a tool can turn a
 * typed escape into the real character, and a real bidi control in source is a hazard of its own).
 */
import { expect, test } from '@playwright/test';
import { NAME_MAX_LENGTH } from '../packages/protocol/src/index.ts';
import {
  closeAll,
  COPY,
  createGame,
  fillName,
  newPlayer,
  open,
  TEST_IDS,
  type Player,
} from './support/app.ts';

const cp = (...codePoints: number[]): string => String.fromCodePoint(...codePoints);

interface AcceptedName {
  readonly label: string;
  readonly name: string;
}

// `<b>x</b>` is valid under NameSchema (no control, format or bidi character, 8 code points), so it
// must be accepted and shown as the literal text, never as bold markup.
const ACCEPTED: readonly AcceptedName[] = [
  { label: 'ASCII', name: 'Ariel' },
  { label: 'accented Latin (precomposed e-acute)', name: `Jos${cp(0xe9)}` },
  { label: 'CJK', name: cp(0x674e, 0x96f7) },
  // Cyrillic: D, m, i, t, r, i, y (Dmitry), each a letter.
  {
    label: 'Cyrillic',
    name: cp(0x414, 0x43c, 0x438, 0x442, 0x440, 0x438, 0x439),
  },
  { label: 'apostrophe and hyphen', name: "O'Brien-Jr" },
  { label: 'markup characters, shown as text', name: '<b>x</b>' },
];

/**
 * The two classes of problem the home form tells apart (`nameProblem` in the client): a name that is
 * the wrong size gets the length message, a name with a character the schema refuses (control,
 * format, bidirectional, zero-width, emoji) gets the symbols message. Each case names the exact
 * message it must show, taken from `COPY`, so a wrong class fails the test.
 */
const LENGTH_MESSAGE = COPY.errors.nameInvalid(NAME_MAX_LENGTH);
const SYMBOLS_MESSAGE = COPY.errors.nameSymbols;

interface RefusedName {
  readonly label: string;
  readonly name: string;
  readonly message: string;
}

const REFUSED: readonly RefusedName[] = [
  { label: 'whitespace only', name: '   ', message: LENGTH_MESSAGE },
  {
    label: `${String(NAME_MAX_LENGTH + 1)} characters`,
    name: 'A'.repeat(NAME_MAX_LENGTH + 1),
    message: LENGTH_MESSAGE,
  },
  {
    label: 'a control character (BEL)',
    name: `Bob${String.fromCharCode(0x07)}`,
    message: SYMBOLS_MESSAGE,
  },
  {
    label: 'a right-to-left override',
    name: `Ab${String.fromCharCode(0x202e)}cd`,
    message: SYMBOLS_MESSAGE,
  },
  {
    label: 'a zero-width space',
    name: `Ab${String.fromCharCode(0x200b)}cd`,
    message: SYMBOLS_MESSAGE,
  },
  // REQ-044 (owner decision 2026-11-10): emoji are refused. Every one is built from code points.
  { label: 'an emoji', name: cp(0x1f600), message: SYMBOLS_MESSAGE },
  {
    // Man, ZWJ, woman, ZWJ, girl.
    label: 'a joined emoji sequence',
    name: cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467),
    message: SYMBOLS_MESSAGE,
  },
  {
    // Regional indicators C and A.
    label: 'a flag',
    name: cp(0x1f1e8, 0x1f1e6),
    message: SYMBOLS_MESSAGE,
  },
  {
    // Thumbs up, then the medium skin tone modifier.
    label: 'a skin-toned emoji',
    name: cp(0x1f44d, 0x1f3fd),
    message: SYMBOLS_MESSAGE,
  },
  {
    // Digit one, variation selector 16, combining enclosing keycap.
    label: 'a keycap',
    name: cp(0x31, 0xfe0f, 0x20e3),
    message: SYMBOLS_MESSAGE,
  },
  {
    // A letter name with an emoji inside still carries a symbol: refused as a whole.
    label: 'letters with an emoji inside',
    name: `Ab${cp(0x1f600)}cd`,
    message: SYMBOLS_MESSAGE,
  },
];

test.describe('REQ-044 names accepted: shown in the lobby as text', () => {
  for (const { label, name } of ACCEPTED) {
    test(`${label}: "${name}" is accepted and appears in the lobby as text`, async ({
      browser,
    }) => {
      const player: Player = await newPlayer(browser, name);
      try {
        await createGame(player);
        const { page } = player;
        const seat = page.getByTestId(TEST_IDS.lobby.player).first();
        // The seat row holds the name as its text: exactly the string entered, nothing added.
        await expect(seat.getByText(name, { exact: true })).toBeVisible();
        await expect(seat).toContainText(COPY.lobby.you);
        // No HTML interpretation: no element other than the <bdi> wrapper exists below the player
        // list, and the name is the text of that wrapper (a `<b>` would split it into markup).
        await expect(
          page.getByTestId(TEST_IDS.lobby.playerList).locator('b, i, script, img'),
        ).toHaveCount(0);
        await expect(seat.locator('bdi')).toHaveText(name);
        expect(player.problems, `${name}: console problems`).toEqual([]);
      } finally {
        await closeAll([player]);
      }
    });
  }
});

test.describe('REQ-044 names refused: a visible error that names the fix, and no lobby', () => {
  for (const { label, name, message } of REFUSED) {
    test(`${label} is refused on the home form`, async ({ browser }) => {
      const player: Player = await newPlayer(browser, 'refused');
      try {
        const { page } = player;
        await open(page, '/');
        await expect(page.getByTestId(TEST_IDS.home.screen)).toBeVisible();
        await fillName(page, name);
        await page.getByTestId(TEST_IDS.home.createButton).click();

        // The error says what is wrong with the name and what to do, and it is the message for this
        // class of problem (length or symbols), not just any error.
        const error = page.getByTestId(TEST_IDS.home.nameError);
        await expect(error).toBeVisible();
        await expect(error).toHaveText(message);
        await expect(page.getByTestId(TEST_IDS.home.nameInput)).toHaveAttribute(
          'aria-invalid',
          'true',
        );
        await expect(page.getByTestId(TEST_IDS.home.nameInput)).toBeFocused();

        // Refused means refused: still on the home screen, no lobby, no game.
        await expect(page.getByTestId(TEST_IDS.home.screen)).toBeVisible();
        await expect(page.getByTestId(TEST_IDS.lobby.screen)).toHaveCount(0);
        await expect(page.getByTestId(TEST_IDS.game.screen)).toHaveCount(0);
        expect(player.problems, `${label}: console problems`).toEqual([]);
      } finally {
        await closeAll([player]);
      }
    });
  }
});
