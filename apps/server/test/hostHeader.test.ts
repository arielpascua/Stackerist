/**
 * Security review F5 (hardening): the Host header is copied into the response's Content-Security-Policy
 * `connect-src ... wss://<host>`, so only a plain host[:port] may pass. Control characters are built at
 * runtime so none sits in this source file.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from '../src/http.js';
import { createLogger, createServer, ManualClock, type StackeristServer } from '../src/index.js';

const wssOf = (host: string): boolean => contentSecurityPolicy(host, false).includes('wss://');

const ACCEPTED: readonly string[] = [
  'game.up.railway.app',
  'Game.Up.Railway.App',
  'localhost',
  'localhost:3000',
  '127.0.0.1:8080',
  '[::1]:3000',
  '[::1]',
  '1d.example.com',
  'a-b.c-d.example',
  `${'a'.repeat(63)}.example`,
  'example.com:1',
  'example.com:65535',
];

const REJECTED: Readonly<Record<string, string>> = {
  'directive injection with a space and ;': 'a;b c',
  'a space': 'x y',
  'a second directive': 'evil.com; script-src *',
  'a single quote': "a'b",
  'a double quote': 'a"b',
  'an asterisk': 'a*b',
  'a comma': 'a,b',
  'an empty label (a..b)': 'a..b',
  'a leading dot': '.a',
  'a trailing dot': 'a.',
  'a non-numeric port': 'a:b',
  'the letter d as a port (lost backslash)': 'a:ddd',
  'a port over 5 digits': 'a:123456',
  'an empty port': 'a:',
  'an empty string': '',
  'only a port': ':3000',
  'a slash': 'a/b',
  'an @ (userinfo)': 'user@host',
  'a path-like value': 'a.b/c',
  'an unclosed IPv6 bracket': '[::1',
  'an empty IPv6 literal': '[]',
  'a non-hex IPv6 literal': '[zz]',
  'a label of 64 characters': `${'a'.repeat(64)}.example`,
  'a 254-character host': `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}`,
  'a newline': `a${String.fromCharCode(10)}b`,
  'a carriage return': `a${String.fromCharCode(13)}b`,
  'a NUL': `a${String.fromCharCode(0)}b`,
  'a tab': `a${String.fromCharCode(9)}b`,
  'a trailing newline': `example.com${String.fromCharCode(10)}`,
};

describe('REQ-037 F5 the Host header filter', () => {
  it('REQ-037 F5 the 254-character fixture really is 254 characters, and 253 is the limit', () => {
    const raw = REJECTED['a 254-character host'] ?? '';
    expect(raw).toHaveLength(254);
    expect(wssOf(raw.slice(1))).toBe(true); // 253 characters: allowed
  });

  for (const host of ACCEPTED) {
    it(`REQ-037 F5 accepts ${JSON.stringify(host)} into connect-src`, () => {
      expect(contentSecurityPolicy(host, false)).toContain(`connect-src 'self' wss://${host}`);
    });
  }

  for (const [label, host] of Object.entries(REJECTED)) {
    it(`REQ-037 F5 refuses ${label}`, () => {
      const csp = contentSecurityPolicy(host, false);
      expect(csp).not.toContain('wss://');
      expect(csp).toMatch(/connect-src 'self'$/);
    });
  }

  it('REQ-037 F5 a hostile host cannot add a directive or change the directive count', () => {
    const base = contentSecurityPolicy(undefined, false).split(';').length;
    for (const host of ['a;b c', 'evil.com; script-src *', "x; script-src 'unsafe-inline'"]) {
      expect(contentSecurityPolicy(host, false).split(';').length).toBe(base);
    }
  });

  it('REQ-037 F5 a long hostile string is rejected in milliseconds (no catastrophic backtracking)', () => {
    const hostile = [
      `${'a-'.repeat(100_000)}!`,
      'a-'.repeat(100_000),
      `${'a.'.repeat(100_000)}!`,
      `${'a'.repeat(100_000)}:`,
      `[${'0:'.repeat(100_000)}!`,
    ];
    for (const host of hostile) {
      const t0 = performance.now();
      expect(wssOf(host)).toBe(false);
      expect(performance.now() - t0).toBeLessThan(20);
    }
  });
});

describe('REQ-037 F5 through the real server', () => {
  let clientDist: string;
  let server: StackeristServer | null = null;

  beforeAll(() => {
    clientDist = mkdtempSync(join(tmpdir(), 'stackerist-host-'));
    writeFileSync(join(clientDist, 'index.html'), '<!doctype html><title>Stackerist</title>');
    mkdirSync(join(clientDist, 'assets'));
  });
  afterAll(() => {
    rmSync(clientDist, { recursive: true, force: true });
  });
  afterEach(async () => {
    await server?.close();
    server = null;
  });

  function get(port: number, hostHeader: string): Promise<{ status: number; csp: string }> {
    return new Promise((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port, path: '/', method: 'GET', headers: { Host: hostHeader } },
        (res) => {
          res.resume();
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              csp: String(res.headers['content-security-policy']),
            });
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('REQ-037 F5 a request with Host "a;b c" still gets a valid CSP without a wss:// entry', async () => {
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      clientDist,
      clock: new ManualClock(),
      logger: createLogger({ level: 'silent' }),
      clientIp: { source: 'socket' },
    });
    const { port } = await server.listen();
    const hostile = await get(port, 'a;b c');
    expect(hostile.status).toBe(200);
    expect(hostile.csp).toContain("default-src 'self'; script-src 'self'");
    expect(hostile.csp).toMatch(/connect-src 'self'$/);
    expect(hostile.csp).not.toContain('wss://');
    expect(hostile.csp).not.toContain('a;b');

    const good = await get(port, `localhost:${String(port)}`);
    expect(good.csp).toContain(`connect-src 'self' wss://localhost:${String(port)}`);
  });
});
