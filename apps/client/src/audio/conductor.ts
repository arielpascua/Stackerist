/**
 * The music cue sheet (REQ-089): when the soundtrack starts, steps up and stops. Pure and DOM-free.
 *
 * - Starts on the frame where input goes live (`inputLive` flips to true): the same frame that paints DUEL!.
 * - Steps the tempo with the server's speed level, read from the same frames.
 * - Stops when input goes dead (round over, pause, top-out), on game over, a pause and leave, and when the
 *   arena goes away.
 */
import type { ClientState, FrameModel, Music } from '../game/contract.ts';

export interface Conductor {
  onFrame(frame: Pick<FrameModel, 'inputLive' | 'level'>): void;
  onState(state: Pick<ClientState, 'code' | 'result' | 'paused'>): void;
  /** The arena unmounted (leave, navigation): nothing is on screen to score. */
  onArenaGone(): void;
}

export function createConductor(music: Pick<Music, 'start' | 'stop' | 'setLevel'>): Conductor {
  let live = false;
  let level = -1;
  const stop = (): void => {
    live = false;
    music.stop();
  };
  return {
    onFrame(frame) {
      if (frame.inputLive && !live) {
        live = true;
        level = frame.level;
        music.start(frame.level);
        return;
      }
      if (!frame.inputLive && live) {
        stop();
        return;
      }
      if (live && frame.level !== level) {
        level = frame.level;
        music.setLevel(frame.level);
      }
    },
    onState(state) {
      if (state.code === null || state.result !== null || state.paused !== null) stop();
    },
    onArenaGone: stop,
  };
}
