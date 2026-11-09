/**
 * Server integration harness (architecture §6.3): a real server on a random port with a ManualClock and
 * manual ticks, and real `ws` clients. Every inbound message is checked against the strict
 * ServerMessageSchema, so an unknown key (a leaked seed, bag or queue) is recorded as a violation and
 * fails the test at `close()` (REQ-028, REQ-036 on every test).
 */
import { Writable } from 'node:stream';
import {
  COUNTDOWN_MS,
  PING_INTERVAL_MS,
  ServerMessageSchema,
  WS_PATH,
  type ClientMessage,
  type ServerMessage,
  type ServerMessageType,
  type WireAction,
} from '@stackerist/protocol';
import { WebSocket } from 'ws';
import {
  createLogger,
  createServer,
  ManualClock,
  type RoomInspection,
  type ServerOptions,
  type StackeristServer,
  type TestControls,
  type TestOptions,
} from '../../src/index.js';

export type MsgOf<T extends ServerMessageType> = Extract<ServerMessage, { type: T }>;

export async function until(cond: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

export interface ClientOptions {
  readonly headers?: Record<string, string>;
  /** Answer every ping with a pong (default true). */
  readonly autoPong?: boolean;
}

export class TestClient {
  readonly ws: WebSocket;
  readonly received: ServerMessage[] = [];
  /** Raw text of every inbound frame, for byte-level leak scans. */
  readonly raw: string[] = [];
  readonly violations: string[] = [];
  readonly #consumed = new Set<number>();
  autoPong: boolean;
  sent = 0;
  pings = 0;
  /** `t` of the first ping: the server's monotonic ms when this socket opened. */
  t0: number | null = null;
  closed: { readonly code: number; readonly reason: string } | null = null;
  /** The client's own input counter; reset on created / joined / countdown like the real client. */
  seq = 0;

  private constructor(ws: WebSocket, autoPong: boolean) {
    this.ws = ws;
    this.autoPong = autoPong;
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      const text = isBinary ? '<binary>' : data.toString('utf8');
      this.raw.push(text);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        this.violations.push(`not JSON: ${text}`);
        return;
      }
      const parsed = ServerMessageSchema.safeParse(json);
      if (!parsed.success) {
        this.violations.push(`schema: ${text}`);
        return;
      }
      const msg = parsed.data;
      this.received.push(msg);
      if (msg.type === 'created' || msg.type === 'joined' || msg.type === 'countdown') this.seq = 0;
      if (msg.type === 'ping') {
        this.pings += 1;
        this.t0 ??= msg.t;
        if (this.autoPong) this.send({ type: 'pong', t: msg.t });
      }
    });
    ws.on('close', (code: number, reason: Buffer) => {
      this.closed = { code, reason: reason.toString('utf8') };
    });
  }

  static open(url: string, options: ClientOptions = {}): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(
        url,
        options.headers === undefined ? {} : { headers: options.headers },
      );
      const client = new TestClient(ws, options.autoPong ?? true);
      ws.once('open', () => {
        resolve(client);
      });
      ws.once('error', reject);
    });
  }

  /** Sends a message (or raw text / bytes). Counted only while the socket is open. */
  send(msg: ClientMessage | string | Buffer, options: { readonly binary?: boolean } = {}): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const data = typeof msg === 'string' || Buffer.isBuffer(msg) ? msg : JSON.stringify(msg);
    this.ws.send(data, { binary: options.binary ?? false });
    this.sent += 1;
  }

  /** Sends an input with the next seq. */
  input(action: WireAction, tick: number): number {
    this.seq += 1;
    this.send({ type: 'input', seq: this.seq, tick, action });
    return this.seq;
  }

  /** The oldest unconsumed message of `type` (consumes it), waiting for it to arrive. */
  async next<T extends ServerMessageType>(type: T, timeoutMs = 3000): Promise<MsgOf<T>> {
    let found: MsgOf<T> | undefined;
    await until(
      () => {
        for (let i = 0; i < this.received.length; i += 1) {
          const msg = this.received[i];
          if (msg !== undefined && msg.type === type && !this.#consumed.has(i)) {
            this.#consumed.add(i);
            found = msg as MsgOf<T>;
            return true;
          }
        }
        return false;
      },
      `a '${type}' message`,
      timeoutMs,
    );
    if (found === undefined) throw new Error(`no '${type}'`);
    return found;
  }

  all<T extends ServerMessageType>(type: T): MsgOf<T>[] {
    return this.received.filter((m): m is MsgOf<T> => m.type === type);
  }

  last<T extends ServerMessageType>(type: T): MsgOf<T> | undefined {
    return this.all(type).at(-1);
  }

  /** Marks everything received so far as consumed. */
  clear(): void {
    for (let i = 0; i < this.received.length; i += 1) this.#consumed.add(i);
  }

  /** Types received since the last `clear()`/`mark()`, in order (consumed or not). */
  typesSince(index: number): ServerMessageType[] {
    return this.received.slice(index).map((m) => m.type);
  }

  mark(): number {
    return this.received.length;
  }

  /** Waits until at least `n` error messages have arrived; returns every error code so far. */
  async errorCodes(n: number): Promise<string[]> {
    await until(() => this.all('error').length >= n, `${String(n)} error message(s)`);
    return this.all('error').map((e) => e.code);
  }

  /** Waits until a received message satisfies `pred` (consumed or not). */
  async waitFor(pred: (msg: ServerMessage) => boolean, what: string): Promise<void> {
    await until(() => this.received.some(pred), what);
  }

  /** Waits until a snapshot at or after `tick` has arrived (a server → client barrier). */
  async snapshotAt(tick: number): Promise<MsgOf<'snapshot'>> {
    await this.waitFor(
      (m) => m.type === 'snapshot' && m.tick >= tick,
      `a snapshot at tick ${String(tick)}`,
    );
    const snap = this.last('snapshot');
    if (snap === undefined) throw new Error('no snapshot');
    return snap;
  }

  async waitClose(timeoutMs = 3000): Promise<{ readonly code: number; readonly reason: string }> {
    await until(() => this.closed !== null, 'socket close', timeoutMs);
    if (this.closed === null) throw new Error('not closed');
    return this.closed;
  }
}

/** A pino destination that keeps every line in memory (parsed). */
export class MemoryLog extends Writable {
  readonly lines: Record<string, unknown>[] = [];
  readonly text: string[] = [];
  override _write(chunk: Buffer, _enc: BufferEncoding, done: (error?: Error | null) => void): void {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim() === '') continue;
      this.text.push(line);
      this.lines.push(JSON.parse(line) as Record<string, unknown>);
    }
    done();
  }
  events(name: string): Record<string, unknown>[] {
    return this.lines.filter((l) => l.event === name);
  }
}

export interface StartOptions extends Omit<
  ServerOptions,
  'port' | 'host' | 'clientDist' | 'clock' | 'test'
> {
  readonly clock?: ManualClock;
  readonly test?: Omit<TestOptions, 'manualTick'>;
  /** Capture log lines in memory (default: a silent logger). */
  readonly memoryLog?: MemoryLog;
}

export const SEEDS = { pieceSeed: 12345, holeSeed: 678 } as const;

export class Harness {
  readonly server: StackeristServer;
  readonly clock: ManualClock;
  readonly port: number;
  readonly clients: TestClient[] = [];

  constructor(server: StackeristServer, clock: ManualClock, port: number) {
    this.server = server;
    this.clock = clock;
    this.port = port;
  }

  get testing(): TestControls {
    const testing = this.server.testing;
    if (testing === null) throw new Error('test controls missing');
    return testing;
  }

  get wsUrl(): string {
    return `ws://127.0.0.1:${String(this.port)}${WS_PATH}`;
  }

  async connect(options: ClientOptions = {}): Promise<TestClient> {
    const client = await TestClient.open(this.wsUrl, options);
    this.clients.push(client);
    await until(() => client.pings >= 1, 'the first ping');
    await this.settle();
    return client;
  }

  totalSent(): number {
    return this.clients.reduce((sum, c) => sum + c.sent, 0);
  }

  /** I/O barrier: every frame any client has sent has been fully handled. */
  async settle(): Promise<void> {
    await until(() => this.testing.framesHandled() >= this.totalSent(), 'frames to be handled');
  }

  step(ticks = 1): void {
    this.testing.step(ticks);
  }

  inspect(code: string): RoomInspection {
    const room = this.testing.inspect(code);
    if (room === null) throw new Error(`no room ${code}`);
    return room;
  }

  tick(code: string): number {
    return this.inspect(code).tick ?? 0;
  }

  /** Moves the ManualClock forward in ≤ 2 s chunks, letting auto-pong clients answer every ping. */
  async advance(ms: number): Promise<void> {
    let left = ms;
    while (left > 0) {
      const chunk = Math.min(left, 2000);
      this.clock.advance(chunk);
      left -= chunk;
      const now = this.clock.monotonicMs();
      await until(
        () =>
          this.clients.every(
            (c) =>
              c.closed !== null ||
              !c.autoPong ||
              c.t0 === null ||
              c.pings >= 1 + Math.floor((now - c.t0) / PING_INTERVAL_MS),
          ),
        'pings to arrive',
      );
      await this.settle();
    }
  }

  async close(): Promise<void> {
    await this.server.close();
    const violations = this.clients.flatMap((c) => c.violations);
    if (violations.length > 0) {
      throw new Error(`server sent messages outside the strict schema:\n${violations.join('\n')}`);
    }
  }
}

export async function startTestServer(options: StartOptions = {}): Promise<Harness> {
  const clock = options.clock ?? new ManualClock();
  const { memoryLog, test, ...rest } = options;
  const server = await createServer({
    seedProvider: () => SEEDS,
    logger: createLogger(memoryLog === undefined ? { level: 'silent' } : { stream: memoryLog }),
    clientIp: { source: 'socket' },
    ...rest,
    port: 0,
    host: '127.0.0.1',
    clientDist: null,
    clock,
    test: { manualTick: true, ...test },
  });
  const { port } = await server.listen();
  return new Harness(server, clock, port);
}

export interface Duel {
  readonly a: TestClient;
  readonly b: TestClient;
  readonly code: string;
  readonly tokenA: string;
  readonly tokenB: string;
}

/** A creates, B joins with the code; both receive the countdown. */
export async function createAndJoin(h: Harness): Promise<Duel> {
  const a = await h.connect();
  a.send({ type: 'create', name: 'Ann' });
  const created = await a.next('created');
  const b = await h.connect();
  b.send({ type: 'join', code: created.code, name: 'Ben' });
  const joined = await b.next('joined');
  if (joined.token === undefined) throw new Error('B got no token');
  await a.next('countdown');
  await b.next('countdown');
  return { a, b, code: created.code, tokenA: created.token, tokenB: joined.token };
}

/** createAndJoin, then the 3-second countdown runs out: the round is playing. */
export async function startDuel(h: Harness): Promise<Duel> {
  const duel = await createAndJoin(h);
  await h.advance(COUNTDOWN_MS);
  if (h.inspect(duel.code).status !== 'playing') throw new Error('round did not start');
  return duel;
}
