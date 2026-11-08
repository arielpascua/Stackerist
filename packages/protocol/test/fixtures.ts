/**
 * Realistic engine states for the view and message tests, typed as the engine's own PlayerState.
 * The queue is longer than the preview and the bag is set, as on the server, so the tests can prove
 * the views cut both off.
 */
import type { BestMoment, PlayerState } from '@stackerist/engine';
import type { RoundReport, SeriesView } from '../src/index.js';

const EMPTY = '..........';

/** A T finishes rows 17 and 18 (its cells: three in row 17, one in row 18); row 19 is garbage. */
export const BEST_MOMENT: BestMoment = {
  board: [...Array<string>(17).fill(EMPTY), 'IIITTTJJJL', 'OOOOTSSZZL', 'GGGG.GGGGG'],
  clearedRows: [17, 18],
  pieceCells: [
    { x: 3, y: 17 },
    { x: 4, y: 17 },
    { x: 5, y: 17 },
    { x: 4, y: 18 },
  ],
  combo: 3,
  linesCleared: 2,
  attack: 2,
  sent: 1,
  cancelled: 1,
  tick: 96,
};

/** A mid-round server state: a 7-piece queue (preview is 5), a live bag and two pending attacks. */
export function sampleState(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    tick: 120,
    board: [...Array<string>(18).fill(EMPTY), 'GGGG.GGGGG', 'IIII.TTTOO'],
    active: { kind: 'T', rotation: 0, x: 3, y: 0 },
    queue: ['I', 'O', 'S', 'Z', 'J', 'L', 'T'],
    bag: { rng: 0xdeadbeef, remaining: ['L', 'J'] },
    pendingGarbage: [
      { rows: 2, holeColumn: 4 },
      { rows: 1, holeColumn: 7 },
    ],
    softDrop: false,
    gravityCounter: 12,
    lockCounter: 3,
    lockResets: 1,
    lowestY: 0,
    combo: 2,
    bestCombo: 3,
    linesCleared: 9,
    garbageSent: 4,
    garbageCancelled: 1,
    garbageReceived: 5,
    garbageInserted: 2,
    piecesPlaced: 31,
    bestMoment: BEST_MOMENT,
    toppedOut: false,
    ...overrides,
  };
}

export const SAMPLE_REPORT: RoundReport = {
  piecesPlaced: 31,
  actions: 112,
  garbageSent: 4,
  garbageReceived: 5,
  garbageCancelled: 1,
  durationTicks: 3600,
  heightSamples: [0, 1, 3, 2, 4, 6, 5],
};

export const SERIES_IN_PROGRESS: SeriesView = {
  round: 2,
  replay: false,
  score: { A: 1, B: 0 },
  over: false,
  winner: null,
  endReason: null,
  rounds: [{ round: 1, replay: false, winner: 'A', reason: 'TOP_OUT', durationTicks: 3600 }],
};
