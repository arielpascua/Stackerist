/**
 * Security review F3: IPv6 clients are keyed by /64, a rejoin with a valid token is never blocked by the
 * failed-join window, and a missing client-IP header is logged once (without any address).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { resolveClientIp, type ClientIpConfig } from '../src/index.js';
import { MemoryLog, startTestServer, type Harness } from './helpers/harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const socketOf = (remoteAddress: string) => ({ remoteAddress });
const viaSocket: ClientIpConfig = { source: 'socket' };

describe('F3a IPv6 clients are one key per /64', () => {
  it('F3a spellings of one address are one key', () => {
    const keys = [
      '2001:0db8:0000:0000:0000:0000:0000:0001',
      '2001:db8::1',
      '2001:DB8:0:0:0:0:0:1',
      '2001:db8:0:0::1',
    ].map((a) => resolveClientIp({ headers: {}, socket: socketOf(a) }, viaSocket));
    expect(new Set(keys).size).toBe(1);
  });

  it('F3a every address in one /64 is one key; another /64 is another key', () => {
    const key = (a: string) => resolveClientIp({ headers: {}, socket: socketOf(a) }, viaSocket);
    expect(key('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(key('2001:db8:1:2::1'));
    expect(key('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe(key('2001:db8:1:2:0:0:0:0'));
    expect(key('2001:db8:1:3::1')).not.toBe(key('2001:db8:1:2::1'));
    expect(key('2001:db8:2:2::1')).not.toBe(key('2001:db8:1:2::1'));
    expect(key('::1')).toBe(key('0:0:0:0:1:2:3:4'));
  });

  it('F3a a zone id is dropped, an embedded IPv4 tail expands, and IPv4 (also IPv4-mapped) is unchanged', () => {
    const key = (a: string) => resolveClientIp({ headers: {}, socket: socketOf(a) }, viaSocket);
    expect(key('fe80::1%eth0')).toBe(key('fe80::2'));
    expect(key('64:ff9b::192.0.2.33')).toBe(key('64:ff9b:0:0:0:0:c000:221'));
    expect(key('203.0.113.7')).toBe('203.0.113.7');
    expect(key('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('F3a the header-derived address is grouped the same way', () => {
    const cfg: ClientIpConfig = { source: 'x-real-ip' };
    const key = (a: string) =>
      resolveClientIp({ headers: { 'x-real-ip': a }, socket: socketOf('10.0.0.1') }, cfg);
    expect(key('2001:db8:1:2::9')).toBe(key('2001:db8:1:2:5:6:7:8'));
    expect(key('2001:db8:1:2::9')).not.toBe(key('2001:db8:1:9::9'));
  });
});

describe('F3b a matching token is never blocked by the failed-join window', () => {
  const IP_NAT = '198.51.100.20';
  const as = (ip: string) => ({ headers: { 'X-Real-IP': ip } });

  it('F3b a rejoin with the right token succeeds from an IP whose failed-join window is full; failures still hit the window', async () => {
    h = await startTestServer({
      clientIp: { source: 'x-real-ip' },
      limits: { maxFailedJoinsPerIpPerMin: 3 },
    });
    const a = await h.connect(as('203.0.113.1'));
    a.send({ type: 'create', name: 'Ann' });
    const created = await a.next('created');
    // A noisy neighbour behind the same NAT burns the window.
    const noisy = await h.connect(as(IP_NAT));
    for (let i = 0; i < 3; i += 1) noisy.send({ type: 'join', code: 'ZZZZZZ', name: 'x' });
    await noisy.errorCodes(3);
    noisy.send({ type: 'join', code: 'ZZZZZZ', name: 'x' });
    expect((await noisy.errorCodes(4)).at(-1)).toBe('TOO_MANY_JOINS');
    // Ann's family member rejoins from that NAT with the token and gets in.
    const back = await h.connect(as(IP_NAT));
    back.send({ type: 'rejoin', code: created.code, token: created.token });
    expect((await back.next('joined')).seat).toBe('A');
    // A wrong token (or an unknown room) from the same IP is still refused, and says nothing more.
    const guess = await h.connect(as(IP_NAT));
    guess.send({ type: 'rejoin', code: created.code, token: 'A'.repeat(22) });
    guess.send({ type: 'rejoin', code: 'ZZZZZZ', token: created.token });
    expect(await guess.errorCodes(2)).toEqual(['TOO_MANY_JOINS', 'TOO_MANY_JOINS']);
  });

  it('F3b a successful rejoin charges nothing, and a failed one still charges before any state changes', async () => {
    h = await startTestServer({
      clientIp: { source: 'x-real-ip' },
      limits: { maxFailedJoinsPerIpPerMin: 2 },
    });
    const a = await h.connect(as('203.0.113.1'));
    a.send({ type: 'create', name: 'Ann' });
    const created = await a.next('created');
    for (let i = 0; i < 5; i += 1) {
      const c = await h.connect(as(IP_NAT));
      c.send({ type: 'rejoin', code: created.code, token: created.token });
      expect((await c.next('joined')).seat).toBe('A');
    }
    const bad = await h.connect(as(IP_NAT));
    bad.send({ type: 'rejoin', code: created.code, token: 'B'.repeat(22) });
    bad.send({ type: 'rejoin', code: created.code, token: 'B'.repeat(22) });
    bad.send({ type: 'rejoin', code: created.code, token: 'B'.repeat(22) });
    expect(await bad.errorCodes(3)).toEqual(['BAD_TOKEN', 'BAD_TOKEN', 'TOO_MANY_JOINS']);
    expect(h.inspect(created.code).seats.A?.connected).toBe(true);
  });
});

describe('F3c a missing client-IP header is logged once, with no address', () => {
  it('F3c one warning for many connections, and nothing identifying in it', async () => {
    const log = new MemoryLog();
    h = await startTestServer({ clientIp: { source: 'x-real-ip' }, memoryLog: log });
    await h.connect();
    await h.connect();
    await h.connect();
    const lines = log.events('clientip.header_missing');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe(40);
    expect(JSON.stringify(lines)).not.toMatch(/127\.0\.0\.1|::1/);
  });

  it('F3c nothing is logged when the header is there, or when the source is the socket', async () => {
    const log = new MemoryLog();
    h = await startTestServer({ clientIp: { source: 'x-real-ip' }, memoryLog: log });
    await h.connect({ headers: { 'X-Real-IP': '203.0.113.9' } });
    expect(log.events('clientip.header_missing')).toHaveLength(0);
    await h.close();
    const log2 = new MemoryLog();
    h = await startTestServer({ clientIp: { source: 'socket' }, memoryLog: log2 });
    await h.connect();
    expect(log2.events('clientip.header_missing')).toHaveLength(0);
  });
});
