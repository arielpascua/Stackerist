/**
 * Snapshot-event de-duplication (REQ-087): projectiles and cancel bursts are driven only by the `attack` and
 * `cancel` events in server snapshots, and each plays exactly once. An event has no id of its own, so its
 * identity is its kind, seat, tick and row count; a snapshot that arrives twice, or lists an event the
 * previous one already carried, never replays it. Pure.
 */
import { MAX_SNAPSHOT_EVENTS, type SnapshotEvent } from '@stackerist/protocol';

/** How many recent identities are remembered: several snapshots' worth, far more than a replay needs. */
const REMEMBERED = MAX_SNAPSHOT_EVENTS * 8;

/** `attack:A:120:2` or `cancel:B:120:1`. */
export function eventIdentity(event: SnapshotEvent): string {
  const seat = event.type === 'attack' ? event.from : event.seat;
  return `${event.type}:${seat}:${String(event.tick)}:${String(event.rows)}`;
}

export class SnapshotEventFilter {
  readonly #seen = new Set<string>();

  /** The events not seen before, in order. */
  fresh(events: readonly SnapshotEvent[]): SnapshotEvent[] {
    const fresh: SnapshotEvent[] = [];
    for (const event of events) {
      const id = eventIdentity(event);
      if (this.#seen.has(id)) continue;
      this.#seen.add(id);
      fresh.push(event);
    }
    while (this.#seen.size > REMEMBERED) {
      const oldest = this.#seen.values().next();
      if (oldest.done === true) break;
      this.#seen.delete(oldest.value);
    }
    return fresh;
  }

  /** A new round or a new binding: ticks start over, so old identities no longer apply. */
  reset(): void {
    this.#seen.clear();
  }
}
