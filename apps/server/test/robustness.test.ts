import { EventEmitter } from 'node:events';
import { CLOSE_CODES, HEALTH_PATH } from '@stackerist/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { ManualClock, createLogger, createServer, EventLog } from '../src/index.js';
import { installProcessHandlers } from '../src/safe.js';
import { MemoryLog, startDuel, startTestServer, type Harness } from './helpers/harness.js';
import { mustPlanClear, runPlans } from './helpers/play.js';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

async function healthz(port: number): Promise<number> {
  return (await fetch(`http://127.0.0.1:${String(port)}${HEALTH_PATH}`)).status;
}

describe('REQ-072 one failing message never takes the process down', () => {
  it('REQ-072 a throwing message handler aborts only its own room; other rooms keep playing', async () => {
    const memoryLog = new MemoryLog();
    const harness = await startTestServer({
      memoryLog,
      test: { throwOn: (msg) => msg.type === 'input' && msg.seq === 999 },
    });
    h = harness;
    const one = await startDuel(harness);
    const two = await startDuel(harness);
    one.a.send({
      type: 'input',
      seq: 999,
      tick: harness.tick(one.code),
      action: { type: 'moveLeft' },
    });
    for (const client of [one.a, one.b]) {
      expect((await client.next('error')).code).toBe('INTERNAL_ERROR');
      expect((await client.waitClose()).code).toBe(CLOSE_CODES.ROOM_CLOSED);
    }
    expect(harness.testing.inspect(one.code)).toBeNull();
    // Room two is untouched and still plays.
    two.a.input({ type: 'hardDrop' }, harness.tick(two.code));
    await harness.settle();
    harness.step();
    const snap = await two.a.snapshotAt(harness.tick(two.code));
    expect(snap.you?.stats.piecesPlaced).toBe(1);
    expect(await healthz(harness.port)).toBe(200);
    expect(memoryLog.events('handler.error')).toHaveLength(1);
    expect(memoryLog.events('room.aborted')).toContainEqual(
      expect.objectContaining({ room: one.code }),
    );
  });

  it('REQ-072 a throw for an unbound socket replies INTERNAL_ERROR and the socket keeps working', async () => {
    const harness = await startTestServer({
      test: { throwOn: (msg) => msg.type === 'create' && msg.name === 'boom' },
    });
    h = harness;
    const a = await harness.connect();
    a.send({ type: 'create', name: 'boom' });
    expect((await a.next('error')).code).toBe('INTERNAL_ERROR');
    a.send({ type: 'create', name: 'Ann' });
    await a.next('created');
    expect(a.closed).toBeNull();
  });

  it('REQ-072 a throw inside a tick aborts that room only', async () => {
    // The hole RNG returns an impossible column: routing the first attack throws inside step().
    const harness = await startTestServer({
      limits: { inputBurst: 100_000 },
      holeRngFactory: () => () => 42,
    });
    h = harness;
    const one = await startDuel(harness);
    const two = await startDuel(harness);
    const plan = mustPlanClear(harness, one.code, 'A', 2);
    await runPlans(harness, one.code, { A: { client: one.a, plan } });
    expect((await one.b.next('error')).code).toBe('INTERNAL_ERROR');
    expect((await one.b.waitClose()).code).toBe(CLOSE_CODES.ROOM_CLOSED);
    expect(harness.testing.inspect(one.code)).toBeNull();
    expect(harness.testing.inspect(two.code)?.status).toBe('playing');
    harness.step(4);
    expect(harness.testing.inspect(two.code)?.tick).toBeGreaterThan(plan.length);
  });

  it('REQ-072 an HTTP route that throws gets a generic 500 and the server keeps serving', async () => {
    const memoryLog = new MemoryLog();
    const server = await createServer({
      clientDist: null,
      clock: new ManualClock(),
      logger: createLogger({ stream: memoryLog }),
      test: { manualTick: true },
    });
    server.app.get('/boom', () => {
      throw new Error('route exploded');
    });
    const res = await server.app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'INTERNAL' });
    expect(res.body).not.toContain('exploded');
    expect((await server.app.inject({ method: 'GET', url: HEALTH_PATH })).statusCode).toBe(200);
    expect(memoryLog.events('handler.error')).toHaveLength(1);
    await server.close();
  });

  it('REQ-072 process handlers: unhandled rejections are logged and survived; uncaught exceptions are logged, then exit(1)', () => {
    const memoryLog = new MemoryLog();
    const log = new EventLog(createLogger({ stream: memoryLog }), new ManualClock());
    const exits: (number | undefined)[] = [];
    const proc = Object.assign(new EventEmitter(), {
      exit: (code?: number) => {
        exits.push(code);
      },
    });
    installProcessHandlers(log, proc);
    proc.emit('unhandledRejection', new Error('nobody awaited me'));
    proc.emit('unhandledRejection', 'a bare string with a name in it: Zelda');
    expect(exits).toEqual([]);
    expect(memoryLog.events('process.unhandledRejection')).toHaveLength(2);
    expect(memoryLog.text.join('\n')).not.toContain('Zelda');
    proc.emit('uncaughtException', new Error('boom'));
    expect(exits).toEqual([1]);
    expect(memoryLog.events('process.uncaughtException')).toHaveLength(1);
  });
});
