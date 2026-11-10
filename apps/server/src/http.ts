/**
 * HTTP on the one port (architecture §4.13, REQ-073): GET /healthz, the built client with a SPA
 * fallback, a human page for malformed URLs, and an error handler that never lets one request crash
 * the process (REQ-072). Request logging is off; errors are logged as domain events without PII.
 */
import { existsSync } from 'node:fs';
import { extname, relative, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import { HEALTH_PATH } from '@stackerist/protocol';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EventLog } from './log.js';

/** The page for a URL the router can't decode (e.g. `/g/%`). Static text: nothing from the request. */
export const BAD_URL_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Stackerist — broken link</title></head>
<body>
<main>
<h1>That link is broken</h1>
<p>The address couldn't be read. Check the game code, or start again from the home page.</p>
<p><a href="/">Back to Stackerist</a></p>
</main>
</body>
</html>
`;

/**
 * The Content-Security-Policy minus `connect-src`, which adds the request's own host for the WebSocket
 * (`wss://<host>`; `'self'` alone is not honoured for ws: by every browser). Scripts and styles are
 * same-origin only: the built client has no inline script, and React's `style` props use the CSSOM.
 */
export const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
] as const;

/** A host[:port] we are willing to copy into a header: letters, digits, dots, hyphens, [v6], a port. */
const SAFE_HOST = /^(?:[a-z0-9-]+(?:.[a-z0-9-]+)*|[[0-9a-f:.]+])(?::d{1,5})?$/i;

/**
 * `inlineStyles` adds `'unsafe-inline'` to style-src only. The built client doesn't need it (React's
 * `style` props and canvas sizing go through the CSSOM), so production never sets it; dev servers and the
 * e2e probes, which inject `<style>` tags into the page, do.
 */
export function contentSecurityPolicy(host: string | undefined, inlineStyles: boolean): string {
  const wss = host !== undefined && SAFE_HOST.test(host) ? ` wss://${host}` : '';
  const style = inlineStyles ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'";
  return [...CSP_DIRECTIVES, style, `connect-src 'self'${wss}`].join('; ');
}

/** F5: the same four headers on every response (pages, assets, health, errors, refusals). */
export function applySecurityHeaders(reply: FastifyReply, inlineStyles: boolean): void {
  void reply
    .header('x-content-type-options', 'nosniff')
    .header('referrer-policy', 'no-referrer')
    .header(
      'content-security-policy',
      contentSecurityPolicy(reply.request.headers.host, inlineStyles),
    );
}

/**
 * F4: a browser upgrade must come from this site. No Origin header (non-browser clients, tests) is
 * allowed; otherwise the Origin's host must equal the request's own `Host` header, compared literally so
 * it holds on any deploy domain and on localhost. Anything unparseable (`null`, junk) is refused.
 */
export function isAllowedOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true;
  if (host === undefined) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/** `onRequest` for the /ws route: a cross-site upgrade gets 403 and never reaches the hub. */
export async function guardOrigin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.ws || isAllowedOrigin(request.headers.origin, request.headers.host)) return;
  await reply.code(403).send({ error: 'FORBIDDEN_ORIGIN' });
}

const ASSET_CACHE = 'public, max-age=31536000, immutable';
const PAGE_CACHE = 'no-cache';

/** Fastify `frameworkErrors`: a bad URL gets the 400 page; anything else keeps the default handling. */
export function respondToFrameworkError(
  error: FastifyError,
  reply: FastifyReply,
  inlineStyles: boolean,
): void {
  applySecurityHeaders(reply, inlineStyles);
  if (error.code === 'FST_ERR_BAD_URL') {
    void reply
      .code(400)
      .header('cache-control', 'no-store')
      .type('text/html; charset=utf-8')
      .send(BAD_URL_PAGE);
    return;
  }
  void reply.send(error);
}

function statusOf(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const { statusCode } = error;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) return statusCode;
  }
  return 500;
}

export async function registerHttp(
  app: FastifyInstance,
  options: {
    readonly clientDist: string | null;
    readonly log: EventLog;
    readonly inlineStyles: boolean;
  },
): Promise<void> {
  const { log } = options;

  // F5: every response, whichever handler or error path produced it.
  app.addHook('onSend', (_request, reply, payload, done) => {
    applySecurityHeaders(reply, options.inlineStyles);
    done(null, payload);
  });

  // Every route error lands here: logged (5xx), answered generically, never thrown further.
  app.setErrorHandler((error, _request, reply) => {
    const status = statusOf(error);
    if (status >= 500) log.error('handler.error', {}, error);
    return reply.code(status).send({ error: status >= 500 ? 'INTERNAL' : 'BAD_REQUEST' });
  });

  app.get(HEALTH_PATH, (_request, reply) => {
    void reply.header('cache-control', 'no-store');
    return { ok: true };
  });

  const clientDist =
    options.clientDist !== null && existsSync(options.clientDist) ? options.clientDist : null;
  if (clientDist !== null) {
    await app.register(fastifyStatic, {
      root: clientDist,
      wildcard: true,
      index: 'index.html',
      dotfiles: 'ignore',
      setHeaders: (reply, path) => {
        const top = relative(clientDist, path).split(sep)[0];
        void reply.header('cache-control', top === 'assets' ? ASSET_CACHE : PAGE_CACHE);
      },
    });
  }

  // SPA fallback: extension-less GET/HEAD paths (e.g. /g/ABC234) get index.html; missing assets
  // and everything else stay 404, so a browser never receives HTML for a script.
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    if (
      clientDist !== null &&
      (request.method === 'GET' || request.method === 'HEAD') &&
      extname(path) === ''
    ) {
      return reply
        .code(200)
        .header('cache-control', PAGE_CACHE)
        .type('text/html')
        .sendFile('index.html');
    }
    return reply.code(404).send({ error: 'NOT_FOUND' });
  });
}
