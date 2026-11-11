/**
 * Gaps found by mutation testing (gate 10a, Stryker): each test pins a behaviour of the server's rules,
 * gates, limits or HTTP surface that a mutant could change without any earlier test noticing. Titles
 * carry the REQ id they protect. Everything here runs in-process (no WebSocket needed).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBag, createPlayerState, pieceCells, type PlayerState } from '@stackerist/engine';
import {
  ERROR_CODES,
  MAX_ROUND_SUMMARIES,
  MAX_SNAPSHOT_EVENTS,
  type RoundSummary,
} from '@stackerist/protocol';
import fastify from 'fastify';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveClientIp, resolveClientIpDetailed } from '../src/clientIp.js';
import { ERROR_TEXT, generateRoomCode } from '../src/codes.js';
import { DEFAULT_LIMITS, resolvePort } from '../src/config.js';
import {
  BAD_URL_PAGE,
  contentSecurityPolicy,
  guardOrigin,
  isAllowedOrigin,
  registerHttp,
  respondToFrameworkError,
} from '../src/http.js';
import {
  ManualClock,
  clientIpConfigFromEnv,
  createLogger,
  createServer,
  EventLog,
  type StackeristServer,
} from '../src/index.js';
import { Match } from '../src/match.js';
import { applyForfeit, applyRoundResult, newSeries, nextRound } from '../src/series.js';

// ---------------------------------------------------------------- series

describe('mutation gaps: series', () => {
  it('REQ-083 a terminal series refuses a result, a forfeit and a next round, naming the operation', () => {
    const over = applyForfeit(newSeries(), 'A', 'OPPONENT_LEFT', null);
    expect(over.over).toBe(true);
    expect(() =>
      applyRoundResult(over, { winner: 'A', reason: 'TOP_OUT', durationTicks: 1 }),
    ).toThrow('applyRoundResult on a series that is already over');
    expect(() => applyForfeit(over, 'B', 'OPPONENT_DISCONNECTED', 5)).toThrow(
      'applyForfeit on a series that is already over',
    );
    expect(() => nextRound(over)).toThrow('nextRound on a series that is already over');
    for (const op of [
      () => applyRoundResult(over, { winner: null, reason: 'DRAW', durationTicks: 1 }),
      () => applyForfeit(over, 'A', 'OPPONENT_LEFT', null),
      () => nextRound(over),
    ]) {
      expect(op).toThrow(RangeError);
    }
  });

  it('REQ-092 the round list keeps only the last MAX_ROUND_SUMMARIES entries', () => {
    let s = newSeries();
    for (let i = 0; i < MAX_ROUND_SUMMARIES + 6; i += 1) {
      s = applyRoundResult(s, { winner: null, reason: 'DRAW', durationTicks: i });
    }
    expect(s.over).toBe(false);
    expect(s.rounds).toHaveLength(MAX_ROUND_SUMMARIES);
    expect(s.rounds[0]?.durationTicks).toBe(6);
    expect(s.rounds.at(-1)?.durationTicks).toBe(MAX_ROUND_SUMMARIES + 5);
    // The forfeit path trims the same way.
    const trimmed = applyForfeit(s, 'A', 'OPPONENT_LEFT', 999);
    expect(trimmed.rounds).toHaveLength(MAX_ROUND_SUMMARIES);
    const last: RoundSummary | undefined = trimmed.rounds.at(-1);
    expect(last?.durationTicks).toBe(999);
  });

  it('REQ-083 nextRound on a series with no round played yet advances to round 2 (no previous round to inspect)', () => {
    const next = nextRound(newSeries());
    expect(next.round).toBe(2);
    expect(next.replay).toBe(false);
  });
});

// ---------------------------------------------------------------- config

describe('mutation gaps: PORT', () => {
  it('REQ-073 resolvePort accepts 0 and 65535 and refuses everything outside or fractional', () => {
    expect(resolvePort('0')).toBe(0);
    expect(resolvePort('1')).toBe(1);
    expect(resolvePort('65535')).toBe(65535);
    for (const bad of ['-1', '65536', '1.5', 'abc', '8080x']) {
      expect(() => resolvePort(bad), bad).toThrow(/Invalid PORT/);
    }
    expect(resolvePort(undefined)).toBe(3000);
    expect(resolvePort('   ')).toBe(3000);
  });
});

// ---------------------------------------------------------------- codes and error text

describe('mutation gaps: codes', () => {
  it('REQ-072 every protocol error code has developer-facing text', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_TEXT[code].length, code).toBeGreaterThan(10);
    }
  });

  it('REQ-020 generateRoomCode asks isTaken at most 64 times, then gives up with a clear error', () => {
    let calls = 0;
    expect(() =>
      generateRoomCode(() => {
        calls += 1;
        return true;
      }),
    ).toThrow('No free room code after repeated attempts');
    expect(calls).toBe(64);
  });
});

// ---------------------------------------------------------------- client IP

describe('mutation gaps: client IP (REQ-081)', () => {
  const socket = { remoteAddress: '10.0.0.1' };

  it('REQ-081 the source name is trimmed; blank means the default for the environment', () => {
    expect(clientIpConfigFromEnv({ CLIENT_IP_SOURCE: ' socket ' })).toEqual({ source: 'socket' });
    expect(clientIpConfigFromEnv({ CLIENT_IP_SOURCE: ' x-real-ip ' })).toEqual({
      source: 'x-real-ip',
    });
    expect(clientIpConfigFromEnv({ CLIENT_IP_SOURCE: '   ' })).toEqual({ source: 'socket' });
    expect(clientIpConfigFromEnv({ CLIENT_IP_SOURCE: '', NODE_ENV: 'production' })).toEqual({
      source: 'x-real-ip',
    });
    expect(clientIpConfigFromEnv({ CLIENT_IP_SOURCE: 'x-real-ip' })).toEqual({
      source: 'x-real-ip',
    });
    expect(clientIpConfigFromEnv({ NODE_ENV: 'production' })).toEqual({ source: 'x-real-ip' });
    expect(clientIpConfigFromEnv({ NODE_ENV: 'development' })).toEqual({ source: 'socket' });
  });

  it('REQ-081 x-forwarded-for needs a whole TRUSTED_PROXY_HOPS of at least 1', () => {
    const xff = { CLIENT_IP_SOURCE: 'x-forwarded-for' };
    for (const hops of [undefined, '', '0', '-1', '1.5', 'abc']) {
      const env = hops === undefined ? xff : { ...xff, TRUSTED_PROXY_HOPS: hops };
      expect(() => clientIpConfigFromEnv(env), String(hops)).toThrow(
        'CLIENT_IP_SOURCE=x-forwarded-for needs TRUSTED_PROXY_HOPS ≥ 1',
      );
    }
    expect(clientIpConfigFromEnv({ ...xff, TRUSTED_PROXY_HOPS: '1' })).toEqual({
      source: 'x-forwarded-for',
      trustedHops: 1,
    });
  });

  it('REQ-081 an unknown source is refused whatever TRUSTED_PROXY_HOPS says, and the error names the choices', () => {
    expect(() =>
      clientIpConfigFromEnv({ CLIENT_IP_SOURCE: 'bogus', TRUSTED_PROXY_HOPS: '2' }),
    ).toThrow('CLIENT_IP_SOURCE must be socket, x-real-ip or x-forwarded-for');
  });

  it('REQ-081 an IPv6 address with an embedded IPv4 tail gets the same keys as its hex spelling', () => {
    const cfg = { source: 'x-real-ip' } as const;
    const dotted = resolveClientIpDetailed(
      { headers: { 'x-real-ip': '1::2:3:4:5:1.2.3.4' }, socket },
      cfg,
    );
    const hex = resolveClientIpDetailed(
      { headers: { 'x-real-ip': '1::2:3:4:5:102:304' }, socket },
      cfg,
    );
    expect(dotted.ip).toBe('1:0:2:3::/64');
    expect(dotted.network).toBe('1:0:2::/48');
    expect(dotted).toEqual(hex);
    expect(dotted.fromConfiguredSource).toBe(true);
  });

  it('REQ-081 only a real ::ffff: prefix is unwrapped to IPv4; seven junk characters before an IPv4 address are not', () => {
    const cfg = { source: 'x-real-ip' } as const;
    const mapped = resolveClientIpDetailed(
      { headers: { 'x-real-ip': '::FFFF:203.0.113.7' }, socket },
      cfg,
    );
    expect(mapped.ip).toBe('203.0.113.7');
    expect(mapped.fromConfiguredSource).toBe(true);
    for (const junk of ['garbage1.2.3.4', 'abcdefg203.0.113.7', '::ffff:zzz', ':ffff::1.2.3.4x']) {
      const result = resolveClientIpDetailed({ headers: { 'x-real-ip': junk }, socket }, cfg);
      expect(result.ip, junk).toBe('10.0.0.1');
      expect(result.fromConfiguredSource, junk).toBe(false);
    }
    expect(
      resolveClientIp(
        { headers: { 'x-real-ip': 'garbage1.2.3.4' }, socket },
        { source: 'x-real-ip' },
      ),
    ).toBe('10.0.0.1');
  });
});

// ---------------------------------------------------------------- HTTP

describe('mutation gaps: origin and Host header (REQ-037)', () => {
  it('REQ-037 F5 an absent Host header adds no wss:// entry (never "wss://undefined")', () => {
    const csp = contentSecurityPolicy(undefined, false);
    expect(csp).not.toContain('wss://');
    expect(csp).toMatch(/connect-src 'self'$/);
    expect(contentSecurityPolicy('game.example', false)).toMatch(
      /connect-src 'self' wss:\/\/game\.example$/,
    );
  });

  it('REQ-037 F4 isAllowedOrigin: no Origin passes; a present Origin needs a Host and the same host; junk is refused', () => {
    expect(isAllowedOrigin(undefined, undefined)).toBe(true);
    expect(isAllowedOrigin(undefined, 'game.example')).toBe(true);
    expect(isAllowedOrigin('https://game.example', undefined)).toBe(false);
    expect(isAllowedOrigin('https://game.example', 'game.example')).toBe(true);
    expect(isAllowedOrigin('https://GAME.example', 'game.EXAMPLE')).toBe(true);
    expect(isAllowedOrigin('https://game.example:8443', 'game.example:8443')).toBe(true);
    expect(isAllowedOrigin('https://game.example:8443', 'game.example')).toBe(false);
    expect(isAllowedOrigin('https://evil.example', 'game.example')).toBe(false);
    expect(isAllowedOrigin('null', 'game.example')).toBe(false);
    expect(isAllowedOrigin('not a url', 'game.example')).toBe(false);
    expect(isAllowedOrigin('', 'game.example')).toBe(false);
  });
});

interface Recorded {
  headers: Record<string, string>;
  code: number | undefined;
  type: string | undefined;
  body: unknown;
  sent: boolean;
}

function stubReply(host = 'game.example'): { reply: FastifyReply; rec: Recorded } {
  const rec: Recorded = {
    headers: {},
    code: undefined,
    type: undefined,
    body: undefined,
    sent: false,
  };
  const reply = {
    request: { headers: { host } },
    header(name: string, value: string) {
      rec.headers[name] = value;
      return reply;
    },
    code(status: number) {
      rec.code = status;
      return reply;
    },
    type(value: string) {
      rec.type = value;
      return reply;
    },
    send(body: unknown) {
      rec.body = body;
      rec.sent = true;
      return Promise.resolve(reply);
    },
  };
  return { reply: reply as unknown as FastifyReply, rec };
}

function stubRequest(
  ws: boolean,
  origin: string | undefined,
  host: string | undefined,
): FastifyRequest {
  return { ws, headers: { origin, host } } as unknown as FastifyRequest;
}

describe('mutation gaps: the /ws origin guard and framework errors', () => {
  it('REQ-037 F4 guardOrigin answers a cross-site upgrade with 403 FORBIDDEN_ORIGIN and lets same-site, no-Origin and plain HTTP through', async () => {
    const blocked = stubReply();
    await guardOrigin(stubRequest(true, 'https://evil.example', 'game.example'), blocked.reply);
    expect(blocked.rec.code).toBe(403);
    expect(blocked.rec.body).toEqual({ error: 'FORBIDDEN_ORIGIN' });

    const noHost = stubReply();
    await guardOrigin(stubRequest(true, 'https://game.example', undefined), noHost.reply);
    expect(noHost.rec.code).toBe(403);

    for (const [ws, origin] of [
      [true, 'https://game.example'],
      [true, undefined],
      [false, 'https://evil.example'],
    ] as const) {
      const passed = stubReply();
      await guardOrigin(stubRequest(ws, origin, 'game.example'), passed.reply);
      expect(passed.rec.sent, `${String(ws)} ${String(origin)}`).toBe(false);
    }
  });

  it('REQ-073 a bad URL gets the static 400 page; any other framework error is passed on untouched; both carry the security headers', () => {
    const bad = stubReply();
    respondToFrameworkError(
      Object.assign(new Error('bad'), { code: 'FST_ERR_BAD_URL' }),
      bad.reply,
      false,
    );
    expect(bad.rec.code).toBe(400);
    expect(bad.rec.headers['cache-control']).toBe('no-store');
    expect(bad.rec.type).toBe('text/html; charset=utf-8');
    expect(bad.rec.body).toBe(BAD_URL_PAGE);
    expect(bad.rec.headers['x-content-type-options']).toBe('nosniff');
    expect(bad.rec.headers['referrer-policy']).toBe('no-referrer');
    expect(bad.rec.headers['content-security-policy']).toContain("default-src 'self'");

    const other = stubReply();
    const error = Object.assign(new Error('other'), { code: 'FST_ERR_SOMETHING' }) as FastifyError;
    respondToFrameworkError(error, other.reply, false);
    expect(other.rec.code).toBeUndefined();
    expect(other.rec.type).toBeUndefined();
    expect(other.rec.body).toBe(error);
    expect(other.rec.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('mutation gaps: the error handler (REQ-072)', () => {
  it('REQ-072 a 4xx error keeps its status and answers BAD_REQUEST unlogged; anything else is a logged 500 INTERNAL', async () => {
    const app = fastify();
    const log = new EventLog(createLogger({ level: 'silent' }), new ManualClock());
    const errorLog = vi.spyOn(log, 'error');
    await registerHttp(app, { clientDist: null, log, inlineStyles: false });
    app.get('/fail/:status', (request) => {
      const raw = (request.params as { status: string }).status;
      // 's404' is the numeric string '404': a status must be a number, so it is not honoured.
      const statusCode: unknown = /^\d+$/.test(raw) ? Number(raw) : raw === 's404' ? '404' : raw;
      throw Object.assign(new Error('boom'), { statusCode });
    });
    app.get('/plain', () => {
      throw new Error('no status at all');
    });
    app.get('/null', () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw null;
    });

    for (const status of [400, 404, 418, 499]) {
      errorLog.mockClear();
      const res = await app.inject({ method: 'GET', url: `/fail/${String(status)}` });
      expect(res.statusCode, String(status)).toBe(status);
      expect(res.json(), String(status)).toEqual({ error: 'BAD_REQUEST' });
      expect(errorLog, String(status)).not.toHaveBeenCalled();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    }
    for (const url of [
      '/fail/399',
      '/fail/500',
      '/fail/503',
      '/fail/text',
      '/fail/s404',
      '/plain',
      '/null',
    ]) {
      errorLog.mockClear();
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(500);
      expect(res.json(), url).toEqual({ error: 'INTERNAL' });
      expect(errorLog, url).toHaveBeenCalledTimes(1);
    }
    await app.close();
  });
});

describe('mutation gaps: static client and SPA fallback (REQ-073)', () => {
  let dist: string;
  let server: StackeristServer | null = null;

  beforeAll(() => {
    dist = mkdtempSync(join(tmpdir(), 'stackerist-mut-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Stackerist</title>');
  });
  afterAll(() => {
    rmSync(dist, { recursive: true, force: true });
  });
  afterEach(async () => {
    await server?.close();
    server = null;
  });

  async function start(clientDist: string | null): Promise<StackeristServer> {
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      clientDist,
      clock: new ManualClock(),
      logger: createLogger({ level: 'silent' }),
      clientIp: { source: 'socket' },
    });
    return server;
  }

  it('REQ-073 / and an extension-less path serve index.html as HTML for GET and HEAD; other methods and missing files are a JSON 404', async () => {
    const { app } = await start(dist);
    for (const method of ['GET', 'HEAD'] as const) {
      for (const url of ['/', '/g/ABC234']) {
        const res = await app.inject({ method, url });
        expect(res.statusCode, `${method} ${url}`).toBe(200);
        expect(String(res.headers['content-type']), `${method} ${url}`).toMatch(/^text\/html/);
        expect(res.headers['cache-control'], `${method} ${url}`).toBe('no-cache');
      }
    }
    const post = await app.inject({ method: 'POST', url: '/g/ABC234' });
    expect(post.statusCode).toBe(404);
    expect(post.json()).toEqual({ error: 'NOT_FOUND' });
    const missing = await app.inject({ method: 'GET', url: '/assets/missing.js' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'NOT_FOUND' });
    expect(String(missing.headers['content-type'])).toMatch(/json/);
  });

  it('REQ-073 a file added after start is still served (the static root is resolved per request)', async () => {
    const { app } = await start(dist);
    writeFileSync(join(dist, 'late.txt'), 'added after the server started');
    const res = await app.inject({ method: 'GET', url: '/late.txt' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('added after the server started');
  });

  it('REQ-073 a client directory that does not exist is skipped: no static routes, the API still answers', async () => {
    const { app } = await start(join(dist, 'does-not-exist'));
    const page = await app.inject({ method: 'GET', url: '/g/ABC234' });
    expect(page.statusCode).toBe(404);
    expect(page.json()).toEqual({ error: 'NOT_FOUND' });
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------- the round pipeline

function makeMatch(overrides: Partial<ConstructorParameters<typeof Match>[0]> = {}): Match {
  return new Match({
    seeds: { pieceSeed: 12345, holeSeed: 678 },
    startTick: 0,
    holeRng: () => 3,
    limits: { ...DEFAULT_LIMITS, inputBurst: 1000 },
    nowMs: 0,
    ...overrides,
  });
}

const move = (seq: number, tick: number) =>
  ({ seq, tick, action: { type: 'moveLeft' as const } }) as const;

describe('mutation gaps: Match construction (REQ-023)', () => {
  const MAX = 2 ** 31 - 1;

  it('REQ-023 seeds must be whole numbers in 0..2^31-1, each one checked, and the error says so', () => {
    for (const pieceSeed of [-1, MAX + 1, 1.5, Number.NaN]) {
      expect(
        () => makeMatch({ seeds: { pieceSeed, holeSeed: 1 } }),
        `piece ${String(pieceSeed)}`,
      ).toThrow('Match seeds must be integers in 0..2^31-1');
      expect(
        () => makeMatch({ seeds: { pieceSeed: 1, holeSeed: pieceSeed } }),
        `hole ${String(pieceSeed)}`,
      ).toThrow(RangeError);
    }
    expect(() => makeMatch({ seeds: { pieceSeed: 0, holeSeed: 0 } })).not.toThrow();
    expect(() => makeMatch({ seeds: { pieceSeed: MAX, holeSeed: MAX } })).not.toThrow();
  });

  it('REQ-023 startTick must be a whole tick in 0..2^31-1, and the error says so', () => {
    for (const startTick of [-1, MAX + 1, 0.5, Number.NaN]) {
      expect(() => makeMatch({ startTick }), String(startTick)).toThrow('startTick must be a tick');
    }
    expect(makeMatch({ startTick: 0 }).tick).toBe(0);
    expect(makeMatch({ startTick: MAX }).tick).toBe(MAX);
  });

  it('REQ-023 both seats start from the same seed with separate, identical piece sequences', () => {
    const match = makeMatch();
    expect(match.states.A.active).toEqual(match.states.B.active);
    expect(match.states.A.queue).toEqual(match.states.B.queue);
    expect(match.states.A.bag).not.toBe(match.states.B.bag);
  });
});

describe('mutation gaps: input buffers on pause and bind (REQ-038, REQ-034)', () => {
  it('REQ-034 a pause empties both buffers and forgets the stamps, but remembers what was seen and the seq floor', () => {
    const match = makeMatch();
    expect(match.receiveInput('A', move(1, 5), 0)).toBe('accepted');
    expect(match.receiveInput('B', move(1, 5), 0)).toBe('accepted');
    expect(match.bufferLength('A')).toBe(1);
    match.clearBuffers();
    expect(match.bufferLength('A')).toBe(0);
    expect(match.bufferLength('B')).toBe(0);
    // Nothing is left to apply, so every seen seq is acknowledged.
    expect(match.lastAckSeq('A')).toBe(1);
    expect(match.lastAckSeq('B')).toBe(1);
    // The stamp floor is gone (an earlier tick is fine again), the seq floor is not.
    expect(match.receiveInput('A', move(1, 0), 0)).toBe('badSeq');
    expect(match.receiveInput('A', move(2, 0), 0)).toBe('accepted');
    expect(match.receiveInput('B', move(2, 0), 0)).toBe('accepted');
  });

  it('REQ-034 a new binding gives that seat a fresh seq space and leaves the other seat alone', () => {
    const match = makeMatch();
    expect(match.receiveInput('A', move(5, 3), 0)).toBe('accepted');
    expect(match.receiveInput('B', move(5, 3), 0)).toBe('accepted');
    match.resetSeatSequence('A');
    expect(match.bufferLength('A')).toBe(0);
    expect(match.bufferLength('B')).toBe(1);
    expect(match.lastAckSeq('A')).toBe(0);
    expect(match.lastAckSeq('B')).toBe(4); // B's first queued seq is 5, so 4 is acknowledged
    expect(match.receiveInput('A', move(1, 0), 0)).toBe('accepted'); // seq 1 and tick 0 are valid again
    expect(match.receiveInput('B', move(1, 0), 0)).toBe('badSeq'); // B kept its floor
  });
});

describe('mutation gaps: round end and snapshot cadence (REQ-027, REQ-046)', () => {
  it('REQ-027 a snapshot is due on the round-ending tick even when nothing locked and the cadence is not yet reached', () => {
    const quiet = makeMatch();
    expect(quiet.step().snapshotDue).toBe(false); // tick 1: no lock, 1 tick since the last snapshot

    for (const [out, expected] of [
      ['A', { winner: 'B', reason: 'TOP_OUT' }],
      ['B', { winner: 'A', reason: 'TOP_OUT' }],
    ] as const) {
      const match = makeMatch();
      match.states[out] = { ...match.states[out], toppedOut: true };
      const result = match.step();
      expect(result.outcome).toEqual(expected);
      expect(result.snapshotDue).toBe(true);
    }
    const draw = makeMatch();
    draw.states.A = { ...draw.states.A, toppedOut: true };
    draw.states.B = { ...draw.states.B, toppedOut: true };
    expect(draw.step().outcome).toEqual({ winner: null, reason: 'DRAW' });
  });

  it('REQ-027 snapshot events are capped at the last MAX_SNAPSHOT_EVENTS since the previous broadcast', () => {
    const match = makeMatch();
    // Two rows with a 2-wide hole at columns 8-9 and an O above it: a hard drop clears two rows (attack 1).
    const row = 'GGGGGGGG..';
    const board = Array.from({ length: 20 }, (_, y) => (y >= 18 ? row : '..........'));
    const originX =
      8 - Math.min(...pieceCells({ kind: 'O', rotation: 0, x: 0, y: 0 }).map((c) => c.x));
    const armed = (tick: number): PlayerState =>
      createPlayerState({
        board,
        active: { kind: 'O', rotation: 0, x: originX, y: 0 },
        bag: createBag(9),
        tick,
      });
    const total = MAX_SNAPSHOT_EVENTS + 6;
    for (let i = 0; i < total; i += 1) {
      match.states.A = armed(match.tick);
      expect(
        match.receiveInput('A', { seq: i + 1, tick: match.tick, action: { type: 'hardDrop' } }, 0),
      ).toBe('accepted');
      match.step();
    }
    const events = match.takeSnapshotEvents();
    expect(events).toHaveLength(MAX_SNAPSHOT_EVENTS);
    expect(events.every((e) => e.type === 'attack' && e.from === 'A' && e.rows === 1)).toBe(true);
    expect(events[0]?.tick).toBe(total - MAX_SNAPSHOT_EVENTS); // the oldest six were dropped
    expect(events.at(-1)?.tick).toBe(total - 1);
    expect(match.takeSnapshotEvents()).toEqual([]);
  });
});
