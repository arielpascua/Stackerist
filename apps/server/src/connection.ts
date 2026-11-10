/**
 * The per-socket ingress pipeline (architecture §4.3 — the gate order is a contract), the bad-message
 * counter and ping/pong/RTT (§4.9). Every frame runs inside `safeCall`; `framesHandled` counts in
 * `finally`. No gate writes state before it decides: windows are charged only on the outcome they
 * count, rooms exist only after every create gate, spectators are added only below the cap, and the
 * input bucket is charged once, inside `Match.receiveInput`, after the seat and status gates.
 */
import type { IncomingHttpHeaders } from 'node:http';
import {
  CLOSE_CODES,
  MAX_FRAME_BYTES,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  RECOVERABLE_CLOSE_CODES,
  normalizeRoomCode,
  parseClientMessage,
  type ClientMessage,
  type CloseCodeName,
  type CreateMessage,
  type ErrorCode,
  type InputMessage,
  type JoinMessage,
  type PongMessage,
  type RejoinMessage,
  type Seat,
  type ServerMessage,
} from '@stackerist/protocol';
import type { RawData, WebSocket } from 'ws';
import { resolveClientIpDetailed, type ClientIpConfig } from './clientIp.js';
import type { Clock, TimerId } from './clock.js';
import { CLOSE, ERR, ERROR_TEXT, type AnyCloseName } from './codes.js';
import { IP_WINDOW_MS, REFUSED_SOCKET_GRACE_MS, type Limits } from './config.js';
import type { AnticheatRule, EventLog } from './log.js';
import { SlidingWindowCounter, TokenBucket } from './rateLimit.js';
import type { Room, RoomRegistry } from './rooms.js';
import { safeCall } from './safe.js';

export interface ConnectionOptions {
  readonly maxBufferedBytes: number;
  readonly nonInputBurst: number;
  readonly nonInputRefillPerSec: number;
  /** Called (in a microtask) after the socket was closed for a full send buffer. */
  readonly onOverflow: (conn: Connection) => void;
}

/** One WebSocket. `room`/`role` are the binding; the IP stays in memory for the flood windows only. */
export class Connection {
  readonly id: number;
  readonly ip: string;
  /** The aggregate network key (IPv6 /48; the address itself for IPv4), for the N2 caps. */
  readonly network: string;
  readonly #socket: WebSocket;
  room: Room | null = null;
  role: Seat | 'spectator' | null = null;
  badMessages = 0;
  /** A newer socket took this seat (R1): its close is not a disconnect. */
  replaced = false;
  /** The server has started closing it (or it closed): frames are ignored, pings stop. */
  closing = false;
  lastPongAt: number;
  rttMs: number | null = null;
  pingTimer: TimerId | null = null;
  /** Non-input messages (join, rejoin, leave, rematch, pong, create): one token each (F9). */
  readonly nonInputBucket: TokenBucket;
  readonly #clock: Clock;
  readonly #options: ConnectionOptions;
  /** `t` of the pings that may still be answered (at most PONG_TIMEOUT_MS old). */
  #outstandingPings: number[] = [];

  constructor(
    id: number,
    socket: WebSocket,
    keys: { readonly ip: string; readonly network: string },
    clock: Clock,
    options: ConnectionOptions,
  ) {
    this.id = id;
    this.#socket = socket;
    this.ip = keys.ip;
    this.network = keys.network;
    this.#clock = clock;
    this.#options = options;
    this.lastPongAt = clock.monotonicMs();
    this.nonInputBucket = new TokenBucket(
      options.nonInputBurst,
      options.nonInputRefillPerSec,
      clock.monotonicMs(),
    );
  }

  send(msg: ServerMessage): void {
    this.sendText(JSON.stringify(msg));
  }

  /**
   * Every server → client frame goes through here. A socket whose queue is already above the cap is a
   * reader that isn't reading (F1): it is closed SLOW_CONSUMER and nothing more is queued for it, so
   * the buffer is bounded by the cap plus one frame. It rejoins with its token like any dropped client.
   */
  sendText(text: string): void {
    const socket = this.#socket;
    if (this.closing || socket.readyState !== socket.OPEN) return;
    if (socket.bufferedAmount > this.#options.maxBufferedBytes) {
      this.close(RECOVERABLE_CLOSE_CODES.SLOW_CONSUMER, CLOSE.SLOW_CONSUMER);
      // The seat/spectator bookkeeping runs after the current broadcast, never inside it.
      queueMicrotask(() => {
        this.#options.onOverflow(this);
      });
      return;
    }
    socket.send(text);
  }

  /** Remembers that a ping with this `t` went out and may be answered. */
  recordPing(t: number, nowMs: number): void {
    this.#outstandingPings = this.#outstandingPings.filter((p) => nowMs - p <= PONG_TIMEOUT_MS);
    this.#outstandingPings.push(t);
  }

  /** True once per outstanding ping: a blind, stale or replayed `pong` gets false (F1). */
  consumePing(t: number, nowMs: number): boolean {
    const index = this.#outstandingPings.indexOf(t);
    if (index < 0) return false;
    this.#outstandingPings.splice(index, 1);
    return nowMs - t <= PONG_TIMEOUT_MS;
  }

  sendError(code: ErrorCode): void {
    this.send({ type: 'error', code, message: ERROR_TEXT[code] });
  }

  stopPing(): void {
    if (this.pingTimer !== null) {
      this.#clock.clearTimeout(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /** Close with a protocol close code; the reason string is the code's name (decision 19). */
  close(code: number, reason: AnyCloseName): void {
    if (this.closing) return;
    this.closing = true;
    this.stopPing();
    if (this.#socket.readyState === this.#socket.OPEN) this.#socket.close(code, reason);
  }

  terminate(): void {
    this.closing = true;
    this.stopPing();
    this.#socket.terminate();
  }
}

/**
 * A framing violation `ws` reported itself (oversized past the hard payload cap, invalid UTF-8, bad opcode,
 * reserved bits…): every one carries a `WS_ERR_*` code. Hostile input, not a server fault.
 */
export function isFrameError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err)) return false;
  const { code } = err;
  return typeof code === 'string' && code.startsWith('WS_ERR_');
}

function frameByteLength(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((sum, part) => sum + part.length, 0);
  if (Buffer.isBuffer(data)) return data.length;
  return data.byteLength;
}

function frameText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return Buffer.from(data).toString('utf8');
}

export interface HubDeps {
  readonly clock: Clock;
  readonly log: EventLog;
  readonly limits: Limits;
  readonly registry: RoomRegistry;
  readonly clientIp: ClientIpConfig;
  /** Test-only fault injection (REQ-072). */
  readonly throwOn?: ((msg: ClientMessage) => boolean) | undefined;
}

export interface UpgradeRequest {
  readonly headers: IncomingHttpHeaders;
  readonly socket: { readonly remoteAddress?: string | undefined };
}

export class ConnectionHub {
  /** Client frames fully handled (an I/O barrier for tests). */
  framesHandled = 0;
  readonly #deps: HubDeps;
  readonly #conns = new Set<Connection>();
  readonly #creates = new SlidingWindowCounter(IP_WINDOW_MS);
  readonly #failedJoins = new SlidingWindowCounter(IP_WINDOW_MS);
  /** Open sockets per client IP (F2); a refused socket is never counted. */
  readonly #socketsPerIp = new Map<string, number>();
  /** Open sockets per IPv6 /48 (N2). */
  readonly #socketsPerNetwork = new Map<string, number>();
  #nextId = 1;
  #warnedHeaderMissing = false;
  #sweepTimer: TimerId | null = null;

  constructor(deps: HubDeps) {
    this.#deps = deps;
    this.#armSweep();
  }

  get connections(): number {
    return this.#conns.size;
  }

  /** Called synchronously from the WebSocket route: listeners are attached before returning. */
  accept(socket: WebSocket, req: UpgradeRequest): void {
    const { clock, log, clientIp, limits } = this.#deps;
    const resolved = resolveClientIpDetailed(req, clientIp);
    if (!resolved.fromConfiguredSource && !this.#warnedHeaderMissing) {
      // Once, with no address: a proxy that stopped sending the header makes everyone share one bucket.
      this.#warnedHeaderMissing = true;
      log.warn('clientip.header_missing');
    }
    const conn = new Connection(this.#nextId, socket, resolved, clock, {
      maxBufferedBytes: limits.maxBufferedBytes,
      nonInputBurst: limits.nonInputBurst,
      nonInputRefillPerSec: limits.nonInputRefillPerSec,
      onOverflow: (slow) => {
        safeCall(log, { conn: slow.id }, () => {
          this.#onOverflow(slow);
        });
      },
    });
    this.#nextId += 1;
    if (this.#socketsFull(conn)) {
      this.#refuse(conn, socket);
      return;
    }
    this.#conns.add(conn);
    this.#socketsPerIp.set(conn.ip, (this.#socketsPerIp.get(conn.ip) ?? 0) + 1);
    this.#socketsPerNetwork.set(conn.network, (this.#socketsPerNetwork.get(conn.network) ?? 0) + 1);
    socket.on('message', (data, isBinary) => {
      this.#onFrame(conn, data, isBinary);
    });
    socket.on('close', (code) => {
      safeCall(log, { conn: conn.id }, () => {
        this.#onClose(conn, code);
      });
    });
    socket.on('error', (err: unknown) => {
      // The plugin's errorHandler terminates (and logs anything that is not a frame error); this stops our
      // side and records a frame the WebSocket layer refused as one coalesced warning (F8).
      safeCall(log, { conn: conn.id }, () => {
        conn.closing = true;
        conn.stopPing();
        if (isFrameError(err)) {
          log.anticheat(ERR.BAD_MESSAGE, {
            conn: conn.id,
            ...(conn.room === null ? {} : { room: conn.room.code }),
          });
        }
      });
    });
    this.#ping(conn);
  }

  /** The process cap, the per-client cap, and (IPv6 only) the aggregate cap of the client's /48. */
  #socketsFull(conn: Connection): boolean {
    const { limits } = this.#deps;
    return (
      this.#conns.size >= limits.maxSockets ||
      (this.#socketsPerIp.get(conn.ip) ?? 0) >= limits.maxSocketsPerIp ||
      (conn.network !== conn.ip &&
        (this.#socketsPerNetwork.get(conn.network) ?? 0) >= limits.maxSocketsPerNetwork)
    );
  }

  /** F2: over a socket cap. Say so, close with 1013 (the client backs off and retries), never bind it. */
  #refuse(conn: Connection, socket: WebSocket): void {
    const { clock, log } = this.#deps;
    // N3: one shared, coalesced line per second for every refusal: a flood must not write a line, or
    // add a coalescing entry that every later close has to look at, per socket.
    log.anticheatShared('SOCKET_LIMIT');
    conn.sendError(ERR.SERVER_BUSY);
    conn.close(RECOVERABLE_CLOSE_CODES.TRY_AGAIN_LATER, CLOSE.TRY_AGAIN_LATER);
    // A flooder won't finish the close handshake: don't let ws wait 30 s for it.
    const killer = clock.setTimeout(() => {
      socket.terminate();
    }, REFUSED_SOCKET_GRACE_MS);
    socket.once('close', () => {
      clock.clearTimeout(killer);
    });
  }

  /** Shutdown: every socket closes with SERVER_SHUTDOWN (1001). */
  closeAll(): void {
    if (this.#sweepTimer !== null) this.#deps.clock.clearTimeout(this.#sweepTimer);
    this.#sweepTimer = null;
    for (const conn of this.#conns) {
      conn.room = null;
      conn.role = null;
      conn.close(CLOSE_CODES.SERVER_SHUTDOWN, CLOSE.SERVER_SHUTDOWN);
    }
  }

  // ------------------------------------------------------------ the pipeline

  #onFrame(conn: Connection, data: RawData, isBinary: boolean): void {
    const roomBefore = conn.room;
    try {
      safeCall(
        this.#deps.log,
        { conn: conn.id, ...(roomBefore === null ? {} : { room: roomBefore.code }) },
        () => {
          this.#ingest(conn, data, isBinary);
        },
        () => {
          const room = conn.room ?? roomBefore;
          if (room !== null && !room.deleted)
            room.abort(); // X3: this room only
          else conn.sendError(ERR.INTERNAL_ERROR);
        },
      );
    } finally {
      this.framesHandled += 1;
    }
  }

  #ingest(conn: Connection, data: RawData, isBinary: boolean): void {
    if (conn.closing) return;
    // 1. Binary or oversized → BAD_MESSAGE (before any parsing).
    if (isBinary || frameByteLength(data) > MAX_FRAME_BYTES) {
      this.#badMessage(conn);
      return;
    }
    // 2. JSON + strict schema; anything else → BAD_MESSAGE.
    const parsed = parseClientMessage(frameText(data));
    if (!parsed.ok) {
      this.#badMessage(conn);
      return;
    }
    const msg = parsed.msg;
    // 3. Test-only fault injection.
    if (this.#deps.throwOn?.(msg) === true) throw new Error('fault injected by test.throwOn');
    // 4. Everything but an input draws one token from the connection's non-input bucket (F9); the input
    //    bucket is charged separately, inside Match.receiveInput. Charged before any state is written.
    if (msg.type !== 'input' && !conn.nonInputBucket.take(this.#deps.clock.monotonicMs())) {
      this.#badMessage(conn, 'NON_INPUT_DROP');
      return;
    }
    // 5. Dispatch.
    switch (msg.type) {
      case 'create':
        this.#create(conn, msg);
        return;
      case 'join':
        this.#join(conn, msg);
        return;
      case 'rejoin':
        this.#rejoin(conn, msg);
        return;
      case 'input':
        this.#input(conn, msg);
        return;
      case 'leave':
        conn.room?.onLeave(conn);
        return;
      case 'rematch':
        this.#rematch(conn);
        return;
      case 'pong':
        this.#pong(conn, msg);
        return;
      default: {
        const unreachable: never = msg;
        void unreachable;
        this.#badMessage(conn); // pessimistic: an unknown shape is a bad message
      }
    }
  }

  #reject(conn: Connection, code: ErrorCode, rule: AnticheatRule | null): void {
    conn.sendError(code);
    if (rule !== null) {
      this.#deps.log.anticheat(rule, {
        conn: conn.id,
        ...(conn.room === null ? {} : { room: conn.room.code }),
      });
    }
  }

  /** A bad or over-rate message: BAD_MESSAGE back, counted toward the 20-strike disconnect. */
  #badMessage(conn: Connection, rule: AnticheatRule = ERR.BAD_MESSAGE): void {
    conn.badMessages += 1;
    this.#reject(conn, ERR.BAD_MESSAGE, rule);
    if (conn.badMessages >= this.#deps.limits.maxBadMessages) {
      this.#deps.log.anticheat(CLOSE.TOO_MANY_BAD_MESSAGES, { conn: conn.id });
      this.#disconnect(conn, CLOSE.TOO_MANY_BAD_MESSAGES);
    }
  }

  /** create: bound → full create window → room cap → only then charge and create. */
  #create(conn: Connection, msg: CreateMessage): void {
    const { clock, limits, registry } = this.#deps;
    const now = clock.monotonicMs();
    if (conn.room !== null) {
      this.#reject(conn, ERR.ALREADY_IN_ROOM, ERR.ALREADY_IN_ROOM);
      return;
    }
    if (this.#creates.isFull(conn.ip, limits.maxCreatesPerIpPerMin, now)) {
      this.#reject(conn, ERR.TOO_MANY_CREATES, 'CREATE_LIMIT');
      return;
    }
    if (
      registry.liveRoomsOf(conn.ip) >= limits.maxLiveRoomsPerIp ||
      (conn.network !== conn.ip &&
        registry.liveRoomsOfNetwork(conn.network) >= limits.maxLiveRoomsPerNetwork)
    ) {
      this.#reject(conn, ERR.TOO_MANY_CREATES, 'CREATE_LIMIT');
      return;
    }
    if (registry.size >= limits.maxLiveRooms) {
      this.#reject(conn, ERR.SERVER_BUSY, ERR.SERVER_BUSY);
      return;
    }
    this.#creates.charge(conn.ip, now);
    registry.create(conn).start(conn, msg.name);
  }

  /** The canonical room for a raw code, or null (malformed codes are "not found", never BAD_MESSAGE). */
  #lookup(raw: string): Room | null {
    const code = normalizeRoomCode(raw);
    if (code === null) return null;
    const room = this.#deps.registry.get(code);
    return room === undefined || room.deleted ? null : room;
  }

  /** join: bound → full failed-join window (no lookup) → not found (charge) → spectator cap → bind. */
  #join(conn: Connection, msg: JoinMessage): void {
    const { clock, limits } = this.#deps;
    const now = clock.monotonicMs();
    if (conn.room !== null) {
      this.#reject(conn, ERR.ALREADY_IN_ROOM, ERR.ALREADY_IN_ROOM);
      return;
    }
    if (this.#failedJoins.isFull(conn.ip, limits.maxFailedJoinsPerIpPerMin, now)) {
      this.#reject(conn, ERR.TOO_MANY_JOINS, 'JOIN_LIMIT');
      return;
    }
    const room = this.#lookup(msg.code);
    if (room === null) {
      this.#failedJoins.charge(conn.ip, now);
      this.#reject(conn, ERR.ROOM_NOT_FOUND, ERR.ROOM_NOT_FOUND);
      return;
    }
    const role = room.joinRole(msg.asSpectator === true);
    if (role === 'spectator') {
      if (room.spectatorsFull()) {
        this.#reject(conn, ERR.ROOM_FULL, null);
        return;
      }
      room.addSpectator(conn);
      return;
    }
    if (msg.name === undefined) {
      this.#badMessage(conn); // the schema requires a name for a player; never guess one
      return;
    }
    room.addPlayer(conn, role, msg.name);
  }

  /**
   * rejoin: bound → verify the token (constant time, both seats) → a match rejoins whatever the failed-join
   * window says (the 128-bit token can't be guessed, and a family behind a noisy NAT must get back to its
   * game, F3b) → a failure with the window full is TOO_MANY_JOINS and says no more → otherwise charge, then
   * ROOM_NOT_FOUND or BAD_TOKEN. The charge comes before any state is written.
   */
  #rejoin(conn: Connection, msg: RejoinMessage): void {
    const { clock, limits } = this.#deps;
    const now = clock.monotonicMs();
    if (conn.room !== null) {
      this.#reject(conn, ERR.ALREADY_IN_ROOM, ERR.ALREADY_IN_ROOM);
      return;
    }
    const room = this.#lookup(msg.code);
    const seat = room === null ? null : room.matchToken(msg.token);
    if (room !== null && seat !== null) {
      room.rejoin(conn, seat);
      return;
    }
    if (this.#failedJoins.isFull(conn.ip, limits.maxFailedJoinsPerIpPerMin, now)) {
      this.#reject(conn, ERR.TOO_MANY_JOINS, 'JOIN_LIMIT');
      return;
    }
    this.#failedJoins.charge(conn.ip, now);
    if (room === null) this.#reject(conn, ERR.ROOM_NOT_FOUND, ERR.ROOM_NOT_FOUND);
    else this.#reject(conn, ERR.BAD_TOKEN, ERR.BAD_TOKEN);
  }

  /** input: unbound → spectator → not playing → Match.receiveInput (bucket first, §4.3 a–e). */
  #input(conn: Connection, msg: InputMessage): void {
    const room = conn.room;
    const role = conn.role;
    if (room === null || role === null) {
      this.#reject(conn, ERR.NOT_IN_ROOM, null);
      return;
    }
    if (role === 'spectator') {
      this.#reject(conn, ERR.NOT_A_PLAYER, ERR.NOT_A_PLAYER);
      return;
    }
    if (room.status !== 'playing') {
      this.#reject(conn, ERR.NOT_PLAYING, ERR.NOT_PLAYING);
      return;
    }
    room.onInput(conn, role, msg);
  }

  /** rematch: unbound → spectator → not finished → ready (N1–N3). */
  #rematch(conn: Connection): void {
    const room = conn.room;
    const role = conn.role;
    if (room === null || role === null) {
      this.#reject(conn, ERR.NOT_IN_ROOM, null);
      return;
    }
    if (role === 'spectator') {
      this.#reject(conn, ERR.NOT_A_PLAYER, ERR.NOT_A_PLAYER);
      return;
    }
    if (room.status !== 'roundOver' && room.status !== 'seriesOver') {
      this.#reject(conn, ERR.NOT_FINISHED, null);
      return;
    }
    room.onRematch(role);
  }

  // ------------------------------------------------------------ ping / pong / close

  /** Liveness only for a pong that answers an outstanding ping; a blind pong changes nothing (F1). */
  #pong(conn: Connection, msg: PongMessage): void {
    const now = this.#deps.clock.monotonicMs();
    if (!conn.consumePing(msg.t, now)) return;
    conn.lastPongAt = now;
    const rtt = now - msg.t;
    if (rtt >= 0 && rtt <= PONG_TIMEOUT_MS) conn.rttMs = Math.round(rtt);
  }

  /** Immediately on open, then every PING_INTERVAL_MS; a silent connection is closed (REQ-031). */
  #ping(conn: Connection): void {
    const { clock, log } = this.#deps;
    conn.pingTimer = null;
    if (conn.closing) return;
    const now = clock.monotonicMs();
    if (now - conn.lastPongAt > PONG_TIMEOUT_MS) {
      this.#disconnect(conn, CLOSE.PONG_TIMEOUT);
      return;
    }
    const t = Math.round(now);
    conn.recordPing(t, now);
    conn.send({ type: 'ping', t, rtt: conn.rttMs });
    conn.pingTimer = clock.setTimeout(() => {
      safeCall(log, { conn: conn.id }, () => {
        this.#ping(conn);
      });
    }, PING_INTERVAL_MS);
  }

  /** A server-initiated close is an unexpected disconnect for the bound seat, handled at once. */
  #disconnect(conn: Connection, name: CloseCodeName): void {
    const room = conn.room;
    conn.close(CLOSE_CODES[name], name);
    room?.onConnectionClosed(conn);
  }

  /** A socket was just closed for a full send buffer: an unexpected disconnect for its seat, at once. */
  #onOverflow(conn: Connection): void {
    this.#deps.log.anticheat(CLOSE.SLOW_CONSUMER, {
      conn: conn.id,
      ...(conn.room === null ? {} : { room: conn.room.code }),
    });
    conn.room?.onConnectionClosed(conn);
  }

  #onClose(conn: Connection, code: number): void {
    if (this.#conns.delete(conn)) {
      const left = (this.#socketsPerIp.get(conn.ip) ?? 1) - 1;
      if (left > 0) this.#socketsPerIp.set(conn.ip, left);
      else this.#socketsPerIp.delete(conn.ip);
      const netLeft = (this.#socketsPerNetwork.get(conn.network) ?? 1) - 1;
      if (netLeft > 0) this.#socketsPerNetwork.set(conn.network, netLeft);
      else this.#socketsPerNetwork.delete(conn.network);
    }
    conn.closing = true;
    conn.stopPing();
    const { log } = this.#deps;
    log.forgetConn(conn.id);
    const room = conn.room;
    const role = conn.role;
    log.info('conn.disconnected', {
      conn: conn.id,
      closeCode: code,
      ...(room === null ? {} : { room: room.code }),
      ...(role === null ? {} : { seat: role }),
    });
    if (conn.replaced || room === null) return;
    room.onConnectionClosed(conn);
  }

  /** Prunes the per-IP windows every minute. */
  #armSweep(): void {
    const { clock, log } = this.#deps;
    this.#sweepTimer = clock.setTimeout(() => {
      safeCall(log, {}, () => {
        const now = clock.monotonicMs();
        this.#creates.sweep(now);
        this.#failedJoins.sweep(now);
        this.#armSweep();
      });
    }, IP_WINDOW_MS);
  }
}
