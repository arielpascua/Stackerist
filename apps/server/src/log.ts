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

export class EventLog {
  readonly pino: Logger;
  readonly #clock: Clock;
  readonly #coalesce = new Map<string, CoalesceEntry>();

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
    const key = `${String(fields.conn)}:${rule}`;
    const now = this.#clock.monotonicMs();
    const entry = this.#coalesce.get(key);
    if (entry !== undefined && now - entry.windowStart < COALESCE_MS) {
      entry.suppressed += 1;
      if (entry.timer === null) {
        entry.timer = this.#clock.setTimeout(
          () => {
            this.#flush(key);
          },
          entry.windowStart + COALESCE_MS - now,
        );
      }
      return;
    }
    if (entry !== undefined) this.#flush(key);
    this.pino.warn({ ...fields, event: 'anticheat', rule, count: 1 });
    this.#coalesce.set(key, {
      windowStart: now,
      suppressed: 0,
      timer: null,
      fields: { ...fields, rule },
    });
  }

  #flush(key: string): void {
    const entry = this.#coalesce.get(key);
    if (entry === undefined) return;
    this.#coalesce.delete(key);
    if (entry.timer !== null) this.#clock.clearTimeout(entry.timer);
    if (entry.suppressed > 0) {
      this.pino.warn({ ...entry.fields, event: 'anticheat', count: entry.suppressed });
    }
  }

  /** Flushes and forgets every coalescing entry of a closed connection. */
  forgetConn(conn: number): void {
    const prefix = `${String(conn)}:`;
    for (const key of [...this.#coalesce.keys()]) {
      if (key.startsWith(prefix)) this.#flush(key);
    }
  }

  /** Flushes everything (shutdown). */
  flushAll(): void {
    for (const key of [...this.#coalesce.keys()]) this.#flush(key);
  }
}
