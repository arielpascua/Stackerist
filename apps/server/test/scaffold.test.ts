import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENGINE_VERSION } from '@stackerist/engine';
import { PROTOCOL_VERSION } from '@stackerist/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, DEFAULT_PORT, resolvePort } from '../src/index.js';

describe('server scaffold', () => {
  let clientDist: string;

  beforeAll(() => {
    clientDist = mkdtempSync(join(tmpdir(), 'stackerist-client-'));
    writeFileSync(join(clientDist, 'index.html'), '<!doctype html><title>Stackerist</title>');
  });

  afterAll(() => {
    rmSync(clientDist, { recursive: true, force: true });
  });

  it('resolves the workspace engine and protocol packages', () => {
    expect(ENGINE_VERSION).toBeTypeOf('string');
    expect(PROTOCOL_VERSION).toBeTypeOf('number');
  });

  it('GET /healthz returns 200 {"ok":true}', async () => {
    const app = await buildApp({ clientDist, logger: false });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it('serves index.html for SPA routes and 404s missing assets', async () => {
    const app = await buildApp({ clientDist, logger: false });
    const page = await app.inject({ method: 'GET', url: '/g/ABC234' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<title>Stackerist</title>');
    const asset = await app.inject({ method: 'GET', url: '/assets/missing.js' });
    expect(asset.statusCode).toBe(404);
    await app.close();
  });

  it('reads PORT with a 3000 default', () => {
    expect(resolvePort(undefined)).toBe(DEFAULT_PORT);
    expect(resolvePort('4123')).toBe(4123);
    expect(() => resolvePort('not-a-port')).toThrow(/Invalid PORT/);
  });
});
