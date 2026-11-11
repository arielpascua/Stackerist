/**
 * Structured logging (architecture §4.11, REQ-071). Every line is a domain event `{ event, …fields }`.
 * `LogFields` is the allow-list: there is no field for a name, an IP, a token or a header, so the type
 * system keeps them out. Anticheat triggers coalesce per (connection, rule) per second.
 */
import type { CloseCodeName, GameOverReason, RoomStatus, Seat } from '@stackerist/protocol';
import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import type { Clock, TimerId } from './clock.js';
import { CLOSE, ERR } from './codes.js';

export const LOG_EVENT_NAMES = [
  'room.created',
  'room.joined',
  'room.rejoined',
  'room.left',
  'match.started',
  'match.paused',
  'match.resumed',
  'match.ended',
  'series.ended',
  'room.closed',
  'room.aborted',
  'conn.disconnected',
  'anticheat',
  'handler.error',
  'process.unhandledRejection',
  'process.uncaughtException',
  'server.listening',
  'clientip.header_missing',
] as const;
export type LogEventName = (typeof LOG_EVENT_NAMES)[number];

/** Rules that share a name with a protocol error or close code come from those lists (§7.4). */
export const ANTICHEAT_RULES = [
  ERR.BAD_MESSAGE,
  CLOSE.TOO_MANY_BAD_MESSAGES,
  'RATE_LIMIT_DROP',
  'RATE_LIMITED_KICK',
  'QUEUE_FULL',
  ERR.BAD_SEQ,
  ERR.BAD_TICK,
  ERR.NOT_A_PLAYER,
  ERR.NOT_PLAYING,
  ERR.BAD_TOKEN,
  ERR.ROOM_NOT_FOUND,
  'CREATE_LIMIT',
  'JOIN_LIMIT',
  ERR.SERVER_BUSY,
  ERR.ALREADY_IN_ROOM,
  'PAUSE_LIMIT_FORFEIT',
  CLOSE.SLOW_CONSUMER,
  'NON_INPUT_DROP',
  'SOCKET_LIMIT',
] as const;
export type AnticheatRule = (typeof ANTICHEAT_RULES)[number];

/** Why a room was deleted (room.closed). */
export type RoomClosedReason =
  'EMPTY' | 'WAITING_EXPIRED' | 'ABANDONED' | 'ABORTED' | 'SHUTDOWN' | 'IDLE' | 'MAX_AGE';
export type LogReason = GameOverReason | 'TWO_WINS' | RoomClosedReason | CloseCodeName;

/** The only fields a log line may carry. Never names, IPs, tokens or headers. */
export interface LogFields {
  readonly room?: string;
  readonly seat?: Seat | 'spectator';
  readonly conn?: number;
  readonly round?: number;
  readonly tick?: number;
  readonly status?: RoomStatus;
  readonly reason?: LogReason;
  readonly rule?: AnticheatRule;
  readonly count?: number;
  readonly winner?: Seat | null;
  readonly closeCode?: number;
}

/** A new pino logger with the architecture's serializers: requests reduce to method + url. */
export function createLogger(
  options: { readonly level?: string; readonly stream?: DestinationStream } = {},
): Logger {
  const config: LoggerOptions = {
    level: options.level ?? process.env.LOG_LEVEL ?? 'info',
    serializers: {
      err: pino.stdSerializers.err,
      req: (r: { readonly method?: unknown; readonly url?: unknown }) => ({
        method: r.method,
        url: r.url,
      }),
    },
  };
  return options.stream === undefined ? pino(config) : pino(config, options.stream);
}

/** Errors only: anything else thrown or rejected is replaced so no arbitrary value reaches a log line. */
function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(`non-Error value thrown (${typeof err})`);
}

const COALESCE_MS = 1000;

interface CoalesceEntry {
  readonly windowStart: number;
  suppressed: number;
  timer: TimerId | null;
  readonly fields: LogFields;
}

/** The coalescing entries of one owner (a connection, or the shared bucket), one per rule. */
type EntryMap = Map<AnticheatRule, CoalesceEntry>;

export class EventLog {
  readonly pino: Logger;
  readonly #clock: Clock;
  /**
   * Coalescing entries indexed by connection (N3): closing a connection touches only its own entries,
   * never every other connection's, so a flood of closes costs O(closes), not O(closes x entries).
   */
  readonly #byConn = new Map<number, EntryMap>();
  /** Entries not tied to any connection: refusals counted under one key per second (N3). */
  readonly #shared: EntryMap = new Map();

  constructor(logger: Logger, clock: Clock) {
    this.pino = logger;
    this.#clock = clock;
  }

  info(event: LogEventName, fields: LogFields = {}): void {
    this.pino.info({ ...fields, event });
  }

  warn(event: LogEventName, fields: LogFields = {}): void {
    this.pino.warn({ ...fields, event });
  }

  error(event: LogEventName, fields: LogFields, err: unknown): void {
    this.pino.error({ ...fields, event, err: toError(err) });
  }

  fatal(event: LogEventName, fields: LogFields, err: unknown): void {
    this.pino.fatal({ ...fields, event, err: toError(err) });
  }

  /**
   * One anticheat trigger. The first per (conn, rule) logs at once; repeats within 1 s are counted
   * and flushed as one line with `count` when the second ends. Every trigger is counted.
   */
  anticheat(rule: AnticheatRule, fields: LogFields & { readonly conn: number }): void {
    let entries = this.#byConn.get(fields.conn);
    if (entries === undefined) {
      entries = new Map();
      this.#byConn.set(fields.conn, entries);
    }
    this.#record(entries, rule, fields, () => {
      if (this.#byConn.get(fields.conn)?.size === 0) this.#byConn.delete(fields.conn);
    });
  }

  /**
   * A trigger that has no connection to charge it to (a socket refused before it was bound): one shared
   * key per rule, so a flood of N refusals is one line per second with `count`, whoever sends it and
   * however many sockets it opens (N3). Every trigger is counted. Carries no connection id by design.
   */
  anticheatShared(rule: AnticheatRule): void {
    this.#record(this.#shared, rule, {}, () => undefined);
  }

  #record(entries: EntryMap, rule: AnticheatRule, fields: LogFields, onEmpty: () => void): void {
    const now = this.#clock.monotonicMs();
    const entry = entries.get(rule);
    if (entry !== undefined && now - entry.windowStart < COALESCE_MS) {
      entry.suppressed += 1;
      if (entry.timer === null) {
        entry.timer = this.#clock.setTimeout(
          () => {
            this.#flush(entries, rule, onEmpty);
          },
          entry.windowStart + COALESCE_MS - now,
        );
      }
      return;
    }
    if (entry !== undefined) this.#flush(entries, rule, onEmpty);
    this.pino.warn({ ...fields, event: 'anticheat', rule, count: 1 });
    entries.set(rule, {
      windowStart: now,
      suppressed: 0,
      timer: null,
      fields: { ...fields, rule },
    });
  }

  #flush(entries: EntryMap, rule: AnticheatRule, onEmpty: () => void): void {
    const entry = entries.get(rule);
    if (entry === undefined) return;
    entries.delete(rule);
    if (entry.timer !== null) this.#clock.clearTimeout(entry.timer);
    if (entry.suppressed > 0) {
      this.pino.warn({ ...entry.fields, event: 'anticheat', count: entry.suppressed });
    }
    onEmpty();
  }

  /** Flushes and forgets every coalescing entry of a closed connection: O(that connection's entries). */
  forgetConn(conn: number): void {
    const entries = this.#byConn.get(conn);
    if (entries === undefined) return;
    for (const rule of [...entries.keys()]) this.#flush(entries, rule, () => undefined);
    this.#byConn.delete(conn);
  }

  /** Flushes everything (shutdown). */
  flushAll(): void {
    for (const conn of [...this.#byConn.keys()]) this.forgetConn(conn);
    for (const rule of [...this.#shared.keys()]) this.#flush(this.#shared, rule, () => undefined);
  }
}
