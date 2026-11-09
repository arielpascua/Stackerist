/**
 * Wire-shaped fixtures for UI tests and the visual harness. Every value has the protocol's shape
 * (the helpers return the protocol's own types), so a schema change breaks these at compile time.
 */
import type {
  GameOverMessage,
  LiveStats,
  PlayerStats,
  RoomMessage,
  RoundReport,
  SeriesView,
  WireBestMoment,
} from '@stackerist/protocol';
import type { ClientState } from '../../src/game/contract.ts';

const E = '..........';

/** A best moment: a Triple with a T finisher, cleared rows 16–18. */
export function makeMoment(overrides: Partial<WireBestMoment> = {}): WireBestMoment {
  return {
    board: [
      E,
      E,
      E,
      E,
      E,
      E,
      E,
      E,
      E,
      E,
      E,
      E,
      E,
      '.....SS...',
      'J...SS..L.',
      'JJJ.ZZ.LLI',
      'TTOOZZJLLI',
      'ZTOOJJJLLI',
      'TZZSSOOLLI',
      'GGGG.GGGGG',
    ],
    clearedRows: [16, 17, 18],
    pieceCells: [
      { x: 9, y: 15 },
      { x: 9, y: 16 },
      { x: 9, y: 17 },
      { x: 9, y: 18 },
    ],
    combo: 6,
    linesCleared: 3,
    attack: 6,
    sent: 5,
    cancelled: 1,
    tick: 15120,
    ...overrides,
  };
}

export function makeStats(overrides: Partial<PlayerStats> = {}): PlayerStats {
  return {
    linesCleared: 48,
    garbageSent: 29,
    garbageCancelled: 7,
    piecesPlaced: 131,
    bestCombo: 6,
    bestMoment: makeMoment(),
    ...overrides,
  };
}

export function makeReport(overrides: Partial<RoundReport> = {}): RoundReport {
  return {
    piecesPlaced: 131,
    actions: 420,
    garbageSent: 29,
    garbageReceived: 14,
    garbageCancelled: 7,
    durationTicks: 17460,
    heightSamples: [0, 2, 4, 6],
    ...overrides,
  };
}

export function makeSeries(overrides: Partial<SeriesView> = {}): SeriesView {
  return {
    round: 1,
    replay: false,
    score: { A: 0, B: 0 },
    over: false,
    winner: null,
    endReason: null,
    rounds: [],
    ...overrides,
  };
}

/** Round 1 won by seat A: B topped out at 04:51 (17460 ticks). */
export function makeGameOver(overrides: Partial<GameOverMessage> = {}): GameOverMessage {
  return {
    type: 'gameOver',
    round: 1,
    replay: false,
    winner: 'A',
    reason: 'TOP_OUT',
    tick: 17460,
    series: makeSeries({
      score: { A: 1, B: 0 },
      rounds: [{ round: 1, replay: false, winner: 'A', reason: 'TOP_OUT', durationTicks: 17460 }],
    }),
    stats: {
      A: makeStats(),
      B: makeStats({
        linesCleared: 31,
        garbageSent: 14,
        garbageCancelled: 3,
        piecesPlaced: 124,
        bestCombo: 3,
        bestMoment: makeMoment({ combo: 3, linesCleared: 2, sent: 2, cancelled: 0 }),
      }),
    },
    report: {
      A: makeReport(),
      B: makeReport({ garbageReceived: 29, garbageSent: 14, garbageCancelled: 3 }),
    },
    ...overrides,
  };
}

export function makeRoom(overrides: Partial<RoomMessage> = {}): RoomMessage {
  return {
    type: 'room',
    code: 'K7QM4X',
    status: 'waiting',
    players: { A: { name: 'Ariel', connected: true } },
    spectators: 0,
    series: makeSeries(),
    ...overrides,
  };
}

export const ZERO_STATS: LiveStats = {
  linesCleared: 0,
  garbageSent: 0,
  garbageCancelled: 0,
  garbageReceived: 0,
  garbageInserted: 0,
  piecesPlaced: 0,
  bestCombo: 0,
};

export function makeClientState(overrides: Partial<ClientState> = {}): ClientState {
  return {
    connection: 'open',
    closedBy: null,
    code: null,
    role: null,
    room: null,
    countdown: null,
    paused: null,
    level: 0,
    roundStartTick: null,
    hud: { left: null, right: null },
    result: null,
    ready: { A: false, B: false },
    rttMs: null,
    error: null,
    ...overrides,
  };
}
