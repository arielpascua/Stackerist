import { randomBytes } from 'node:crypto';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  SEAT_TOKEN_BYTES,
  SEAT_TOKEN_LENGTH,
  isSeatToken,
  normalizeRoomCode,
} from '@stackerist/protocol';
import { describe, expect, it } from 'vitest';
import { clientIpConfigFromEnv, resolveClientIp } from '../src/clientIp.js';
import { ManualClock } from '../src/clock.js';
import { generateRoomCode, generateSeatToken, tokenMatches } from '../src/codes.js';
import { SlidingWindowCounter, TokenBucket } from '../src/rateLimit.js';

describe('REQ-065 the injectable ManualClock', () => {
  it('REQ-065 fires due timers in due order, including timers scheduled while advancing', () => {
    const clock = new ManualClock(1_000_000);
    const fired: string[] = [];
    clock.setTimeout(() => fired.push('b@200'), 200);
    clock.setTimeout(() => {
      fired.push('a@100');
      clock.setTimeout(() => fired.push('c@150'), 50);
    }, 100);
    const cancelled = clock.setTimeout(() => fired.push('never'), 120);
    clock.clearTimeout(cancelled);
    clock.advance(199);
    expect(fired).toEqual(['a@100', 'c@150']);
    clock.advance(1);
    expect(fired).toEqual(['a@100', 'c@150', 'b@200']);
    expect(clock.monotonicMs()).toBe(200);
    expect(clock.nowEpochMs()).toBe(1_000_200);
  });

  it('REQ-065 keeps wall-clock time integral under fractional advances', () => {
    const clock = new ManualClock(5);
    clock.advance(1000 / 60);
    expect(Number.isInteger(clock.nowEpochMs())).toBe(true);
    expect(clock.nowEpochMs()).toBe(21);
  });
});

describe('room codes and seat tokens', () => {
  it('REQ-020 room codes are 6 characters of the 31-character alphabet and skip taken codes', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i += 1) {
      const code = generateRoomCode((c) => seen.has(c));
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
      expect(seen.has(code)).toBe(false);
      expect(normalizeRoomCode(code.toLowerCase())).toBe(code);
      seen.add(code);
    }
    const calls: string[] = [];
    const code = generateRoomCode((c) => {
      calls.push(c);
      return calls.length < 3;
    });
    expect(calls).toHaveLength(3);
    expect(code).toBe(calls[2]);
    expect(() => generateRoomCode(() => true)).toThrow();
  });

  it('REQ-040 seat tokens are 128-bit base64url and compare with timingSafeEqual', () => {
    const token = generateSeatToken();
    expect(token.bytes).toHaveLength(SEAT_TOKEN_BYTES);
    expect(token.text).toHaveLength(SEAT_TOKEN_LENGTH);
    expect(isSeatToken(token.text)).toBe(true);
    expect(tokenMatches(token.bytes, token.text)).toBe(true);
    const other = generateSeatToken();
    expect(tokenMatches(token.bytes, other.text)).toBe(false);
  });

  it('REQ-040 a length mismatch, a malformed or non-canonical token, or a missing seat never matches or throws', () => {
    const token = generateSeatToken();
    expect(tokenMatches(token.bytes, '')).toBe(false);
    expect(tokenMatches(token.bytes, `${token.text}A`)).toBe(false);
    expect(tokenMatches(token.bytes, token.text.slice(0, -1))).toBe(false);
    expect(tokenMatches(token.bytes, '!'.repeat(SEAT_TOKEN_LENGTH))).toBe(false);
    expect(tokenMatches(randomBytes(SEAT_TOKEN_BYTES + 1), token.text)).toBe(false);
    expect(tokenMatches(Buffer.alloc(0), token.text)).toBe(false);
    // All-zero bytes decode from 'AAAA…': a missing seat (null) must still reject it.
    expect(tokenMatches(null, 'A'.repeat(SEAT_TOKEN_LENGTH))).toBe(false);
    // The last base64url character carries 2 data bits: a non-canonical spelling of the same bytes is rejected.
    const last = token.text.at(-1) ?? 'A';
    const index = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(last);
    const alias =
      token.text.slice(0, -1) +
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.charAt(index ^ 1);
    expect(Buffer.from(alias, 'base64url').equals(token.bytes)).toBe(true);
    expect(tokenMatches(token.bytes, alias)).toBe(false);
  });
});

describe('rate limiting', () => {
  it('REQ-038 the token bucket allows a burst of 20 and refills 30 per second', () => {
    const bucket = new TokenBucket(20, 30, 0);
    let taken = 0;
    for (let i = 0; i < 25; i += 1) if (bucket.take(0)) taken += 1;
    expect(taken).toBe(20);
    expect(bucket.take(0)).toBe(false);
    // 100 ms refills 3 tokens.
    taken = 0;
    for (let i = 0; i < 5; i += 1) if (bucket.take(100)) taken += 1;
    expect(taken).toBe(3);
    // Sustained: one second later, 30 more; never beyond capacity.
    taken = 0;
    for (let i = 0; i < 50; i += 1) if (bucket.take(10_000)) taken += 1;
    expect(taken).toBe(20);
  });

  it('REQ-081 the sliding window counts per key, prunes old hits and never grows on a check', () => {
    const w = new SlidingWindowCounter(60_000);
    expect(w.isFull('1.2.3.4', 2, 0)).toBe(false);
    expect(w.size).toBe(0);
    w.charge('1.2.3.4', 0);
    w.charge('1.2.3.4', 30_000);
    expect(w.isFull('1.2.3.4', 2, 30_000)).toBe(true);
    expect(w.isFull('5.6.7.8', 2, 30_000)).toBe(false);
    expect(w.isFull('1.2.3.4', 2, 60_000)).toBe(false);
    w.sweep(200_000);
    expect(w.size).toBe(0);
  });
});

describe('client IP resolution (no Fastify trustProxy)', () => {
  const socket = { remoteAddress: '10.0.0.1' };

  it('REQ-081 X-Real-IP is used when it is a valid IP, otherwise the socket address', () => {
    const cfg = { source: 'x-real-ip' } as const;
    expect(resolveClientIp({ headers: { 'x-real-ip': '203.0.113.9' }, socket }, cfg)).toBe(
      '203.0.113.9',
    );
    expect(resolveClientIp({ headers: { 'x-real-ip': 'evil' }, socket }, cfg)).toBe('10.0.0.1');
    expect(resolveClientIp({ headers: {}, socket }, cfg)).toBe('10.0.0.1');
    expect(resolveClientIp({ headers: {}, socket: {} }, cfg)).toBe('unknown');
  });

  it('REQ-081 X-Forwarded-For picks the entry trustedHops from the right', () => {
    const cfg = { source: 'x-forwarded-for', trustedHops: 1 } as const;
    const headers = { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' };
    expect(resolveClientIp({ headers, socket }, cfg)).toBe('3.3.3.3');
    expect(resolveClientIp({ headers, socket }, { ...cfg, trustedHops: 2 })).toBe('2.2.2.2');
    expect(resolveClientIp({ headers, socket }, { ...cfg, trustedHops: 9 })).toBe('1.1.1.1');
  });

  it('REQ-081 the socket source ignores spoofable headers; IPv4-mapped addresses are unwrapped', () => {
    expect(
      resolveClientIp(
        { headers: { 'x-real-ip': '9.9.9.9' }, socket: { remoteAddress: '::ffff:127.0.0.1' } },
        { source: 'socket' },
      ),
    ).toBe('127.0.0.1');
  });

  it('REQ-081 config comes from the environment and rejects unknown values', () => {
    expect(clientIpConfigFromEnv({})).toEqual({ source: 'socket' });
    expect(clientIpConfigFromEnv({ NODE_ENV: 'production' })).toEqual({ source: 'x-real-ip' });
    expect(clientIpConfigFromEnv({ CLIENT_IP_SOURCE: 'socket', NODE_ENV: 'production' })).toEqual({
      source: 'socket',
    });
    expect(
      clientIpConfigFromEnv({ CLIENT_IP_SOURCE: 'x-forwarded-for', TRUSTED_PROXY_HOPS: '2' }),
    ).toEqual({ source: 'x-forwarded-for', trustedHops: 2 });
    expect(() => clientIpConfigFromEnv({ CLIENT_IP_SOURCE: 'x-forwarded-for' })).toThrow();
    expect(() => clientIpConfigFromEnv({ CLIENT_IP_SOURCE: 'cookie' })).toThrow();
  });
});
