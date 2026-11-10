/**
 * The strict production Content-Security-Policy, end to end. The suite's normal server runs with
 * NODE_ENV unset, whose policy allows inline styles (`style-src 'self' 'unsafe-inline'`), so nothing else
 * in the suite would notice a page that only works because of that allowance. This spec starts its own
 * copy of the production build with `NODE_ENV=production` on its own free port, plays a real two-browser
 * game against it and asserts the browser reported no violation, the response headers carry the strict
 * policy, and a cross-site WebSocket upgrade is refused.
 *
 * "Can this fail?" is part of the spec: a second instance with NODE_ENV unset is started and the same
 * policy check must reject it.
 *
 * Ids and strings come from the app's single sources (`TEST_IDS`, `COPY`, `WS_PATH`).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { connect, createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { WS_PATH } from '../packages/protocol/src/index.ts';
import {
  closeAll,
  COPY,
  createGame,
  joinViaLink,
  ownCanvas,
  oppCanvas,
  ownStat,
  TEST_IDS,
  waitUntilLive,
  type Player,
} from './support/app.ts';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** The two font families DESIGN.md names; the computed `font-family` must begin with them. */
const BODY_FONT = 'Archivo';
const DISPLAY_FONT = 'Big Shoulders Display';

// ---------------------------------------------------------------------------------------------
// A server process of our own
// ---------------------------------------------------------------------------------------------

interface ServerHandle {
  readonly port: number;
  readonly baseURL: string;
  readonly child: ChildProcess;
  /** What the process wrote to stdout / stderr, for a failure message. */
  readonly output: string[];
  stop(): Promise<void>;
}

/** Asks the OS for a free port, then proves nothing answers on it before it is handed out. */
async function freePort(): Promise<number> {
  const port = await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const chosen = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => {
        resolve(chosen);
      });
    });
  });
  expect(await accepts(port), `port ${String(port)} is not free`).toBe(false);
  return port;
}

/** True when something accepts a TCP connection on 127.0.0.1:port. */
function accepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * `node apps/server/dist/index.js` (the same command as playwright.config.ts) with `nodeEnv` as its
 * NODE_ENV: a string sets it, `undefined` removes it (Playwright itself may have set one for this
 * process, and the child must not inherit that).
 */
async function startServer(nodeEnv: string | undefined): Promise<ServerHandle> {
  const port = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    CLIENT_IP_SOURCE: 'x-real-ip',
  };
  if (nodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = nodeEnv;
  const child = spawn(process.execPath, ['apps/server/dist/index.js'], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const output: string[] = [];
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString('utf8')));
  let exited = false;
  const exit = new Promise<void>((resolve) => {
    child.once('exit', () => {
      exited = true;
      resolve();
    });
  });
  const baseURL = `http://127.0.0.1:${String(port)}`;
  const handle: ServerHandle = {
    port,
    baseURL,
    child,
    output,
    async stop() {
      // Only the process this function started is ever signalled.
      if (!exited) child.kill();
      await Promise.race([
        exit,
        new Promise<void>((resolve) => {
          setTimeout(resolve, 10_000);
        }),
      ]);
      if (!exited) child.kill('SIGKILL');
      await exit;
      expect(await accepts(port), `port ${String(port)} is still in use after stop`).toBe(false);
    },
  };
  try {
    await expect
      .poll(
        async () => {
          if (exited) throw new Error(`server exited early:\n${output.join('')}`);
          try {
            return (await fetch(`${baseURL}/healthz`)).status;
          } catch {
            return 0;
          }
        },
        { timeout: 30_000, message: `server on ${baseURL} never answered /healthz` },
      )
      .toBe(200);
  } catch (error) {
    await handle.stop();
    throw error;
  }
  return handle;
}

// ---------------------------------------------------------------------------------------------
// The policy
// ---------------------------------------------------------------------------------------------

/** The directives of a CSP header as name -> source list. */
function parsePolicy(header: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of header.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name !== undefined && name !== '') directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

/** The strict production policy and the other three security headers; throws (via expect) otherwise. */
function expectStrictHeaders(headers: Headers, what: string): void {
  const csp = headers.get('content-security-policy');
  expect(csp, `${what}: content-security-policy`).not.toBeNull();
  const policy = parsePolicy(csp ?? '');
  expect(policy.get('script-src'), `${what}: script-src`).toEqual(["'self'"]);
  const style = policy.get('style-src');
  expect(style, `${what}: style-src`).toContain("'self'");
  expect(style, `${what}: style-src must not allow inline styles`).not.toContain("'unsafe-inline'");
  expect(policy.get('frame-ancestors'), `${what}: frame-ancestors`).toEqual(["'none'"]);
  expect(headers.get('x-content-type-options'), `${what}: x-content-type-options`).toBe('nosniff');
  expect(headers.get('referrer-policy'), `${what}: referrer-policy`).toBe('no-referrer');
}

/** The status of a WebSocket upgrade to `/ws` that carries `origin` (101 when the server accepts). */
function upgradeStatus(server: ServerHandle, origin: string): Promise<number> {
  return new Promise((resolve, reject) => {
    // A raw request on a plain socket: the status line is the whole answer, and a server that closes the
    // connection right after a refusal cannot turn that into an error of the HTTP client.
    const socket = connect({ host: '127.0.0.1', port: server.port });
    let received = '';
    let answered = false;
    socket.setEncoding('latin1');
    socket.once('connect', () => {
      socket.write(
        [
          `GET ${WS_PATH} HTTP/1.1`,
          `Host: 127.0.0.1:${String(server.port)}`,
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Version: 13',
          `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
          `Origin: ${origin}`,
          'x-real-ip: 10.250.1.1',
          '',
          '',
        ].join('\r\n'),
      );
    });
    socket.on('data', (chunk: string) => {
      received += chunk;
      const status = /^HTTP\/1\.1 (\d{3})/.exec(received);
      if (status?.[1] === undefined || answered) return;
      answered = true;
      socket.destroy();
      resolve(Number(status[1]));
    });
    socket.on('error', (error) => {
      if (!answered) reject(error);
    });
    socket.on('close', () => {
      if (!answered) reject(new Error(`closed without a status line: ${JSON.stringify(received)}`));
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Two browsers that report everything the browser complained about
// ---------------------------------------------------------------------------------------------

interface Watched {
  readonly player: Player;
  /** Console errors and warnings, page errors and failed requests. */
  readonly complaints: string[];
  /** WebSocket URLs this page opened. */
  readonly sockets: string[];
}

let ipCounter = 1 + Math.floor(Math.random() * 200);

/** A player on `baseURL` whose page records `securitypolicyviolation` events into `window.__csp`. */
async function watchedPlayer(browser: Browser, baseURL: string, name: string): Promise<Watched> {
  ipCounter += 1;
  const context: BrowserContext = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 600 },
    extraHTTPHeaders: {
      'x-real-ip': `10.240.${String(ipCounter % 250)}.${String(1 + (ipCounter % 200))}`,
    },
  });
  await context.addInitScript(() => {
    const store: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = store;
    document.addEventListener(
      'securitypolicyviolation',
      (event) => {
        store.push(
          `${event.violatedDirective} blocked ${event.blockedURI} (${event.sourceFile}:${String(event.lineNumber)})`,
        );
      },
      true,
    );
  });
  const page = await context.newPage();
  const complaints: string[] = [];
  const sockets: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      complaints.push(`console.${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => complaints.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (req) =>
    complaints.push(`requestfailed: ${req.url()} ${req.failure()?.errorText ?? ''}`),
  );
  page.on('websocket', (ws) => sockets.push(ws.url()));
  const player: Player = { name, context, page, problems: [], mobile: false };
  return { player, complaints, sockets };
}

async function violations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

/** A few seconds of live play: both hard-drop until each has placed pieces and the other sees them. */
async function playLive(a: Player, b: Player): Promise<void> {
  const target = 3;
  await expect
    .poll(
      async () => {
        await a.page.keyboard.press('Space');
        await b.page.keyboard.press('Space');
        return Math.min(
          await ownStat(a.page, COPY.game.pieces),
          await ownStat(b.page, COPY.game.pieces),
        );
      },
      { timeout: 30_000, intervals: [250] },
    )
    .toBeGreaterThanOrEqual(target);
}

// ---------------------------------------------------------------------------------------------
// The specs
// ---------------------------------------------------------------------------------------------

test.describe('production Content-Security-Policy (NODE_ENV=production)', () => {
  let prod: ServerHandle;

  test.beforeAll(async () => {
    prod = await startServer('production');
  });

  test.afterAll(async () => {
    await prod.stop();
  });

  test('a full two-browser game under the strict policy: no violation, no console noise, styled, live', async ({
    browser,
  }, testInfo: TestInfo) => {
    test.setTimeout(120_000);
    const a = await watchedPlayer(browser, prod.baseURL, 'Alice');
    const b = await watchedPlayer(browser, prod.baseURL, 'Bob');
    try {
      // A creates, B joins by the link, both see the standoff, then live play.
      const created = await createGame(a.player);
      await joinViaLink(b.player, created.link, created.code);
      for (const { player } of [a, b]) {
        await expect(player.page.getByTestId(TEST_IDS.game.screen)).toBeVisible();
        await expect(player.page.getByTestId(TEST_IDS.countdown.overlay)).toBeVisible();
      }
      await waitUntilLive(a.player);
      await waitUntilLive(b.player);
      await playLive(a.player, b.player);

      for (const { player } of [a, b]) {
        const { page } = player;
        // The boards rendered.
        await expect(ownCanvas(page)).toBeVisible();
        await expect(oppCanvas(page)).toBeVisible();
        expect(
          await page.locator('canvas').count(),
          `${player.name}: canvases`,
        ).toBeGreaterThanOrEqual(2);

        // The styles and the web fonts applied under a policy that forbids inline styles.
        const styled = await page.evaluate(async (displayTestId) => {
          await document.fonts.ready;
          const rules = [...document.styleSheets].reduce((total, sheet) => {
            try {
              return total + sheet.cssRules.length;
            } catch {
              return total;
            }
          }, 0);
          // The room code in the game's top bar is set in the display face.
          const display = document.querySelector(`[data-testid="${displayTestId}"]`);
          return {
            bodyFont: getComputedStyle(document.body).fontFamily,
            displayFont: display === null ? '' : getComputedStyle(display).fontFamily,
            rules,
            loadedFaces: [...document.fonts]
              .filter((face) => face.status === 'loaded')
              .map((face) => face.family.replaceAll('"', '')),
          };
        }, TEST_IDS.game.roomCode);
        expect(styled.bodyFont.replaceAll('"', ''), `${player.name}: body font`).toMatch(
          new RegExp(`^${BODY_FONT}\\b`),
        );
        expect(styled.displayFont.replaceAll('"', ''), `${player.name}: display font`).toMatch(
          new RegExp(`^${DISPLAY_FONT}\\b`),
        );
        // The built sheets hold about 300 rules (296 when this was written); a page whose styles were
        // blocked or never loaded holds none.
        expect(styled.rules, `${player.name}: CSS rules in the loaded sheets`).toBeGreaterThan(200);
        expect(styled.loadedFaces, `${player.name}: web fonts really loaded`).toEqual(
          expect.arrayContaining([BODY_FONT, DISPLAY_FONT]),
        );
      }

      // Nothing was blocked and nothing complained.
      for (const { player } of [a, b]) {
        expect(await violations(player.page), `${player.name}: CSP violations`).toEqual([]);
      }
      expect(a.complaints, 'A console errors / warnings / failed requests').toEqual([]);
      expect(b.complaints, 'B console errors / warnings / failed requests').toEqual([]);

      // Two WebSockets in all: one game socket per browser.
      expect(a.sockets.length, 'A sockets').toBe(1);
      expect(b.sockets.length, 'B sockets').toBe(1);
      for (const url of [...a.sockets, ...b.sockets]) {
        expect(new URL(url).pathname).toBe(WS_PATH);
        expect(new URL(url).host).toBe(new URL(prod.baseURL).host);
      }
      testInfo.annotations.push({ type: 'server', description: prod.baseURL });
    } finally {
      await closeAll([a.player, b.player]);
    }
  });

  test('the security headers on / and /healthz are the strict set', async () => {
    for (const path of ['/', '/healthz']) {
      const response = await fetch(`${prod.baseURL}${path}`);
      expect(response.status, path).toBe(200);
      expectStrictHeaders(response.headers, path);
    }
  });

  test('a WebSocket upgrade from a foreign Origin gets 403; the same host gets 101', async () => {
    expect(await upgradeStatus(prod, 'https://evil.example')).toBe(403);
    expect(await upgradeStatus(prod, `http://evil.example:${String(prod.port)}`)).toBe(403);
    expect(await upgradeStatus(prod, 'null')).toBe(403);
    expect(await upgradeStatus(prod, prod.baseURL)).toBe(101);
  });
});

test.describe('the policy check can fail', () => {
  test('an instance with NODE_ENV unset allows inline styles, and the strict check rejects it', async () => {
    const dev = await startServer(undefined);
    try {
      const response = await fetch(`${dev.baseURL}/`);
      const style = parsePolicy(response.headers.get('content-security-policy') ?? '').get(
        'style-src',
      );
      expect(style, 'the dev policy is the one that allows inline styles').toContain(
        "'unsafe-inline'",
      );
      expect(() => {
        expectStrictHeaders(response.headers, 'NODE_ENV unset');
      }).toThrow(/unsafe-inline|style-src/);
    } finally {
      await dev.stop();
    }
  });
});
