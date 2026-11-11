import { ghostPosition, pieceCells, parseBoard } from '@stackerist/engine';
import type { SnapshotEvent } from '@stackerist/protocol';
import { describe, expect, it } from 'vitest';
import { danger } from '../../../../design/tokens/tokens.ts';
import { isDanger } from '../../src/game/frame.ts';
import { EMPTY, oppState, ownState, rig, snapshot } from './storeRig.ts';

const attack = (from: 'A' | 'B', rows: number, tick: number): SnapshotEvent => ({
  type: 'attack',
  from,
  rows,
  tick,
});
const cancel = (seat: 'A' | 'B', rows: number, tick: number): SnapshotEvent => ({
  type: 'cancel',
  seat,
  rows,
  tick,
});

describe('REQ-087 each attack and cancel event in a snapshot plays', () => {
  it('REQ-087 the store emits one projectile and one burst per event, sides from the viewer', () => {
    const r = rig('A');
    const goAt = r.startRound();
    r.timers.now = goAt;
    const events = [attack('A', 3, 100), attack('B', 2, 101), cancel('A', 1, 102)];
    r.receive(snapshot(100, ownState(), oppState(), { events }));
    const fx = r.frame().fx;
    expect(fx.filter((e) => e.kind === 'projectile')).toEqual([
      { kind: 'projectile', from: 'left', rows: 3, originRow: null },
      { kind: 'projectile', from: 'right', rows: 2, originRow: null },
    ]);
    expect(fx.filter((e) => e.kind === 'burst')).toEqual([
      { kind: 'burst', side: 'left', rows: 1 },
    ]);
  });

  it('REQ-087 two equal attacks from one tick (two clearing hard drops) both fly and both count in the chain', () => {
    const r = rig('A');
    const goAt = r.startRound();
    r.timers.now = goAt;
    // The server really emits this pair (apps/server/test/snapshotEvents.test.ts).
    const events = [attack('A', 1, 100), attack('A', 1, 100)];
    r.receive(snapshot(100, ownState(), oppState(), { events }));
    const frame = r.frame();
    expect(frame.fx.filter((e) => e.kind === 'projectile')).toHaveLength(2);
    expect(frame.left?.chain).toEqual({ sent: 2, cancelled: 0 });
  });

  it('REQ-087 spectators see A on the left: an attack from B flies from the right board', () => {
    const r = rig('spectator');
    r.startRound();
    r.receive(snapshot(100, ownState(), oppState(), { events: [attack('B', 2, 100)] }));
    expect(r.frame().fx).toContainEqual({
      kind: 'projectile',
      from: 'right',
      rows: 2,
      originRow: null,
    });
  });

  it('REQ-087 an attack in flight never delays input: keys still reach the server that frame', () => {
    const r = rig('A');
    const goAt = r.startRound();
    r.timers.now = goAt;
    r.receive(snapshot(100, ownState(), oppState(), { events: [attack('B', 4, 100)] }));
    const frame = r.frame();
    expect(frame.inputLive).toBe(true);
    expect(frame.fx.some((e) => e.kind === 'projectile')).toBe(true);
    r.store.input.keyDown('ArrowLeft', false);
    expect(r.sent.filter((m) => m.type === 'input')).toHaveLength(1);
  });
});

describe('REQ-061 the ghost comes from the engine, on the own board only', () => {
  it('REQ-061 the own board model carries ghostPosition of the displayed state', () => {
    const r = rig('A');
    const goAt = r.startRound();
    r.timers.now = goAt;
    const left = r.frame().left;
    expect(left?.active).not.toBeNull();
    expect(left?.ghost).not.toBeNull();
    const ghost = left?.ghost;
    if (ghost === null || ghost === undefined) throw new Error('no ghost');
    // The I piece drops into the 4-wide gap of the bottom row.
    expect(pieceCells(ghost).every(({ y }) => y === 19)).toBe(true);
    const state = { ...ownState(), active: left?.active ?? null };
    expect(ghost).toEqual(ghostPosition(state));
  });

  it('REQ-061 the opponent board never has a ghost', () => {
    const r = rig('A');
    r.startRound();
    expect(r.frame().right?.ghost).toBeNull();
  });
});

describe('REQ-088 danger: stack height + pending garbage', () => {
  const stack = (rows: number) =>
    parseBoard([
      ...Array<string>(20 - rows).fill(EMPTY),
      ...Array<string>(rows).fill('GGGGGGGG..'),
    ]);

  it('REQ-088 the threshold is the token (16 rows) and the test is >=', () => {
    expect(danger.rows).toBe(16);
    expect(isDanger(stack(14), 1)).toBe(false);
    expect(isDanger(stack(14), 2)).toBe(true);
    expect(isDanger(stack(15), 1)).toBe(true);
    expect(isDanger(stack(16), 0)).toBe(true);
    expect(isDanger(stack(15), 0)).toBe(false);
  });

  it('REQ-088 an empty board with 16 pending rows is in danger', () => {
    expect(isDanger(stack(0), 16)).toBe(true);
  });

  it("REQ-088 the opponent's danger uses the PublicView pending total", () => {
    const r = rig('A');
    r.startRound();
    const opp = oppState(100, {
      board: stack(14),
      pendingGarbage: [
        { rows: 1, holeColumn: 2 },
        { rows: 1, holeColumn: 5 },
      ],
    });
    r.receive(snapshot(100, ownState(), opp));
    const right = r.frame().right;
    expect(right?.pendingGarbage).toBe(2);
    expect(right?.danger).toBe(true);
    expect(r.frame().left?.danger).toBe(false);
  });

  it('REQ-088 the own danger flag uses the displayed board plus its pending rows', () => {
    const r = rig('A');
    r.startRound();
    const own = {
      ...ownState(),
      board: stack(15),
      pendingGarbage: [{ rows: 1, holeColumn: 0 }],
    };
    r.receive(snapshot(100, own));
    expect(r.frame().left?.danger).toBe(true);
  });
});
