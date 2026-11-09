/**
 * Shared protocol constants (architecture §3.3). Every producer/consumer literal lives here once;
 * the server and the client import these values and never retype them (architecture §7.4).
 *
 * Units are pinned in each comment (architecture §3.2): "ms" is a duration in milliseconds unless it
 * says "epoch"; "ticks" are integer match ticks at TICK_RATE (60/s).
 */
import { TICK_RATE } from '@stackerist/engine';

// ---- Paths ----
/** The one WebSocket endpoint (same origin as the client). */
export const WS_PATH = '/ws';
/** Health check: `GET /healthz` → 200 `{"ok":true}`. */
export const HEALTH_PATH = '/healthz';
/** Share link prefix: `/g/<CODE>`. Build links with `gamePath` / `shareUrl`, never by hand. */
export const GAME_PATH_PREFIX = '/g/';
/** Watch-only query parameter: `/g/<CODE>?watch=1`. */
export const WATCH_QUERY_PARAM = 'watch';

// ---- Room codes, names, seat tokens ----
/** The 31 room-code characters (no 0, O, 1, I, L). Upper case is canonical. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Room code length in characters. */
export const ROOM_CODE_LENGTH = 6;
/**
 * Minimum player-name length, counted after trimming, in Unicode code points (a surrogate pair counts
 * once: zod 4.6 measures strings that way). Validate names with `NameSchema`, never with `.length`.
 */
export const NAME_MIN_LENGTH = 1;
/** Maximum player-name length, counted after trimming, in Unicode code points (see NAME_MIN_LENGTH). */
export const NAME_MAX_LENGTH = 16;
/** Seat token entropy in bytes (128-bit). */
export const SEAT_TOKEN_BYTES = 16;
/** Seat token length in base64url characters, no padding. */
export const SEAT_TOKEN_LENGTH = 22;

// ---- Limits and timings ----
/** Largest client→server frame the app accepts, in UTF-8 bytes; larger frames get BAD_MESSAGE. */
export const MAX_FRAME_BYTES = 1024;
/** An input may be stamped at most this many ticks ahead of the server's current tick (else BAD_TICK). */
export const MAX_INPUT_LEAD_TICKS = 30;
/** Duration of one tick in ms (float, ≈16.667). Timing maths only; never put it in game state. */
export const TICK_MS = 1000 / TICK_RATE;
/** Start and resume countdown length (the standoff), ms. */
export const COUNTDOWN_MS = 3000;
/** Server ping interval, ms. */
export const PING_INTERVAL_MS = 3000;
/** A connection with no pong for this long is closed with PONG_TIMEOUT, ms. */
export const PONG_TIMEOUT_MS = 10_000;
/** Reconnect grace after an unexpected disconnect mid-round, ms. */
export const GRACE_MS = 20_000;
/** Pauses each player may cause per series (count). */
export const MAX_PAUSES_PER_SERIES = 3;
/** A seat is held for its token this long after a disconnect outside a running round, ms. */
export const SEAT_HOLD_MS = 120_000;
/** Snapshot cadence: at most every this many ticks, plus immediately after every lock (ticks). */
export const SNAPSHOT_EVERY_TICKS = 2;
/** Round wins needed to take a best-of-3 series (count). */
export const SERIES_WINS_NEEDED = 2;
/** Stack-height sample cadence for the round report, in round-relative ticks. */
export const HEIGHT_SAMPLE_EVERY_TICKS = 30;
/** The client's round-trip assumption until the first `ping.rtt`, ms. */
export const DEFAULT_RTT_MS = 100;

// ---- Browser storage keys ----
/** sessionStorage key prefix for seat tokens: `token:<CODE>` (REQ-021). Build keys with `tokenStorageKey`. */
export const TOKEN_STORAGE_PREFIX = 'token:';
/** localStorage key for the music toggle; value 'on' | 'off', default 'on' (DESIGN.md). */
export const MUSIC_STORAGE_KEY = 'stackerist:music';

// ---- Wire bounds (the numeric limits §3.4–3.6 pin; the schemas enforce them) ----
/** Upper bound of `input.seq` (1..) and `input.tick` (0..): 2^31 − 1. */
export const MAX_WIRE_INT = 2 ** 31 - 1;
/** Raw `code` length accepted in join/rejoin (code points) before `normalizeRoomCode` runs. */
export const ROOM_CODE_INPUT_MAX_LENGTH = 16;
/** Pieces of the queue an opponent or spectator sees (`PublicView.next`); the owner sees PREVIEW_COUNT. */
export const PUBLIC_PREVIEW_COUNT = 1;
/** Most visual events one snapshot carries (count). */
export const MAX_SNAPSHOT_EVENTS = 64;
/** Most completed-round summaries a series view carries (count). */
export const MAX_ROUND_SUMMARIES = 64;
/** Most stack-height samples one round report carries (count). */
export const MAX_HEIGHT_SAMPLES = 7200;
/** Highest round number in a series: 2 × SERIES_WINS_NEEDED − 1 = 3 (a drawn round reuses its number). */
export const MAX_ROUND_NUMBER = 2 * SERIES_WINS_NEEDED - 1;

// ---- Error and close codes ----
export const ERROR_CODES = [
  'BAD_MESSAGE', // binary, > MAX_FRAME_BYTES, bad JSON, schema failure, unknown type (counts toward 20)
  'ROOM_NOT_FOUND', // join/rejoin: unknown or malformed code (charges the failed-join budget)
  'BAD_TOKEN', // rejoin: the token matches no seat (charges the failed-join budget)
  'ROOM_FULL', // spectator join beyond the cap of 8 spectators per room (§10.1 OQ-3)
  'NOT_A_PLAYER', // input/rematch from a spectator
  'NOT_PLAYING', // input while status ≠ playing (before start, paused/resuming, after round end)
  'BAD_SEQ', // input seq ≤ the last accepted seq for that seat
  'BAD_TICK', // input tick > serverTick + 30, or < that seat's previous stamp
  'ALREADY_IN_ROOM', // create/join/rejoin from a socket already bound to a live room
  'NOT_IN_ROOM', // input/rematch from an unbound socket
  'NOT_FINISHED', // rematch while status ∉ {roundOver, seriesOver}
  'TOO_MANY_CREATES', // per-IP creates: 10 per minute (DESIGN.md copy: "created a lot of games")
  'TOO_MANY_JOINS', // per-IP failed joins: 20 per minute (DESIGN.md copy: "too many wrong codes")
  'SERVER_BUSY', // 500 live rooms
  'INTERNAL_ERROR', // a handler threw; it was logged and the process keeps running
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** WebSocket close codes. The close `reason` string is the key name. */
export const CLOSE_CODES = {
  REPLACED: 4000, // a newer socket rejoined this seat (REQ-035)
  RATE_LIMITED: 4001, // 200 dropped inputs in a series (REQ-038)
  TOO_MANY_BAD_MESSAGES: 4002, // 20 BAD_MESSAGEs on one connection (REQ-039)
  PONG_TIMEOUT: 4003, // no pong for 10 s (REQ-031)
  ROOM_CLOSED: 4004, // room deleted (empty / waiting TTL / abandoned / aborted)
  SERVER_SHUTDOWN: 1001,
} as const;
export type CloseCodeName = keyof typeof CLOSE_CODES;

/**
 * Server-initiated closes the client already handles generically: any close code that is not in
 * `CLOSE_CODES` (and is not 1000) makes `net/socket.ts` reconnect with backoff and rejoin with its
 * stored token. They are kept out of `CLOSE_CODES` on purpose: that object's names are exhaustive in
 * the client's close policy, and these two are deliberately "recoverable, no new screen". The close
 * `reason` string is the key name here too.
 */
export const RECOVERABLE_CLOSE_CODES = {
  /** The socket's send buffer passed `Limits.maxBufferedBytes`: it can't keep up. Rejoin to resume. */
  SLOW_CONSUMER: 4005,
  /** RFC 6455 "Try Again Later" (1013): too many sockets from this network, or the server is full. */
  TRY_AGAIN_LATER: 1013,
} as const;
export type RecoverableCloseName = keyof typeof RECOVERABLE_CLOSE_CODES;
