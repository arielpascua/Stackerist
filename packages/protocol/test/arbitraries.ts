/**
 * fast-check generators for valid wire values. Every arbitrary is typed by the real `z.infer` wire
 * type (or the engine type), so the compiler rejects a generator that drifts from the contract;
 * the schemas then decide at runtime whether each generated value is valid.
 */
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  LOCK_DELAY_TICKS,
  MAX_LOCK_RESETS,
  PREVIEW_COUNT,
  type BagState,
  type PieceKind,
  type PlayerState,
} from '@stackerist/engine';
import fc from 'fast-check';
import {
  ERROR_CODES,
  MAX_PAUSES_PER_SERIES,
  MAX_ROUND_NUMBER,
  MAX_WIRE_INT,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  PUBLIC_PREVIEW_COUNT,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_INPUT_MAX_LENGTH,
  ROOM_CODE_LENGTH,
  SEAT_TOKEN_LENGTH,
  SERIES_WINS_NEEDED,
  type ClientMessage,
  type CountdownMessage,
  type CreatedMessage,
  type CreateMessage,
  type ErrorMessage,
  type GameOverMessage,
  type GameOverReason,
  type InputMessage,
  type JoinedMessage,
  type JoinMessage,
  type LiveStats,
  type OwnView,
  type PausedMessage,
  type PingMessage,
  type PlayerInfo,
  type PlayerStats,
  type PongMessage,
  type PublicView,
  type RejoinMessage,
  type RematchStatusMessage,
  type ResumedMessage,
  type RoomMessage,
  type RoomStatus,
  type RoundReport,
  type RoundSummary,
  type Seat,
  type SeriesEndReason,
  type SeriesView,
  type ServerMessage,
  type SnapshotEvent,
  type SnapshotMessage,
  type WireAction,
  type WireActivePiece,
  type WireBestMoment,
  type WireCell,
  type WireGarbageAttack,
  type WireRotation,
} from '../src/index.js';

const REC = { noNullPrototype: true } as const;

// ---- Scalars ----
export const seatArb: fc.Arbitrary<Seat> = fc.constantFrom('A', 'B');
export const pieceKindArb: fc.Arbitrary<PieceKind> = fc.constantFrom(
  'I',
  'O',
  'T',
  'S',
  'Z',
  'J',
  'L',
);
export const rotationArb: fc.Arbitrary<WireRotation> = fc.constantFrom(0, 1, 2, 3);
export const actionArb: fc.Arbitrary<WireAction> = fc.constantFrom(
  { type: 'moveLeft' },
  { type: 'moveRight' },
  { type: 'rotateCW' },
  { type: 'rotateCCW' },
  { type: 'softDropStart' },
  { type: 'softDropStop' },
  { type: 'hardDrop' },
);
/** Match ticks (0..2^31−1). */
export const tickArb = fc.integer({ min: 0, max: MAX_WIRE_INT });
/** seq (1..2^31−1). */
export const seqArb = fc.integer({ min: 1, max: MAX_WIRE_INT });
/** Counts and rows. */
export const countArb = fc.nat({ max: 1_000_000 });
/** Server ms since the epoch / opaque monotonic ms: any safe non-negative integer. */
export const msArb = fc.maxSafeNat();

const cellCharArb = fc.constantFrom('.', 'I', 'O', 'T', 'S', 'Z', 'J', 'L', 'G');
export const boardArb: fc.Arbitrary<string[]> = fc.array(
  fc.string({ unit: cellCharArb, minLength: BOARD_WIDTH, maxLength: BOARD_WIDTH }),
  { minLength: BOARD_HEIGHT, maxLength: BOARD_HEIGHT },
);
/** Canonical room codes: 6 upper-case characters of the alphabet. */
export const roomCodeArb = fc.string({
  unit: fc.constantFrom(...ROOM_CODE_ALPHABET.split('')), // ASCII only
  minLength: ROOM_CODE_LENGTH,
  maxLength: ROOM_CODE_LENGTH,
});
/** The raw join/rejoin `code`: any 1..16-character string (normalised later by the server). */
export const rawCodeArb = fc
  .oneof(
    roomCodeArb,
    roomCodeArb.map((c) => ` ${c.toLowerCase()} `),
    fc.string({ unit: 'binary', minLength: 1, maxLength: ROOM_CODE_INPUT_MAX_LENGTH }),
  )
  .filter((c) => c.length >= 1 && c.length <= ROOM_CODE_INPUT_MAX_LENGTH);
export const seatTokenArb = fc.string({
  unit: fc.constantFrom(
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split(''),
  ),
  minLength: SEAT_TOKEN_LENGTH,
  maxLength: SEAT_TOKEN_LENGTH,
});
/** Length in Unicode code points (a surrogate pair counts once), the unit zod 4.6 measures. */
export const codePoints = (s: string): number => Array.from(s).length;

/** Canonical (already trimmed) names of 1..16 code points, including control and astral characters. */
export const nameArb = fc
  .oneof(
    fc.string({ unit: 'grapheme-ascii', minLength: 1, maxLength: NAME_MAX_LENGTH }),
    fc.string({ unit: 'grapheme', minLength: 1, maxLength: NAME_MAX_LENGTH }),
    fc.string({ unit: 'binary-ascii', minLength: 1, maxLength: NAME_MAX_LENGTH }),
    fc.string({ unit: 'binary', minLength: 1, maxLength: NAME_MAX_LENGTH }),
  )
  .filter(
    (s) => s.trim() === s && codePoints(s) >= NAME_MIN_LENGTH && codePoints(s) <= NAME_MAX_LENGTH,
  );

// ---- Game shapes ----
export const garbageAttackArb: fc.Arbitrary<WireGarbageAttack> = fc.record(
  {
    rows: fc.integer({ min: 1, max: 8 }),
    holeColumn: fc.integer({ min: 0, max: BOARD_WIDTH - 1 }),
  },
  REC,
);
export const activePieceArb: fc.Arbitrary<WireActivePiece> = fc.record(
  {
    kind: pieceKindArb,
    rotation: rotationArb,
    x: fc.integer({ min: -2, max: BOARD_WIDTH - 1 }),
    y: fc.integer({ min: -2, max: BOARD_HEIGHT - 1 }),
  },
  REC,
);
export const cellArb: fc.Arbitrary<WireCell> = fc.record(
  {
    x: fc.integer({ min: 0, max: BOARD_WIDTH - 1 }),
    y: fc.integer({ min: 0, max: BOARD_HEIGHT - 1 }),
  },
  REC,
);
export const liveStatsArb: fc.Arbitrary<LiveStats> = fc.record(
  {
    linesCleared: countArb,
    garbageSent: countArb,
    garbageCancelled: countArb,
    garbageReceived: countArb,
    garbageInserted: countArb,
    piecesPlaced: countArb,
    bestCombo: countArb,
  },
  REC,
);
export const publicViewArb: fc.Arbitrary<PublicView> = fc.record(
  {
    board: boardArb,
    active: fc.option(activePieceArb, { nil: null }),
    next: fc.array(pieceKindArb, { maxLength: PUBLIC_PREVIEW_COUNT }),
    pendingGarbage: countArb,
    combo: countArb,
    stats: liveStatsArb,
    toppedOut: fc.boolean(),
  },
  REC,
);
export const ownViewArb: fc.Arbitrary<OwnView> = fc.record(
  {
    board: boardArb,
    active: fc.option(activePieceArb, { nil: null }),
    next: fc.array(pieceKindArb, { maxLength: PREVIEW_COUNT }),
    pendingGarbage: fc.array(garbageAttackArb, { maxLength: 6 }),
    lastAckSeq: fc.integer({ min: 0, max: MAX_WIRE_INT }),
    combo: countArb,
    stats: liveStatsArb,
    toppedOut: fc.boolean(),
    softDrop: fc.boolean(),
    gravityCounter: fc.integer({ min: 0, max: 59 }),
    lockCounter: fc.integer({ min: 0, max: LOCK_DELAY_TICKS }),
    lockResets: fc.integer({ min: 0, max: MAX_LOCK_RESETS }),
    lowestY: fc.integer({ min: -2, max: BOARD_HEIGHT - 1 }),
  },
  REC,
);
export const bestMomentArb: fc.Arbitrary<WireBestMoment> = fc.record(
  {
    board: boardArb,
    clearedRows: fc
      .uniqueArray(fc.integer({ min: 0, max: BOARD_HEIGHT - 1 }), { minLength: 1, maxLength: 4 })
      .map((rows) => [...rows].sort((a, b) => a - b)),
    pieceCells: fc.array(cellArb, { minLength: 4, maxLength: 4 }),
    combo: fc.integer({ min: 1, max: 200 }),
    linesCleared: fc.integer({ min: 1, max: 4 }),
    attack: countArb,
    sent: countArb,
    cancelled: countArb,
    tick: tickArb,
  },
  REC,
);
export const playerStatsArb: fc.Arbitrary<PlayerStats> = fc.record(
  {
    linesCleared: countArb,
    garbageSent: countArb,
    garbageCancelled: countArb,
    piecesPlaced: countArb,
    bestCombo: countArb,
    bestMoment: fc.option(bestMomentArb, { nil: null }),
  },
  REC,
);
export const roundReportArb: fc.Arbitrary<RoundReport> = fc.record(
  {
    piecesPlaced: countArb,
    actions: countArb,
    garbageSent: countArb,
    garbageReceived: countArb,
    garbageCancelled: countArb,
    durationTicks: countArb,
    heightSamples: fc.array(fc.integer({ min: 0, max: BOARD_HEIGHT }), { maxLength: 40 }),
  },
  REC,
);
const roundArb = fc.integer({ min: 1, max: MAX_ROUND_NUMBER });
const gameOverReasonArb: fc.Arbitrary<GameOverReason> = fc.constantFrom(
  'TOP_OUT',
  'OPPONENT_LEFT',
  'OPPONENT_DISCONNECTED',
  'DRAW',
);
const seriesEndReasonArb: fc.Arbitrary<SeriesEndReason> = fc.constantFrom(
  'TWO_WINS',
  'OPPONENT_LEFT',
  'OPPONENT_DISCONNECTED',
);
export const roundSummaryArb: fc.Arbitrary<RoundSummary> = fc.record(
  {
    round: roundArb,
    replay: fc.boolean(),
    winner: fc.option(seatArb, { nil: null }),
    reason: gameOverReasonArb,
    durationTicks: countArb,
  },
  REC,
);
const scoreArb = fc.record(
  {
    A: fc.integer({ min: 0, max: SERIES_WINS_NEEDED }),
    B: fc.integer({ min: 0, max: SERIES_WINS_NEEDED }),
  },
  REC,
);
const seriesCommon = {
  round: roundArb,
  replay: fc.boolean(),
  score: scoreArb,
  rounds: fc.array(roundSummaryArb, { maxLength: 6 }),
};
export const seriesViewArb: fc.Arbitrary<SeriesView> = fc.oneof(
  fc.record(
    {
      ...seriesCommon,
      over: fc.constant(false),
      winner: fc.constant(null),
      endReason: fc.constant(null),
    },
    REC,
  ),
  fc.record(
    { ...seriesCommon, over: fc.constant(true), winner: seatArb, endReason: seriesEndReasonArb },
    REC,
  ),
);
export const snapshotEventArb: fc.Arbitrary<SnapshotEvent> = fc.oneof(
  fc.record(
    {
      type: fc.constant('attack'),
      from: seatArb,
      rows: fc.integer({ min: 1, max: 8 }),
      tick: tickArb,
    },
    REC,
  ),
  fc.record(
    {
      type: fc.constant('cancel'),
      seat: seatArb,
      rows: fc.integer({ min: 1, max: 8 }),
      tick: tickArb,
    },
    REC,
  ),
);
export const playerInfoArb: fc.Arbitrary<PlayerInfo> = fc.record(
  { name: nameArb, connected: fc.boolean() },
  REC,
);
/** `{ A?: T; B?: T }` with any subset of the seats present. */
function bySeatArb<T>(arb: fc.Arbitrary<T>): fc.Arbitrary<{ A?: T; B?: T }> {
  return fc.record({ A: arb, B: arb }, { requiredKeys: [], noNullPrototype: true });
}

// ---- Client → server messages ----
export const createArb: fc.Arbitrary<CreateMessage> = fc.record(
  { type: fc.constant('create'), name: nameArb },
  REC,
);
export const joinArb: fc.Arbitrary<JoinMessage> = fc.oneof(
  fc.record(
    { type: fc.constant('join'), code: rawCodeArb, name: nameArb, asSpectator: fc.boolean() },
    { requiredKeys: ['type', 'code', 'name'], noNullPrototype: true },
  ),
  fc.record(
    { type: fc.constant('join'), code: rawCodeArb, name: nameArb, asSpectator: fc.constant(true) },
    { requiredKeys: ['type', 'code', 'asSpectator'], noNullPrototype: true },
  ),
);
export const rejoinArb: fc.Arbitrary<RejoinMessage> = fc.record(
  { type: fc.constant('rejoin'), code: rawCodeArb, token: seatTokenArb },
  REC,
);
export const inputArb: fc.Arbitrary<InputMessage> = fc.record(
  { type: fc.constant('input'), seq: seqArb, tick: tickArb, action: actionArb },
  REC,
);
export const pongArb: fc.Arbitrary<PongMessage> = fc.record(
  { type: fc.constant('pong'), t: msArb },
  REC,
);
export const clientMessageArb: fc.Arbitrary<ClientMessage> = fc.oneof(
  createArb,
  joinArb,
  rejoinArb,
  inputArb,
  fc.constant({ type: 'leave' as const }),
  fc.constant({ type: 'rematch' as const }),
  pongArb,
);

// ---- Server → client messages ----
const createdArb: fc.Arbitrary<CreatedMessage> = fc.record(
  { type: fc.constant('created'), code: roomCodeArb, token: seatTokenArb, seat: fc.constant('A') },
  REC,
);
const joinedArb: fc.Arbitrary<JoinedMessage> = fc.oneof(
  fc.record(
    { type: fc.constant('joined'), code: roomCodeArb, seat: seatArb, token: seatTokenArb },
    { requiredKeys: ['type', 'code', 'seat'], noNullPrototype: true },
  ),
  fc.record(
    { type: fc.constant('joined'), code: roomCodeArb, seat: fc.constant('spectator') },
    REC,
  ),
);
const roomStatusArb: fc.Arbitrary<RoomStatus> = fc.constantFrom(
  'waiting',
  'countdown',
  'playing',
  'paused',
  'roundOver',
  'seriesOver',
);
const roomArb: fc.Arbitrary<RoomMessage> = fc.record(
  {
    type: fc.constant('room'),
    code: roomCodeArb,
    status: roomStatusArb,
    players: bySeatArb(playerInfoArb),
    spectators: fc.nat({ max: 8 }),
    series: seriesViewArb,
  },
  REC,
);
const countdownArb: fc.Arbitrary<CountdownMessage> = fc.record(
  { type: fc.constant('countdown'), startsAt: msArb, serverNow: msArb, tick: tickArb },
  REC,
);
const snapshotArb: fc.Arbitrary<SnapshotMessage> = fc.record(
  {
    type: fc.constant('snapshot'),
    tick: tickArb,
    level: fc.integer({ min: 0, max: 12 }),
    you: ownViewArb,
    players: bySeatArb(publicViewArb),
    events: fc.array(snapshotEventArb, { maxLength: 8 }),
  },
  { requiredKeys: ['type', 'tick', 'level', 'players', 'events'], noNullPrototype: true },
);
const pausedArb: fc.Arbitrary<PausedMessage> = fc.record(
  {
    type: fc.constant('paused'),
    seat: seatArb,
    graceEndsAt: msArb,
    serverNow: msArb,
    pausesLeft: fc.integer({ min: 0, max: MAX_PAUSES_PER_SERIES }),
  },
  REC,
);
const resumedArb: fc.Arbitrary<ResumedMessage> = fc.record(
  { type: fc.constant('resumed'), startsAt: msArb, serverNow: msArb, tick: tickArb },
  REC,
);
const gameOverArb: fc.Arbitrary<GameOverMessage> = fc.record(
  {
    type: fc.constant('gameOver'),
    round: roundArb,
    replay: fc.boolean(),
    winner: fc.option(seatArb, { nil: null }),
    reason: gameOverReasonArb,
    tick: tickArb,
    series: seriesViewArb,
    stats: bySeatArb(playerStatsArb),
    report: bySeatArb(roundReportArb),
  },
  REC,
);
const rematchStatusArb: fc.Arbitrary<RematchStatusMessage> = fc.record(
  { type: fc.constant('rematchStatus'), A: fc.boolean(), B: fc.boolean() },
  REC,
);
const errorArb: fc.Arbitrary<ErrorMessage> = fc.record(
  { type: fc.constant('error'), code: fc.constantFrom(...ERROR_CODES), message: fc.string() },
  REC,
);
const pingArb: fc.Arbitrary<PingMessage> = fc.record(
  { type: fc.constant('ping'), t: msArb, rtt: fc.option(fc.nat({ max: 60_000 }), { nil: null }) },
  REC,
);
export const serverMessageArb: fc.Arbitrary<ServerMessage> = fc.oneof(
  createdArb,
  joinedArb,
  roomArb,
  countdownArb,
  snapshotArb,
  pausedArb,
  resumedArb,
  gameOverArb,
  rematchStatusArb,
  errorArb,
  pingArb,
);

// ---- Engine states (for the views) ----
const bagArb: fc.Arbitrary<BagState> = fc.record(
  {
    rng: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
    remaining: fc.array(pieceKindArb, { maxLength: 7 }),
  },
  REC,
);
/** Any engine PlayerState within the documented field ranges, server-style (bag set) or not. */
export const playerStateArb: fc.Arbitrary<PlayerState> = fc.record(
  {
    tick: tickArb,
    board: boardArb,
    active: fc.option(activePieceArb, { nil: null }),
    queue: fc.array(pieceKindArb, { maxLength: 12 }),
    bag: fc.option(bagArb, { nil: null }),
    pendingGarbage: fc.array(garbageAttackArb, { maxLength: 6 }),
    softDrop: fc.boolean(),
    gravityCounter: fc.integer({ min: 0, max: 59 }),
    lockCounter: fc.integer({ min: 0, max: LOCK_DELAY_TICKS }),
    lockResets: fc.integer({ min: 0, max: MAX_LOCK_RESETS }),
    lowestY: fc.integer({ min: -2, max: BOARD_HEIGHT - 1 }),
    combo: countArb,
    bestCombo: countArb,
    linesCleared: countArb,
    garbageSent: countArb,
    garbageCancelled: countArb,
    garbageReceived: countArb,
    garbageInserted: countArb,
    piecesPlaced: countArb,
    bestMoment: fc.option(bestMomentArb, { nil: null }),
    toppedOut: fc.boolean(),
  },
  REC,
);

/** Recursively freeze a value (engine inputs are immutable by contract; views must not write to them). */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** Every own key anywhere inside a JSON-like value. */
export function deepKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      deepKeys(item, into);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      deepKeys(child, into);
    }
  }
  return into;
}
