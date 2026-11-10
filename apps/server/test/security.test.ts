/**
 * Security review F4 (Origin check on /ws) and F5 (security headers on every response).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HEALTH_PATH, WS_PATH } from '@stackerist/protocol';
import { WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createLogger, createServer, ManualClock, type StackeristServer } from '../src/index.js';

let clientDist: string;
let server: StackeristServer | null = null;
let port = 0;

beforeAll(() => {
  clientDist = mkdtempSync(join(tmpdir(), 'stackerist-sec-'));
  writeFileSync(join(clientDist, 'index.html'), '<!doctype html><title>Stackerist</title>');
  mkdirSync(join(clientDist, 'assets'));
  writeFileSync(join(clientDist, 'assets', 'app-1234.js'), 'console.log(1);');
});
afterAll(() => {
  rmSync(clientDist, { recursive: true, force: true });
});
afterEach(async () => {
  await server?.close();
  server = null;
});

async function start(): Promise<StackeristServer> {
  server = await createServer({
    port: 0,
    host: '127.0.0.1',
    clientDist,
    clock: new ManualClock(),
    logger: createLogger({ level: 'silent' }),
    clientIp: { source: 'socket' },
  });
  port = (await server.listen()).port;
  return server;
}

/** Opens /ws with these headers. Resolves 'open' if the upgrade succeeded, else the HTTP status. */
function upgrade(
  headers: Record<string, string>,
  onRefused?: (headers: Record<string, unknown>) => void,
): Promise<'open' | number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${String(port)}${WS_PATH}`, { headers });
    ws.on('open', () => {
      ws.terminate();
      resolve('open');
    });
    ws.on('unexpected-response', (_req, res) => {
      onRefused?.(res.headers);
      resolve(res.statusCode ?? 0);
      res.resume();
      ws.terminate();
    });
    ws.on('error', () => undefined);
  });
}

/** A raw GET that sends the path byte-for-byte (fetch would normalise it). */
function rawGet(path: string): Promise<{ status: number; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('F4 Origin check on the /ws upgrade', () => {
  it('F4 no Origin header (non-browser clients, tests) is allowed', async () => {
    await start();
    expect(await upgrade({})).toBe('open');
  });

  it('F4 an Origin whose host equals the Host header is allowed, on any scheme', async () => {
    await start();
    expect(await upgrade({ Origin: `http://127.0.0.1:${String(port)}` })).toBe('open');
    // The comparison is against the literal Host header, not a configured URL.
    expect(await upgrade({ Host: 'play.example.test', Origin: 'https://play.example.test' })).toBe(
      'open',
    );
    expect(await upgrade({ Host: 'Play.Example.test', Origin: 'https://play.example.TEST' })).toBe(
      'open',
    );
  });

  it('F4 a foreign Origin is refused with 403 and never reaches the hub', async () => {
    const s = await start();
    expect(await upgrade({ Origin: 'https://evil.example' })).toBe(403);
    expect(await upgrade({ Origin: `http://127.0.0.1:${String(port + 1)}` })).toBe(403); // other port
    expect(await upgrade({ Origin: 'http://127.0.0.1.evil.example' })).toBe(403);
    expect(await upgrade({ Origin: 'null' })).toBe(403);
    expect(await upgrade({ Origin: 'not a url' })).toBe(403);
    expect(await upgrade({ Origin: '' })).toBe(403);
    expect(s.app.websocketServer.clients.size).toBe(0);
  });
});

describe('F5 security headers', () => {
  const REQUIRED = [
    "default-src 'self'",
    "img-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "script-src 'self'",
  ];

  function expectHardened(headers: Record<string, unknown>, host: string): void {
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
    const csp = String(headers['content-security-policy']);
    for (const directive of REQUIRED) expect(csp).toContain(directive);
    expect(csp).toContain(`connect-src 'self' wss://${host}`);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  }

  it('F5 every kind of response carries them: page, SPA fallback, asset, health, 404, bad URL, upgrade refusal', async () => {
    await start();
    const host = `127.0.0.1:${String(port)}`;
    const urls = ['/', '/g/ABC234', '/assets/app-1234.js', HEALTH_PATH, '/assets/missing.js'];
    for (const url of urls) {
      const res = await fetch(`http://${host}${url}`);
      expectHardened(Object.fromEntries(res.headers), host);
    }
    // POST, a framework 404, and the malformed-URL page (raw path: fetch would normalise it).
    const post = await fetch(`http://${host}/nope`, { method: 'POST' });
    expectHardened(Object.fromEntries(post.headers), host);
    const bad = await rawGet('/g/%');
    expect(bad.status).toBe(400);
    expectHardened(bad.headers, host);
    let refusedHeaders: Record<string, unknown> = {};
    expect(
      await upgrade({ Origin: 'https://evil.example' }, (headers) => {
        refusedHeaders = headers;
      }),
    ).toBe(403);
    expectHardened(refusedHeaders, host);
  });

  it('F5 the wss:// entry follows the request Host, and a hostile Host header cannot inject directives', async () => {
    const s = await start();
    const ok = await s.app.inject({
      method: 'GET',
      url: '/',
      headers: { host: 'play.example.test' },
    });
    expect(String(ok.headers['content-security-policy'])).toContain(
      "connect-src 'self' wss://play.example.test",
    );
    const evil = await s.app.inject({
      method: 'GET',
      url: '/',
      headers: { host: "x; script-src 'unsafe-inline'" },
    });
    const csp = String(evil.headers['content-security-policy']);
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('wss://');
    expect(csp).toContain("connect-src 'self'");
  });
});
