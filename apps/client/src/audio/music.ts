/**
 * The `Music` service (architecture §5.6, DESIGN.md Music control, REQ-089).
 *
 * - Preference: `localStorage[MUSIC_STORAGE_KEY]` = 'on' | 'off', default 'on'.
 * - Autoplay: nothing is created or played until `unlock()` runs inside a click or key handler. Until it
 *   has, an 'on' preference reports `blocked`. Where there is no Web Audio the status is `unavailable`.
 * - Playing: the controller keeps one question answered, "should sound be playing now?" (a round is live,
 *   the preference is on, audio is unlocked, the tab is visible) and starts or stops the lookahead
 *   scheduler to match. Everything browser-specific arrives through `MusicDeps`, so tests inject fakes.
 */
import { MUSIC_STORAGE_KEY } from '@stackerist/protocol';
import type {
  Music,
  MusicPreference,
  MusicStatus,
  MusicToggleSource,
  SoundEffect,
} from '../game/contract.ts';
import { browserTimers, type Timers } from '../game/timers.ts';
import { browserAudioHost, type AudioBackend, type AudioHost } from './graph.ts';
import { LookaheadScheduler } from './scheduler.ts';
import { CLEAR_EFFECT_STEP_SECONDS, clearEffectNotes, notesAt } from './score.ts';
import { bpmForLevel } from './tempo.ts';

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Page visibility as the music sees it. */
export interface Visibility {
  hidden(): boolean;
  /** Calls `listener` when the tab is hidden or shown; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export interface MusicDeps {
  readonly storage: PreferenceStorage | null;
  readonly host: AudioHost;
  readonly timers: Timers;
  readonly visibility: Visibility;
}

/** `Music` plus the key path the window keyboard binding uses (the UI never calls it). */
export interface MusicService extends Music {
  /** The M key: like `toggle()`, recorded as a key toggle so the UI announces it. */
  toggleByKey(): void;
  preference(): MusicPreference;
  lastToggleSource(): MusicToggleSource | null;
}

/** A clear starts this far ahead of the audio clock, so its first note is never scheduled in the past. */
const CLEAR_EFFECT_LEAD_SECONDS = 0.01;

const ON: MusicPreference = 'on';
const OFF: MusicPreference = 'off';

export function readPreference(storage: PreferenceStorage | null): MusicPreference {
  try {
    return storage?.getItem(MUSIC_STORAGE_KEY) === OFF ? OFF : ON;
  } catch {
    return ON;
  }
}

function writePreference(storage: PreferenceStorage | null, value: MusicPreference): void {
  try {
    storage?.setItem(MUSIC_STORAGE_KEY, value);
  } catch {
    // Storage blocked: the toggle still applies for this page.
  }
}

export function createMusicService(deps: MusicDeps): MusicService {
  const { storage, host, timers, visibility } = deps;
  let preference = readPreference(storage);
  const listeners = new Set<() => void>();

  let backend: AudioBackend | null = null;
  let failed = false;
  let scheduler: LookaheadScheduler | null = null;
  let unlocked = false;
  let wantPlaying = false;
  let playing = false;
  /** A fresh `start()` begins at the top of the song; a resume after a hide or mute carries on. */
  let fromTop = true;
  let level = 0;
  let lastSource: MusicToggleSource | null = null;

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const supported = (): boolean => !failed && host.supported();

  const ensureBackend = (): AudioBackend | null => {
    if (backend !== null) return backend;
    if (!supported()) return null;
    try {
      backend = host.create();
    } catch {
      failed = true;
    }
    return backend;
  };

  const schedulerOf = (audio: AudioBackend): LookaheadScheduler => {
    scheduler ??= new LookaheadScheduler({
      now: () => audio.now(),
      bpm: () => bpmForLevel(level),
      playStep: (step, when, length) => {
        for (const note of notesAt(step)) audio.play(note, when, length);
      },
      timers,
    });
    return scheduler;
  };

  const halt = (): void => {
    if (!playing) return;
    playing = false;
    scheduler?.stop();
    backend?.closeBus();
  };

  /** Starts or stops the scheduler so it matches whether sound should be playing now. */
  const reconcile = (): void => {
    const should = wantPlaying && preference === ON && unlocked && !visibility.hidden();
    if (should && !playing && backend !== null) {
      playing = true;
      backend.openBus();
      schedulerOf(backend).start(fromTop);
      fromTop = false;
    } else if (!should) {
      halt();
    }
  };

  const setUnlocked = (value: boolean): void => {
    if (value === unlocked) return;
    unlocked = value;
    reconcile();
    notify();
  };

  const unlock = (): void => {
    const audio = ensureBackend();
    if (audio === null) {
      notify();
      return;
    }
    if (audio.state() === 'running') {
      setUnlocked(true);
      return;
    }
    // resume() is called synchronously here, inside the user's gesture.
    audio.resume().then(
      () => {
        setUnlocked(audio.state() === 'running');
      },
      () => {
        setUnlocked(false);
      },
    );
  };

  const toggle = (source: MusicToggleSource): void => {
    preference = preference === ON ? OFF : ON;
    lastSource = source;
    writePreference(storage, preference);
    if (preference === ON) unlock();
    reconcile();
    notify();
  };

  visibility.subscribe(reconcile);

  return {
    unlock,
    start(startLevel) {
      level = startLevel;
      wantPlaying = true;
      fromTop = true;
      halt();
      reconcile();
    },
    setLevel(nextLevel) {
      level = nextLevel;
    },
    effect(kind: SoundEffect, rows: number) {
      // The same question as the music: is sound allowed right now? `playing` already answers it.
      if (kind !== 'clear' || !playing || backend === null) return;
      const audio = backend;
      const start = audio.now() + CLEAR_EFFECT_LEAD_SECONDS;
      clearEffectNotes(rows).forEach((note, index) => {
        audio.play(note, start + index * CLEAR_EFFECT_STEP_SECONDS, CLEAR_EFFECT_STEP_SECONDS);
      });
    },
    stop() {
      wantPlaying = false;
      halt();
    },
    status(): MusicStatus {
      if (!supported()) return 'unavailable';
      if (preference === OFF) return 'off';
      return unlocked ? 'on' : 'blocked';
    },
    toggle() {
      toggle('button');
    },
    toggleByKey() {
      toggle('key');
    },
    preference: () => preference,
    lastToggleSource: () => lastSource,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** `window.localStorage`, or null where reading it throws. */
export function browserLocalStorage(): PreferenceStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function browserVisibility(): Visibility {
  return {
    hidden: () => document.hidden,
    subscribe: (listener) => {
      document.addEventListener('visibilitychange', listener);
      return () => {
        document.removeEventListener('visibilitychange', listener);
      };
    },
  };
}

/** The production music: browser Web Audio, `window.localStorage`, `document.hidden`. */
export function createMusic(storage: PreferenceStorage | null): MusicService {
  return createMusicService({
    storage,
    host: browserAudioHost(),
    timers: browserTimers,
    visibility: browserVisibility(),
  });
}
