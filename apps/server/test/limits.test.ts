import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../src/index.js';
import {
  createAndJoin,
  startTestServer,
  type Harness,
  type TestClient,
} from './helpers/harness.js';

let h: Harness;
afterEach(async () => {
  await h.close();
});

const IP_1 = '198.51.100.7';
const IP_2 = '198.51.100.8';

async function createFrom(ip: string): Promise<TestClient> {
  const c = await h.connect({ headers: { 'X-Real-IP': ip } });
  c.send({ type: 'create', name: 'Ann' });
  await c.waitFor((m) => m.type === 'created' || m.type === 'error', 'create reply');
  return c;
}

describe('REQ-081 flood limits', () => {
  it('REQ-081 one live room per connection: create, join and rejoin from a bound socket get ALREADY_IN_ROOM', async () => {
    h = await startTestServer();
    const { a, code, tokenB } = await createAndJoin(h);
    a.send({ type: 'create', name: 'Ann' });
    a.send({ type: 'join', code, name: 'Ann' });
    a.send({ type: 'rejoin', code, token: tokenB });
    expect(await a.errorCodes(3)).toEqual([
      'ALREADY_IN_ROOM',
      'ALREADY_IN_ROOM',
      'ALREADY_IN_ROOM',
    ]);
    expect(h.inspect(code).seats.B?.connected).toBe(true);
  });

  it('REQ-081 at most 10 creates per minute per client IP, resolved from X-Real-IP', async () => {
    h = await startTestServer({ clientIp: { source: 'x-real-ip' } });
    for (let i = 0; i < DEFAULT_LIMITS.maxCreatesPerIpPerMin; i += 1) {
      expect((await createFrom(IP_1)).all('created')).toHaveLength(1);
    }
    const eleventh = await createFrom(IP_1);
    expect(eleventh.all('created')).toHaveLength(0);
    expect(eleventh.all('error')[0]?.code).toBe('TOO_MANY_CREATES');
    // A different client IP is unaffected; the first IP recovers after the window.
    expect((await createFrom(IP_2)).all('created')).toHaveLength(1);
    await h.advance(60_000);
    expect((await createFrom(IP_1)).all('created')).toHaveLength(1);
  });

  it('REQ-081 at most 20 failed joins per minute per IP; then even a valid code is refused without a lookup', async () => {
    h = await startTestServer({ clientIp: { source: 'x-real-ip' } });
    const host = await createFrom(IP_2);
    const code = host.all('created')[0]?.code ?? '';
    const c = await h.connect({ headers: { 'X-Real-IP': IP_1 } });
    for (let i = 0; i < DEFAULT_LIMITS.maxFailedJoinsPerIpPerMin - 1; i += 1) {
      c.send({ type: 'join', code: 'ZZZZZZ', name: 'Cy' });
    }
    c.send({ type: 'rejoin', code, token: 'A'.repeat(22) }); // BAD_TOKEN charges too
    const codes = await c.errorCodes(DEFAULT_LIMITS.maxFailedJoinsPerIpPerMin);
    expect(codes.at(-1)).toBe('BAD_TOKEN');
    c.send({ type: 'join', code, name: 'Cy' });
    expect((await c.errorCodes(DEFAULT_LIMITS.maxFailedJoinsPerIpPerMin + 1)).at(-1)).toBe(
      'TOO_MANY_JOINS',
    );
    expect(h.inspect(code).seats.B).toBeUndefined();
    // Another IP joins fine; a successful join never charges the window.
    const d = await h.connect({ headers: { 'X-Real-IP': IP_2 } });
    d.send({ type: 'join', code, name: 'Di' });
    expect((await d.next('joined')).seat).toBe('B');
  });

  it('REQ-081 at most N live rooms (SERVER_BUSY), checked after the per-IP window; a deleted room frees a slot', async () => {
    h = await startTestServer({ clientIp: { source: 'x-real-ip' }, limits: { maxLiveRooms: 3 } });
    const owners: TestClient[] = [];
    for (let i = 0; i < 3; i += 1) owners.push(await createFrom(`203.0.113.${String(i + 1)}`));
    const busy = await createFrom('203.0.113.9');
    expect(busy.all('error')[0]?.code).toBe('SERVER_BUSY');
    // The busy reply did not charge the create window: 10 more attempts still say SERVER_BUSY, not TOO_MANY_CREATES.
    for (let i = 0; i < DEFAULT_LIMITS.maxCreatesPerIpPerMin; i += 1) {
      busy.send({ type: 'create', name: 'Ann' });
    }
    const codes = await busy.errorCodes(1 + DEFAULT_LIMITS.maxCreatesPerIpPerMin);
    expect(new Set(codes)).toEqual(new Set(['SERVER_BUSY']));
    // One owner leaves an empty room behind; once it is deleted, a create succeeds.
    owners[0]?.send({ type: 'leave' });
    await h.settle();
    await h.advance(DEFAULT_LIMITS.emptyRoomTtlMs);
    busy.send({ type: 'create', name: 'Ann' });
    await busy.next('created');
  });
});
