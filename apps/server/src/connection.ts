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
import { resolveClientIp, type ClientIpConfig } from './clientIp.js';
import type { Clock, TimerId } from './clock.js';
import { CLOSE, ERR, ERROR_TEXT } from './codes.js';
import { IP_WINDOW_MS, type Limits } from './config.js';
import type { AnticheatRule, EventLog } from './log.js';
import { SlidingWindowCounter } from './rateLimit.js';
import type { Room, RoomRegistry } from './rooms.js';
import { safeCall } from './safe.js';

/** One WebSocket. `room`/`role` are the binding; the IP stays in memory for the flood windows only. */
export class Connection {
  readonly id: number;
  readonly ip: string;
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
  readonly #clock: Clock;

  constructor(id: number, socket: WebSocket, ip: string, clock: Clock) {
    this.id = id;
    this.#socket = socket;
    this.ip = ip;
    this.#clock = clock;
    this.lastPongAt = clock.monotonicMs();
  }

  send(msg: ServerMessage): void {
    this.sendText(JSON.stringify(msg));
  }

  sendText(text: string): void {
    if (this.#socket.readyState === this.#socket.OPEN) this.#socket.send(text);
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
  close(code: number, reason: CloseCodeName): void {
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
  #nextId = 1;
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
    const { clock, log, clientIp } = this.#deps;
    const conn = new Connection(this.#nextId, socket, resolveClientIp(req, clientIp), clock);
    this.#nextId += 1;
    this.#conns.add(conn);
    socket.on('message', (data, isBinary) => {
      this.#onFrame(conn, data, isBinary);
    });
    socket.on('close', (code) => {
      safeCall(log, { conn: conn.id }, () => {
        this.#onClose(conn, code);
      });
    });
    socket.on('error', () => {
      // The plugin's errorHandler logs and terminates; this only stops our side.
      safeCall(log, { conn: conn.id }, () => {
        conn.closing = true;
        conn.stopPing();
      });
    });
    this.#ping(conn);
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
    // 4. Dispatch.
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

  #badMessage(conn: Connection): void {
    conn.badMessages += 1;
    this.#reject(conn, ERR.BAD_MESSAGE, ERR.BAD_MESSAGE);
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
    if (registry.size >= limits.maxLiveRooms) {
      this.#reject(conn, ERR.SERVER_BUSY, ERR.SERVER_BUSY);
      return;
    }
    this.#creates.charge(conn.ip, now);
    registry.create().start(conn, msg.name);
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

  /** rejoin: bound → full failed-join window → not found (charge) → token matches neither seat (charge) → R1. */
  #rejoin(conn: Connection, msg: RejoinMessage): void {
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
    const seat = room.matchToken(msg.token);
    if (seat === null) {
      this.#failedJoins.charge(conn.ip, now);
      this.#reject(conn, ERR.BAD_TOKEN, ERR.BAD_TOKEN);
      return;
    }
    room.rejoin(conn, seat);
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

  #pong(conn: Connection, msg: PongMessage): void {
    const now = this.#deps.clock.monotonicMs();
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
    conn.send({ type: 'ping', t: Math.round(now), rtt: conn.rttMs });
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

  #onClose(conn: Connection, code: number): void {
    this.#conns.delete(conn);
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
