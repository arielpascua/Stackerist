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
  { label: 'apostrophe and hyphen', name: "O'Brien-Jr" },
  { label: 'markup characters, shown as text', name: '<b>x</b>' },
];

interface RefusedName {
  readonly label: string;
  readonly name: string;
}

const REFUSED: readonly RefusedName[] = [
  { label: 'whitespace only', name: '   ' },
  { label: `${String(NAME_MAX_LENGTH + 1)} characters`, name: 'A'.repeat(NAME_MAX_LENGTH + 1) },
  { label: 'a control character (BEL)', name: `Bob${String.fromCharCode(0x07)}` },
  { label: 'a right-to-left override', name: `Ab${String.fromCharCode(0x202e)}cd` },
  { label: 'a zero-width space', name: `Ab${String.fromCharCode(0x200b)}cd` },
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
  for (const { label, name } of REFUSED) {
    test(`${label} is refused on the home form`, async ({ browser }) => {
      const player: Player = await newPlayer(browser, 'refused');
      try {
        const { page } = player;
        await open(page, '/');
        await expect(page.getByTestId(TEST_IDS.home.screen)).toBeVisible();
        await fillName(page, name);
        await page.getByTestId(TEST_IDS.home.createButton).click();

        // The error says what is wrong with the name (its length rule) and what to do (enter a name).
        const error = page.getByTestId(TEST_IDS.home.nameError);
        await expect(error).toBeVisible();
        await expect(error).toHaveText(COPY.errors.nameInvalid(NAME_MAX_LENGTH));
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

// REQ-044 emoji refusal lands in a follow-up commit (owner decision 2026-11-10); remove the fixme when the schema change merges
test.fixme('REQ-044 emoji names are refused: an emoji, a joined emoji sequence and a flag', async ({
  browser,
}) => {
  const emoji: readonly RefusedName[] = [
    { label: 'an emoji', name: cp(0x1f600) },
    // Man, ZWJ, woman, ZWJ, girl.
    { label: 'a joined emoji sequence', name: cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467) },
    // Regional indicators C and A.
    { label: 'a flag', name: cp(0x1f1e8, 0x1f1e6) },
  ];
  for (const { label, name } of emoji) {
    const player: Player = await newPlayer(browser, 'refused');
    try {
      const { page } = player;
      await open(page, '/');
      await fillName(page, name);
      await page.getByTestId(TEST_IDS.home.createButton).click();
      const error = page.getByTestId(TEST_IDS.home.nameError);
      await expect(error, label).toBeVisible();
      await expect(error, label).toHaveText(COPY.errors.nameInvalid(NAME_MAX_LENGTH));
      await expect(page.getByTestId(TEST_IDS.lobby.screen), label).toHaveCount(0);
    } finally {
      await closeAll([player]);
    }
  }
});
