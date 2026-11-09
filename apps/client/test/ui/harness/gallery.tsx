/**
 * Visual harness (dev server only, never bundled): `/test/ui/harness/gallery.html?s=<scenario>`
 * renders the real <App> against a scripted store, with CORE's real canvas renderer, so every screen
 * can be screenshotted without a live match. Used by the W2 rendered self-check.
 */
import '../../../src/styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../../src/App.tsx';
import type { BoardModel, ClientState, CoreServices, Music } from '../../../src/game/contract.ts';
import { mountArena } from '../../../src/render/arena.ts';
import { drawBestMoment } from '../../../src/render/bestMoment.ts';
import type { DeviceServices } from '../../../src/ui/browser.ts';
import { KeyboardProof } from '../../../src/ui/device.ts';
import { createMemoryRouter } from '../../../src/ui/router.ts';
import { makeClientState, makeGameOver, makeRoom, makeSeries, ZERO_STATS } from '../fixtures.ts';
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

const resultState = (role: 'A' | 'B' | 'spectator', winner: 'A' | 'B' | null) => {
  const result = makeGameOver(winner === null ? { winner: null, reason: 'DRAW' } : { winner });
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
const music: Music = {
  unlock: noop,
  start: noop,
  setLevel: noop,
  stop: noop,
  status: () => 'off',
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
