/**
 * REQ-087: what the server really puts in a snapshot's `events`. Two clearing hard drops by the same
 * seat in one tick are two attack events with the same kind, seat, tick and rows: the client must be able
 * to play both.
 */
import { createPlayerState, pieceCells } from '@stackerist/engine';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../src/config.js';
import { Match } from '../src/match.js';

describe('REQ-087 snapshot events from the server', () => {
  it('REQ-087 two clearing hard drops drained in one tick give two identical attack events, each sent once', () => {
    const match = new Match({
      seeds: { pieceSeed: 12345, holeSeed: 678 },
      startTick: 0,
      holeRng: () => 3,
      limits: { ...DEFAULT_LIMITS, inputBurst: 1000 },
      nowMs: 0,
    });
    // An O dropped at columns 8-9 clears rows 18-19 (a double, combo 1: attack 1). The stack above it then
    // falls two rows; the next O at 8-9 clears one row (a single, combo 2: 0 + 1 bonus = attack 1 again).
    const rows = ['GGGGGGG...', 'GGGGGGGG..', 'GGGGGGGG..', 'GGGGGGGG..'];
    const board = Array.from({ length: 20 }, (_, y) => rows[y - 16] ?? '..........');
    const spawn = createPlayerState({ board, queue: ['O', 'O', 'O', 'O'], tick: 0 });
    if (spawn.active === null) throw new Error('no active piece');
    const shift = 8 - Math.min(...pieceCells(spawn.active).map((cell) => cell.x));
    match.states.A = spawn;
    let seq = 0;
    const send = (type: 'hardDrop' | 'moveRight'): void => {
      seq += 1;
      expect(match.receiveInput('A', { seq, tick: 0, action: { type } }, 0)).toBe('accepted');
    };
    for (let i = 0; i < shift; i += 1) send('moveRight');
    send('hardDrop');
    for (let i = 0; i < shift; i += 1) send('moveRight');
    send('hardDrop');
    match.step();
    const events = match.takeSnapshotEvents();
    expect(events).toEqual([
      { type: 'attack', from: 'A', rows: 1, tick: 0 },
      { type: 'attack', from: 'A', rows: 1, tick: 0 },
    ]);
    // Nothing is ever repeated into the next snapshot.
    expect(match.takeSnapshotEvents()).toEqual([]);
  });
});
