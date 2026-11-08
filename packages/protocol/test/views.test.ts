import { PREVIEW_COUNT, type PlayerState } from '@stackerist/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  OwnViewSchema,
  PUBLIC_PREVIEW_COUNT,
  PlayerStatsSchema,
  PublicViewSchema,
  WireBestMomentSchema,
  ownViewToPlayerState,
  parseServerMessage,
  toOwnView,
  toPlayerStats,
  toPublicView,
  toWireBestMoment,
  type SnapshotMessage,
} from '../src/index.js';
import { deepFreeze, deepKeys, playerStateArb } from './arbitraries.js';
import { BEST_MOMENT, sampleState } from './fixtures.js';

/** Keys that would leak hidden state: the bag, its RNG, the queue itself, any seed. */
const HIDDEN_KEYS = ['bag', 'rng', 'remaining', 'queue', 'seed', 'pieceSeed', 'holeSeed'];

function snapshotFor(state: PlayerState, you: boolean): SnapshotMessage {
  return {
    type: 'snapshot',
    tick: state.tick,
    level: 0,
    ...(you ? { you: toOwnView(state, 3) } : {}),
    players: { A: toPublicView(state), B: toPublicView(state) },
    events: [],
  };
}

describe('REQ-028 information hiding in the views', () => {
  it('REQ-028 an opponent or spectator sees the next 1 piece; the owner sees the next 5', () => {
    const state = deepFreeze(sampleState());
    expect(state.queue).toHaveLength(7);
    expect(toPublicView(state).next).toEqual(['I']);
    expect(toOwnView(state, 0).next).toEqual(['I', 'O', 'S', 'Z', 'J']);
    expect(PUBLIC_PREVIEW_COUNT).toBe(1);
    expect(PREVIEW_COUNT).toBe(5);
  });

  it('REQ-028 for any state, view.next is exactly the visible slice of the queue', () => {
    fc.assert(
      fc.property(playerStateArb, (state) => {
        const pub = toPublicView(state);
        const own = toOwnView(state, 0);
        expect(pub.next).toEqual(state.queue.slice(0, 1));
        expect(own.next).toEqual(state.queue.slice(0, PREVIEW_COUNT));
        expect(pub.next.length).toBeLessThanOrEqual(1);
        expect(own.next.length).toBeLessThanOrEqual(PREVIEW_COUNT);
      }),
    );
  });

  it('REQ-028 no view can reach the bag, the further queue or a seed', () => {
    fc.assert(
      fc.property(playerStateArb, fc.nat(), (state, ack) => {
        for (const view of [toPublicView(state), toOwnView(state, ack), toPlayerStats(state)]) {
          const keys = deepKeys(JSON.parse(JSON.stringify(view)));
          for (const hidden of HIDDEN_KEYS) {
            expect(keys.has(hidden), hidden).toBe(false);
          }
        }
      }),
    );
  });

  it('REQ-028 the opponent view shows the pending total only, never the hole columns', () => {
    const view = toPublicView(sampleState());
    expect(view.pendingGarbage).toBe(3);
    expect(deepKeys(view).has('holeColumn')).toBe(false);
    const own = toOwnView(sampleState(), 0);
    expect(own.pendingGarbage).toEqual([
      { rows: 2, holeColumn: 4 },
      { rows: 1, holeColumn: 7 },
    ]);
  });

  it('REQ-028 every view passes its strict schema (exact keys, nothing extra)', () => {
    fc.assert(
      fc.property(playerStateArb, fc.integer({ min: 0, max: 2 ** 31 - 1 }), (state, ack) => {
        const pub = toPublicView(state);
        const own = toOwnView(state, ack);
        expect(PublicViewSchema.parse(pub)).toEqual(pub);
        expect(OwnViewSchema.parse(own)).toEqual(own);
        expect(Object.keys(pub).sort()).toEqual(Object.keys(PublicViewSchema.shape).sort());
        expect(Object.keys(own).sort()).toEqual(Object.keys(OwnViewSchema.shape).sort());
        expect(PlayerStatsSchema.parse(toPlayerStats(state))).toEqual(toPlayerStats(state));
      }),
    );
  });

  it('REQ-028 snapshots built from the views parse; a leaked seed, bag or queue does not', () => {
    const state = sampleState();
    const owner = snapshotFor(state, true);
    const watcher = snapshotFor(state, false);
    expect(parseServerMessage(JSON.stringify(owner))).toEqual(owner);
    expect(parseServerMessage(JSON.stringify(watcher))).toEqual(watcher);
    const you = toOwnView(state, 3);
    const pub = toPublicView(state);
    const leaks: unknown[] = [
      { ...owner, seed: 12345 },
      { ...owner, you: { ...you, bag: state.bag } },
      { ...owner, you: { ...you, queue: state.queue } },
      { ...owner, you: { ...you, next: state.queue } },
      { ...watcher, players: { A: { ...pub, next: state.queue.slice(0, 2) } } },
      { ...watcher, players: { A: { ...pub, queue: state.queue } } },
      { ...watcher, players: { A: { ...pub, pendingGarbage: state.pendingGarbage } } },
      { ...watcher, players: { A: { ...pub, stats: { ...pub.stats, seed: 1 } } } },
      { ...watcher, players: { C: pub } },
    ];
    for (const leak of leaks) {
      expect(parseServerMessage(JSON.stringify(leak))).toBeNull();
    }
  });

  it('REQ-028 views copy: they never alias or write to the engine state', () => {
    const state = deepFreeze(sampleState());
    const own = toOwnView(state, 1);
    const pub = toPublicView(state);
    const stats = toPlayerStats(state);
    expect(own.board).not.toBe(state.board);
    expect(pub.board).not.toBe(state.board);
    expect(own.active).not.toBe(state.active);
    expect(own.pendingGarbage[0]).not.toBe(state.pendingGarbage[0]);
    expect(stats.bestMoment?.board).not.toBe(BEST_MOMENT.board);
    // The outputs are fresh, mutable wire objects; writing to them leaves the frozen state intact.
    own.board[0] = 'GGGGGGGGGG';
    own.next.push('T');
    pub.next.length = 0;
    expect(state.board[0]).toBe('..........');
    expect(state.queue).toHaveLength(7);
  });
});

describe('REQ-028 REQ-045 stats and best moment', () => {
  it('REQ-045 toPlayerStats carries the design §6 fields and the wire best moment', () => {
    const stats = toPlayerStats(sampleState());
    expect(stats).toEqual({
      linesCleared: 9,
      garbageSent: 4,
      garbageCancelled: 1,
      piecesPlaced: 31,
      bestCombo: 3,
      bestMoment: toWireBestMoment(BEST_MOMENT),
    });
    expect(toPlayerStats(sampleState({ bestMoment: null })).bestMoment).toBeNull();
  });

  it('REQ-045 toWireBestMoment copies every field and passes the strict schema', () => {
    const wire = toWireBestMoment(deepFreeze({ ...BEST_MOMENT }));
    expect(WireBestMomentSchema.parse(wire)).toEqual(wire);
    expect(wire).toEqual({
      board: [...BEST_MOMENT.board],
      clearedRows: [17, 18],
      pieceCells: BEST_MOMENT.pieceCells.map((c) => ({ x: c.x, y: c.y })),
      combo: 3,
      linesCleared: 2,
      attack: 2,
      sent: 1,
      cancelled: 1,
      tick: 96,
    });
  });
});

describe('REQ-028 the client rebuilds a predictable state from its own view', () => {
  it('REQ-028 ownViewToPlayerState: bag null, queue = next, bestMoment null, tick = snapshot tick', () => {
    fc.assert(
      fc.property(playerStateArb, fc.nat(), (state, ack) => {
        const rebuilt = ownViewToPlayerState(toOwnView(state, ack), state.tick);
        expect(rebuilt).toEqual({
          ...state,
          bag: null,
          queue: state.queue.slice(0, PREVIEW_COUNT),
          bestMoment: null,
        });
      }),
    );
  });

  it('REQ-028 the rebuilt state survives the wire: parse → rebuild → view is a fixed point', () => {
    fc.assert(
      fc.property(playerStateArb, (state) => {
        const sent = toOwnView(state, 9);
        const received = OwnViewSchema.parse(JSON.parse(JSON.stringify(sent)));
        const rebuilt = ownViewToPlayerState(received, state.tick);
        expect(toOwnView(rebuilt, 9)).toEqual(sent);
      }),
    );
  });
});
