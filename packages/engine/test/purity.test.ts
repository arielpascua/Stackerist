import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  cancelGarbage,
  createBag,
  createPlayerState,
  drawPiece,
  ghostPosition,
  insertGarbage,
  playerStats,
  receiveGarbage,
  removeRows,
  tick,
  writeCells,
  type ActionType,
  type PlayerState,
} from '../src/index.js';
import { boardOf, deepFreeze, dropAt, singleMachine, ticks, I_FLAT_RIGHT } from './helpers.js';

const ACTIONS: readonly ActionType[] = [
  'moveLeft',
  'moveRight',
  'rotateCW',
  'rotateCCW',
  'softDropStart',
  'softDropStop',
  'hardDrop',
];

/** States that exercise every branch an action or a tick can take. */
function fixtures(): Record<string, PlayerState> {
  const grounded = ticks(
    createPlayerState({ active: { kind: 'T', rotation: 0, x: 3, y: 18 }, bag: createBag(2) }),
    29,
    0,
  ).state; // the next tick locks
  return {
    fresh: createPlayerState({ bag: createBag(1) }),
    grounded,
    groundedWithGarbage: receiveGarbage(grounded, { rows: 2, holeColumn: 4 }),
    aboutToClear: {
      ...createPlayerState({
        board: boardOf('.GGGGGGGGG', '.GGGGGGGGG', '.GGGGGGGGG', '.GGGGGGGGG'),
        active: { kind: 'I', rotation: 1, x: -2, y: 16 }, // grounded; the next tick locks a four
        pendingGarbage: [{ rows: 1, holeColumn: 2 }],
        bag: createBag(3),
      }),
      lockCounter: 29,
      softDrop: true,
    },
    lastPreview: createPlayerState({ active: { kind: 'O', rotation: 0, x: 0, y: 18 }, queue: [] }),
  };
}

describe('REQ-063 source spec §8.1 — purity', () => {
  it('REQ-011 #31 applyAction never mutates its inputs (deep-frozen state and action)', () => {
    for (const [name, state] of Object.entries(fixtures())) {
      for (const type of ACTIONS) {
        const frozen = deepFreeze(state);
        const action = deepFreeze({ type });
        const snapshot = structuredClone(frozen);
        expect(() => applyAction(frozen, action), `${name} ${type}`).not.toThrow();
        expect(frozen, `${name} ${type}`).toEqual(snapshot);
      }
    }
  });

  it('REQ-011 #31 tick never mutates its input, including ticks that lock, clear, cancel and spawn', () => {
    for (const [name, state] of Object.entries(fixtures())) {
      for (const level of [0, 6, 12]) {
        const frozen = deepFreeze(state);
        const snapshot = structuredClone(frozen);
        const result = tick(frozen, level);
        expect(frozen, `${name} @${String(level)}`).toEqual(snapshot);
        expect(result.state).not.toBe(frozen);
      }
    }
  });

  it('REQ-011 the other state functions never mutate their inputs either', () => {
    const state = deepFreeze(
      createPlayerState({ pendingGarbage: [{ rows: 2, holeColumn: 1 }], bag: createBag(4) }),
    );
    const snapshot = structuredClone(state);
    receiveGarbage(state, deepFreeze({ rows: 1, holeColumn: 0 }));
    ghostPosition(state);
    playerStats(state);
    cancelGarbage(state.pendingGarbage, 1);
    drawPiece(deepFreeze(createBag(9)));
    insertGarbage(state.board, 3, 2);
    writeCells(state.board, deepFreeze([{ x: 0, y: 19 }]), 'G');
    removeRows(state.board, deepFreeze([19]));
    expect(state).toEqual(snapshot);
  });

  it('REQ-011 engine sources use no wall clock, no Math.random, no timers, no process/crypto and no Node built-ins', () => {
    const dir = fileURLToPath(new URL('../src/', import.meta.url));
    const files = readdirSync(dir).filter((file) => file.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(10);
    const banned = [
      /Math\.random/,
      /\bDate\b/,
      /\bperformance\b/,
      /\bsetTimeout\b/,
      /\bsetInterval\b/,
      /\bsetImmediate\b/,
      /\bprocess\.\w/, // process.env, process.exit… (prose such as "will process." is fine)
      /\bcrypto\.\w/,
      /from ['"]node:/,
      /\brequire\(/,
    ];
    for (const file of files) {
      const source = readFileSync(`${dir}${file}`, 'utf8');
      for (const pattern of banned)
        expect(source, `${file} ${String(pattern)}`).not.toMatch(pattern);
    }
  });

  it('REQ-011 game state holds integers only (no floats), after locks, clears, cancels and garbage', () => {
    let state = createPlayerState({ board: boardOf(...singleMachine(3)), bag: createBag(6) });
    state = receiveGarbage(state, { rows: 3, holeColumn: 5 });
    state = dropAt(state, I_FLAT_RIGHT).state;
    state = dropAt(state, I_FLAT_RIGHT).state;
    state = ticks(state, 500, 7).state;
    const numbers: number[] = [];
    const collect = (node: unknown): void => {
      if (typeof node === 'number') numbers.push(node);
      else if (typeof node === 'object' && node !== null) Object.values(node).forEach(collect);
    };
    collect(state);
    expect(numbers.length).toBeGreaterThan(20);
    for (const value of numbers) expect(Number.isInteger(value), String(value)).toBe(true);
  });
});
