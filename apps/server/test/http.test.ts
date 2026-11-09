import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HEALTH_PATH, WS_PATH } from '@stackerist/protocol';
import { WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createLogger,
  createServer,
  DEFAULT_PORT,
  ManualClock,
  resolvePort,
  type StackeristServer,
} from '../src/index.js';

let clientDist: string;
let server: StackeristServer | null = null;

beforeAll(() => {
  clientDist = mkdtempSync(join(tmpdir(), 'stackerist-client-'));
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

async function start(dist: string | null = clientDist): Promise<StackeristServer> {
  server = await createServer({
    port: 0,
    host: '127.0.0.1',
    clientDist: dist,
    clock: new ManualClock(),
    logger: createLogger({ level: 'silent' }),
    clientIp: { source: 'socket' },
  });
  return server;
}

/** A raw GET that sends the path byte-for-byte (fetch would normalise it). */
function rawGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('REQ-073 one port: client, /ws and /healthz', () => {
  it('REQ-073 GET /healthz returns 200 {"ok":true} without caching', async () => {
    const s = await start();
    const res = await s.app.inject({ method: 'GET', url: HEALTH_PATH });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('REQ-073 serves the built client with an SPA fallback; missing assets stay 404', async () => {
    const s = await start();
    const page = await s.app.inject({ method: 'GET', url: '/g/ABC234' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<title>Stackerist</title>');
    const root = await s.app.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(200);
    expect(root.headers['cache-control']).toBe('no-cache');
    const asset = await s.app.inject({ method: 'GET', url: '/assets/app-1234.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await s.app.inject({ method: 'GET', url: '/assets/missing.js' })).statusCode).toBe(404);
    expect((await s.app.inject({ method: 'POST', url: '/g/ABC234' })).statusCode).toBe(404);
  });

  it('REQ-073 static serving is skipped when there is no client build', async () => {
    const s = await start(null);
    expect((await s.app.inject({ method: 'GET', url: '/g/ABC234' })).statusCode).toBe(404);
    expect((await s.app.inject({ method: 'GET', url: HEALTH_PATH })).statusCode).toBe(200);
  });

  it('REQ-073 REQ-072 malformed paths get a 4xx page and the server keeps serving', async () => {
    const s = await start();
    const { port } = await s.listen();
    const broken = await rawGet(port, '/g/%');
    expect(broken.status).toBe(400);
    expect(broken.body).toContain('That link is broken');
    expect(broken.body).toContain('href="/"');
    for (const path of ['/%', '/g/%E0%A4%A', '/..%2f..%2fetc%2fpasswd']) {
      const res = await rawGet(port, path);
      expect(res.status, path).toBeGreaterThanOrEqual(400);
      expect(res.status, path).toBeLessThan(500);
      expect(res.body).not.toContain('root:');
    }
    expect((await rawGet(port, HEALTH_PATH)).status).toBe(200);
  });

  it('REQ-073 the WebSocket shares the HTTP port', async () => {
    const s = await start();
    const { port, url } = await s.listen();
    expect(url).toBe(`http://127.0.0.1:${String(port)}`);
    const ws = new WebSocket(`ws://127.0.0.1:${String(port)}${WS_PATH}`);
    const first = await new Promise<string>((resolve, reject) => {
      ws.once('message', (data: Buffer) => {
        resolve(data.toString('utf8'));
      });
      ws.once('error', reject);
    });
    expect(JSON.parse(first)).toMatchObject({ type: 'ping', rtt: null });
    expect((await fetch(`${url}${HEALTH_PATH}`)).status).toBe(200);
    const closed = new Promise<number>((resolve) => {
      ws.once('close', (code: number) => {
        resolve(code);
      });
    });
    await s.close();
    server = null;
    expect(await closed).toBe(1001); // SERVER_SHUTDOWN
  });

  it('REQ-073 reads PORT with a 3000 default', () => {
    expect(resolvePort(undefined)).toBe(DEFAULT_PORT);
    expect(DEFAULT_PORT).toBe(3000);
    expect(resolvePort(' ')).toBe(DEFAULT_PORT);
    expect(resolvePort('4123')).toBe(4123);
    expect(() => resolvePort('not-a-port')).toThrow(/Invalid PORT/);
    expect(() => resolvePort('70000')).toThrow(/Invalid PORT/);
  });
});
