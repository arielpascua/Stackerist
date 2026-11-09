/**
 * `createServer` (architecture §4.2): one Fastify app on one port serving the client, GET /healthz and
 * the /ws WebSocket, with every dependency injectable for deterministic tests (clock, seeds, hole RNG,
 * client-IP strategy, limits, manual ticks).
 */
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fastifyWebsocket from '@fastify/websocket';
import { BOARD_WIDTH, rngInt, seedRng } from '@stackerist/engine';
import { CLOSE_CODES, WS_PATH, normalizeRoomCode, type ClientMessage } from '@stackerist/protocol';
import { fastify, LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { clientIpConfigFromEnv, type ClientIpConfig } from './clientIp.js';
import { realClock, type Clock } from './clock.js';
import { CLOSE } from './codes.js';
import { DEFAULT_LIMITS, resolvePort, type Limits } from './config.js';
import { ConnectionHub } from './connection.js';
import { registerHttp, respondToFrameworkError } from './http.js';
import { createLogger, EventLog } from './log.js';
import { GameLoop } from './loop.js';
import type { MatchSeeds } from './match.js';
import { RoomRegistry, type RoomInspection } from './rooms.js';
import { safeCall } from './safe.js';

export type { MatchSeeds } from './match.js';
export type { RoomInspection, SeatInspection } from './rooms.js';

/** `apps/client/dist`, resolved from this file so it works from src (tsx) and dist (node). */
const DEFAULT_CLIENT_DIST = fileURLToPath(new URL('../../client/dist/', import.meta.url));

export interface TestOptions {
  /** No loop timer; drive ticks with `testing.step()`. */
  readonly manualTick?: boolean;
  /** First play tick of every round (21600 → level 12 at once). */
  readonly startTick?: number;
  /** Fault injection inside the wrapped handler (REQ-072). */
  readonly throwOn?: (msg: ClientMessage) => boolean;
}

export interface ServerOptions {
  /** Default resolvePort(process.env.PORT) → 3000; tests pass 0. */
  readonly port?: number;
  /** Default process.env.HOST ?? '0.0.0.0'. */
  readonly host?: string;
  /** Default apps/client/dist; null disables static serving. */
  readonly clientDist?: string | null;
  /** A pino instance; tests inject one that writes to memory. */
  readonly logger?: Logger;
  readonly clock?: Clock;
  /** Default crypto.randomInt(2 ** 31) for each seed, per round. */
  readonly seedProvider?: () => MatchSeeds;
  /** Returns a hole column 0..9 per call. Default: the engine's mulberry32 seeded with holeSeed. */
  readonly holeRngFactory?: (holeSeed: number) => () => number;
  /** Default clientIpConfigFromEnv(process.env). */
  readonly clientIp?: ClientIpConfig;
  readonly limits?: Partial<Limits>;
  /** Never set in production. */
  readonly test?: TestOptions;
}

export interface TestControls {
  /** manualTick only: process N ticks for every playing room, then return (sends are queued). */
  step(ticks?: number): void;
  /** Total client frames fully handled (an I/O barrier for tests). */
  framesHandled(): number;
  inspect(code: string): RoomInspection | null;
}

export interface StackeristServer {
  readonly app: FastifyInstance;
  listen(): Promise<{ readonly port: number; readonly url: string }>;
  /** Closes sockets with 1001 and clears timers. */
  close(): Promise<void>;
  /** Non-null iff options.test was given. */
  readonly testing: TestControls | null;
}

function defaultSeeds(): MatchSeeds {
  return { pieceSeed: randomInt(2 ** 31), holeSeed: randomInt(2 ** 31) };
}

/** The server's own hole RNG (REQ-017): unbiased columns from mulberry32. */
export function defaultHoleRngFactory(holeSeed: number): () => number {
  let state = seedRng(holeSeed);
  return () => {
    const step = rngInt(state, BOARD_WIDTH);
    state = step.state;
    return step.value;
  };
}

export async function createServer(options: ServerOptions = {}): Promise<StackeristServer> {
  const limits: Limits = { ...DEFAULT_LIMITS, ...options.limits };
  const clock = options.clock ?? realClock;
  const logger = options.logger ?? createLogger();
  const log = new EventLog(logger, clock);
  const clientIp = options.clientIp ?? clientIpConfigFromEnv(process.env);
  const port = options.port ?? resolvePort(process.env.PORT);
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  const clientDist = options.clientDist === undefined ? DEFAULT_CLIENT_DIST : options.clientDist;
  const test = options.test;

  // Widen to Fastify's logger interface so the instance type stays the default FastifyInstance.
  const loggerInstance: FastifyBaseLogger = logger;
  const app = fastify({
    loggerInstance,
    logController: new LogController({ disableRequestLogging: true }),
    frameworkErrors: (error, _request, reply) => {
      respondToFrameworkError(error, reply);
    },
  });

  await app.register(fastifyWebsocket, {
    options: { maxPayload: limits.wsHardMaxPayloadBytes },
    errorHandler: (error, socket) => {
      log.error('handler.error', {}, error);
      socket.terminate();
    },
    preClose: (done) => {
      for (const client of app.websocketServer.clients) {
        client.close(CLOSE_CODES.SERVER_SHUTDOWN, CLOSE.SERVER_SHUTDOWN);
      }
      done();
    },
  });
  await registerHttp(app, { clientDist, log });

  const loop = new GameLoop(clock, {
    manual: test?.manualTick === true,
    maxCatchUpTicks: limits.maxCatchUpTicks,
  });
  const registry = new RoomRegistry({
    clock,
    log,
    limits,
    loop,
    seedProvider: options.seedProvider ?? defaultSeeds,
    holeRngFactory: options.holeRngFactory ?? defaultHoleRngFactory,
    startTick: test?.startTick ?? 0,
  });
  const hub = new ConnectionHub({ clock, log, limits, registry, clientIp, throwOn: test?.throwOn });

  app.get(WS_PATH, { websocket: true }, (socket, request) => {
    safeCall(
      log,
      {},
      () => {
        hub.accept(socket, request);
      },
      () => {
        socket.terminate();
      },
    );
  });

  let closed = false;
  const server: StackeristServer = {
    app,
    async listen() {
      const address = await app.listen({
        port,
        host,
        listenTextResolver: () => 'server listening',
      });
      const bound = app.server.address();
      const actualPort = typeof bound === 'object' && bound !== null ? bound.port : port;
      log.info('server.listening');
      const url = new URL(address);
      if (url.hostname === '0.0.0.0' || url.hostname === '[::]') url.hostname = '127.0.0.1';
      return { port: actualPort, url: url.origin };
    },
    async close() {
      if (closed) return;
      closed = true;
      loop.stop();
      registry.shutdown();
      hub.closeAll();
      log.flushAll();
      await app.close();
    },
    testing:
      test === undefined
        ? null
        : {
            step(ticks = 1) {
              if (test.manualTick !== true) throw new Error('testing.step needs test.manualTick');
              loop.stepAll(ticks);
            },
            framesHandled: () => hub.framesHandled,
            inspect(code) {
              const canonical = normalizeRoomCode(code);
              const room = canonical === null ? undefined : registry.get(canonical);
              return room === undefined ? null : room.inspect();
            },
          },
  };
  return server;
}
