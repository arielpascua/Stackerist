/**
 * The UI shell (architecture §5.7): routing (`/`, `/g/:code`, `?watch=1`), screen selection from the
 * store's state, and the connection-level notices. CORE arrives by injection (`CoreServices`), typed
 * by `game/contract.ts`; nothing here imports a concrete CORE module.
 */
import type { RoomCode, RoomStatus, Seat } from '@stackerist/protocol';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { CoreServices } from './game/contract.ts';
import type { DeviceServices } from './ui/browser.ts';
import { ConnectionBanner, FatalPlate } from './ui/components/Notices.tsx';
import { COPY } from './ui/copy.ts';
import { logHiddenError, presentClose, presentError } from './ui/errors.ts';
import { useClientState } from './ui/hooks.ts';
import { intentCode, IntentStore } from './ui/intent.ts';
import { SessionMemory } from './ui/memory.ts';
import { deriveResult, deriveSeriesEnd, otherSeat, type SeatNames } from './ui/result.ts';
import { parseRoute, roomPath, type Router, splitLocation } from './ui/router.ts';
import { Game } from './ui/screens/Game.tsx';
import { Home, type HomeBusy } from './ui/screens/Home.tsx';
import { Lobby } from './ui/screens/Lobby.tsx';

export interface AppProps {
  readonly services: CoreServices;
  readonly router: Router;
  readonly device: DeviceServices;
}

const LIVE_STATUSES: ReadonlySet<RoomStatus> = new Set(['countdown', 'playing', 'paused']);

export function App({ services, router, device }: AppProps) {
  const { store, music } = services;
  const state = useClientState(store);
  const location = useSyncExternalStore(router.subscribe, router.getLocation);
  const route = useMemo(() => {
    const { pathname, search } = splitLocation(location);
    return parseRoute(pathname, search);
  }, [location]);

  const [intents] = useState(() => new IntentStore());
  const intent = useSyncExternalStore(intents.subscribe, intents.get);
  const [memory] = useState(() => new SessionMemory(store));
  useEffect(() => memory.attach(), [memory]);
  const remembered = useSyncExternalStore(memory.subscribe, memory.get);

  // Open the socket once (StrictMode runs effects twice in development; the ref keeps it once).
  const connected = useRef(false);
  useEffect(() => {
    if (connected.current) return;
    connected.current = true;
    store.connect();
  }, [store]);

  useEffect(() => device.keyboard.attach(window), [device.keyboard]);

  const seated = state.role !== null && state.code !== null;
  const roomCode = route.name === 'room' ? route.code : null;
  const watchLink = route.name === 'room' && route.watch;

  // A malformed path shows home at `/`.
  useEffect(() => {
    if (route.name === 'notFound') router.navigate('/', { replace: true });
  }, [route.name, router]);

  // Opening /g/:code: rejoin with a stored seat token, or watch for ?watch=1; otherwise the home
  // screen asks for a name with the code pre-filled.
  const entered = useRef<string | null>(null);
  useEffect(() => {
    if (roomCode === null) {
      entered.current = null;
      return;
    }
    if (seated || entered.current === roomCode) return;
    entered.current = roomCode;
    if (store.resume(roomCode)) {
      intents.set({ kind: 'resume', code: roomCode });
      return;
    }
    if (watchLink) {
      intents.set({ kind: 'join', code: roomCode, asSpectator: true });
      store.join(roomCode, null, true);
    }
  }, [roomCode, watchLink, seated, store, intents]);

  // The URL follows the seat, so a refresh rejoins (architecture §5.7).
  const pushedFor = useRef<string | null>(null);
  const leftCode = useRef<string | null>(null);
  useEffect(() => {
    const code = state.code;
    if (code === null || state.role === null) {
      leftCode.current = null;
      return;
    }
    if (code === leftCode.current) return;
    if (route.name === 'room' && route.code === code) {
      pushedFor.current = code;
      return;
    }
    const replace = pushedFor.current === code || route.name !== 'home';
    pushedFor.current = code;
    router.navigate(roomPath(code, state.role === 'spectator'), { replace });
  }, [state.code, state.role, route, router]);

  const errorView = useMemo(
    () =>
      state.error === null
        ? null
        : presentError(state.error.code, {
            intent: intent.kind,
            roomCode: intentCode(intent) ?? roomCode,
          }),
    [state.error, intent, roomCode],
  );
  useEffect(() => {
    if (state.error !== null && errorView?.placement === 'hidden') {
      logHiddenError(state.error.code, state.error.message);
    }
  }, [state.error, errorView]);

  const create = useCallback(
    (name: string) => {
      music.unlock();
      store.clearError();
      intents.set({ kind: 'create' });
      store.create(name);
    },
    [music, store, intents],
  );
  const join = useCallback(
    (code: RoomCode, name: string) => {
      music.unlock();
      store.clearError();
      intents.set({ kind: 'join', code, asSpectator: false });
      store.join(code, name, false);
    },
    [music, store, intents],
  );
  const watch = useCallback(
    (code: RoomCode) => {
      store.clearError();
      intents.set({ kind: 'join', code, asSpectator: true });
      store.join(code, null, true);
    },
    [store, intents],
  );
  const goHome = useCallback(() => {
    const current = store.getState();
    if (current.code !== null) leftCode.current = current.code;
    if (current.role !== null) store.leave();
    store.clearError();
    intents.reset();
    router.navigate('/');
    if (current.connection === 'closed') store.connect();
  }, [store, intents, router]);
  const nextRound = useCallback(() => {
    music.unlock();
    store.ready();
  }, [music, store]);
  const retryConnection = useCallback(() => store.connect(), [store]);

  const names: SeatNames = {
    A: remembered.names.A ?? COPY.game.opponent,
    B: remembered.names.B ?? COPY.game.opponent,
  };

  const room = state.room;
  const role = state.role;
  const status = room?.status ?? null;
  const resultView = useMemo(() => {
    if (room === null || role === null || (status !== 'roundOver' && status !== 'seriesOver')) {
      return null;
    }
    const opponent: Seat | null = role === 'spectator' ? null : otherSeat(role);
    const opponentInfo = opponent === null ? undefined : room.players[opponent];
    const seatNames = { A: names.A, B: names.B };
    const common = {
      role,
      names: seatNames,
      ready: state.ready,
      opponentSeated: opponent === null ? null : opponentInfo !== undefined,
      opponentConnected: opponent === null ? null : (opponentInfo?.connected ?? false),
    };
    if (state.result !== null) {
      return deriveResult({
        ...common,
        result: state.result,
        series: room.series,
        status,
        roundStartTick: state.roundStartTick,
      });
    }
    return status === 'seriesOver' ? deriveSeriesEnd({ ...common, series: room.series }) : null;
  }, [room, role, status, names.A, names.B, state.ready, state.result, state.roundStartTick]);

  const closeView =
    state.connection === 'closed' && state.closedBy !== null ? presentClose(state.closedBy) : null;
  const inLiveMatch = seated && status !== null && LIVE_STATUSES.has(status);
  const connectionDown =
    state.connection === 'reconnecting' ||
    (state.connection === 'closed' && remembered.everOpen && closeView?.kind !== 'fatal');
  const notice =
    intent.kind === 'join' && !intent.asSpectator && role === 'spectator'
      ? COPY.errors.joinedAsSpectator
      : null;

  const busy: HomeBusy =
    seated || state.error !== null || state.connection === 'closed'
      ? null
      : intent.kind === 'create'
        ? 'create'
        : intent.kind === 'join' && !intent.asSpectator
          ? 'join'
          : null;

  let screen: ReactNode;
  if (closeView?.kind === 'fatal') {
    screen = (
      <FatalPlate
        text={closeView.text}
        actions={closeView.actions}
        onReload={device.reload}
        onHome={goHome}
      />
    );
  } else if (seated && room !== null && role !== null && room.code === state.code) {
    screen =
      room.status === 'waiting' ? (
        <Lobby
          code={room.code}
          role={role}
          room={room}
          names={names}
          loadingText={null}
          notice={notice}
          error={errorView}
          origin={device.origin}
          copyText={device.copyText}
          onLeave={goHome}
          music={music}
        />
      ) : (
        <Game
          services={services}
          state={state}
          room={room}
          role={role}
          names={names}
          result={resultView}
          notice={notice}
          apple={device.apple}
          onLeave={goHome}
          onPrimary={nextRound}
          onBackHome={goHome}
        />
      );
  } else if (
    state.code !== null &&
    (seated || (roomCode === state.code && intent.kind !== 'idle' && errorView === null))
  ) {
    screen = (
      <Lobby
        code={state.code}
        role={null}
        room={null}
        names={names}
        loadingText={COPY.lobby.connectingTo(state.code)}
        notice={notice}
        error={errorView}
        origin={device.origin}
        copyText={device.copyText}
        onLeave={goHome}
        music={music}
      />
    );
  } else if (
    roomCode !== null &&
    errorView === null &&
    state.connection !== 'closed' &&
    intentCode(intent) === roomCode &&
    (intent.kind === 'resume' || (intent.kind === 'join' && intent.asSpectator))
  ) {
    screen = (
      <Lobby
        code={roomCode}
        role={null}
        room={null}
        names={names}
        loadingText={
          intent.kind === 'resume'
            ? COPY.lobby.rejoining(roomCode)
            : COPY.lobby.connectingTo(roomCode)
        }
        notice={null}
        error={null}
        origin={device.origin}
        copyText={device.copyText}
        onLeave={goHome}
        music={music}
      />
    );
  } else {
    screen = (
      <Home
        key={roomCode ?? 'home'}
        mode={roomCode !== null ? 'join' : 'create'}
        initialCode={roomCode ?? ''}
        busy={busy}
        error={errorView}
        onCreate={create}
        onJoin={join}
        onWatch={watch}
        needsKeyboardWarning={() => device.touchOnly() && !device.keyboard.proven}
        keyboard={device.keyboard}
      />
    );
  }

  return (
    <>
      {connectionDown && !inLiveMatch ? (
        <ConnectionBanner
          failed={state.connection === 'closed'}
          onRetry={retryConnection}
          onHome={goHome}
        />
      ) : null}
      {screen}
    </>
  );
}
