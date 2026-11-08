import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RTT_MS,
  MAX_INPUT_LEAD_TICKS,
  TICK_MS,
  TICK_SAMPLE_WINDOW,
  TickEstimator,
  parseServerMessage,
  toLocalMs,
  type ClockAnchor,
} from '../src/index.js';

/** A countdown parsed through the real schema: play starts at tick 0, 3 s after serverNow. */
function countdown(): ClockAnchor {
  const msg = parseServerMessage(
    JSON.stringify({ type: 'countdown', startsAt: 1_003_000, serverNow: 1_000_000, tick: 0 }),
  );
  if (msg?.type !== 'countdown') {
    throw new Error('countdown fixture failed to parse');
  }
  return msg;
}

/** Received at local 500 ms with the default 100 ms rtt → goAt = 500 − 50 + 3000 = 3450. */
function anchored(): TickEstimator {
  const est = new TickEstimator();
  est.anchor(countdown(), 500);
  return est;
}

describe('REQ-080 rtt and the start tick (client half)', () => {
  it('REQ-080 rtt defaults to DEFAULT_RTT_MS; ping.rtt replaces it; null keeps it', () => {
    const est = new TickEstimator();
    expect(est.rttMs).toBe(DEFAULT_RTT_MS);
    est.setRtt(null);
    expect(est.rttMs).toBe(DEFAULT_RTT_MS);
    est.setRtt(42);
    expect(est.rttMs).toBe(42);
    est.setRtt(null);
    expect(est.rttMs).toBe(42);
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      est.setRtt(bad);
      expect(est.rttMs).toBe(42);
    }
  });

  it('REQ-080 countdown anchors play at its tick at startsAt (goAt = toLocalMs(startsAt))', () => {
    const est = anchored();
    expect(est.goAtLocalMs()).toBe(3450);
    expect(est.goAtLocalMs()).toBe(toLocalMs(1_003_000, 1_000_000, 500, DEFAULT_RTT_MS));
    expect(est.serverTick(600)).toBe(0); // during the standoff the tick holds at the start tick
    expect(est.serverTick(3449)).toBe(0);
    expect(est.serverTick(3450)).toBe(0);
    expect(est.serverTick(3450 + 1000)).toBe(60); // one second of play = 60 ticks
    expect(est.serverTick(3450 + 50)).toBe(3); // an exact whole-tick boundary is not floored short
  });

  it('REQ-080 resumed re-anchors at its tick, clearing samples and unfreezing', () => {
    const est = anchored();
    est.observeSnapshot(60, 4500);
    est.freeze(5000);
    const frozen = est.serverTick(5000);
    expect(est.serverTick(60_000)).toBe(frozen);
    const resumed = parseServerMessage(
      JSON.stringify({ type: 'resumed', startsAt: 2_003_000, serverNow: 2_000_000, tick: 1234 }),
    );
    expect(resumed?.type).toBe('resumed');
    if (resumed?.type !== 'resumed') return;
    est.anchor(resumed, 100_000);
    const goAt = 100_000 - 50 + 3000;
    expect(est.goAtLocalMs()).toBe(goAt);
    expect(est.serverTick(goAt - 10)).toBe(1234);
    expect(est.serverTick(goAt + 1000)).toBe(1234 + 60);
  });

  it('REQ-080 the anchor keeps the rtt it arrived with, so DUEL! does not drift on a later ping', () => {
    const est = anchored();
    est.setRtt(300);
    expect(est.goAtLocalMs()).toBe(3450);
    expect(est.serverTick(3450 + 1000)).toBe(60);
  });

  it('REQ-080 toLocalMs maps a server epoch time to local ms', () => {
    // Sent at server 1_000_000, received at local 500, one-way ≈ rtt/2 = 50 → server 1_000_000 ≈ local 450.
    expect(toLocalMs(1_000_000, 1_000_000, 500, 100)).toBe(450);
    expect(toLocalMs(1_020_000, 1_000_000, 500, 100)).toBe(20_450); // e.g. graceEndsAt
  });

  it('REQ-080 nothing heard yet: serverTick 0, goAt null', () => {
    const est = new TickEstimator();
    expect(est.serverTick(12_345)).toBe(0);
    expect(est.goAtLocalMs()).toBeNull();
  });
});

describe('REQ-079 the estimate and the input stamp (client half)', () => {
  it('REQ-079 with samples: floor((local − min s) / TICK_MS + (rtt / 2) / TICK_MS)', () => {
    const est = new TickEstimator();
    est.setRtt(0);
    est.observeSnapshot(10, 1000);
    expect(est.serverTick(1000)).toBe(10);
    expect(est.serverTick(1050)).toBe(13);
    expect(est.serverTick(1049.9)).toBe(12);
    est.setRtt(100);
    expect(est.serverTick(1000)).toBe(13); // + (50 ms)/TICK_MS = 3 ticks
    const minS = 1000 - 10 * TICK_MS;
    for (const local of [1000, 1234.5, 5000]) {
      expect(est.serverTick(local)).toBe(Math.floor((local - minS) / TICK_MS + 50 / TICK_MS));
    }
  });

  it('REQ-079 the least-delayed snapshot (min s) wins', () => {
    const est = new TickEstimator();
    est.setRtt(0);
    est.observeSnapshot(10, 1000); // s ≈ 833.3
    est.observeSnapshot(12, 1040); // s = 840: later than expected, ignored by the min
    expect(est.serverTick(1100)).toBe(16);
    est.observeSnapshot(20, 1100); // s ≈ 766.7: the server is further on than we thought
    expect(est.serverTick(1100)).toBe(20);
  });

  it(`REQ-079 only the last ${String(TICK_SAMPLE_WINDOW)} samples count`, () => {
    const est = new TickEstimator();
    est.setRtt(0);
    est.observeSnapshot(0, 0); // s = 0, the minimum
    for (let tick = 1; tick < TICK_SAMPLE_WINDOW; tick += 1) {
      est.observeSnapshot(tick, tick * TICK_MS + 10); // s = 10
    }
    expect(est.serverTick(10_000)).toBe(600);
    est.observeSnapshot(TICK_SAMPLE_WINDOW, TICK_SAMPLE_WINDOW * TICK_MS + 10); // evicts s = 0
    expect(est.serverTick(10_000)).toBe(599);
  });

  it('REQ-079 snapshots before the anchored start, or while frozen, are not samples', () => {
    const est = anchored();
    est.observeSnapshot(0, 1000); // under the standoff: would claim play started at local ≈ 1000
    expect(est.serverTick(5000)).toBe(Math.floor(((5000 - 3450) * 60) / 1000));
    est.freeze(5000);
    est.observeSnapshot(0, 5001);
    expect(est.serverTick(9000)).toBe(93);
  });

  it('REQ-079 targetTick = serverTick + ceil((rtt / 2) / TICK_MS) + 1', () => {
    const cases: [rtt: number, lead: number][] = [
      [0, 1],
      [34, 3],
      [100, 4],
      [150, 6],
    ];
    for (const [rtt, lead] of cases) {
      const est = new TickEstimator();
      est.setRtt(rtt);
      est.observeSnapshot(500, 10_000);
      expect(est.targetTick(12_000) - est.serverTick(12_000), `rtt ${String(rtt)}`).toBe(lead);
    }
  });

  it('REQ-079 the stamp is clamped to serverTick + MAX_INPUT_LEAD_TICKS (30)', () => {
    const est = new TickEstimator();
    est.setRtt(2000); // lead would be ceil(60) + 1 = 61
    est.observeSnapshot(500, 10_000);
    expect(est.targetTick(10_000)).toBe(est.serverTick(10_000) + MAX_INPUT_LEAD_TICKS);
    expect(MAX_INPUT_LEAD_TICKS).toBe(30);
  });

  it('REQ-079 the stamp never goes backwards until the next anchor', () => {
    const est = new TickEstimator();
    est.setRtt(400);
    est.observeSnapshot(100, 2000);
    expect(est.serverTick(2000)).toBe(112);
    expect(est.targetTick(2000)).toBe(125);
    est.setRtt(0); // the estimate drops to 100, the lead to 1 …
    expect(est.serverTick(2000)).toBe(100);
    expect(est.targetTick(2000)).toBe(125); // … but the stamp holds
    expect(est.targetTick(2400)).toBe(125);
    expect(est.targetTick(2500)).toBe(131); // and moves again once the clamp passes it
    est.anchor(countdown(), 3000); // a new round may start lower (rtt is 0 now, so the lead is 1)
    expect(est.targetTick(3000)).toBe(0 + 1);
  });

  it('REQ-079 for any sequence of snapshots, pings and stamps: stamps are non-decreasing and within the lead clamp', () => {
    type Op =
      | { readonly kind: 'snap'; readonly dt: number; readonly tick: number }
      | { readonly kind: 'rtt'; readonly rtt: number | null }
      | { readonly kind: 'stamp'; readonly dt: number };
    const opArb: fc.Arbitrary<Op> = fc.oneof(
      fc.record({
        kind: fc.constant('snap'),
        dt: fc.integer({ min: 0, max: 200 }),
        tick: fc.integer({ min: 0, max: 20_000 }),
      }),
      fc.record({ kind: fc.constant('rtt'), rtt: fc.option(fc.nat({ max: 3000 }), { nil: null }) }),
      fc.record({ kind: fc.constant('stamp'), dt: fc.integer({ min: 0, max: 200 }) }),
    );
    fc.assert(
      fc.property(fc.boolean(), fc.array(opArb, { maxLength: 200 }), (anchor, ops) => {
        const est = anchor ? anchored() : new TickEstimator();
        let now = 4000;
        let previous = Number.NEGATIVE_INFINITY;
        for (const op of ops) {
          if (op.kind === 'rtt') {
            est.setRtt(op.rtt);
            continue;
          }
          now += op.dt;
          if (op.kind === 'snap') {
            est.observeSnapshot(op.tick, now);
            continue;
          }
          const server = est.serverTick(now);
          const stamp = est.targetTick(now);
          expect(Number.isInteger(stamp)).toBe(true);
          expect(stamp).toBeGreaterThanOrEqual(previous);
          expect(stamp).toBeGreaterThan(server);
          expect(stamp).toBeLessThanOrEqual(Math.max(previous, server + MAX_INPUT_LEAD_TICKS));
          previous = stamp;
        }
      }),
    );
  });
});
