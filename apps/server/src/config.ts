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
}

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
});

/** Per-IP flood windows, ms (REQ-081: "per minute"). */
export const IP_WINDOW_MS = 60_000;

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
