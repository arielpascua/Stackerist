/**
 * Client IP for the per-IP flood limits (architecture §4.8, REQ-081). Fastify `trustProxy` is NOT used:
 * the installed 5.12 types have no hop-count form. Railway documents `X-Real-IP` (risk R3: verified by
 * a spoof test after the first deploy). IPs live in memory only and are never logged.
 */
import type { IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';

export type ClientIpConfig =
  | { readonly source: 'socket' }
  | { readonly source: 'x-real-ip' }
  | { readonly source: 'x-forwarded-for'; readonly trustedHops: number };

/** All clients whose address can't be determined share this one bucket (pessimistic). */
const UNKNOWN_IP = 'unknown';

/**
 * CLIENT_IP_SOURCE = socket | x-real-ip | x-forwarded-for (the last needs TRUSTED_PROXY_HOPS ≥ 1).
 * Default: x-real-ip when NODE_ENV=production (Railway), socket otherwise. Anything else throws at
 * startup rather than silently trusting a header.
 */
export function clientIpConfigFromEnv(env: NodeJS.ProcessEnv): ClientIpConfig {
  const source = env.CLIENT_IP_SOURCE?.trim();
  if (source === undefined || source === '') {
    return env.NODE_ENV === 'production' ? { source: 'x-real-ip' } : { source: 'socket' };
  }
  if (source === 'socket') return { source: 'socket' };
  if (source === 'x-real-ip') return { source: 'x-real-ip' };
  if (source === 'x-forwarded-for') {
    const hops = Number(env.TRUSTED_PROXY_HOPS);
    if (!Number.isInteger(hops) || hops < 1) {
      throw new Error('CLIENT_IP_SOURCE=x-forwarded-for needs TRUSTED_PROXY_HOPS ≥ 1');
    }
    return { source: 'x-forwarded-for', trustedHops: hops };
  }
  throw new Error('CLIENT_IP_SOURCE must be socket, x-real-ip or x-forwarded-for');
}

function canonicalIp(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  let value = raw.trim();
  if (value.toLowerCase().startsWith('::ffff:') && isIP(value.slice(7)) === 4) {
    value = value.slice(7);
  }
  return isIP(value) === 0 ? null : value;
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function resolveClientIp(
  req: {
    readonly headers: IncomingHttpHeaders;
    readonly socket: { readonly remoteAddress?: string | undefined };
  },
  cfg: ClientIpConfig,
): string {
  const fallback = canonicalIp(req.socket.remoteAddress) ?? UNKNOWN_IP;
  switch (cfg.source) {
    case 'socket':
      return fallback;
    case 'x-real-ip':
      return canonicalIp(headerValue(req.headers, 'x-real-ip')) ?? fallback;
    case 'x-forwarded-for': {
      const list = (headerValue(req.headers, 'x-forwarded-for') ?? '').split(',');
      const index = Math.max(0, list.length - cfg.trustedHops);
      return canonicalIp(list[index]) ?? fallback;
    }
    default:
      return fallback;
  }
}
