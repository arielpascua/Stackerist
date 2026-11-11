/**
 * Every zod schema on the wire (architecture §3.4–3.7). zod 4.6.7; each API used here is declared in
 * `zod/v4/classic/schemas.d.ts`. Every object is a `z.strictObject`, so an unknown key fails parsing:
 * on the server that is BAD_MESSAGE, and in tests a leaked `seed`, `bag` or `queue` key fails (REQ-028).
 *
 * Types are derived from these schemas in `messages.ts` (`z.infer`), never written twice.
 * Units (architecture §3.2) are stated on every numeric field.
 */
import * as z from 'zod';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  LINE_ATTACK,
  LOCK_DELAY_TICKS,
  MAX_LEVEL,
  MAX_LOCK_RESETS,
  PREVIEW_COUNT,
} from '@stackerist/engine';
import {
  ERROR_CODES,
  MAX_HEIGHT_SAMPLES,
  MAX_PAUSES_PER_SERIES,
  MAX_ROUND_NUMBER,
  MAX_ROUND_SUMMARIES,
  MAX_SNAPSHOT_EVENTS,
  MAX_WIRE_INT,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  NAME_RAW_MAX_LENGTH,
  PUBLIC_PREVIEW_COUNT,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_INPUT_MAX_LENGTH,
  ROOM_CODE_LENGTH,
  SEAT_TOKEN_LENGTH,
  SERIES_WINS_NEEDED,
} from './constants.js';

// ---- Numeric building blocks (all integers; z.int() is the safe-integer range) ----
/** A count ≥ 0. */
const CountSchema = z.int().nonnegative();
/** Rows (integer ≥ 0). */
const RowsSchema = z.int().nonnegative();
/** Match tick: integer, 60/s, absolute; 0..2^31−1. */
const TickSchema = z.int().min(0).max(MAX_WIRE_INT);
/** Ticks as a duration (integer ≥ 0). */
const TickDurationSchema = z.int().nonnegative();
/** Server wall clock, ms since the Unix epoch (integer ≥ 0). */
const EpochMsSchema = z.int().nonnegative();
/** A duration in ms (integer ≥ 0). */
const DurationMsSchema = z.int().nonnegative();
/** Opaque server monotonic ms (integer ≥ 0), echoed back unchanged. */
const MonotonicMsSchema = z.int().nonnegative();
/** Board column, cells: 0..BOARD_WIDTH−1. */
const ColumnSchema = z
  .int()
  .min(0)
  .max(BOARD_WIDTH - 1);
/** Board row index, cells: 0..BOARD_HEIGHT−1. */
const RowIndexSchema = z
  .int()
  .min(0)
  .max(BOARD_HEIGHT - 1);
/** Round number in a series: 1..MAX_ROUND_NUMBER (3). */
const RoundNumberSchema = z.int().min(1).max(MAX_ROUND_NUMBER);

// ---- Identity, codes, names ----
export const SeatSchema = z.enum(['A', 'B']);
/** A seated player or a spectator (the `joined.seat` field). */
export const RoleSchema = z.enum([...SeatSchema.options, 'spectator']);

const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${String(ROOM_CODE_LENGTH)}}$`, 'i');
/**
 * The one room-code validator (REQ-020). Trims, accepts the 31-character alphabet in either case at
 * length ROOM_CODE_LENGTH, and outputs the canonical upper-case code. `normalizeRoomCode` wraps it.
 * The case-insensitive match is ASCII-only (no `u` flag), so no non-ASCII look-alike is accepted.
 */
export const RoomCodeSchema = z.string().trim().regex(ROOM_CODE_PATTERN).toUpperCase();
/**
 * The raw `code` in join/rejoin: 1..16 code points, not normalised. The server runs `normalizeRoomCode`
 * on it, so a malformed code is ROOM_NOT_FOUND rather than BAD_MESSAGE (architecture §3.5).
 */
export const RoomCodeInputSchema = z.string().min(1).max(ROOM_CODE_INPUT_MAX_LENGTH);
/**
 * Characters that look blank, are a long phrase in one glyph, or are otherwise unreadable, refused by
 * code point (security re-review N4): the Hangul fillers U+3164, U+FFA0, U+115F and U+1160, the braille
 * blank U+2800, the Khmer inherent vowels U+17B4 and U+17B5, and the Arabic ligatures U+FDFD and U+FDFC
 * (one code point that renders as a whole phrase). A short explicit list on purpose: homoglyph spoofing
 * in general (a Cyrillic letter that looks Latin) is NOT solved here and is out of scope.
 */
const DENIED_NAME_CODE_POINTS = [
  0x3164, 0xffa0, 0x115f, 0x1160, 0x2800, 0x17b4, 0x17b5, 0xfdfd, 0xfdfc,
];
/**
 * What a name may not contain (security review F7 and re-review N4): control characters (Unicode Cc: NUL,
 * newline, tab, DEL, C1), format characters (Cf: zero-width, bidirectional overrides and isolates, marks,
 * BOM, soft hyphen, tags), the line and paragraph separators, private-use (Co), unassigned (Cn) and
 * surrogate (Cs) code points, and the DENIED_NAME_CODE_POINTS. The separators and the denied characters
 * are added from their code points so no invisible character sits in this file. Emoji are refused
 * separately (NAME_EMOJI_PATTERN). One character class: it matches in time linear in the input.
 */
const FORBIDDEN_NAME_CHARS = new RegExp(
  [
    '\\p{Cc}',
    '\\p{Cf}',
    '\\p{Co}',
    '\\p{Cn}',
    '\\p{Cs}',
    // The line and paragraph separators and the denied characters, one alternative each, written as
    // \u{...} escapes (no literal character, and no character class that mixes marks with letters).
    ...[0x2028, 0x2029, ...DENIED_NAME_CODE_POINTS].map((c) => `\\u{${c.toString(16)}}`),
  ].join('|'),
  'u',
);
/**
 * Three combining marks (\p{M}) in a row. Real scripts stack at most two (Thai: a vowel and a tone mark;
 * Vietnamese: a vowel mark and a tone), so a longer run is "zalgo" text that overflows its line. A fixed
 * repeat of a single class: linear, no nested quantifier, nothing to backtrack.
 */
const MARK_RUN_PATTERN = /\p{M}{3}/u;
/** A letter or a digit: a name that has none (only marks, symbols or punctuation) is not readable. */
const LETTER_OR_DIGIT_PATTERN = /[\p{L}\p{N}]/u;
/**
 * Emoji a name may not contain (REQ-044; owner decision 2026-11-10: "refuse emoji for better name
 * readability"). The guaranteed rule, the same on every Node build whatever its Unicode data: the
 * explicit blocks U+1F000..U+1F2FF (mahjong, cards, enclosed symbols) and U+1F300..U+1FAFF (the
 * pictograph, emoticon, transport and supplemental blocks, which include the skin-tone modifiers),
 * regional indicators (flags), the variation selectors U+FE0E and U+FE0F, the combining enclosing keycap
 * U+20E3, and, through the zero-width joiner (a format character), every joined sequence (a family, an
 * astronaut). On top of that the Unicode properties Extended_Pictographic, Regional_Indicator and
 * Emoji_Modifier are refused, so an emoji outside those blocks is refused when the Node build's table
 * knows it. Text-style symbols (a star, a heart, a smiley, the copyright, registered and trade mark signs)
 * are NOT part of the guarantee: they may or may not be refused, depending on the Unicode data of the
 * Node build, and no test asserts either way. The digits and the keycap bases `#` and `*` are not
 * pictographic, so they stay allowed. Built from escapes and code points so no emoji sits in this file.
 * Every part is a single class or a fixed range: linear, nothing nested to backtrack. Not global (`g`),
 * so `.test` is stateless and safe to share with the client.
 */
export const NAME_EMOJI_PATTERN = new RegExp(
  [
    '[\\u{1f000}-\\u{1f2ff}]',
    '[\\u{1f300}-\\u{1faff}]',
    '[\\u{1f1e6}-\\u{1f1ff}]',
    `[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\p{Emoji_Modifier}${String.fromCodePoint(
      0xfe0e,
      0xfe0f,
      0x20e3,
    )}]`,
  ].join('|'),
  'u',
);
/** True when the text holds an emoji or pictographic symbol that `NameSchema` refuses (REQ-044). */
export function nameHasEmoji(text: string): boolean {
  return NAME_EMOJI_PATTERN.test(text);
}
/** The character rules, run on the name as typed and again on its NFKC form (no stage trusts the other). */
const nameCharacterRules = (name: string): boolean =>
  !FORBIDDEN_NAME_CHARS.test(name) &&
  !NAME_EMOJI_PATTERN.test(name) &&
  !MARK_RUN_PATTERN.test(name);
const NAME_CHARACTER_MESSAGE =
  'A name is readable text: letters, numbers and punctuation, with no emoji, hidden, control, bidirectional or stacked combining characters';

/**
 * Player name (REQ-044, security review F7 and re-review N4), in three stages so that hostile input
 * costs a few microseconds. 1) Trimmed and at most NAME_RAW_MAX_LENGTH code points (a larger input is
 * refused untouched, before anything is normalized or scanned). 2) The character rules on the text as
 * typed: no control, format, bidirectional, private-use, unassigned or surrogate code point, no blank-
 * looking or phrase-sized character (DENIED_NAME_CODE_POINTS), no emoji, no run of three combining
 * marks. This stage also refuses what NFKC would otherwise rewrite into something allowed (the trade
 * mark sign becomes "TM", U+FDFD becomes a phrase). 3) NFKC-normalized (full-width and mathematical
 * look-alike letters become plain letters, a decomposed accent composes), trimmed again, then
 * NAME_MIN_LENGTH..NAME_MAX_LENGTH Unicode code points counted on the normalized text (zod 4.6 counts a
 * surrogate pair once), the same character rules again, and at least one letter or digit.
 * The output is the normalized name. Homoglyph spoofing in general is out of scope. The one name
 * validator: the UI uses it too.
 */
export const NameSchema = z
  .string()
  .trim()
  .max(NAME_RAW_MAX_LENGTH)
  .pipe(z.string().refine(nameCharacterRules, { message: NAME_CHARACTER_MESSAGE }))
  .pipe(
    z
      .string()
      .normalize('NFKC')
      .trim()
      .min(NAME_MIN_LENGTH)
      .max(NAME_MAX_LENGTH)
      .refine(nameCharacterRules, { message: NAME_CHARACTER_MESSAGE })
      // An empty name is the length rule's to report (min above), not "no letter".
      .refine((name) => name === '' || LETTER_OR_DIGIT_PATTERN.test(name), {
        message: 'A name needs at least one letter or digit',
      }),
  );
/** Seat token: SEAT_TOKEN_LENGTH base64url characters, no padding (128-bit). */
export const SeatTokenSchema = z
  .string()
  .regex(new RegExp(`^[A-Za-z0-9_-]{${String(SEAT_TOKEN_LENGTH)}}$`));

export const RoomStatusSchema = z.enum([
  'waiting',
  'countdown',
  'playing',
  'paused',
  'roundOver',
  'seriesOver',
]);
export const GameOverReasonSchema = z.enum([
  'TOP_OUT',
  'OPPONENT_LEFT',
  'OPPONENT_DISCONNECTED',
  'DRAW',
]);
export const SeriesEndReasonSchema = z.enum(['TWO_WINS', 'OPPONENT_LEFT', 'OPPONENT_DISCONNECTED']);
export const ErrorCodeSchema = z.enum(ERROR_CODES);

// ---- Game shapes mirrored from the engine (typeAssertions.ts proves they match) ----
export const PieceKindSchema = z.enum(['I', 'O', 'T', 'S', 'Z', 'J', 'L']);
/** 0 = spawn, 1 = R (one CW turn), 2 = 180°, 3 = L (one CCW turn). */
export const RotationSchema = z.literal([0, 1, 2, 3]);
export const ActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('moveLeft') }),
  z.strictObject({ type: z.literal('moveRight') }),
  z.strictObject({ type: z.literal('rotateCW') }),
  z.strictObject({ type: z.literal('rotateCCW') }),
  z.strictObject({ type: z.literal('softDropStart') }),
  z.strictObject({ type: z.literal('softDropStop') }),
  z.strictObject({ type: z.literal('hardDrop') }),
]);

const BOARD_ROW_PATTERN = new RegExp(
  `^[.${PieceKindSchema.options.join('')}G]{${String(BOARD_WIDTH)}}$`,
);
/** BOARD_HEIGHT (20) rows, top first, each BOARD_WIDTH (10) of '.', a piece letter or 'G'. */
export const BoardSchema = z.array(z.string().regex(BOARD_ROW_PATTERN)).length(BOARD_HEIGHT);

export const WireCellSchema = z.strictObject({
  /** Column, cells (0..9). */
  x: ColumnSchema,
  /** Row, cells (0..19). */
  y: RowIndexSchema,
});
export const WireActivePieceSchema = z.strictObject({
  kind: PieceKindSchema,
  rotation: RotationSchema,
  /** Box-origin column, cells; may be negative. */
  x: z.int(),
  /** Box-origin row, cells; may be negative. */
  y: z.int(),
});
export const WireGarbageAttackSchema = z.strictObject({
  /** Garbage rows in this attack (≥ 1). */
  rows: z.int().min(1),
  /** The empty cell's column, cells (0..9). */
  holeColumn: ColumnSchema,
});

// ---- Views (architecture §3.4, §3.8) ----
/** Live stats in every view. Rows for garbage*, counts for the rest. */
export const LiveStatsSchema = z.strictObject({
  /** Count. */
  linesCleared: CountSchema,
  /** Rows sent after cancelling. */
  garbageSent: RowsSchema,
  /** Rows of own pending garbage cancelled. */
  garbageCancelled: RowsSchema,
  /** Rows routed to this player (cancelled, inserted or still pending). */
  garbageReceived: RowsSchema,
  /** Rows actually inserted into the board. */
  garbageInserted: RowsSchema,
  /** Count. */
  piecesPlaced: CountSchema,
  /** Count. */
  bestCombo: CountSchema,
});
/** Opponents and spectators: board, active piece, next 1, pending total, combo, stats. Nothing else. */
export const PublicViewSchema = z.strictObject({
  board: BoardSchema,
  active: WireActivePieceSchema.nullable(),
  /** The next piece only: length 0..PUBLIC_PREVIEW_COUNT (1). */
  next: z.array(PieceKindSchema).max(PUBLIC_PREVIEW_COUNT),
  /** Total pending garbage, rows. */
  pendingGarbage: RowsSchema,
  /** Current combo, count. */
  combo: CountSchema,
  stats: LiveStatsSchema,
  toppedOut: z.boolean(),
});
/** The board's owner only. Piece timers are included so prediction re-simulates exactly (REQ-054/082). */
export const OwnViewSchema = z.strictObject({
  board: BoardSchema,
  active: WireActivePieceSchema.nullable(),
  /** The preview: length 0..PREVIEW_COUNT (5). */
  next: z.array(PieceKindSchema).max(PREVIEW_COUNT),
  /** Incoming attacks, oldest first, with hole columns (needed to predict insertion). */
  pendingGarbage: z.array(WireGarbageAttackSchema),
  /** Highest seq whose input has been applied or discarded; 0 = nothing acknowledged. */
  lastAckSeq: z.int().min(0).max(MAX_WIRE_INT),
  /** Current combo, count. */
  combo: CountSchema,
  stats: LiveStatsSchema,
  toppedOut: z.boolean(),
  softDrop: z.boolean(),
  /** Ticks counted toward the next gravity row. */
  gravityCounter: TickDurationSchema,
  /** Consecutive grounded ticks, 0..LOCK_DELAY_TICKS. */
  lockCounter: z.int().min(0).max(LOCK_DELAY_TICKS),
  /** Lock-delay resets used, count 0..MAX_LOCK_RESETS. */
  lockResets: z.int().min(0).max(MAX_LOCK_RESETS),
  /** Largest box-origin y reached since spawn, row index (may be negative). */
  lowestY: z.int(),
});

// ---- Round results (architecture §3.4; design §5.4, §5.7, §6) ----
const MAX_LINES_PER_LOCK = LINE_ATTACK.length - 1; // 4
const PIECE_CELL_COUNT = 4; // a tetromino
export const WireBestMomentSchema = z.strictObject({
  /** The board with the finishing piece written, before full rows were removed. */
  board: BoardSchema,
  /** Row indices of the cleared rows in `board`, ascending, 1..4 entries. */
  clearedRows: z.array(RowIndexSchema).min(1).max(MAX_LINES_PER_LOCK),
  /** The finishing piece's cells in `board` coordinates: exactly 4. */
  pieceCells: z.array(WireCellSchema).length(PIECE_CELL_COUNT),
  /** Combo after this lock, count ≥ 1. */
  combo: z.int().min(1),
  /** Rows cleared by this lock, 1..4. */
  linesCleared: z.int().min(1).max(MAX_LINES_PER_LOCK),
  /** Attack before cancelling, rows. */
  attack: RowsSchema,
  /** Rows sent after cancelling. */
  sent: RowsSchema,
  /** Rows of own pending garbage cancelled. */
  cancelled: RowsSchema,
  /** Match tick of the lock. */
  tick: TickSchema,
});
/** Per-seat round stats carried by gameOver (design §6, REQ-046). */
export const PlayerStatsSchema = z.strictObject({
  /** Count. */
  linesCleared: CountSchema,
  /** Rows sent after cancelling. */
  garbageSent: RowsSchema,
  /** Rows cancelled. */
  garbageCancelled: RowsSchema,
  /** Count. */
  piecesPlaced: CountSchema,
  /** Count. */
  bestCombo: CountSchema,
  /** null when the player cleared no lines. */
  bestMoment: WireBestMomentSchema.nullable(),
});
/** One per seat per round (REQ-090, design §5.7). */
export const RoundReportSchema = z.strictObject({
  /** Count. */
  piecesPlaced: CountSchema,
  /** Inputs drained and applied this round, count. */
  actions: CountSchema,
  /** Rows sent after cancelling. */
  garbageSent: RowsSchema,
  /** Rows routed to this player (cancelled, inserted or still pending). */
  garbageReceived: RowsSchema,
  /** Rows cancelled. */
  garbageCancelled: RowsSchema,
  /** Ticks processed while playing (pauses and countdowns excluded). */
  durationTicks: TickDurationSchema,
  /** Stack height in rows (0..20) at round-relative ticks 0, 30, 60, …; ≤ MAX_HEIGHT_SAMPLES entries. */
  heightSamples: z.array(z.int().min(0).max(BOARD_HEIGHT)).max(MAX_HEIGHT_SAMPLES),
});
export const RoundSummarySchema = z.strictObject({
  /** Round number, 1..3. */
  round: RoundNumberSchema,
  /** True when this round number was a replay after a draw. */
  replay: z.boolean(),
  winner: SeatSchema.nullable(),
  reason: GameOverReasonSchema,
  /** Ticks played in the round. */
  durationTicks: TickDurationSchema,
});
export const SeriesViewSchema = z
  .strictObject({
    /** The current round, or the last one played: 1..3. */
    round: RoundNumberSchema,
    /** True while this round number is being replayed after a draw. */
    replay: z.boolean(),
    /** Round wins, 0..SERIES_WINS_NEEDED (2). A forfeit adds no win. */
    score: z.strictObject({
      A: z.int().min(0).max(SERIES_WINS_NEEDED),
      B: z.int().min(0).max(SERIES_WINS_NEEDED),
    }),
    over: z.boolean(),
    /** Non-null iff `over`. */
    winner: SeatSchema.nullable(),
    /** Non-null iff `over`. */
    endReason: SeriesEndReasonSchema.nullable(),
    /** Completed rounds in order, including draws and a forfeited round; ≤ MAX_ROUND_SUMMARIES. */
    rounds: z.array(RoundSummarySchema).max(MAX_ROUND_SUMMARIES),
  })
  .refine(
    (s) => s.over === (s.winner !== null) && s.over === (s.endReason !== null),
    'winner and endReason are set exactly when the series is over',
  );
/** Visual-only events since the previous snapshot (REQ-087). No hole columns; nothing beyond PublicView. */
export const SnapshotEventSchema = z.discriminatedUnion('type', [
  /** Leftover rows routed from `from` to the other seat. */
  z.strictObject({
    type: z.literal('attack'),
    from: SeatSchema,
    rows: z.int().min(1),
    tick: TickSchema,
  }),
  /** Rows `seat` cancelled from its own pending garbage. */
  z.strictObject({
    type: z.literal('cancel'),
    seat: SeatSchema,
    rows: z.int().min(1),
    tick: TickSchema,
  }),
]);
export const PlayerInfoSchema = z.strictObject({ name: NameSchema, connected: z.boolean() });

/** `{ A?: T; B?: T }`, strict. */
function bySeat<T extends z.ZodType>(schema: T) {
  return z.strictObject({ A: schema.optional(), B: schema.optional() });
}

// ---- Client → server (architecture §3.5). No client message carries game state (REQ-036). ----
export const CreateMessageSchema = z.strictObject({ type: z.literal('create'), name: NameSchema });
/** `name` is required unless `asSpectator === true` (the refine keeps it a ZodObject). */
export const JoinMessageSchema = z
  .strictObject({
    type: z.literal('join'),
    code: RoomCodeInputSchema,
    name: NameSchema.optional(),
    asSpectator: z.boolean().optional(),
  })
  .refine(
    (m) => m.asSpectator === true || m.name !== undefined,
    'name is required unless asSpectator is true',
  );
export const RejoinMessageSchema = z.strictObject({
  type: z.literal('rejoin'),
  code: RoomCodeInputSchema,
  token: SeatTokenSchema,
});
export const InputMessageSchema = z.strictObject({
  type: z.literal('input'),
  /** 1..2^31−1, strictly increasing per seat binding per round. */
  seq: z.int().min(1).max(MAX_WIRE_INT),
  /** The match tick to apply it at: 0..2^31−1. */
  tick: TickSchema,
  action: ActionSchema,
});
export const LeaveMessageSchema = z.strictObject({ type: z.literal('leave') });
/** "Next round" in roundOver, "New series" in seriesOver. */
export const RematchMessageSchema = z.strictObject({ type: z.literal('rematch') });
export const PongMessageSchema = z.strictObject({
  type: z.literal('pong'),
  /** Echo of `ping.t`: opaque server monotonic ms. */
  t: MonotonicMsSchema,
});
export const ClientMessageSchema = z.discriminatedUnion('type', [
  CreateMessageSchema,
  JoinMessageSchema,
  RejoinMessageSchema,
  InputMessageSchema,
  LeaveMessageSchema,
  RematchMessageSchema,
  PongMessageSchema,
]);

// ---- Server → client (architecture §3.6) ----
export const CreatedMessageSchema = z.strictObject({
  type: z.literal('created'),
  code: RoomCodeSchema,
  token: SeatTokenSchema,
  seat: z.literal('A'),
});
/** `token` only on a first seat join; a spectator never gets one. */
export const JoinedMessageSchema = z
  .strictObject({
    type: z.literal('joined'),
    code: RoomCodeSchema,
    seat: RoleSchema,
    token: SeatTokenSchema.optional(),
  })
  .refine((m) => m.seat !== 'spectator' || m.token === undefined, 'a spectator gets no token');
export const RoomMessageSchema = z.strictObject({
  type: z.literal('room'),
  code: RoomCodeSchema,
  status: RoomStatusSchema,
  players: bySeat(PlayerInfoSchema),
  /** Spectators watching, count. */
  spectators: CountSchema,
  series: SeriesViewSchema,
});
export const CountdownMessageSchema = z.strictObject({
  type: z.literal('countdown'),
  /** Play starts at this server time, ms since epoch. */
  startsAt: EpochMsSchema,
  /** Server time when sent, ms since epoch. */
  serverNow: EpochMsSchema,
  /** The match tick play starts at (`startTick`, 0 in production). */
  tick: TickSchema,
});
export const SnapshotMessageSchema = z.strictObject({
  type: z.literal('snapshot'),
  /** The match tick the states are at (the next tick the server will process). */
  tick: TickSchema,
  /** levelForTick(tick): 0-based GRAVITY_TABLE index, 0..MAX_LEVEL (12). The HUD shows level + 1. */
  level: z.int().min(0).max(MAX_LEVEL),
  /** Only to a seated recipient: their own board. */
  you: OwnViewSchema.optional(),
  /** A PublicView for every seated player, the recipient's own seat included. */
  players: bySeat(PublicViewSchema),
  /** ≤ MAX_SNAPSHOT_EVENTS (64). */
  events: z.array(SnapshotEventSchema).max(MAX_SNAPSHOT_EVENTS),
});
export const PausedMessageSchema = z.strictObject({
  type: z.literal('paused'),
  /** The seat that disconnected. */
  seat: SeatSchema,
  /** Grace expiry, server ms since epoch. */
  graceEndsAt: EpochMsSchema,
  /** Server time when sent, ms since epoch. */
  serverNow: EpochMsSchema,
  /** Pauses `seat` has left this series, count 0..MAX_PAUSES_PER_SERIES (3). */
  pausesLeft: z.int().min(0).max(MAX_PAUSES_PER_SERIES),
});
export const ResumedMessageSchema = z.strictObject({
  type: z.literal('resumed'),
  /** Play resumes at this server time, ms since epoch. */
  startsAt: EpochMsSchema,
  /** Server time when sent, ms since epoch. */
  serverNow: EpochMsSchema,
  /** The match tick play resumes at. */
  tick: TickSchema,
});
export const GameOverMessageSchema = z.strictObject({
  type: z.literal('gameOver'),
  /** Round number, 1..3. */
  round: RoundNumberSchema,
  /** True when this round was a replay after a draw. */
  replay: z.boolean(),
  /** null on a draw. */
  winner: SeatSchema.nullable(),
  reason: GameOverReasonSchema,
  /** The match tick the round ended at. */
  tick: TickSchema,
  /** The series after applying this round. */
  series: SeriesViewSchema,
  stats: bySeat(PlayerStatsSchema),
  report: bySeat(RoundReportSchema),
});
/** Ready flags for Next round / New series. */
export const RematchStatusMessageSchema = z.strictObject({
  type: z.literal('rematchStatus'),
  A: z.boolean(),
  B: z.boolean(),
});
export const ErrorMessageSchema = z.strictObject({
  type: z.literal('error'),
  code: ErrorCodeSchema,
  /** Developer-facing detail. The UI shows DESIGN.md copy mapped from `code`, never this text. */
  message: z.string(),
});
export const PingMessageSchema = z.strictObject({
  type: z.literal('ping'),
  /** Opaque server monotonic ms; the client echoes it in `pong.t`. */
  t: MonotonicMsSchema,
  /** The server's last measured round trip for this connection, ms; null until measured. */
  rtt: DurationMsSchema.nullable(),
});
export const ServerMessageSchema = z.discriminatedUnion('type', [
  CreatedMessageSchema,
  JoinedMessageSchema,
  RoomMessageSchema,
  CountdownMessageSchema,
  SnapshotMessageSchema,
  PausedMessageSchema,
  ResumedMessageSchema,
  GameOverMessageSchema,
  RematchStatusMessageSchema,
  ErrorMessageSchema,
  PingMessageSchema,
]);

/** Every client→server `type`, in schema order. Derived from the union, so it can't drift. */
export const CLIENT_MESSAGE_TYPES = ClientMessageSchema.options.map((o) => o.shape.type.value);
/** Every server→client `type`, in schema order. Derived from the union, so it can't drift. */
export const SERVER_MESSAGE_TYPES = ServerMessageSchema.options.map((o) => o.shape.type.value);
