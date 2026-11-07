/**
 * @stackerist/server — milestone 1 placeholder.
 *
 * Provides only: GET /healthz, static serving of the built client with SPA fallback, a
 * wrapped error handler, an unhandledRejection logger and graceful shutdown. Rooms, matches
 * and the /ws WebSocket land in the server milestone.
 */
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { ENGINE_VERSION } from '@stackerist/engine';
import { PROTOCOL_VERSION } from '@stackerist/protocol';
import { fastify, type FastifyInstance, type FastifyServerOptions } from 'fastify';

export const DEFAULT_PORT = 3000;

/** `apps/client/dist`, resolved from this file so it works from src (tsx) and dist (node). */
const DEFAULT_CLIENT_DIST = fileURLToPath(new URL('../../client/dist/', import.meta.url));

export interface BuildAppOptions {
  /** Directory of the built client. Static serving is skipped when it does not exist. */
  clientDist?: string;
  logger?: FastifyServerOptions['logger'];
}

function statusOf(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const { statusCode } = error;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) return statusCode;
  }
  return 500;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = fastify({
    // Request logs carry method + URL only: never client IPs or hostnames (REQ-071).
    logger: options.logger ?? {
      serializers: {
        req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
      },
    },
  });

  // One failing request must never take the process down (REQ-072): every route error lands
  // here, is logged, and becomes a generic JSON error without internals.
  app.setErrorHandler((error, request, reply) => {
    const status = statusOf(error);
    if (status >= 500) request.log.error({ err: error }, 'request failed');
    return reply.code(status).send({ error: status >= 500 ? 'INTERNAL' : 'BAD_REQUEST' });
  });

  app.get('/healthz', () => ({ ok: true }));

  const clientDist = options.clientDist ?? DEFAULT_CLIENT_DIST;
  if (existsSync(clientDist)) {
    await app.register(fastifyStatic, { root: clientDist });
    // SPA fallback: extension-less GET/HEAD paths (e.g. /g/ABC234) get index.html;
    // missing assets stay 404 so the browser never receives HTML for a script.
    app.setNotFoundHandler((request, reply) => {
      const path = request.url.split('?')[0] ?? '';
      if ((request.method === 'GET' || request.method === 'HEAD') && extname(path) === '') {
        return reply.type('text/html').sendFile('index.html');
      }
      return reply.code(404).send({ error: 'NOT_FOUND' });
    });
  } else {
    app.log.warn({ clientDist }, 'client build not found; static serving disabled');
  }

  return app;
}

export function resolvePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${JSON.stringify(raw)}`);
  }
  return port;
}

async function main(): Promise<void> {
  const app = await buildApp();

  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'unhandled promise rejection');
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'shutting down');
      app.close().then(
        () => process.exit(0),
        (err: unknown) => {
          app.log.error({ err }, 'shutdown failed');
          process.exit(1);
        },
      );
    });
  }

  const port = resolvePort(process.env.PORT);
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen({ port, host });
  app.log.info({ engine: ENGINE_VERSION, protocol: PROTOCOL_VERSION }, 'stackerist server ready');
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
