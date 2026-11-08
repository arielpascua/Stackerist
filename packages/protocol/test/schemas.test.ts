import { Buffer } from 'node:buffer';
import fc from 'fast-check';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as z from 'zod';
import {
  ActionSchema,
  CLIENT_MESSAGE_TYPES,
  ClientMessageSchema,
  CreateMessageSchema,
  ERROR_CODES,
  InputMessageSchema,
  JoinMessageSchema,
  LiveStatsSchema,
  MAX_FRAME_BYTES,
  MAX_HEIGHT_SAMPLES,
  MAX_SNAPSHOT_EVENTS,
  MAX_WIRE_INT,
  NAME_MAX_LENGTH,
  NameSchema,
  OwnViewSchema,
  PlayerStatsSchema,
  PublicViewSchema,
  RoundReportSchema,
  SERVER_MESSAGE_TYPES,
  SeriesViewSchema,
  ServerMessageSchema,
  SnapshotEventSchema,
  parseClientMessage,
  parseServerMessage,
  toOwnView,
  toPlayerStats,
  toPublicView,
  type ClientMessage,
  type ClientMessageType,
  type ServerMessage,
  type ServerMessageType,
} from '../src/index.js';
import {
  clientMessageArb,
  codePoints,
  createArb,
  deepKeys,
  joinArb,
  nameArb,
  serverMessageArb,
} from './arbitraries.js';
import { SAMPLE_REPORT, SERIES_IN_PROGRESS, sampleState } from './fixtures.js';

const TOKEN = 'AbCdEfGhIjKlMnOpQrSt_-';

/** One real message per client type; the mapped type makes a missing type a compile error. */
const CLIENT_SAMPLES: { [K in ClientMessageType]: Extract<ClientMessage, { type: K }> } = {
  create: { type: 'create', name: 'Sam' },
  join: { type: 'join', code: 'K7QM4X', name: 'Ari' },
  rejoin: { type: 'rejoin', code: 'K7QM4X', token: TOKEN },
  input: { type: 'input', seq: 1, tick: 4, action: { type: 'hardDrop' } },
  leave: { type: 'leave' },
  rematch: { type: 'rematch' },
  pong: { type: 'pong', t: 123_456 },
};

const stateA = sampleState();
const stateB = sampleState({ bestMoment: null, combo: 0, queue: ['L', 'J', 'T', 'O', 'I'] });

/** One real message per server type, the views built through views.ts. */
const SERVER_SAMPLES: { [K in ServerMessageType]: Extract<ServerMessage, { type: K }> } = {
  created: { type: 'created', code: 'K7QM4X', token: TOKEN, seat: 'A' },
  joined: { type: 'joined', code: 'K7QM4X', seat: 'B', token: TOKEN },
  room: {
    type: 'room',
    code: 'K7QM4X',
    status: 'playing',
    players: { A: { name: 'Sam', connected: true }, B: { name: 'Ari', connected: false } },
    spectators: 2,
    series: SERIES_IN_PROGRESS,
  },
  countdown: {
    type: 'countdown',
    startsAt: 1_762_600_003_000,
    serverNow: 1_762_600_000_000,
    tick: 0,
  },
  snapshot: {
    type: 'snapshot',
    tick: 120,
    level: 0,
    you: toOwnView(stateA, 7),
    players: { A: toPublicView(stateA), B: toPublicView(stateB) },
    events: [
      { type: 'attack', from: 'A', rows: 1, tick: 96 },
      { type: 'cancel', seat: 'A', rows: 1, tick: 96 },
    ],
  },
  paused: {
    type: 'paused',
    seat: 'B',
    graceEndsAt: 1_762_600_020_000,
    serverNow: 1_762_600_000_000,
    pausesLeft: 2,
  },
  resumed: {
    type: 'resumed',
    startsAt: 1_762_600_003_000,
    serverNow: 1_762_600_000_000,
    tick: 1234,
  },
  gameOver: {
    type: 'gameOver',
    round: 2,
    replay: false,
    winner: 'A',
    reason: 'TOP_OUT',
    tick: 5400,
    series: {
      ...SERIES_IN_PROGRESS,
      score: { A: 2, B: 0 },
      over: true,
      winner: 'A',
      endReason: 'TWO_WINS',
    },
    stats: { A: toPlayerStats(stateA), B: toPlayerStats(stateB) },
    report: { A: SAMPLE_REPORT, B: { ...SAMPLE_REPORT, heightSamples: [] } },
  },
  rematchStatus: { type: 'rematchStatus', A: true, B: false },
  error: { type: 'error', code: 'ROOM_NOT_FOUND', message: 'no room with that code' },
  ping: { type: 'ping', t: 98_765, rtt: null },
};

const roundTripClient = (msg: unknown) => parseClientMessage(JSON.stringify(msg));
const roundTripServer = (msg: unknown) => parseServerMessage(JSON.stringify(msg));
const without = (msg: object, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(msg).filter(([k]) => k !== key));
const withField = (msg: object, key: string, value: unknown): Record<string, unknown> => ({
  ...msg,
  [key]: value,
});

describe('REQ-045 protocol: every message has a schema and round-trips', () => {
  it('REQ-045 the client message types are exactly source spec §5', () => {
    expect([...CLIENT_MESSAGE_TYPES].sort()).toEqual(
      ['create', 'join', 'rejoin', 'input', 'leave', 'rematch', 'pong'].sort(),
    );
    expectTypeOf(CLIENT_MESSAGE_TYPES).toEqualTypeOf<ClientMessageType[]>();
  });

  it('REQ-045 the server message types are exactly source spec §5', () => {
    expect([...SERVER_MESSAGE_TYPES].sort()).toEqual(
      [
        'created',
        'joined',
        'room',
        'countdown',
        'snapshot',
        'paused',
        'resumed',
        'gameOver',
        'rematchStatus',
        'error',
        'ping',
      ].sort(),
    );
    expectTypeOf(SERVER_MESSAGE_TYPES).toEqualTypeOf<ServerMessageType[]>();
  });

  it.each(Object.entries(CLIENT_SAMPLES))('REQ-045 client %s round-trips', (_type, msg) => {
    expect(roundTripClient(msg)).toEqual({ ok: true, msg });
  });

  it.each(Object.entries(SERVER_SAMPLES))('REQ-045 server %s round-trips', (_type, msg) => {
    expect(roundTripServer(msg)).toEqual(msg);
  });

  it('REQ-045 every generated client message round-trips: parse(serialize(m)) = m', () => {
    fc.assert(
      fc.property(clientMessageArb, (msg) => {
        expect(roundTripClient(msg)).toEqual({ ok: true, msg });
      }),
      { numRuns: 500 },
    );
  });

  it('REQ-045 every generated server message round-trips: parse(serialize(m)) = m', () => {
    fc.assert(
      fc.property(serverMessageArb, (msg) => {
        expect(roundTripServer(msg)).toEqual(msg);
      }),
      { numRuns: 300 },
    );
  });

  it('REQ-045 the generators reach every message type', () => {
    const client = new Set(fc.sample(clientMessageArb, 400).map((m) => m.type));
    const server = new Set(fc.sample(serverMessageArb, 600).map((m) => m.type));
    expect([...client].sort()).toEqual([...CLIENT_MESSAGE_TYPES].sort());
    expect([...server].sort()).toEqual([...SERVER_MESSAGE_TYPES].sort());
  });

  it('REQ-045 input carries the tick stamp (int 0..2^31−1) and seq (int 1..2^31−1)', () => {
    const input = CLIENT_SAMPLES.input;
    expect(roundTripClient(without(input, 'tick'))).toEqual({ ok: false, reason: 'BAD_SCHEMA' });
    for (const tick of [0, MAX_WIRE_INT]) {
      expect(roundTripClient({ ...input, tick }).ok).toBe(true);
    }
    for (const tick of [-1, 1.5, MAX_WIRE_INT + 1]) {
      expect(roundTripClient({ ...input, tick }).ok).toBe(false);
    }
    for (const seq of [0, -1, 2.5, MAX_WIRE_INT + 1]) {
      expect(roundTripClient({ ...input, seq }).ok).toBe(false);
    }
    expect(roundTripClient({ ...input, seq: MAX_WIRE_INT }).ok).toBe(true);
  });

  it('REQ-045 REQ-080 ping carries rtt (ms, integer ≥ 0, or null until measured)', () => {
    const ping = SERVER_SAMPLES.ping;
    expect(roundTripServer({ ...ping, rtt: 42 })).toEqual({ ...ping, rtt: 42 });
    expect(roundTripServer(without(ping, 'rtt'))).toBeNull();
    for (const rtt of [-1, 1.5, '42']) {
      expect(roundTripServer({ ...ping, rtt })).toBeNull();
    }
  });

  it('REQ-045 REQ-080 countdown and resumed carry the start tick', () => {
    for (const msg of [SERVER_SAMPLES.countdown, SERVER_SAMPLES.resumed]) {
      expect(roundTripServer(msg)?.type).toBe(msg.type);
      expect(roundTripServer(without(msg, 'tick'))).toBeNull();
      expect(roundTripServer({ ...msg, tick: -1 })).toBeNull();
    }
  });

  it('REQ-045 both views carry combo', () => {
    expect(Object.keys(PublicViewSchema.shape)).toContain('combo');
    expect(Object.keys(OwnViewSchema.shape)).toContain('combo');
    const snapshot = SERVER_SAMPLES.snapshot;
    const parsed = roundTripServer(snapshot);
    expect(parsed?.type === 'snapshot' && parsed.players.A?.combo).toBe(stateA.combo);
    expect(parsed?.type === 'snapshot' && parsed.you?.combo).toBe(stateA.combo);
  });

  it('REQ-045 snapshot events are exactly attack and cancel (no clear event, no hole column)', () => {
    const types = SnapshotEventSchema.options.map((o) => o.shape.type.value);
    expect(types.sort()).toEqual(['attack', 'cancel']);
    const snapshot = SERVER_SAMPLES.snapshot;
    const clear = { type: 'clear', seat: 'A', rows: 2, tick: 96 };
    expect(roundTripServer({ ...snapshot, events: [clear] })).toBeNull();
    const withHole = { type: 'attack', from: 'A', rows: 1, tick: 96, holeColumn: 3 };
    expect(roundTripServer({ ...snapshot, events: [withHole] })).toBeNull();
    const many = Array.from({ length: MAX_SNAPSHOT_EVENTS + 1 }, () => snapshot.events[0]);
    expect(roundTripServer({ ...snapshot, events: many })).toBeNull();
  });

  it('REQ-045 room and gameOver carry the round and series fields', () => {
    const room = roundTripServer(SERVER_SAMPLES.room);
    expect(room?.type === 'room' && room.series).toEqual(SERIES_IN_PROGRESS);
    const over = roundTripServer(SERVER_SAMPLES.gameOver);
    expect(over?.type === 'gameOver' && [over.round, over.replay, over.series.over]).toEqual([
      2,
      false,
      true,
    ]);
  });

  it('REQ-045 a series view sets winner and endReason exactly when it is over', () => {
    const open = SERIES_IN_PROGRESS;
    expect(SeriesViewSchema.safeParse(open).success).toBe(true);
    expect(SeriesViewSchema.safeParse({ ...open, winner: 'A' }).success).toBe(false);
    expect(SeriesViewSchema.safeParse({ ...open, over: true }).success).toBe(false);
    expect(
      SeriesViewSchema.safeParse({ ...open, over: true, winner: 'B', endReason: 'OPPONENT_LEFT' })
        .success,
    ).toBe(true);
    for (const score of [3, -1]) {
      expect(SeriesViewSchema.safeParse({ ...open, score: { A: score, B: 0 } }).success).toBe(
        false,
      );
    }
    for (const round of [0, 4]) {
      expect(SeriesViewSchema.safeParse({ ...open, round }).success).toBe(false);
    }
  });

  it('REQ-045 gameOver carries the round report (heightSamples rows 0..20, ≤ 7200)', () => {
    expect(Object.keys(RoundReportSchema.shape).sort()).toEqual(
      [
        'piecesPlaced',
        'actions',
        'garbageSent',
        'garbageReceived',
        'garbageCancelled',
        'durationTicks',
        'heightSamples',
      ].sort(),
    );
    const full = { ...SAMPLE_REPORT, heightSamples: Array<number>(MAX_HEIGHT_SAMPLES).fill(20) };
    expect(RoundReportSchema.safeParse(full).success).toBe(true);
    const tooMany = { ...full, heightSamples: [...full.heightSamples, 0] };
    expect(RoundReportSchema.safeParse(tooMany).success).toBe(false);
    expect(RoundReportSchema.safeParse({ ...SAMPLE_REPORT, heightSamples: [21] }).success).toBe(
      false,
    );
  });

  it('REQ-045 gameOver stats are { A?, B? } of exactly the design §6 PlayerStats fields', () => {
    expect(Object.keys(PlayerStatsSchema.shape).sort()).toEqual(
      [
        'linesCleared',
        'garbageSent',
        'garbageCancelled',
        'piecesPlaced',
        'bestCombo',
        'bestMoment',
      ].sort(),
    );
    const over = roundTripServer(SERVER_SAMPLES.gameOver);
    expect(over?.type === 'gameOver' && over.stats.B?.bestMoment).toBeNull();
    expect(over?.type === 'gameOver' && over.stats.A?.bestMoment?.combo).toBe(3);
    expect(roundTripServer({ ...SERVER_SAMPLES.gameOver, stats: {} })?.type).toBe('gameOver');
  });

  it('REQ-045 a joined spectator never carries a token', () => {
    const spectator = { type: 'joined', code: 'K7QM4X', seat: 'spectator' };
    expect(roundTripServer(spectator)).toEqual(spectator);
    expect(roundTripServer({ ...spectator, token: TOKEN })).toBeNull();
  });

  it('REQ-045 the error code is one of ERROR_CODES', () => {
    for (const code of ERROR_CODES) {
      expect(roundTripServer({ type: 'error', code, message: '' })?.type).toBe('error');
    }
    expect(roundTripServer({ type: 'error', code: 'NOPE', message: '' })).toBeNull();
  });

  it('REQ-045 removing any always-required key rejects the message', () => {
    const clientRequired: { [K in ClientMessageType]: readonly string[] } = {
      create: ['type', 'name'],
      join: ['type', 'code'],
      rejoin: ['type', 'code', 'token'],
      input: ['type', 'seq', 'tick', 'action'],
      leave: ['type'],
      rematch: ['type'],
      pong: ['type', 't'],
    };
    for (const type of CLIENT_MESSAGE_TYPES) {
      for (const key of clientRequired[type]) {
        expect(roundTripClient(without(CLIENT_SAMPLES[type], key)), `${type}.${key}`).toEqual({
          ok: false,
          reason: 'BAD_SCHEMA',
        });
      }
    }
    for (const type of SERVER_MESSAGE_TYPES) {
      const sample = SERVER_SAMPLES[type];
      const optional = new Set(['token', 'you']);
      for (const key of Object.keys(sample).filter((k) => !optional.has(k))) {
        expect(roundTripServer(without(sample, key)), `${type}.${key}`).toBeNull();
      }
    }
  });
});

describe('REQ-036 no client message can carry game state', () => {
  /** Every key any client message can hold, at any depth (objects, optionals, unions). */
  function schemaKeys(schema: unknown, into: Set<string> = new Set()): Set<string> {
    if (schema instanceof z.ZodObject) {
      for (const [key, child] of Object.entries(schema.shape)) {
        into.add(key);
        schemaKeys(child, into);
      }
    } else if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
      schemaKeys(schema.unwrap(), into);
    } else if (schema instanceof z.ZodArray) {
      schemaKeys(schema.element, into);
    } else if (schema instanceof z.ZodUnion) {
      for (const option of schema.options) {
        schemaKeys(option, into);
      }
    }
    return into;
  }

  const GAME_STATE_KEYS = [
    'board',
    'active',
    'piece',
    'kind',
    'rotation',
    'x',
    'y',
    'cells',
    'queue',
    'next',
    'bag',
    'seed',
    'garbage',
    'pendingGarbage',
    'holeColumn',
    'rows',
    'attack',
    'stats',
    'linesCleared',
    'combo',
    'score',
    'winner',
    'toppedOut',
    'softDrop',
    'gravityCounter',
    'lockCounter',
    'lockResets',
    'lowestY',
    'level',
    'state',
    'events',
  ];

  it('REQ-036 the full key set across client messages is exactly §3.5', () => {
    const keys = schemaKeys(ClientMessageSchema);
    expect([...keys].sort()).toEqual(
      ['type', 'name', 'code', 'asSpectator', 'token', 'seq', 'tick', 'action', 't'].sort(),
    );
    for (const key of GAME_STATE_KEYS) {
      expect(keys.has(key), key).toBe(false);
    }
  });

  it('REQ-036 input carries only seq, tick and an action whose only key is type', () => {
    expect(Object.keys(InputMessageSchema.shape).sort()).toEqual(
      ['action', 'seq', 'tick', 'type'].sort(),
    );
    for (const option of ActionSchema.options) {
      expect(Object.keys(option.shape)).toEqual(['type']);
    }
  });

  it('REQ-036 a client message with any game-state key is rejected', () => {
    for (const type of CLIENT_MESSAGE_TYPES) {
      for (const key of GAME_STATE_KEYS) {
        expect(roundTripClient(withField(CLIENT_SAMPLES[type], key, 1)), `${type}.${key}`).toEqual({
          ok: false,
          reason: 'BAD_SCHEMA',
        });
      }
    }
    const input = CLIENT_SAMPLES.input;
    const fatAction = { type: 'hardDrop', rows: 4 };
    expect(roundTripClient({ ...input, action: fatAction }).ok).toBe(false);
  });

  it('REQ-036 every generated client message holds only §3.5 keys', () => {
    const allowed = new Set(['type', 'name', 'code', 'asSpectator', 'token', 'seq', 'tick']);
    allowed.add('action').add('t');
    fc.assert(
      fc.property(clientMessageArb, (msg) => {
        for (const key of deepKeys(msg)) {
          expect(allowed.has(key), key).toBe(true);
        }
      }),
    );
  });
});

describe('REQ-039 frame limit and schema-level rejection', () => {
  const junkFieldValues = [null, [], {}, 0.5, -1];

  it('REQ-039 the frame limit is 1 KB', () => {
    expect(MAX_FRAME_BYTES).toBe(1024);
  });

  it('REQ-039 every valid client message fits in MAX_FRAME_BYTES', () => {
    fc.assert(
      fc.property(clientMessageArb, (msg) => {
        expect(Buffer.byteLength(JSON.stringify(msg), 'utf8')).toBeLessThanOrEqual(MAX_FRAME_BYTES);
      }),
      { numRuns: 500 },
    );
    // Worst cases: 16 control characters (6 bytes each once JSON-escaped) or 16 astral characters
    // (4 UTF-8 bytes each) in both the name and the code.
    for (const char of ['\u0001', '\u{1F600}']) {
      const worst = { type: 'join', code: char.repeat(16), name: char.repeat(16) };
      const text = JSON.stringify({ ...worst, asSpectator: false });
      expect(parseClientMessage(text).ok).toBe(true);
      expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(MAX_FRAME_BYTES / 2);
    }
  });

  it('REQ-039 an unknown or missing type is rejected', () => {
    fc.assert(
      fc.property(
        fc.string().filter((t) => !(CLIENT_MESSAGE_TYPES as readonly string[]).includes(t)),
        clientMessageArb,
        (type, msg) => {
          expect(roundTripClient({ ...msg, type })).toEqual({ ok: false, reason: 'BAD_SCHEMA' });
        },
      ),
    );
    expect(roundTripClient({ name: 'Sam' })).toEqual({ ok: false, reason: 'BAD_SCHEMA' });
    expect(roundTripClient({ type: 'Create', name: 'Sam' }).ok).toBe(false);
  });

  it('REQ-039 an unknown key anywhere in a client message is rejected (strict objects)', () => {
    const known = new Set(['type', 'name', 'code', 'asSpectator', 'token', 'seq', 'tick']);
    known.add('action').add('t');
    fc.assert(
      fc.property(
        clientMessageArb,
        fc.string({ minLength: 1 }).filter((k) => !known.has(k)),
        fc.jsonValue(),
        (msg, key, value) => {
          expect(roundTripClient(withField(msg, key, value))).toEqual({
            ok: false,
            reason: 'BAD_SCHEMA',
          });
        },
      ),
    );
    const proto = '{"type":"leave","__proto__":{"polluted":true}}';
    expect(parseClientMessage(proto)).toEqual({ ok: false, reason: 'BAD_SCHEMA' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('REQ-039 a client field of the wrong type or range is rejected', () => {
    fc.assert(
      fc.property(clientMessageArb, fc.constantFrom(...junkFieldValues), (msg, junk) => {
        for (const key of Object.keys(msg).filter((k) => k !== 'type')) {
          expect(roundTripClient(withField(msg, key, junk)), key).toEqual({
            ok: false,
            reason: 'BAD_SCHEMA',
          });
        }
      }),
    );
  });

  it('REQ-039 text that is not JSON is BAD_JSON; JSON that is not a message is BAD_SCHEMA', () => {
    const notJson = fc.string().filter((s) => {
      try {
        JSON.parse(s);
        return false;
      } catch {
        return true;
      }
    });
    fc.assert(
      fc.property(notJson, (text) => {
        expect(parseClientMessage(text)).toEqual({ ok: false, reason: 'BAD_JSON' });
        expect(parseServerMessage(text)).toBeNull();
      }),
    );
    for (const text of ['', '{', '{"type":"leave"', 'undefined', "{'type':'leave'}"]) {
      expect(parseClientMessage(text)).toEqual({ ok: false, reason: 'BAD_JSON' });
    }
    for (const value of [null, 0, 'leave', [], [{ type: 'leave' }], true]) {
      expect(roundTripClient(value)).toEqual({ ok: false, reason: 'BAD_SCHEMA' });
    }
  });

  it('REQ-039 REQ-028 server junk is rejected: unknown type, unknown key, wrong field', () => {
    fc.assert(
      fc.property(
        serverMessageArb,
        fc.string().filter((t) => !(SERVER_MESSAGE_TYPES as readonly string[]).includes(t)),
        fc.constantFrom('seed', 'pieceSeed', 'holeSeed', 'bag', 'queue', 'rng', 'extra'),
        fc.constantFrom(0.5, -1),
        (msg, type, leakKey, junk) => {
          expect(roundTripServer({ ...msg, type })).toBeNull();
          expect(roundTripServer(withField(msg, leakKey, 1))).toBeNull();
          for (const key of Object.keys(msg).filter((k) => k !== 'type')) {
            expect(roundTripServer(withField(msg, key, junk)), key).toBeNull();
          }
        },
      ),
    );
  });
});

describe('REQ-044 names are trimmed, then 1..16 characters', () => {
  it('REQ-044 surrounding whitespace is trimmed in create and join', () => {
    expect(roundTripClient({ type: 'create', name: '  Sam  ' })).toEqual({
      ok: true,
      msg: { type: 'create', name: 'Sam' },
    });
    expect(roundTripClient({ type: 'join', code: 'k7qm4x', name: '\tAri\n' })).toEqual({
      ok: true,
      msg: { type: 'join', code: 'k7qm4x', name: 'Ari' },
    });
  });

  it('REQ-044 a blank name ("  ") is rejected', () => {
    for (const name of ['', ' ', '  ', '\t\n', ' 　']) {
      expect(roundTripClient({ type: 'create', name }), JSON.stringify(name)).toEqual({
        ok: false,
        reason: 'BAD_SCHEMA',
      });
      expect(roundTripClient({ type: 'join', code: 'K7QM4X', name }).ok).toBe(false);
    }
  });

  it('REQ-044 length is checked after trimming (trim runs before min/max)', () => {
    const sixteen = 'x'.repeat(NAME_MAX_LENGTH);
    expect(CreateMessageSchema.parse({ type: 'create', name: ` ${sixteen} ` }).name).toBe(sixteen);
    expect(CreateMessageSchema.safeParse({ type: 'create', name: `${sixteen}y` }).success).toBe(
      false,
    );
    expect(CreateMessageSchema.parse({ type: 'create', name: '  a  ' }).name).toBe('a');
    expect(CreateMessageSchema.safeParse({ type: 'create', name: '   ' }).success).toBe(false);
  });

  it('REQ-044 length is in Unicode code points: 16 emoji pass, 17 do not', () => {
    const emoji = '\u{1F600}';
    expect(emoji).toHaveLength(2); // two UTF-16 code units, one code point
    expect(NameSchema.parse(emoji.repeat(NAME_MAX_LENGTH))).toBe(emoji.repeat(NAME_MAX_LENGTH));
    expect(NameSchema.safeParse(emoji.repeat(NAME_MAX_LENGTH + 1)).success).toBe(false);
    expect(NameSchema.safeParse(`${'x'.repeat(NAME_MAX_LENGTH)}\u0000`).success).toBe(false);
  });

  it('REQ-044 any string is accepted iff its trimmed length is 1..16, and comes out trimmed', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ maxLength: 24 }),
          fc.string({ unit: 'binary', maxLength: 24 }),
          nameArb.map((n) => `  ${n}\t`),
        ),
        (raw) => {
          const result = NameSchema.safeParse(raw);
          const length = codePoints(raw.trim());
          const trimmed = raw.trim();
          expect(result.success).toBe(length >= 1 && length <= NAME_MAX_LENGTH);
          if (result.success) {
            expect(result.data).toBe(trimmed);
          }
        },
      ),
    );
  });

  it('REQ-044 join needs a name unless asSpectator is true (refine inside the discriminated union)', () => {
    expect(roundTripClient({ type: 'join', code: 'K7QM4X' })).toEqual({
      ok: false,
      reason: 'BAD_SCHEMA',
    });
    expect(roundTripClient({ type: 'join', code: 'K7QM4X', asSpectator: false }).ok).toBe(false);
    expect(roundTripClient({ type: 'join', code: 'K7QM4X', asSpectator: true })).toEqual({
      ok: true,
      msg: { type: 'join', code: 'K7QM4X', asSpectator: true },
    });
    const blankSpectator = { type: 'join', code: 'K7QM4X', name: '  ', asSpectator: true };
    expect(roundTripClient(blankSpectator).ok).toBe(false);
    // The member schema and the union agree, and the refined member is still a ZodObject.
    expect(JoinMessageSchema).toBeInstanceOf(z.ZodObject);
    fc.assert(
      fc.property(joinArb, (msg) => {
        expect(JoinMessageSchema.safeParse(msg).success).toBe(true);
        expect(ClientMessageSchema.safeParse(msg).success).toBe(true);
      }),
    );
  });

  it('REQ-044 names reaching other players (room.players) obey the same rule', () => {
    const room = SERVER_SAMPLES.room;
    const padded = { ...room, players: { A: { name: '  Sam ', connected: true } } };
    const parsed = roundTripServer(padded);
    expect(parsed?.type === 'room' && parsed.players.A?.name).toBe('Sam');
    expect(roundTripServer({ ...room, players: { A: { name: ' ', connected: true } } })).toBeNull();
    fc.assert(
      fc.property(createArb, (msg) => {
        expect(roundTripClient(msg)).toEqual({ ok: true, msg });
      }),
    );
  });
});

describe('REQ-079 REQ-080 field shapes', () => {
  it('REQ-079 the input stamp is an integer tick; REQ-080 pong echoes an integer ms', () => {
    const input = CLIENT_SAMPLES.input;
    expect(roundTripClient({ ...input, tick: '4' }).ok).toBe(false);
    expect(roundTripClient({ ...CLIENT_SAMPLES.pong, t: 1.25 }).ok).toBe(false);
    expect(roundTripClient({ ...CLIENT_SAMPLES.pong, t: -5 }).ok).toBe(false);
  });

  it('REQ-080 live stats in every view are integers ≥ 0', () => {
    const stats = toPublicView(stateA).stats;
    expect(LiveStatsSchema.safeParse(stats).success).toBe(true);
    for (const key of Object.keys(stats)) {
      expect(LiveStatsSchema.safeParse({ ...stats, [key]: -1 }).success, key).toBe(false);
    }
  });
});

describe('protocol schemas are strict all the way down', () => {
  it('REQ-028 every object schema rejects unknown keys (no strip, no passthrough)', () => {
    let objects = 0;
    const visit = (schema: unknown, path: string): void => {
      if (schema instanceof z.ZodObject) {
        objects += 1;
        expect(schema.def.catchall?._zod.def.type, path).toBe('never');
        for (const [key, child] of Object.entries(schema.shape)) {
          visit(child, `${path}.${key}`);
        }
      } else if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
        visit(schema.unwrap(), path);
      } else if (schema instanceof z.ZodArray) {
        visit(schema.element, `${path}[]`);
      } else if (schema instanceof z.ZodUnion) {
        schema.options.forEach((o, i) => {
          visit(o, `${path}|${String(i)}`);
        });
      }
    };
    visit(ClientMessageSchema, 'client');
    visit(ServerMessageSchema, 'server');
    // 7 client members + 7 actions; the server side reaches every nested view, stat and event shape.
    expect(objects).toBeGreaterThan(40);
  });
});
