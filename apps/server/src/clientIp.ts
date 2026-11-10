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

/** The eight 16-bit groups of a valid IPv6 address (zone id already removed). */
function ipv6Groups(address: string): number[] {
  let text = address.toLowerCase();
  const tail = text.slice(text.lastIndexOf(':') + 1);
  if (isIP(tail) === 4) {
    const [a = 0, b = 0, c = 0, d = 0] = tail.split('.').map(Number);
    text = `${text.slice(0, text.lastIndexOf(':') + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', rest] = text.split('::');
  const front = head === '' ? [] : head.split(':');
  const back = rest === undefined || rest === '' ? [] : rest.split(':');
  const zeros =
    rest === undefined ? [] : new Array<string>(8 - front.length - back.length).fill('0');
  return [...front, ...zeros, ...back].map((group) => parseInt(group, 16));
}

/** The per-client key and the wider network key an address belongs to (equal for IPv4). */
interface AddressKeys {
  readonly ip: string;
  readonly network: string;
}

/**
 * Two keys per client (F3a, N2): IPv4 as is (the network key is the same address), IPv6 as its /64
 * (`ip`, because a single home or phone gets a whole /64 and could otherwise mint billions of
 * "different" clients) and as its /48 (`network`, the usual site allocation: a /56 or /60 delegated
 * prefix, or a whole /48, would otherwise hold 16 to 65 536 /64 keys with a full budget each). Every
 * spelling of an address (leading zeros, `::`, case, a zone id, an embedded IPv4 tail) gives the same keys.
 */
function canonicalIp(raw: string | undefined): AddressKeys | null {
  if (raw === undefined) return null;
  let value = raw.trim();
  if (value.toLowerCase().startsWith('::ffff:') && isIP(value.slice(7)) === 4) {
    value = value.slice(7);
  }
  const zone = value.indexOf('%');
  if (zone !== -1) value = value.slice(0, zone);
  const family = isIP(value);
  if (family === 0) return null;
  if (family === 4) return { ip: value, network: value };
  const groups = ipv6Groups(value).map((group) => group.toString(16));
  return {
    ip: `${groups.slice(0, 4).join(':')}::/64`,
    network: `${groups.slice(0, 3).join(':')}::/48`,
  };
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export interface ResolvedClientIp {
  readonly ip: string;
  /** The aggregate key: the IPv6 /48 of `ip` (for IPv4 and "unknown", `ip` itself). */
  readonly network: string;
  /** False when the configured header was missing or unusable and the socket address stood in (F3c). */
  readonly fromConfiguredSource: boolean;
}

type RequestLike = {
  readonly headers: IncomingHttpHeaders;
  readonly socket: { readonly remoteAddress?: string | undefined };
};

export function resolveClientIpDetailed(req: RequestLike, cfg: ClientIpConfig): ResolvedClientIp {
  const fallback = canonicalIp(req.socket.remoteAddress) ?? { ip: UNKNOWN_IP, network: UNKNOWN_IP };
  let fromHeader: AddressKeys | null = null;
  switch (cfg.source) {
    case 'socket':
      return { ...fallback, fromConfiguredSource: true };
    case 'x-real-ip':
      fromHeader = canonicalIp(headerValue(req.headers, 'x-real-ip'));
      break;
    case 'x-forwarded-for': {
      const list = (headerValue(req.headers, 'x-forwarded-for') ?? '').split(',');
      fromHeader = canonicalIp(list[Math.max(0, list.length - cfg.trustedHops)]);
      break;
    }
    default:
      break;
  }
  return { ...(fromHeader ?? fallback), fromConfiguredSource: fromHeader !== null };
}

export function resolveClientIp(req: RequestLike, cfg: ClientIpConfig): string {
  return resolveClientIpDetailed(req, cfg).ip;
}
