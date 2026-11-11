import { createPlayerState, parseBoard, type PlayerState } from '@stackerist/engine';
import {
  ErrorCodeSchema,
  RECOVERABLE_CLOSE_CODES,
  Predictor,
  TICK_MS,
  TickEstimator,
  tokenStorageKey,
  toOwnView,
  toPublicView,
  type ClientMessage,
  type ServerMessage,
  type SnapshotMessage,
} from '@stackerist/protocol';
import { describe, expect, it } from 'vitest';
import type { FrameModel } from '../../src/game/contract.ts';
import { frameDriverOf } from '../../src/game/driver.ts';
import type { GameSocketEvents } from '../../src/net/socket.ts';
import { CoreStore } from '../../src/game/store.ts';
import { ManualTimers, MemoryStorage, TOKEN } from './helpers.ts';

const CODE = 'K7QM4X';
const CODES = ErrorCodeSchema.enum;
const SERVER_NOW = 1_700_000_000_000;
const EMPTY = '..........';

function room(status: 'waiting' | 'countdown' | 'playing' | 'paused'): ServerMessage {
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

/** Own state: I spawns over a bottom row with a 4-wide gap, so a hard drop clears row 19. */
function ownState(tick = 0): PlayerState {
  return createPlayerState({
    tick,
    board: parseBoard([...Array<string>(19).fill(EMPTY), 'GGG....GGG']),
    queue: ['I', 'T', 'O', 'S', 'Z', 'J'],
  });
}

function oppState(tick = 0): PlayerState {
  return createPlayerState({ tick, queue: ['T', 'O', 'S', 'Z', 'J', 'L'] });
}

function snapshot(
  tick: number,
  own: PlayerState,
  lastAckSeq = 0,
  extra: Partial<SnapshotMessage> = {},
): SnapshotMessage {
  return {
    type: 'snapshot',
    tick,
    level: 0,
    you: toOwnView(own, lastAckSeq),
    players: { A: toPublicView(own), B: toPublicView(oppState(tick)) },
    events: [],
    ...extra,
  };
}

function rig(storage = new MemoryStorage()) {
  const timers = new ManualTimers();
  const sent: ClientMessage[] = [];
  const logs: string[] = [];
  let socket: GameSocketEvents | null = null;
  let open = false;
  let connects = 0;
  const predictor = new Predictor();
  const estimator = new TickEstimator();
  const store = new CoreStore({
    createTransport: (events) => {
      socket = events;
      return {
        connect: () => {
          connects += 1;
        },
        send: (msg) => {
          if (!open) return false;
          sent.push(msg);
          return true;
        },
        close: () => {
          open = false;
        },
      };
    },
    storage,
    predictor,
    estimator,
    timers,
    now: () => timers.now,
    log: (message) => logs.push(message),
  });
  const events = (): GameSocketEvents => {
    if (socket === null) throw new Error('no transport');
    return socket;
  };
  const openSocket = (): void => {
    open = true;
    events().onStatus('open', null);
    events().onOpen();
  };
  const drop = (code?: number): void => {
    open = false;
    if (code !== undefined) events().onDropped?.(code);
    events().onStatus('reconnecting', null);
  };
  const closeSocket = (): void => {
    open = false;
    events().onStatus('closed', null);
  };
  const receive = (msg: ServerMessage): void => {
    events().onMessage(msg);
  };
  const frame = (reduced = false): FrameModel => store.computeFrame(timers.now, reduced);
  const inputs = () => sent.filter((msg) => msg.type === 'input');
  /** created → room → initial snapshot → countdown, received at local time 0 (goAt = 2950). */
  const startRound = (): number => {
    openSocket();
    receive({ type: 'created', code: CODE, token: TOKEN, seat: 'A' });
    receive(room('countdown'));
    receive(snapshot(0, ownState()));
    receive({ type: 'countdown', startsAt: SERVER_NOW + 3000, serverNow: SERVER_NOW, tick: 0 });
    const goAt = store.getState().countdown?.goAtMs;
    if (goAt === undefined) throw new Error('no countdown');
    return goAt;
  };
  return {
    timers,
    sent,
    logs,
    store,
    storage,
    predictor,
    estimator,
    openSocket,
    drop,
    closeSocket,
    receive,
    frame,
    inputs,
    startRound,
    connects: () => connects,
  };
}

describe('REQ-021 session: token storage and automatic rejoin', () => {
  it('REQ-021 created/joined store the seat token under token:<CODE>', () => {
    const r = rig();
    r.openSocket();
    r.receive({ type: 'created', code: CODE, token: TOKEN, seat: 'A' });
    expect(r.storage.map.get(tokenStorageKey(CODE))).toBe(TOKEN);
    expect(r.store.getState()).toMatchObject({ code: CODE, role: 'A' });
  });

  it('REQ-021 after a refresh, resume(code) sends rejoin with the stored token', () => {
    const storage = new MemoryStorage();
    const first = rig(storage);
    first.openSocket();
    first.receive({ type: 'joined', code: CODE, seat: 'B', token: TOKEN });
    const refreshed = rig(storage);
    expect(refreshed.store.resume(CODE)).toBe(true);
    expect(refreshed.connects()).toBe(1);
    expect(refreshed.sent).toEqual([]);
    refreshed.openSocket();
    expect(refreshed.sent).toEqual([{ type: 'rejoin', code: CODE, token: TOKEN }]);
  });

  it('REQ-021 resume without a stored token returns false and sends nothing', () => {
    const r = rig();
    r.openSocket();
    expect(r.store.resume(CODE)).toBe(false);
    expect(r.sent).toEqual([]);
  });

  it('REQ-021 a dropped socket rejoins with the token on reopen', () => {
    const r = rig();
    r.openSocket();
    r.receive({ type: 'created', code: CODE, token: TOKEN, seat: 'A' });
    r.drop();
    expect(r.store.getState().connection).toBe('reconnecting');
    r.openSocket();
    expect(r.sent.at(-1)).toEqual({ type: 'rejoin', code: CODE, token: TOKEN });
  });

  it('REQ-021 a spectator re-joins as a spectator on reopen', () => {
    const r = rig();
    r.openSocket();
    r.receive({ type: 'joined', code: CODE, seat: 'spectator' });
    r.drop();
    r.openSocket();
    expect(r.sent.at(-1)).toEqual({ type: 'join', code: CODE, asSpectator: true });
  });

  it('REQ-021 a refused rejoin clears the token, unbinds and reports BAD_TOKEN', () => {
    const storage = new MemoryStorage();
    storage.map.set(tokenStorageKey(CODE), TOKEN);
    const r = rig(storage);
    r.openSocket();
    r.store.resume(CODE);
    r.receive({ type: 'error', code: CODES.ROOM_NOT_FOUND, message: 'gone' });
    expect(storage.map.has(tokenStorageKey(CODE))).toBe(false);
    expect(r.store.getState()).toMatchObject({
      code: null,
      role: null,
      error: { code: CODES.BAD_TOKEN, message: 'gone' },
    });
  });

  it('REQ-021 a failed plain join keeps its own error code', () => {
    const r = rig();
    r.openSocket();
    r.store.join(CODE, 'Sam', false);
    expect(r.sent).toEqual([{ type: 'join', code: CODE, name: 'Sam' }]);
    r.receive({ type: 'error', code: CODES.ROOM_NOT_FOUND, message: 'no room' });
    expect(r.store.getState().error?.code).toBe(CODES.ROOM_NOT_FOUND);
    r.store.clearError();
    expect(r.store.getState().error).toBeNull();
  });

  it('REQ-021 leave sends leave, clears the token and unbinds', () => {
    const r = rig();
    r.openSocket();
    r.receive({ type: 'created', code: CODE, token: TOKEN, seat: 'A' });
    r.store.leave();
    expect(r.sent.at(-1)).toEqual({ type: 'leave' });
    expect(r.storage.map.size).toBe(0);
    expect(r.store.getState()).toMatchObject({ code: null, role: null, room: null });
  });

  it('REQ-021 resume on the room this tab is already seated in sends nothing', () => {
    const r = rig();
    r.openSocket();
    r.receive({ type: 'created', code: CODE, token: TOKEN, seat: 'A' });
    expect(r.store.resume(CODE.toLowerCase())).toBe(true);
    expect(r.sent).toEqual([]);
  });

  it('REQ-021 a create the dropped socket never answered is asked again on reopen', () => {
    const r = rig();
    r.openSocket();
    r.store.create('Ariel');
    r.drop();
    r.openSocket();
    expect(r.sent).toEqual([
      { type: 'create', name: 'Ariel' },
      { type: 'create', name: 'Ariel' },
    ]);
    r.receive({ type: 'created', code: CODE, token: TOKEN, seat: 'A' });
    r.drop();
    r.openSocket();
    expect(r.sent.at(-1)).toEqual({ type: 'rejoin', code: CODE, token: TOKEN });
  });

  it('REQ-021 a create issued before the socket opens is sent on open', () => {
    const r = rig();
    r.store.create('Ariel');
    expect(r.sent).toEqual([]);
    r.openSocket();
    expect(r.sent).toEqual([{ type: 'create', name: 'Ariel' }]);
  });

  it('REQ-021 protocol errors only a bug or cheat causes are logged, never shown', () => {
    const r = rig();
    r.openSocket();
    r.receive({ type: 'error', code: CODES.NOT_PLAYING, message: 'x' });
    r.receive({ type: 'error', code: CODES.BAD_TICK, message: 'x' });
    expect(r.store.getState().error).toBeNull();
    expect(r.logs).toHaveLength(2);
    r.receive({ type: 'error', code: CODES.ROOM_FULL, message: 'x' });
    expect(r.store.getState().error?.code).toBe(CODES.ROOM_FULL);
  });
  it('REQ-021 a slow-consumer or try-again-later close is remembered while the socket reconnects', () => {
    for (const code of Object.values(RECOVERABLE_CLOSE_CODES)) {
      const r = rig();
      r.openSocket();
      r.receive({ type: 'created', code: CODE, token: TOKEN, seat: 'A' });
      expect(r.store.getState().recoverableClose).toBeNull();
      r.drop(code);
      expect(r.store.getState()).toMatchObject({
        connection: 'reconnecting',
        recoverableClose: code,
      });
    }
  });

  it('REQ-049 the measured ping is forgotten while the socket is not open, so the HUD never shows a stale number', () => {
    const r = rig();
    r.openSocket();
    r.receive({ type: 'created', code: CODE, token: TOKEN, seat: 'A' });
    r.receive({ type: 'ping', t: 1, rtt: 3 });
    expect(r.store.getState().rttMs).toBe(3);
    r.drop(1006);
    expect(r.store.getState()).toMatchObject({ connection: 'reconnecting', rttMs: null });
    r.openSocket();
    expect(r.store.getState().rttMs).toBeNull();
    r.receive({ type: 'ping', t: 2, rtt: 7 });
    expect(r.store.getState().rttMs).toBe(7);
  });

  it('REQ-049 the notice survives a failed retry and clears when the rejoin succeeds', () => {
    const r = rig();
    r.openSocket();
    r.receive({ type: 'created', code: CODE, token: TOKEN, seat: 'A' });
    r.drop(RECOVERABLE_CLOSE_CODES.SLOW_CONSUMER);
    // The first retry fails with an unnamed 1006: still the same recovery, still the same notice.
    r.drop(1006);
    expect(r.store.getState().recoverableClose).toBe(RECOVERABLE_CLOSE_CODES.SLOW_CONSUMER);
    r.openSocket();
    expect(r.sent.at(-1)).toEqual({ type: 'rejoin', code: CODE, token: TOKEN });
    expect(r.store.getState().recoverableClose).toBe(RECOVERABLE_CLOSE_CODES.SLOW_CONSUMER);
    r.receive({ type: 'joined', code: CODE, seat: 'A' });
    expect(r.store.getState().recoverableClose).toBeNull();
  });

  it('REQ-021 the notice is cleared when the retries run out or the player leaves', () => {
    const r = rig();
    r.openSocket();
    r.receive({ type: 'created', code: CODE, token: TOKEN, seat: 'A' });
    r.drop(RECOVERABLE_CLOSE_CODES.TRY_AGAIN_LATER);
    expect(r.store.getState().recoverableClose).toBe(RECOVERABLE_CLOSE_CODES.TRY_AGAIN_LATER);
    r.closeSocket();
    expect(r.store.getState()).toMatchObject({ connection: 'closed', recoverableClose: null });
    const left = rig();
    left.openSocket();
    left.receive({ type: 'created', code: CODE, token: TOKEN, seat: 'A' });
    left.drop(RECOVERABLE_CLOSE_CODES.SLOW_CONSUMER);
    left.store.leave();
    expect(left.store.getState().recoverableClose).toBeNull();
  });
});

describe('REQ-054 prediction wiring', () => {
  it('REQ-054 keys before the DUEL! frame are dropped; input goes live in the frame that shows DUEL!', () => {
    const r = rig();
    const goAt = r.startRound();
    r.timers.advance(goAt - 1);
    const before = r.frame();
    expect(before.inputLive).toBe(false);
    expect(before.standoff).toBe('1');
    r.store.input.keyDown('Space', false);
    expect(r.inputs()).toEqual([]);
    r.timers.advance(1);
    const duel = r.frame();
    expect(duel.standoff).toBe('duel');
    expect(duel.inputLive).toBe(true);
    r.store.input.keyDown('Space', false);
    expect(r.inputs()).toHaveLength(1);
  });

  it('REQ-054 every input is stamped with targetTick and a seq from 1', () => {
    const r = rig();
    const goAt = r.startRound();
    r.timers.advance(goAt + 100);
    r.frame();
    const expected = r.estimator.targetTick(r.timers.now);
    r.store.input.keyDown('ArrowUp', false);
    r.store.input.keyDown('KeyZ', false);
    expect(r.inputs()).toEqual([
      { type: 'input', seq: 1, tick: expected, action: { type: 'rotateCW' } },
      { type: 'input', seq: 2, tick: expected, action: { type: 'rotateCCW' } },
    ]);
  });

  it('REQ-054 a sent input shows on the own board at once, before any snapshot', () => {
    const r = rig();
    const goAt = r.startRound();
    r.timers.advance(goAt);
    const start = r.frame();
    expect(start.left?.active?.kind).toBe('I');
    r.store.input.keyDown('Space', false);
    r.timers.advance(TICK_MS * 2);
    const after = r.frame();
    expect(after.left?.board[19]).toBe(EMPTY); // the line cleared
    expect(after.left?.active?.kind).toBe('T'); // next piece from the preview
    expect(r.predictor.pendingCount).toBe(1);
  });

  it('REQ-054 an own snapshot drops acknowledged inputs (seq ≤ lastAckSeq)', () => {
    const r = rig();
    const goAt = r.startRound();
    r.timers.advance(goAt);
    r.frame();
    r.store.input.keyDown('ArrowUp', false);
    r.store.input.keyDown('KeyX', false);
    r.store.input.keyDown('KeyZ', false);
    expect(r.predictor.pendingCount).toBe(3);
    r.receive(snapshot(2, ownState(2), 2));
    expect(r.predictor.pendingCount).toBe(1);
  });

  it('REQ-054 the own board snaps to each snapshot re-simulated; the opponent board is the snapshot', () => {
    const r = rig();
    const goAt = r.startRound();
    r.timers.advance(goAt + 100);
    const corrected = createPlayerState({
      tick: 6,
      board: parseBoard([...Array<string>(18).fill(EMPTY), 'GGGGGGGGG.', 'GGGGGGGGG.']),
      queue: ['O', 'T', 'S', 'Z', 'J', 'L'],
    });
    const msg = snapshot(6, corrected);
    r.receive(msg);
    const shown = r.frame();
    expect(shown.left?.board.slice(18)).toEqual(['GGGGGGGGG.', 'GGGGGGGGG.']);
    expect(shown.left?.active?.kind).toBe('O');
    expect(shown.right?.board).toEqual(msg.players.B?.board);
    expect(shown.right?.active).toEqual(msg.players.B?.active);
    expect(shown.right?.next).toEqual(msg.players.B?.next);
  });

  it('REQ-054 a hard-drop line clear fires one flash on the own side, once', () => {
    const r = rig();
    const goAt = r.startRound();
    r.timers.advance(goAt);
    r.frame();
    r.store.input.keyDown('Space', false);
    const flashes: FrameModel['fx'][number][] = [];
    for (let i = 0; i < 10; i += 1) {
      r.timers.advance(TICK_MS);
      flashes.push(...r.frame().fx.filter((fx) => fx.kind === 'flash'));
    }
    expect(flashes).toEqual([{ kind: 'flash', side: 'left', rows: [19] }]);
  });

  it('REQ-054 pause stops input and freezes the clock; resumed re-arms the standoff', () => {
    const r = rig();
    const goAt = r.startRound();
    r.timers.advance(goAt + 500);
    expect(r.frame().inputLive).toBe(true);
    r.receive({
      type: 'paused',
      seat: 'B',
      graceEndsAt: SERVER_NOW + 20_000,
      serverNow: SERVER_NOW,
      pausesLeft: 2,
    });
    const paused = r.frame();
    expect(paused.inputLive).toBe(false);
    expect(paused.standoff).toBeNull();
    expect(paused.left).not.toBeNull();
    expect(r.store.getState().paused).toMatchObject({ seat: 'B', pausesLeft: 2 });
    const frozen = r.store.matchElapsedMs(r.timers.now);
    r.timers.advance(5000);
    expect(r.store.matchElapsedMs(r.timers.now)).toBe(frozen);
    r.receive({
      type: 'resumed',
      startsAt: SERVER_NOW + 3000,
      serverNow: SERVER_NOW,
      tick: 40,
    });
    expect(r.store.getState()).toMatchObject({ paused: null, countdown: { kind: 'resume' } });
    expect(r.frame().inputLive).toBe(false);
  });

  it('REQ-054 gameOver ends input; the match clock stops at the result tick', () => {
    const r = rig();
    const goAt = r.startRound();
    r.timers.advance(goAt + 500);
    r.frame();
    const over = {
      type: 'gameOver',
      round: 1,
      replay: false,
      winner: 'A',
      reason: 'TOP_OUT',
      tick: 600,
      series: {
        round: 1,
        replay: false,
        score: { A: 1, B: 0 },
        over: false,
        winner: null,
        endReason: null,
        rounds: [],
      },
      stats: {},
      report: {},
    } as const satisfies ServerMessage;
    r.receive(over);
    expect(r.frame().inputLive).toBe(false);
    expect(r.store.matchElapsedMs(r.timers.now)).toBeCloseTo(600 * TICK_MS);
    expect(r.store.capturingGameKeys()).toBe(false);
  });

  it('REQ-031 gameOver after a grace expiry clears the pause, so no disconnect overlay survives', () => {
    const r = rig();
    const goAt = r.startRound();
    r.timers.advance(goAt + 500);
    r.frame();
    r.receive({
      type: 'paused',
      seat: 'B',
      graceEndsAt: SERVER_NOW + 20_000,
      serverNow: SERVER_NOW,
      pausesLeft: 2,
    });
    expect(r.store.getState().paused).not.toBeNull();
    r.receive({
      type: 'gameOver',
      round: 1,
      replay: false,
      winner: 'A',
      reason: 'OPPONENT_DISCONNECTED',
      tick: 600,
      series: {
        round: 1,
        replay: false,
        score: { A: 1, B: 0 },
        over: true,
        winner: 'A',
        endReason: 'OPPONENT_DISCONNECTED',
        rounds: [],
      },
      stats: {},
      report: {},
    });
    expect(r.store.getState().paused).toBeNull();
    expect(r.store.getState().result).not.toBeNull();
  });

  it('REQ-050 a room that is over (round or series) never keeps a pause', () => {
    for (const status of ['roundOver', 'seriesOver'] as const) {
      const r = rig();
      const goAt = r.startRound();
      r.timers.advance(goAt + 500);
      r.receive({
        type: 'paused',
        seat: 'B',
        graceEndsAt: SERVER_NOW + 20_000,
        serverNow: SERVER_NOW,
        pausesLeft: 1,
      });
      expect(r.store.getState().paused).not.toBeNull();
      r.receive({ ...room('playing'), status } as ServerMessage);
      expect(r.store.getState().paused).toBeNull();
    }
  });

  it('REQ-054 game keys are captured from the countdown to the round end, for players only', () => {
    const r = rig();
    r.openSocket();
    r.receive({ type: 'created', code: CODE, token: TOKEN, seat: 'A' });
    r.receive(room('waiting'));
    expect(r.store.capturingGameKeys()).toBe(false);
    r.receive(room('countdown'));
    expect(r.store.capturingGameKeys()).toBe(true);
    const spectator = rig();
    spectator.openSocket();
    spectator.receive({ type: 'joined', code: CODE, seat: 'spectator' });
    spectator.receive(room('playing'));
    expect(spectator.store.capturingGameKeys()).toBe(false);
  });

  it('REQ-049 once reconnecting has given up, Space and Enter reach the overlay buttons again', () => {
    const r = rig();
    r.openSocket();
    r.receive({ type: 'created', code: CODE, token: TOKEN, seat: 'A' });
    r.receive(room('playing'));
    r.drop(1006);
    expect(r.store.capturingGameKeys()).toBe(true);
    r.closeSocket();
    expect(r.store.getState().connection).toBe('closed');
    expect(r.store.capturingGameKeys()).toBe(false);
  });

  it('REQ-054 spectators see A left and B right from snapshots, never live', () => {
    const r = rig();
    r.openSocket();
    r.receive({ type: 'joined', code: CODE, seat: 'spectator' });
    r.receive(room('playing'));
    const msg = snapshot(30, ownState(30));
    const { you: _hidden, ...publicOnly } = msg;
    r.receive(publicOnly);
    const shown = r.frame();
    expect(shown.inputLive).toBe(false);
    expect(shown.left?.seat).toBe('A');
    expect(shown.right?.seat).toBe('B');
    expect(shown.left?.board).toEqual(msg.players.A?.board);
  });
});

describe('REQ-055 store side of the canvas: frames, HUD and effects', () => {
  it('REQ-055 subscribeFrame listeners get the published frame; one throwing does not stop the rest', () => {
    const r = rig();
    const driver = frameDriverOf(r.store);
    expect(driver).not.toBeNull();
    const seen: number[] = [];
    r.store.subscribeFrame(() => {
      throw new Error('ui bug');
    });
    const unsubscribe = r.store.subscribeFrame((frame) => seen.push(frame.nowMs));
    const frame = r.frame();
    driver?.publishFrame(frame);
    unsubscribe();
    driver?.publishFrame(frame);
    expect(seen).toEqual([frame.nowMs]);
    expect(r.logs).toEqual(['subscribeFrame listener threw', 'subscribeFrame listener threw']);
  });

  it('REQ-055 the HUD carries names and snapshot stats; unchanged snapshots keep its identity', () => {
    const r = rig();
    r.startRound();
    const hud = r.store.getState().hud;
    expect(hud.left).toMatchObject({ seat: 'A', name: 'Ariel', pendingGarbage: 0 });
    expect(hud.right).toMatchObject({ seat: 'B', name: 'Sam' });
    r.receive(snapshot(0, ownState()));
    expect(r.store.getState().hud).toBe(hud);
  });

  it('REQ-055 opponent garbage insertion becomes a nudge; attack and cancel events become fx and chain totals', () => {
    const r = rig();
    const goAt = r.startRound();
    r.timers.advance(goAt);
    r.frame();
    const opp = { ...oppState(4), combo: 2, garbageInserted: 2 };
    const own = ownState(4);
    r.receive({
      type: 'snapshot',
      tick: 4,
      level: 0,
      you: toOwnView(own, 0),
      players: { A: toPublicView(own), B: toPublicView(opp) },
      events: [
        { type: 'attack', from: 'B', rows: 3, tick: 3 },
        { type: 'cancel', seat: 'B', rows: 1, tick: 3 },
      ],
    });
    const frame = r.frame();
    expect(frame.fx).toEqual([
      { kind: 'nudge', side: 'right', rows: 2 },
      { kind: 'projectile', from: 'right', rows: 3, originRow: null },
      { kind: 'burst', side: 'right', rows: 1 },
    ]);
    expect(frame.right?.chain).toEqual({ sent: 3, cancelled: 1 });
    expect(r.frame().fx).toEqual([]);
  });
});
