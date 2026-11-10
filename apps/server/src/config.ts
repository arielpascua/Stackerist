/**
 * Server-only numbers (architecture §4.2). Shared wire limits and timings live in @stackerist/protocol
 * and are imported where used, never retyped here.
 */
import { MAX_HEIGHT_SAMPLES } from '@stackerist/protocol';

export interface Limits {
  /** Input token bucket capacity (REQ-038). */
  readonly inputBurst: number;
  /** Input token bucket refill, tokens per second (REQ-038). */
  readonly inputRefillPerSec: number;
  /** Dropped inputs per seat per SERIES before close RATE_LIMITED (REQ-038, owner ruling OQ-5). */
  readonly maxDropsPerSeries: number;
  /** BAD_MESSAGEs per connection before close TOO_MANY_BAD_MESSAGES (REQ-039). */
  readonly maxBadMessages: number;
  /** Buffered inputs per seat (REQ-024). */
  readonly maxQueuedInputs: number;
  /** Ticks the real-time loop may catch up per wake (REQ-024). */
  readonly maxCatchUpTicks: number;
  /** Successful creates per client IP per minute (REQ-081). */
  readonly maxCreatesPerIpPerMin: number;
  /** Failed joins/rejoins per client IP per minute (REQ-081). */
  readonly maxFailedJoinsPerIpPerMin: number;
  /** Live rooms per process (REQ-081). */
  readonly maxLiveRooms: number;
  /** Spectators per room; one more gets ROOM_FULL (REQ-062, owner ruling OQ-3). */
  readonly maxSpectatorsPerRoom: number;
  /** A room with no connected player socket is deleted after this, ms (REQ-029). */
  readonly emptyRoomTtlMs: number;
  /** A room that never started a round is deleted this long after creation, ms (REQ-029). */
  readonly waitingRoomTtlMs: number;
  /** `ws` maxPayload: larger frames are closed (1009) before the app sees them, bytes. */
  readonly wsHardMaxPayloadBytes: number;
  /** Stack-height samples kept per seat per round (REQ-090). */
  readonly maxHeightSamples: number;
  /** A socket whose send buffer is above this is closed SLOW_CONSUMER (it rejoins with its token), bytes. */
  readonly maxBufferedBytes: number;
  /**
   * Rooms a single client IP (/64 for IPv6) may have created and not yet deleted (F2, N1): a room
   * counts from creation until it is deleted, even with every player disconnected (its 2-minute TTL).
   */
  readonly maxLiveRoomsPerIp: number;
  /** Open sockets per client IP (F2). */
  readonly maxSocketsPerIp: number;
  /** Rooms one IPv6 /48 may have created and not yet deleted, over all its /64 keys (N2). */
  readonly maxLiveRoomsPerNetwork: number;
  /** Open sockets per IPv6 /48, over all its /64 keys (N2). */
  readonly maxSocketsPerNetwork: number;
  /** Open sockets per process (F2). */
  readonly maxSockets: number;
  /** A room in roundOver or seriesOver with no activity is deleted after this, ms (F2). */
  readonly idleFinishedRoomTtlMs: number;
  /** A room older than this is deleted as soon as no round is in progress (F2, N5), ms. */
  readonly maxRoomAgeMs: number;
  /** How often an over-age room with a round in progress is checked again, ms (N5). */
  readonly maxRoomAgeRecheckMs: number;
  /** Non-input message bucket per connection: capacity (F9). */
  readonly nonInputBurst: number;
  /** Non-input message bucket per connection: refill, tokens per second (F9). */
  readonly nonInputRefillPerSec: number;
}

/** An IPv6 /48 gets this many times a single /64 key's socket and room budget (N2). */
const NETWORK_FACTOR = 4;
const MAX_LIVE_ROOMS_PER_IP = 6;
const MAX_SOCKETS_PER_IP = 40;

export const DEFAULT_LIMITS: Limits = Object.freeze({
  inputBurst: 20,
  inputRefillPerSec: 30,
  maxDropsPerSeries: 200,
  maxBadMessages: 20,
  maxQueuedInputs: 60,
  maxCatchUpTicks: 5,
  maxCreatesPerIpPerMin: 10,
  maxFailedJoinsPerIpPerMin: 20,
  maxLiveRooms: 500,
  maxSpectatorsPerRoom: 8,
  emptyRoomTtlMs: 120_000,
  waitingRoomTtlMs: 900_000,
  wsHardMaxPayloadBytes: 16_384,
  maxHeightSamples: MAX_HEIGHT_SAMPLES,
  maxBufferedBytes: 512 * 1024,
  maxLiveRoomsPerIp: MAX_LIVE_ROOMS_PER_IP,
  maxSocketsPerIp: MAX_SOCKETS_PER_IP,
  maxLiveRoomsPerNetwork: MAX_LIVE_ROOMS_PER_IP * NETWORK_FACTOR,
  maxSocketsPerNetwork: MAX_SOCKETS_PER_IP * NETWORK_FACTOR,
  maxSockets: 2000,
  idleFinishedRoomTtlMs: 600_000,
  maxRoomAgeMs: 10_800_000,
  maxRoomAgeRecheckMs: 5000,
  nonInputBurst: 20,
  nonInputRefillPerSec: 5,
});

/** Per-IP flood windows, ms (REQ-081: "per minute"). */
export const IP_WINDOW_MS = 60_000;

/** A refused socket (over a socket cap) that hasn't closed by now is terminated, ms. */
export const REFUSED_SOCKET_GRACE_MS = 2000;

export const DEFAULT_PORT = 3000;

/** PORT → a TCP port; blank or missing → 3000. Throws on anything that isn't 0..65535. */
export function resolvePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${JSON.stringify(raw)}`);
  }
  return port;
}
