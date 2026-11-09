/**
 * Visual harness (dev server only, never bundled): `/test/ui/harness/gallery.html?s=<scenario>`
 * renders the real <App> against a scripted store, with CORE's real canvas renderer, so every screen
 * can be screenshotted without a live match. Used by the W2 rendered self-check.
 */
import '../../../src/styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../../src/App.tsx';
import type {
  BoardModel,
  ClientState,
  CoreServices,
  Music,
  MusicStatus,
} from '../../../src/game/contract.ts';
import { mountArena } from '../../../src/render/arena.ts';
import { drawBestMoment } from '../../../src/render/bestMoment.ts';
import type { DeviceServices } from '../../../src/ui/browser.ts';
import { KeyboardProof } from '../../../src/ui/device.ts';
import { createMemoryRouter } from '../../../src/ui/router.ts';
import {
  makeClientState,
  makeGameOver,
  makeReport,
  makeRoom,
  makeSeries,
  ZERO_STATS,
} from '../fixtures.ts';
import { FakeStore, type FrameScript } from './fakeStore.ts';

const E = '..........';
const OWN = [
  ...Array<string>(13).fill(E),
  '...T..OO..',
  'J.TTT.OO..',
  'JJJSSZZLL.',
  'IZZSSTTLL.',
  'ITZZJJJOO.',
  'GGG.GGGGGG',
  'GGG.GGGGGG',
];
const OPP = [
  ...Array<string>(9).fill(E),
  '...S......',
  '..SS....JJ',
  'I.S..ZZ.J.',
  'I.LL..ZZJ.',
  'I..L.TTT..',
  'I..LOOT.SS',
  'GGGGGG.GGG',
  'GGGGGG.GGG',
  'GGGGGG.GGG',
  'GGGG.GGGGG',
  'GGGG.GGGGG',
];

function boardModel(seat: 'A' | 'B', own: boolean, combo: number): BoardModel {
  return {
    seat,
    board: own ? OWN : OPP,
    active: own ? { kind: 'I', rotation: 1, x: 7, y: 2 } : { kind: 'T', rotation: 0, x: 3, y: 0 },
    ghost: null,
    next: own ? ['T', 'S', 'O', 'L', 'Z'] : ['J'],
    pendingGarbage: own ? 3 : 0,
    combo,
    chain: own ? { sent: 2, cancelled: 1 } : { sent: 0, cancelled: 0 },
    danger: false,
    toppedOut: false,
  };
}

const PLAYERS = {
  A: { name: 'Ariel', connected: true },
  B: { name: 'Sam', connected: true },
};

const LIVE_HUD: ClientState['hud'] = {
  left: {
    seat: 'A',
    name: 'Ariel',
    connected: true,
    stats: { ...ZERO_STATS, linesCleared: 34, garbageSent: 21, piecesPlaced: 96 },
    pendingGarbage: 3,
  },
  right: {
    seat: 'B',
    name: 'Sam',
    connected: true,
    stats: { ...ZERO_STATS, linesCleared: 22, garbageSent: 9, piecesPlaced: 91 },
    pendingGarbage: 0,
  },
};

interface Scenario {
  readonly path: string;
  readonly state: ClientState;
  readonly script?: Partial<FrameScript>;
  readonly touchOnly?: boolean;
  readonly setup?: (store: FakeStore) => void;
}

const seatedGame = (overrides: Partial<ClientState>): ClientState =>
  makeClientState({
    code: 'K7QM4X',
    role: 'A',
    room: makeRoom({
      status: 'playing',
      players: PLAYERS,
      spectators: 2,
      series: makeSeries({ round: 2, score: { A: 1, B: 0 } }),
    }),
    level: 5,
    rttMs: 38,
    roundStartTick: 0,
    hud: LIVE_HUD,
    ...overrides,
  });

/** A believable stack-height trace: one sample per 30 ticks, climbing in waves to `peak` rows. */
function heights(samples: number, peak: number, phase: number): number[] {
  return Array.from({ length: samples }, (_, i) => {
    const wave = (Math.sin(i / 14 + phase) + 1) / 2;
    const climb = Math.min(1, i / (samples * 0.9));
    return Math.max(0, Math.min(20, Math.round((wave * 0.5 + climb * 0.5) * peak)));
  });
}

const REPORT_A = makeReport({ heightSamples: heights(582, 12, 0) });
const REPORT_B = makeReport({
  garbageReceived: 29,
  garbageSent: 14,
  garbageCancelled: 3,
  heightSamples: [...heights(581, 18, 1.4), 20],
});

const resultState = (role: 'A' | 'B' | 'spectator', winner: 'A' | 'B' | null) => {
  const result = makeGameOver({
    ...(winner === null ? { winner: null, reason: 'DRAW' as const } : { winner }),
    report: { A: REPORT_A, B: REPORT_B },
  });
  return seatedGame({
    role,
    room: makeRoom({
      status: 'roundOver',
      players: PLAYERS,
      series: result.series,
    }),
    result,
  });
};

/** Ariel took the series 2-1 over a drawn-and-replayed round 2. */
const SERIES_WON = makeSeries({
  round: 3,
  score: { A: 2, B: 1 },
  over: true,
  winner: 'A',
  endReason: 'TWO_WINS',
  rounds: [
    { round: 1, replay: false, winner: 'A', reason: 'TOP_OUT', durationTicks: 9000 },
    { round: 2, replay: false, winner: null, reason: 'DRAW', durationTicks: 4000 },
    { round: 2, replay: true, winner: 'B', reason: 'TOP_OUT', durationTicks: 7000 },
    { round: 3, replay: false, winner: 'A', reason: 'TOP_OUT', durationTicks: 17460 },
  ],
});

const seriesState = (role: 'A' | 'B' | 'spectator') => {
  const result = makeGameOver({
    round: 3,
    winner: 'A',
    series: SERIES_WON,
    report: { A: REPORT_A, B: REPORT_B },
  });
  return seatedGame({
    role,
    room: makeRoom({ status: 'seriesOver', players: PLAYERS, series: SERIES_WON }),
    result,
  });
};

const LEFT_OWN = { left: boardModel('A', true, 0), right: boardModel('B', false, 0) };

const SCENARIOS: Record<string, Scenario> = {
  home: { path: '/', state: makeClientState() },
  'home-join': { path: '/g/K7QM4X', state: makeClientState() },
  'home-errors': {
    path: '/',
    state: makeClientState(),
    setup: (store) => {
      store.onJoin = (code) => {
        store.patch({ error: { code: 'ROOM_NOT_FOUND', message: `no room ${code}` } });
      };
    },
  },
  'home-busy': {
    path: '/',
    state: makeClientState({ connection: 'open' }),
    setup: (store) => {
      store.onCreate = () => {
        window.setTimeout(() => {
          store.patch({ error: { code: 'SERVER_BUSY', message: 'busy' } });
        }, 1500);
      };
    },
  },
  keyboard: { path: '/g/K7QM4X', state: makeClientState(), touchOnly: true },
  lobby: {
    path: '/g/K7QM4X',
    state: makeClientState({ code: 'K7QM4X', role: 'A', room: makeRoom() }),
  },
  'lobby-full': {
    path: '/g/K7QM4X',
    state: makeClientState({
      code: 'K7QM4X',
      role: 'B',
      room: makeRoom({
        players: { A: { name: 'Bartholomew-The-Great', connected: false }, B: PLAYERS.B },
        spectators: 2,
        series: makeSeries({ round: 2, score: { A: 1, B: 0 } }),
      }),
    }),
  },
  'lobby-loading': {
    path: '/g/K7QM4X',
    state: makeClientState({ code: 'K7QM4X', role: 'A', room: null }),
  },
  game: {
    path: '/g/K7QM4X',
    state: seatedGame({}),
    script: { left: boardModel('A', true, 4), right: boardModel('B', false, 2), standoff: null },
  },
  countdown: {
    path: '/g/K7QM4X',
    state: seatedGame({ room: makeRoom({ status: 'countdown', players: PLAYERS }) }),
    script: { left: boardModel('A', true, 0), right: boardModel('B', false, 0), standoff: '3' },
  },
  duel: {
    path: '/g/K7QM4X',
    state: seatedGame({}),
    script: { left: boardModel('A', true, 0), right: boardModel('B', false, 0), standoff: 'duel' },
  },
  disconnect: {
    path: '/g/K7QM4X',
    state: seatedGame({
      room: makeRoom({ status: 'paused', players: PLAYERS }),
      paused: { seat: 'B', graceEndsAtMs: performance.now() + 17_400, pausesLeft: 2 },
    }),
    script: { left: boardModel('A', true, 0), right: boardModel('B', false, 0), standoff: null },
  },
  'result-win': {
    path: '/g/K7QM4X',
    state: resultState('A', 'A'),
    script: { left: boardModel('A', true, 0), right: boardModel('B', false, 0), standoff: null },
  },
  'result-lose': {
    path: '/g/K7QM4X',
    state: resultState('B', 'A'),
    script: { left: boardModel('B', false, 0), right: boardModel('A', true, 0), standoff: null },
  },
  'result-draw': {
    path: '/g/K7QM4X',
    state: resultState('A', null),
    script: { left: boardModel('A', true, 0), right: boardModel('B', false, 0), standoff: null },
  },
  'result-spectator': {
    path: '/g/K7QM4X?watch=1',
    state: resultState('spectator', 'A'),
    script: { left: boardModel('A', true, 0), right: boardModel('B', false, 0), standoff: null },
  },
  'result-short': {
    path: '/g/K7QM4X',
    state: seatedGame({
      role: 'A',
      room: makeRoom({ status: 'roundOver', players: PLAYERS, series: makeGameOver().series }),
      result: makeGameOver({
        report: {
          A: makeReport({ heightSamples: [0], durationTicks: 30 }),
          B: makeReport({ heightSamples: [], durationTicks: 30 }),
        },
      }),
    }),
    script: { ...LEFT_OWN, standoff: null },
  },
  'result-waiting': {
    path: '/g/K7QM4X',
    state: { ...resultState('A', 'A'), ready: { A: true, B: false } },
    script: { ...LEFT_OWN, standoff: null },
  },
  'series-win': {
    path: '/g/K7QM4X',
    state: seriesState('A'),
    script: { ...LEFT_OWN, standoff: null },
  },
  'series-lose': {
    path: '/g/K7QM4X',
    state: seriesState('B'),
    script: { left: boardModel('B', true, 0), right: boardModel('A', false, 0), standoff: null },
  },
  'series-spectator': {
    path: '/g/K7QM4X?watch=1',
    state: seriesState('spectator'),
    script: { ...LEFT_OWN, standoff: null },
  },
  'series-forfeit': {
    path: '/g/K7QM4X',
    state: seatedGame({
      role: 'A',
      room: makeRoom({
        status: 'seriesOver',
        players: { A: PLAYERS.A },
        series: makeSeries({
          round: 2,
          score: { A: 1, B: 0 },
          over: true,
          winner: 'A',
          endReason: 'OPPONENT_LEFT',
          rounds: [
            { round: 1, replay: false, winner: 'A', reason: 'TOP_OUT', durationTicks: 9000 },
          ],
        }),
      }),
    }),
    script: { ...LEFT_OWN, standoff: null },
  },
  standoff: {
    path: '/g/K7QM4X',
    state: seatedGame({
      room: makeRoom({
        status: 'countdown',
        players: PLAYERS,
        series: makeSeries({ round: 2, score: { A: 1, B: 0 } }),
      }),
    }),
    script: { ...LEFT_OWN, standoff: '2' },
  },
  'standoff-spectator': {
    path: '/g/K7QM4X?watch=1',
    state: seatedGame({
      role: 'spectator',
      room: makeRoom({
        status: 'countdown',
        players: PLAYERS,
        series: makeSeries({ round: 2, replay: true, score: { A: 1, B: 1 } }),
      }),
    }),
    script: { ...LEFT_OWN, standoff: '3' },
  },
  'standoff-duel': {
    path: '/g/K7QM4X',
    state: seatedGame({}),
    script: { ...LEFT_OWN, standoff: 'duel' },
  },
  'spectator-game': {
    path: '/g/K7QM4X?watch=1',
    state: seatedGame({ role: 'spectator', hud: LIVE_HUD }),
    script: { left: boardModel('A', true, 2), right: boardModel('B', false, 0), standoff: null },
  },
  fatal: { path: '/', state: makeClientState({ connection: 'closed', closedBy: 'REPLACED' }) },
  banner: {
    path: '/',
    state: makeClientState({ connection: 'open' }),
    setup: (store) => {
      window.setTimeout(() => {
        store.patch({ connection: 'closed' });
      }, 50);
    },
  },
};

const noop = () => undefined;
const musicParam = new URLSearchParams(window.location.search).get('m');
const musicStatus: MusicStatus =
  musicParam === 'off' || musicParam === 'blocked' || musicParam === 'unavailable'
    ? musicParam
    : 'on';
const music: Music = {
  unlock: noop,
  start: noop,
  setLevel: noop,
  stop: noop,
  status: () => musicStatus,
  preference: () => (musicStatus === 'off' ? 'off' : 'on'),
  lastToggleSource: () => null,
  toggle: noop,
  subscribe: () => noop,
};

const name = new URLSearchParams(window.location.search).get('s') ?? 'home';
const scenario = SCENARIOS[name] ?? SCENARIOS.home;
if (scenario === undefined) throw new Error('no scenarios');

const store = new FakeStore(scenario.state, {
  left: null,
  right: null,
  standoff: null,
  ...scenario.script,
});
scenario.setup?.(store);

const services: CoreServices = { store, mountArena, drawBestMoment, music };
const device: DeviceServices = {
  touchOnly: () => scenario.touchOnly === true,
  keyboard: new KeyboardProof(),
  apple: false,
  origin: 'https://stackerist.up.railway.app',
  copyText: (text) => navigator.clipboard.writeText(text),
  reload: noop,
};

const container = document.getElementById('root');
if (container === null) throw new Error('Missing #root element');
createRoot(container).render(
  <StrictMode>
    <App services={services} router={createMemoryRouter(scenario.path)} device={device} />
  </StrictMode>,
);
