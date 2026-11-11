/**
 * The one WebSocket to the server (architecture §5.3, close policy §3.3).
 *
 * - Parses every frame with the protocol's `parseServerMessage`; anything invalid is dropped.
 * - Answers `ping` with `pong{t}` itself, then forwards the ping (the store reads `rtt`).
 * - Close policy: REPLACED, RATE_LIMITED, TOO_MANY_BAD_MESSAGES and ROOM_CLOSED end the connection
 *   (the UI shows the matching plate). Anything else (SERVER_SHUTDOWN, PONG_TIMEOUT, 1006, a failed
 *   first connect) reconnects with backoff 0.5 → 1 → 2 → 4 s for as long as the GRACE_MS window lasts;
 *   the store sends `rejoin` with the stored token on every reopen.
 *
 * Liveness (U2): the server sends a `ping` every PING_INTERVAL_MS, so a silent network drop (Wi-Fi gone, no
 * close event for a long while) shows up as "no server message for two intervals". The watchdog then
 * abandons the socket on the client side and takes the same reconnect path as a 1006 close.
 *
 * The WebSocket itself sits behind `SocketFactory`, so the policy is unit-tested without a DOM.
 */
import {
  CLOSE_CODES,
  GRACE_MS,
  PING_INTERVAL_MS,
  RECOVERABLE_CLOSE_CODES,
  WS_PATH,
  parseServerMessage,
  type ClientMessage,
  type CloseCodeName,
  type ServerMessage,
} from '@stackerist/protocol';
import type { ConnectionStatus, RecoverableCloseCode } from '../game/contract.ts';
import type { Timers } from '../game/timers.ts';

/**
 * Reconnect delays, ms: architecture §3.3 ("backoff 0.5 → 1 → 2 → 4 s"). The protocol package exports no
 * constant for it, so this is its single definition; every attempt after the last uses the last value.
 */
export const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 4000] as const;

/** How long an open socket may stay silent before the client calls it lost: two server pings. */
export const LIVENESS_MS = 2 * PING_INTERVAL_MS;

/** The close code the watchdog reports for a socket it gave up on (abnormal closure, always retried). */
const LIVENESS_LOST_CODE = 1006;

/** Close code sent by the client when it closes on purpose (WebSocket "normal closure"). */
const NORMAL_CLOSURE = 1000;

/** Whether each named close code reconnects (architecture §3.3). Unnamed codes (1006 …) reconnect. */
const RECONNECTS: Readonly<Record<CloseCodeName, boolean>> = {
  REPLACED: false,
  RATE_LIMITED: false,
  TOO_MANY_BAD_MESSAGES: false,
  PONG_TIMEOUT: true,
  ROOM_CLOSED: false,
  SERVER_SHUTDOWN: true,
};

const CLOSE_CODE_NAMES = Object.keys(CLOSE_CODES) as CloseCodeName[];

/** The protocol name of a close code, or null for codes the protocol doesn't define (1000, 1006 …). */
export function closeCodeName(code: number): CloseCodeName | null {
  return CLOSE_CODE_NAMES.find((name) => CLOSE_CODES[name] === code) ?? null;
}

/** The code itself when it is one the server sends that CLOSE_CODES does not name (4005, 1013), else null. */
export function recoverableCloseCode(code: number): RecoverableCloseCode | null {
  return Object.values(RECOVERABLE_CLOSE_CODES).find((known) => known === code) ?? null;
}

export function shouldReconnect(code: number): boolean {
  const name = closeCodeName(code);
  return name === null ? code !== NORMAL_CLOSURE : RECONNECTS[name];
}

/** Delay before reconnect attempt `attempt` (0-based), ms. */
export function reconnectDelayMs(attempt: number): number {
  const longest = RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1] ?? 0;
  return RECONNECT_BACKOFF_MS[Math.max(0, attempt)] ?? longest;
}

/** `wss://<host>/ws` on https pages, `ws://<host>/ws` otherwise: same origin as the page. */
export function wsUrl(location: { readonly protocol: string; readonly host: string }): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}${WS_PATH}`;
}

/** What a transport reports back; the factory wires these to the real WebSocket events. */
export interface SocketHandlers {
  onOpen(): void;
  /** The raw frame payload (text for every valid frame). */
  onMessage(data: unknown): void;
  onClose(code: number): void;
}

export interface SocketConnection {
  send(text: string): void;
  close(code?: number): void;
}

export type SocketFactory = (url: string, handlers: SocketHandlers) => SocketConnection;

export interface GameSocketEvents {
  /** Every successful (re)open. */
  onOpen(): void;
  onMessage(msg: ServerMessage): void;
  /** Every close the server or network causes, with its code, just before the status changes. */
  onDropped?(code: number): void;
  onStatus(status: ConnectionStatus, closedBy: CloseCodeName | null): void;
}

export interface GameSocketOptions {
  readonly url: string;
  readonly createSocket: SocketFactory;
  readonly timers: Timers;
  /** Monotonic ms (performance.now()); measures the reconnect window. */
  now(): number;
  readonly events: GameSocketEvents;
  /**
   * Subscribes to "the tab became visible" (returns the unsubscribe). Background tabs throttle timers, so
   * the silence clock restarts on every return instead of counting the hidden time.
   */
  watchVisibility?(onVisible: () => void): () => void;
}

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'connecting' }
  | { readonly kind: 'open' }
  | { readonly kind: 'retrying'; readonly droppedAt: number; readonly attempt: number }
  | { readonly kind: 'closed' };

export class GameSocket {
  readonly #options: GameSocketOptions;
  #phase: Phase = { kind: 'idle' };
  #conn: SocketConnection | null = null;
  #retryTimer: number | null = null;
  #watchdog: number | null = null;
  /** `now()` of the last sign of life from the server (or the last time the tab came back). */
  #heardAt = 0;
  #unwatchVisibility: (() => void) | null = null;

  constructor(options: GameSocketOptions) {
    this.#options = options;
  }

  get isOpen(): boolean {
    return this.#phase.kind === 'open';
  }

  /** Opens the socket. A no-op while connecting, open or retrying; restarts after `closed`. */
  connect(): void {
    if (this.#phase.kind !== 'idle' && this.#phase.kind !== 'closed') return;
    this.#phase = { kind: 'connecting' };
    this.#options.events.onStatus('connecting', null);
    this.#open();
  }

  /** Sends one message; false (and nothing sent) unless the socket is open. */
  send(msg: ClientMessage): boolean {
    if (this.#phase.kind !== 'open' || this.#conn === null) return false;
    this.#conn.send(JSON.stringify(msg));
    return true;
  }

  /** Closes on purpose: no reconnect. */
  close(): void {
    this.#cancelRetry();
    this.#stopWatchdog();
    const conn = this.#conn;
    this.#conn = null;
    this.#phase = { kind: 'closed' };
    conn?.close(NORMAL_CLOSURE);
    this.#options.events.onStatus('closed', null);
  }

  #open(): void {
    const handlers: SocketHandlers = {
      onOpen: () => {
        if (this.#conn !== conn) return;
        this.#phase = { kind: 'open' };
        this.#startWatchdog();
        this.#options.events.onStatus('open', null);
        this.#options.events.onOpen();
      },
      onMessage: (data) => {
        if (this.#conn === conn) this.#receive(data);
      },
      onClose: (code) => {
        if (this.#conn === conn) this.#dropped(code);
      },
    };
    const conn = this.#options.createSocket(this.#options.url, handlers);
    this.#conn = conn;
  }

  #receive(data: unknown): void {
    if (typeof data !== 'string') return;
    const msg = parseServerMessage(data);
    if (msg === null) return;
    this.#heardAt = this.#options.now();
    if (msg.type === 'ping') {
      this.send({ type: 'pong', t: msg.t });
    }
    this.#options.events.onMessage(msg);
  }

  #dropped(code: number): void {
    this.#stopWatchdog();
    this.#conn = null;
    this.#options.events.onDropped?.(code);
    const previous = this.#phase;
    if (!shouldReconnect(code)) {
      this.#phase = { kind: 'closed' };
      this.#options.events.onStatus('closed', closeCodeName(code));
      return;
    }
    const now = this.#options.now();
    const droppedAt = previous.kind === 'retrying' ? previous.droppedAt : now;
    const attempt = previous.kind === 'retrying' ? previous.attempt + 1 : 0;
    const delay = reconnectDelayMs(attempt);
    if (now + delay - droppedAt > GRACE_MS) {
      this.#phase = { kind: 'closed' };
      this.#options.events.onStatus('closed', null);
      return;
    }
    this.#phase = { kind: 'retrying', droppedAt, attempt };
    if (previous.kind !== 'retrying') {
      this.#options.events.onStatus('reconnecting', null);
    }
    this.#retryTimer = this.#options.timers.set(() => {
      this.#retryTimer = null;
      this.#open();
    }, delay);
  }

  #startWatchdog(): void {
    this.#stopWatchdog();
    this.#heardAt = this.#options.now();
    this.#unwatchVisibility =
      this.#options.watchVisibility?.(() => {
        this.#heardAt = this.#options.now();
      }) ?? null;
    this.#armWatchdog(LIVENESS_MS);
  }

  #armWatchdog(delay: number): void {
    this.#watchdog = this.#options.timers.set(() => {
      this.#watchdog = null;
      const silent = this.#options.now() - this.#heardAt;
      if (silent < LIVENESS_MS) {
        this.#armWatchdog(LIVENESS_MS - silent);
        return;
      }
      this.#abandon();
    }, delay);
  }

  #stopWatchdog(): void {
    if (this.#watchdog !== null) {
      this.#options.timers.clear(this.#watchdog);
      this.#watchdog = null;
    }
    this.#unwatchVisibility?.();
    this.#unwatchVisibility = null;
  }

  /**
   * Silent for too long: close our end without waiting for the close handshake (on a dead network it
   * never comes) and carry on as if the socket had dropped with 1006.
   */
  #abandon(): void {
    const conn = this.#conn;
    if (conn === null || this.#phase.kind !== 'open') return;
    this.#dropped(LIVENESS_LOST_CODE);
    conn.close(NORMAL_CLOSURE);
  }

  #cancelRetry(): void {
    if (this.#retryTimer !== null) {
      this.#options.timers.clear(this.#retryTimer);
      this.#retryTimer = null;
    }
  }
}

/** The browser transport: a real WebSocket wired to the handlers. */
export const browserSocketFactory: SocketFactory = (url, handlers) => {
  const ws = new WebSocket(url);
  ws.addEventListener('open', () => {
    handlers.onOpen();
  });
  ws.addEventListener('message', (event: MessageEvent) => {
    handlers.onMessage(event.data);
  });
  ws.addEventListener('close', (event: CloseEvent) => {
    handlers.onClose(event.code);
  });
  return {
    send: (text) => {
      ws.send(text);
    },
    close: (code) => {
      ws.close(code);
    },
  };
};
