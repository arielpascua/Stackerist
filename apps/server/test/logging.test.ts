import { COUNTDOWN_MS } from '@stackerist/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { ANTICHEAT_RULES, LOG_EVENT_NAMES } from '../src/log.js';
import { MemoryLog, startTestServer, until, type Harness } from './helpers/harness.js';

let h: Harness;
afterEach(async () => {
  await h.close();
});

const NAME_A = 'Zelda Secretname';
const NAME_B = 'Yoshi Hiddenname';
const IP_A = '203.0.113.77';
const IP_B = '203.0.113.88';
const ALLOWED_KEYS = new Set([
  // pino's own
  'level',
  'time',
  'pid',
  'hostname',
  'msg',
  'err',
  // §4.11 allow-list
  'event',
  'room',
  'seat',
  'conn',
  'round',
  'tick',
  'status',
  'reason',
  'rule',
  'count',
  'winner',
  'closeCode',
]);

describe('REQ-071 structured logs without names or IP addresses', () => {
  it('REQ-071 logs created, joined, started, paused, resumed, ended, every disconnect and anticheat triggers; never names, IPs or tokens', async () => {
    const memoryLog = new MemoryLog();
    h = await startTestServer({ memoryLog, clientIp: { source: 'x-real-ip' } });
    const a = await h.connect({ headers: { 'X-Real-IP': IP_A } });
    a.send({ type: 'create', name: NAME_A });
    const created = await a.next('created');
    const code = created.code;
    const b = await h.connect({ headers: { 'X-Real-IP': IP_B } });
    b.send({ type: 'join', code, name: NAME_B });
    const joined = await b.next('joined');
    await h.advance(COUNTDOWN_MS);
    b.send('{"type":"teleport"}');
    a.ws.close();
    await b.next('paused');
    const a2 = await h.connect({ headers: { 'X-Real-IP': IP_A } });
    a2.send({ type: 'rejoin', code, token: created.token });
    await b.next('resumed');
    await h.advance(COUNTDOWN_MS);
    a2.send({ type: 'leave' });
    await b.next('gameOver');
    await h.advance(2000);

    const seen = new Set(memoryLog.lines.map((l) => l.event));
    for (const event of [
      'room.created',
      'room.joined',
      'room.rejoined',
      'match.started',
      'match.paused',
      'match.resumed',
      'match.ended',
      'series.ended',
      'room.left',
      'conn.disconnected',
      'anticheat',
    ]) {
      expect(seen, event).toContain(event);
    }
    const secrets = [
      NAME_A,
      'Zelda',
      'Secretname',
      NAME_B,
      'Yoshi',
      'Hiddenname',
      IP_A,
      IP_B,
      '127.0.0.1',
      created.token,
      joined.token ?? 'no-token',
    ];
    for (const line of memoryLog.text) {
      for (const secret of secrets) expect(line).not.toContain(secret);
      expect(line.toLowerCase()).not.toContain('x-real-ip');
    }
    for (const line of memoryLog.lines) {
      for (const key of Object.keys(line)) expect(ALLOWED_KEYS, key).toContain(key);
      if (line.event !== undefined) expect(LOG_EVENT_NAMES).toContain(line.event);
      if (line.event === 'anticheat') expect(ANTICHEAT_RULES).toContain(line.rule);
    }
    expect(memoryLog.events('match.ended')).toContainEqual(
      expect.objectContaining({ room: code, winner: 'B', reason: 'OPPONENT_LEFT' }),
    );
    expect(memoryLog.events('conn.disconnected').length).toBeGreaterThanOrEqual(1);
  });

  it('REQ-071 anticheat triggers coalesce per connection and rule within 1 s, and every trigger is counted', async () => {
    const memoryLog = new MemoryLog();
    h = await startTestServer({ memoryLog });
    const a = await h.connect();
    for (let i = 0; i < 5; i += 1) a.send('nope');
    await h.settle();
    let lines = memoryLog.events('anticheat').filter((l) => l.rule === 'BAD_MESSAGE');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.count).toBe(1);
    await h.advance(1000);
    await until(() => memoryLog.events('anticheat').length >= 2, 'the coalesced line');
    lines = memoryLog.events('anticheat').filter((l) => l.rule === 'BAD_MESSAGE');
    expect(lines.map((l) => l.count)).toEqual([1, 4]);
    // A later trigger logs immediately again.
    a.send('nope');
    await h.settle();
    expect(memoryLog.events('anticheat').filter((l) => l.rule === 'BAD_MESSAGE')).toHaveLength(3);
  });

  it('REQ-071 Fastify request logging is off: an HTTP request writes no line', async () => {
    const memoryLog = new MemoryLog();
    h = await startTestServer({ memoryLog });
    const before = memoryLog.lines.length;
    const res = await fetch(`http://127.0.0.1:${String(h.port)}/healthz`);
    expect(res.status).toBe(200);
    expect(memoryLog.lines.length).toBe(before);
  });
});
