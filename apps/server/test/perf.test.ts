/**
 * REQ-068 — "one running match well under 5 % of one CPU core", measured (best of up to three 10 s windows).
 *
 * Budget: CPU time of this process (`process.cpuUsage()`, user + system) divided by wall time over a
 * 10 s window (after a 3 s warm-up) of a running match must stay below BUDGET_CPU_PERCENT = 5. The window
 * runs the real server on a random port with the real clock (the real 60 Hz accumulator loop), two bot
 * clients on real WebSockets, and input at human rate (about 8 keys/s each; a hard drop only every
 * 50th key, so the stack cannot top out inside 30 s).
 *
 * Noise policy: a busy machine (a build, another test run) only ever ADDS CPU time to this process, never
 * removes it. So the match is measured in up to MAX_WINDOWS = 3 consecutive 10 s windows and passes as
 * soon as one window is under the budget; a server that really burns 5 % fails all three. Every window is
 * printed. (Windows accounts process CPU time in coarse clumps, so shorter slices are not trustworthy;
 * whole 10 s windows are.)
 *
 * The bots live in the same process, so the measurement is an UPPER bound for the server alone. They
 * are raw `ws` sockets that never run the zod schemas or JSON.parse on snapshots (a regex reads the
 * tick), so they add very little. The measured value is printed; it is typically 1 to 3 %. The 5 %
 * budget is the stated margin: failing it means the server really is too hungry, not that the test is
 * tight.
 *
 * Also asserted: a snapshot frame stays under SNAPSHOT_BUDGET_BYTES = 2048, and the loop really ran at
 * about 60 ticks/s (otherwise a low CPU number would prove nothing).
 */
import { performance } from 'node:perf_hooks';
import { WS_PATH, type ClientMessage } from '@stackerist/protocol';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createLogger, createServer } from '../src/index.js';

const BUDGET_CPU_PERCENT = 5;
const SNAPSHOT_BUDGET_BYTES = 2048;
const WARMUP_MS = 3000;
const WINDOW_MS = 10_000;
const MAX_WINDOWS = 3;
const INPUT_EVERY_MS = 120;

const SNAPSHOT_TICK = /^\{"type":"snapshot","tick":(\d+),/;

interface Bot {
  readonly ws: WebSocket;
  readonly snapshotBytes: number[];
  lastTick: number;
  firstPlayTick: number | null;
  code: string | null;
  timer: NodeJS.Timeout | null;
  seq: number;
  keys: number;
}

function openBot(url: string, onText: (bot: Bot, text: string) => void): Promise<Bot> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const bot: Bot = {
      ws,
      snapshotBytes: [],
      lastTick: 0,
      firstPlayTick: null,
      code: null,
      timer: null,
      seq: 0,
      keys: 0,
    };
    ws.on('message', (data: Buffer) => {
      const text = data.toString('utf8');
      const snap = SNAPSHOT_TICK.exec(text);
      if (snap !== null) {
        bot.snapshotBytes.push(data.length);
        const tick = Number(snap[1]);
        bot.lastTick = tick;
        if (tick > 0) bot.firstPlayTick ??= tick;
        return;
      }
      if (text.startsWith('{"type":"ping"')) {
        const ping = JSON.parse(text) as { t: number };
        ws.send(JSON.stringify({ type: 'pong', t: ping.t } satisfies ClientMessage));
        return;
      }
      onText(bot, text);
    });
    ws.once('open', () => {
      resolve(bot);
    });
    ws.once('error', reject);
  });
}

const KEYS = ['moveLeft', 'rotateCW', 'moveRight', 'rotateCCW', 'moveRight', 'moveLeft'] as const;

function startTyping(bot: Bot): void {
  bot.timer = setInterval(() => {
    if (bot.ws.readyState !== WebSocket.OPEN || bot.lastTick === 0) return;
    bot.keys += 1;
    bot.seq += 1;
    const type = bot.keys % 50 === 0 ? 'hardDrop' : (KEYS[bot.keys % KEYS.length] ?? 'moveLeft');
    const msg: ClientMessage = {
      type: 'input',
      seq: bot.seq,
      tick: bot.lastTick + 4,
      action: { type },
    };
    bot.ws.send(JSON.stringify(msg));
  }, INPUT_EVERY_MS);
}

async function waitFor(cond: () => boolean, what: string, timeoutMs: number): Promise<void> {
  const start = performance.now();
  while (!cond()) {
    if (performance.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

describe('REQ-068 CPU budget of one running match', () => {
  it('REQ-068 stays under 5 % of one core and keeps snapshots under 2 KB', async () => {
    const server = await createServer({
      port: 0,
      host: '127.0.0.1',
      clientDist: null,
      logger: createLogger({ level: 'silent' }),
      clientIp: { source: 'socket' },
    });
    const { port } = await server.listen();
    const url = `ws://127.0.0.1:${String(port)}${WS_PATH}`;
    const bots: Bot[] = [];
    try {
      const a = await openBot(url, (bot, text) => {
        const msg = JSON.parse(text) as { type: string; code?: string };
        if (msg.type === 'created' && msg.code !== undefined) bot.code = msg.code;
      });
      bots.push(a);
      a.ws.send(JSON.stringify({ type: 'create', name: 'Ann' } satisfies ClientMessage));
      await waitFor(() => a.code !== null, 'the room code', 5000);
      const b = await openBot(url, () => undefined);
      bots.push(b);
      b.ws.send(
        JSON.stringify({ type: 'join', code: a.code ?? '', name: 'Ben' } satisfies ClientMessage),
      );
      // The real 3 s countdown, then the first play tick.
      await waitFor(
        () => a.firstPlayTick !== null && b.firstPlayTick !== null,
        'play to start',
        8000,
      );
      startTyping(a);
      startTyping(b);
      // Warm-up: the first seconds pay for JIT compilation and socket setup, which is not steady-state load.
      await new Promise<void>((resolve) => setTimeout(resolve, WARMUP_MS));

      // ---- the measured windows
      interface Window {
        readonly percent: number;
        readonly cpuMs: number;
        readonly userMs: number;
        readonly systemMs: number;
        readonly wallMs: number;
        readonly ticksPerSecond: number;
        readonly sizes: number[];
      }
      const windows: Window[] = [];
      for (let attempt = 0; attempt < MAX_WINDOWS; attempt += 1) {
        const cpu0 = process.cpuUsage();
        const wall0 = performance.now();
        const tick0 = a.lastTick;
        const snaps0 = a.snapshotBytes.length;
        await new Promise<void>((resolve) => setTimeout(resolve, WINDOW_MS));
        const cpu = process.cpuUsage(cpu0);
        const wallMs = performance.now() - wall0;
        const cpuMs = (cpu.user + cpu.system) / 1000;
        windows.push({
          percent: (cpuMs / wallMs) * 100,
          cpuMs,
          userMs: cpu.user / 1000,
          systemMs: cpu.system / 1000,
          wallMs,
          ticksPerSecond: ((a.lastTick - tick0) / wallMs) * 1000,
          sizes: a.snapshotBytes.slice(snaps0),
        });
        const last = windows.at(-1);
        // A window in which the match was not ticking would measure an idle server: not evidence.
        expect(
          last?.ticksPerSecond,
          `window ${String(attempt + 1)}: the match kept ticking`,
        ).toBeGreaterThan(50);
        if ((last?.percent ?? Infinity) < BUDGET_CPU_PERCENT) break;
      }
      const best = windows.reduce((lo, w) => (w.percent < lo.percent ? w : lo));
      const allSizes = windows.flatMap((w) => w.sizes);
      const maxBytes = Math.max(...allSizes);
      const meanBytes = allSizes.reduce((sum, n) => sum + n, 0) / allSizes.length;
      console.info(
        `REQ-068 measured: CPU ${best.percent.toFixed(2)} % of one core ` +
          `(${best.cpuMs.toFixed(0)} ms CPU: user ${best.userMs.toFixed(0)} ms + system ${best.systemMs.toFixed(0)} ms, ` +
          `over ${(best.wallMs / 1000).toFixed(2)} s wall; budget < ${String(BUDGET_CPU_PERCENT)} %). ` +
          `Windows measured: ${windows.map((w) => `${w.percent.toFixed(2)} %`).join(', ')}. ` +
          `Loop ${best.ticksPerSecond.toFixed(1)} ticks/s. ` +
          `Snapshot frames: ${String(allSizes.length)} seen by one client, max ${String(maxBytes)} B, ` +
          `mean ${meanBytes.toFixed(0)} B (budget < ${String(SNAPSHOT_BUDGET_BYTES)} B). ` +
          `Inputs sent: ${String(a.keys + b.keys)}.`,
      );

      // The match was alive and ticking for real: ~60 ticks/s, snapshots at least ~25/s, inputs flowing.
      expect(server.app.server.listening).toBe(true);
      expect(best.ticksPerSecond).toBeGreaterThan(50);
      expect(best.ticksPerSecond).toBeLessThan(70);
      expect(best.sizes.length).toBeGreaterThan(200);
      expect(a.keys + b.keys).toBeGreaterThan(100);
      // The budgets.
      expect(best.percent).toBeLessThan(BUDGET_CPU_PERCENT);
      expect(maxBytes).toBeLessThan(SNAPSHOT_BUDGET_BYTES);
    } finally {
      for (const bot of bots) {
        if (bot.timer !== null) clearInterval(bot.timer);
        bot.ws.terminate();
      }
      await server.close();
    }
  }, 90_000);
});
