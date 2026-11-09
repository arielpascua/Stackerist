/**
 * The CORE composition root (architecture §5.1): `main.tsx` calls `createCoreServices()` once and hands
 * the result to the UI. This is the only place the concrete CORE pieces meet: the socket, the protocol
 * `TickEstimator` and `Predictor`, the store, the window keyboard binding, the arena and audio.
 */
import { Predictor, TickEstimator } from '@stackerist/protocol';
import { createConductor } from '../audio/conductor.ts';
import { browserLocalStorage, createMusic } from '../audio/music.ts';
import { browserSessionStorage } from '../net/session.ts';
import { GameSocket, browserSocketFactory, wsUrl } from '../net/socket.ts';
import { mountArena } from '../render/arena.ts';
import { drawBestMoment } from '../render/bestMoment.ts';
import type { CoreServices, MountArena } from './contract.ts';
import { bindKeyboard, createKeyHandlers } from './keyboard.ts';
import { CoreStore } from './store.ts';
import { browserTimers } from './timers.ts';

export function createCoreServices(): CoreServices {
  const now = (): number => performance.now();
  const store = new CoreStore({
    createTransport: (events) =>
      new GameSocket({
        url: wsUrl(window.location),
        createSocket: browserSocketFactory,
        timers: browserTimers,
        now,
        events,
      }),
    storage: browserSessionStorage(),
    predictor: new Predictor(),
    estimator: new TickEstimator(),
    timers: browserTimers,
    now,
    log: (message, detail) => {
      console.warn(`Stackerist: ${message}`, detail);
    },
  });
  const music = createMusic(browserLocalStorage());
  bindKeyboard(
    window,
    createKeyHandlers({
      controller: store.input,
      capturingGameKeys: () => store.capturingGameKeys(),
      musicKeyActive: () => store.getState().code !== null,
      onMusicKey: () => {
        music.toggleByKey();
      },
    }),
  );
  // The soundtrack follows the round: it starts on the frame where input goes live (DUEL!), steps up with
  // the server's level, and stops on game over, pause, leave and when the arena unmounts (REQ-089).
  const conductor = createConductor(music);
  store.subscribeFrame((frame) => {
    conductor.onFrame(frame);
  });
  store.subscribe(() => {
    conductor.onState(store.getState());
  });
  const mountConductedArena: MountArena = (canvases, gameStore, options) => {
    const arena = mountArena(canvases, gameStore, options);
    return {
      destroy() {
        arena.destroy();
        conductor.onArenaGone();
      },
    };
  };
  return { store, mountArena: mountConductedArena, drawBestMoment, music };
}
