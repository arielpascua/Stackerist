/**
 * Security re-review N3 (refuseflood.mjs, forgetconn.mjs): refused sockets must not cost a log line each,
 * and closing one connection must not scan every other connection's coalescing entries.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { EventLog, ManualClock, createLogger } from '../src/index.js';
import type { AnticheatRule } from '../src/log.js';
import { MemoryLog, startTestServer, TestClient, until, type Harness } from './helpers/harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const IP_FLOOD = '203.0.113.50';
const IP_OTHER = '203.0.113.60';
const as = (ip: string) => ({ headers: { 'X-Real-IP': ip } });

const sumCounts = (lines: readonly Record<string, unknown>[]): number =>
  lines.reduce((sum, l) => sum + (typeof l.count === 'number' ? l.count : 0), 0);

describe('N3 refused sockets coalesce into O(1) log lines per second', () => {
  it('N3 60 refused sockets in one second make at most two SOCKET_LIMIT lines, and every refusal is counted', async () => {
    const memoryLog = new MemoryLog();
    h = await startTestServer({
      memoryLog,
      clientIp: { source: 'x-real-ip' },
      limits: { maxSocketsPerIp: 1 },
    });
    await h.connect(as(IP_FLOOD));
    const flood: TestClient[] = [];
    for (let i = 0; i < 60; i += 1) {
      const c = await TestClient.open(h.wsUrl, as(IP_FLOOD));
      h.clients.push(c);
      flood.push(c);
    }
    await until(() => flood.every((c) => c.closed !== null), 'every refusal to close');
    h.clock.advance(1100); // the window ends: the suppressed count is flushed
    const lines = memoryLog.lines.filter(
      (l) => l.event === 'anticheat' && l.rule === 'SOCKET_LIMIT',
    );
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(sumCounts(lines)).toBe(60);
    // no per-connection field: the refusal line is one shared line, not one per socket
    expect(lines.every((l) => l.conn === undefined)).toBe(true);
  });

  it('N3 a refused flood does not hide another IP: its own anticheat lines are still logged', async () => {
    const memoryLog = new MemoryLog();
    h = await startTestServer({
      memoryLog,
      clientIp: { source: 'x-real-ip' },
      limits: { maxSocketsPerIp: 1 },
    });
    await h.connect(as(IP_FLOOD));
    for (let i = 0; i < 10; i += 1) h.clients.push(await TestClient.open(h.wsUrl, as(IP_FLOOD)));
    const other = await h.connect(as(IP_OTHER));
    other.send('{"type":"teleport"}');
    await until(
      () => memoryLog.lines.some((l) => l.event === 'anticheat' && l.rule === 'BAD_MESSAGE'),
      'a bad-message line from the other IP',
    );
  });

  it('N3 a later second logs a fresh line (the key is one per second, not one forever)', async () => {
    const memoryLog = new MemoryLog();
    h = await startTestServer({
      memoryLog,
      clientIp: { source: 'x-real-ip' },
      limits: { maxSocketsPerIp: 1 },
    });
    await h.connect(as(IP_FLOOD));
    const refuse = async (n: number): Promise<void> => {
      const batch: TestClient[] = [];
      for (let i = 0; i < n; i += 1) {
        const c = await TestClient.open(h!.wsUrl, as(IP_FLOOD));
        h!.clients.push(c);
        batch.push(c);
      }
      await until(() => batch.every((c) => c.closed !== null), 'refusals to close');
    };
    await refuse(5);
    h.clock.advance(1100);
    await refuse(5);
    h.clock.advance(1100);
    const lines = memoryLog.lines.filter(
      (l) => l.event === 'anticheat' && l.rule === 'SOCKET_LIMIT',
    );
    expect(sumCounts(lines)).toBe(10);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBeLessThanOrEqual(4);
  });
});

describe('N3 closing a connection costs O(its own entries), not O(all entries)', () => {
  const RULES: readonly AnticheatRule[] = [
    'BAD_MESSAGE',
    'NON_INPUT_DROP',
    'ROOM_NOT_FOUND',
    'JOIN_LIMIT',
  ];

  /** Median-free, noise-tolerant: the fastest of a few runs of `calls` closes of unknown connections. */
  function closeCostMs(entries: number, calls: number): number {
    const log = new EventLog(createLogger({ level: 'silent' }), new ManualClock());
    const conns = entries / RULES.length;
    for (let c = 1; c <= conns; c += 1) for (const rule of RULES) log.anticheat(rule, { conn: c });
    let best = Number.POSITIVE_INFINITY;
    for (let trial = 0; trial < 5; trial += 1) {
      const t0 = performance.now();
      for (let i = 0; i < calls; i += 1) log.forgetConn(10_000_000 + i);
      best = Math.min(best, performance.now() - t0);
    }
    return best;
  }

  it('N3 forgetConn at 40 000 entries costs about what it costs at 2 000 (ratio close to 1)', () => {
    const calls = 50_000;
    const small = closeCostMs(2000, calls);
    const big = closeCostMs(40_000, calls);
    // The old scan of every key made this ratio about 20; allow timer noise but not growth.
    expect(big).toBeLessThanOrEqual(Math.max(small, 1) * 2.5);
  }, 240_000);

  it('N3 forgetting a connection flushes its own suppressed counts and only its own', () => {
    const memoryLog = new MemoryLog();
    const clock = new ManualClock();
    const log = new EventLog(createLogger({ stream: memoryLog }), clock);
    for (let i = 0; i < 5; i += 1) log.anticheat('BAD_MESSAGE', { conn: 1 });
    for (let i = 0; i < 3; i += 1) log.anticheat('BAD_MESSAGE', { conn: 2 });
    log.forgetConn(1);
    const flushed = memoryLog.lines.filter((l) => l.conn === 1 && l.count === 4);
    expect(flushed).toHaveLength(1);
    expect(memoryLog.lines.filter((l) => l.conn === 2)).toHaveLength(1); // conn 2 still coalescing
    clock.advance(1100);
    expect(memoryLog.lines.filter((l) => l.conn === 2 && l.count === 2)).toHaveLength(1);
    log.forgetConn(2);
    log.forgetConn(1); // idempotent
    expect(memoryLog.lines.filter((l) => l.conn === 1 || l.conn === 2)).toHaveLength(4);
  });
});
