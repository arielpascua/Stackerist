/** A `CoreStore` wired to hand-driven doubles, for the W4 feature tests (a trimmed copy of store.test.ts's rig). */
import { createPlayerState, parseBoard, type PlayerState } from '@stackerist/engine';
import {
  Predictor,
  TickEstimator,
  toOwnView,
  toPublicView,
  type ClientMessage,
  type ServerMessage,
  type SnapshotMessage,
} from '@stackerist/protocol';
import type { FrameModel } from '../../src/game/contract.ts';
import { CoreStore } from '../../src/game/store.ts';
import type { GameSocketEvents } from '../../src/net/socket.ts';
import { ManualTimers, MemoryStorage, TOKEN } from './helpers.ts';

export const CODE = 'K7QM4X';
export const SERVER_NOW = 1_700_000_000_000;
export const EMPTY = '..........';

export function room(status: 'countdown' | 'playing'): ServerMessage {
  return {
    type: 'room',
    code: CODE,
    status,
    players: { A: { name: 'Ariel', connected: true }, B: { name: 'Sam', connected: true } },
    spectators: 0,
    series: {
      round: 1,
      replay: false,
      score: { A: 0, B: 0 },
      over: false,
      winner: null,
      endReason: null,
      rounds: [],
    },
  };
}

/** Own state: I spawns over a bottom row with a 4-wide gap, so a hard drop lands in row 19. */
export function ownState(tick = 0): PlayerState {
  return createPlayerState({
    tick,
    board: parseBoard([...Array<string>(19).fill(EMPTY), 'GGG....GGG']),
    queue: ['I', 'T', 'O', 'S', 'Z', 'J'],
  });
}

export function oppState(
  tick = 0,
  options: Parameters<typeof createPlayerState>[0] = {},
): PlayerState {
  return createPlayerState({ tick, queue: ['T', 'O', 'S', 'Z', 'J', 'L'], ...options });
}

export function snapshot(
  tick: number,
  own: PlayerState,
  opp: PlayerState = oppState(tick),
  extra: Partial<SnapshotMessage> = {},
): SnapshotMessage {
  return {
    type: 'snapshot',
    tick,
    level: 0,
    you: toOwnView(own, 0),
    players: { A: toPublicView(own), B: toPublicView(opp) },
    events: [],
    ...extra,
  };
}

export function rig(role: 'A' | 'spectator' = 'A') {
  const timers = new ManualTimers();
  const sent: ClientMessage[] = [];
  let socket: GameSocketEvents | null = null;
  const store = new CoreStore({
    createTransport: (events) => {
      socket = events;
      return {
        connect: () => undefined,
        send: (msg) => {
          sent.push(msg);
          return true;
        },
        close: () => undefined,
      };
    },
    storage: new MemoryStorage(),
    predictor: new Predictor(),
    estimator: new TickEstimator(),
    timers,
    now: () => timers.now,
  });
  const events = (): GameSocketEvents => {
    if (socket === null) throw new Error('no transport');
    return socket;
  };
  const receive = (msg: ServerMessage): void => {
    events().onMessage(msg);
  };
  const frame = (reduced = false): FrameModel => store.computeFrame(timers.now, reduced);
  /** Bound, opened, a countdown at local time 0 (goAt = 2950): the round is live from `goAt`. */
  const startRound = (): number => {
    events().onStatus('open', null);
    events().onOpen();
    receive(
      role === 'A'
        ? { type: 'created', code: CODE, token: TOKEN, seat: 'A' }
        : { type: 'joined', code: CODE, seat: 'spectator' },
    );
    receive(room('countdown'));
    receive(snapshot(0, ownState()));
    receive({ type: 'countdown', startsAt: SERVER_NOW + 3000, serverNow: SERVER_NOW, tick: 0 });
    const goAt = store.getState().countdown?.goAtMs;
    if (goAt === undefined) throw new Error('no countdown');
    return goAt;
  };
  return { timers, sent, store, receive, frame, startRound };
}
