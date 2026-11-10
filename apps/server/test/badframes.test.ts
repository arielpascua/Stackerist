/**
 * Security review F8: frames the WebSocket layer rejects before the app sees them (oversized past the hard
 * payload cap, invalid UTF-8) are logged as a warn-level anticheat line, coalesced, with no stack trace.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryLog, startTestServer, until, type Harness } from './helpers/harness.js';

let h: Harness;
afterEach(async () => {
  await h.close();
});

describe('F8 malformed frames are a warning, not a stack trace', () => {
  it('F8 an oversized frame (past wsHardMaxPayloadBytes) logs one warn anticheat BAD_MESSAGE line and no error', async () => {
    const log = new MemoryLog();
    h = await startTestServer({ memoryLog: log });
    const c = await h.connect();
    c.ws.send('x'.repeat(20_000));
    await c.waitClose();
    await until(() => log.events('anticheat').length > 0, 'the anticheat line');
    const lines = log.events('anticheat');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 40, rule: 'BAD_MESSAGE', count: 1 });
    expect(log.events('handler.error')).toHaveLength(0);
    expect(log.lines.some((l) => 'err' in l || 'stack' in l)).toBe(false);
    expect(log.text.join('\n')).not.toMatch(/\bat .*\.js:\d+/);
  });

  it('F8 an invalid UTF-8 text frame is the same', async () => {
    const log = new MemoryLog();
    h = await startTestServer({ memoryLog: log });
    const c = await h.connect();
    c.ws.send(Buffer.from([0x7b, 0xff, 0xfe, 0x7d]), { binary: false });
    await c.waitClose();
    await until(() => log.events('anticheat').length > 0, 'the anticheat line');
    expect(log.events('anticheat')[0]).toMatchObject({ level: 40, rule: 'BAD_MESSAGE' });
    expect(log.events('handler.error')).toHaveLength(0);
    expect(log.lines.some((l) => 'err' in l)).toBe(false);
  });

  it('F8 the line names the connection only: no address, no frame content', async () => {
    const log = new MemoryLog();
    h = await startTestServer({ memoryLog: log });
    const c = await h.connect();
    c.ws.send('secret-payload-'.repeat(2000));
    await c.waitClose();
    await until(() => log.events('anticheat').length > 0, 'the anticheat line');
    const text = log.text.join('\n');
    expect(text).not.toContain('secret-payload');
    expect(text).not.toMatch(/127\.0\.0\.1/);
    expect(Object.keys(log.events('anticheat')[0] ?? {}).sort()).toEqual(
      ['conn', 'count', 'event', 'hostname', 'level', 'pid', 'rule', 'time'].sort(),
    );
  });

  it('F8 an ordinary clean disconnect still logs no warning', async () => {
    const log = new MemoryLog();
    h = await startTestServer({ memoryLog: log });
    const c = await h.connect();
    c.ws.close();
    await c.waitClose();
    await until(() => log.events('conn.disconnected').length === 1, 'the disconnect line');
    expect(log.events('anticheat')).toHaveLength(0);
    expect(log.events('handler.error')).toHaveLength(0);
  });
});
