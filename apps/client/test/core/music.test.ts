import { MAX_LEVEL } from '@stackerist/engine';
import { MUSIC_STORAGE_KEY } from '@stackerist/protocol';
import { describe, expect, it } from 'vitest';
import { createConductor } from '../../src/audio/conductor.ts';
import type { AudioBackend, AudioHost, BackendState } from '../../src/audio/graph.ts';
import {
  createMusicService,
  readPreference,
  type MusicDeps,
  type Visibility,
} from '../../src/audio/music.ts';
import {
  LOOKAHEAD_SECONDS,
  LookaheadScheduler,
  MAX_LAG_SECONDS,
  SCHEDULER_TICK_MS,
} from '../../src/audio/scheduler.ts';
import {
  CLEAR_EFFECT_STEP_SECONDS,
  KEY_PITCH_CLASSES,
  LOOP_STEPS,
  STEPS_PER_BAR,
  clearEffectNotes,
  midiToHz,
  notesAt,
  type Note,
} from '../../src/audio/score.ts';
import { bpmForLevel, stepSeconds } from '../../src/audio/tempo.ts';
import { ManualTimers, MemoryStorage } from './helpers.ts';

describe('REQ-089 tempo rises with the speed level', () => {
  it('REQ-089 bpm = 100 + 6 x level: 100 at level 0, 172 at the top level', () => {
    expect(bpmForLevel(0)).toBe(100);
    expect(bpmForLevel(1)).toBe(106);
    expect(bpmForLevel(5)).toBe(130);
    expect(bpmForLevel(MAX_LEVEL)).toBe(172);
  });

  it('REQ-089 bpmForLevel is strictly increasing across every level', () => {
    for (let level = 1; level <= MAX_LEVEL; level += 1) {
      expect(bpmForLevel(level)).toBeGreaterThan(bpmForLevel(level - 1));
    }
  });

  it('REQ-089 out-of-range levels are clamped and junk reads as level 0', () => {
    expect(bpmForLevel(-3)).toBe(100);
    expect(bpmForLevel(99)).toBe(172);
    expect(bpmForLevel(Number.NaN)).toBe(100);
    expect(bpmForLevel(2.9)).toBe(112);
  });

  it('REQ-089 a score step is a sixteenth note', () => {
    expect(stepSeconds(120)).toBeCloseTo(0.125);
    expect(stepSeconds(100)).toBeCloseTo(0.15);
  });
});

describe('REQ-089 the original score', () => {
  const allNotes = (): Note[] => Array.from({ length: LOOP_STEPS }, (_, i) => notesAt(i)).flat();

  it('REQ-089 every pitched note is in A minor (with the G sharp of the last bar)', () => {
    const pitched = allNotes().filter((n) => !['kick', 'snare', 'hat'].includes(n.voice));
    expect(pitched.length).toBeGreaterThan(50);
    for (const note of pitched) {
      expect(KEY_PITCH_CLASSES.has(note.midi % 12)).toBe(true);
    }
  });

  it('REQ-089 every bar starts on a bass root and a kick, and the score loops', () => {
    for (let bar = 0; bar < LOOP_STEPS / STEPS_PER_BAR; bar += 1) {
      const voices = notesAt(bar * STEPS_PER_BAR).map((n) => n.voice);
      expect(voices).toContain('kick');
      expect(voices).toContain('bass');
      expect(voices).toContain('pad');
    }
    expect(notesAt(0)).toEqual(notesAt(LOOP_STEPS));
    expect(notesAt(5)).toEqual(notesAt(5 + 3 * LOOP_STEPS));
    expect(notesAt(-1)).toEqual(notesAt(LOOP_STEPS - 1));
  });

  it('REQ-089 it has all voices, gains in 0..1 and positive lengths', () => {
    const notes = allNotes();
    expect(new Set(notes.map((n) => n.voice))).toEqual(
      new Set(['kick', 'snare', 'hat', 'bass', 'pad', 'lead']),
    );
    for (const note of notes) {
      expect(note.gain).toBeGreaterThan(0);
      expect(note.gain).toBeLessThanOrEqual(1);
      expect(note.steps).toBeGreaterThan(0);
    }
  });

  it('REQ-089 midiToHz is equal-tempered (A4 = 440, an octave doubles)', () => {
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(midiToHz(81)).toBeCloseTo(880);
    expect(midiToHz(57)).toBeCloseTo(220);
  });
});

describe('REQ-089 the lookahead scheduler', () => {
  function rig(bpm = () => 120) {
    const timers = new ManualTimers();
    const clock = { skew: 0 };
    const placed: { step: number; when: number; length: number; at: number }[] = [];
    const scheduler = new LookaheadScheduler({
      now: () => timers.now / 1000 + clock.skew,
      bpm,
      playStep: (step, when, length) => {
        placed.push({ step, when, length, at: timers.now / 1000 + clock.skew });
      },
      timers,
    });
    return { timers, placed, scheduler, clock };
  }

  it('REQ-089 it wakes every 25 ms and schedules steps up to 100 ms ahead on the audio clock', () => {
    expect(SCHEDULER_TICK_MS).toBe(25);
    expect(LOOKAHEAD_SECONDS).toBeCloseTo(0.1);
    const r = rig();
    r.scheduler.start();
    r.timers.advance(2000);
    expect(r.placed.length).toBeGreaterThan(10);
    for (const entry of r.placed) {
      expect(entry.when).toBeLessThan(entry.at + LOOKAHEAD_SECONDS + 1e-9);
      expect(entry.when).toBeGreaterThanOrEqual(entry.at - 1e-9);
    }
  });

  it('REQ-089 steps are numbered in order and spaced exactly one step apart', () => {
    const r = rig();
    r.scheduler.start();
    r.timers.advance(1000);
    r.placed.forEach((entry, index) => {
      expect(entry.step).toBe(index);
      if (index > 0) {
        const previous = r.placed[index - 1];
        expect(entry.when - (previous?.when ?? 0)).toBeCloseTo(stepSeconds(120));
      }
    });
  });

  it('REQ-089 a tempo change applies from the next step, without a jump', () => {
    let bpm = 100;
    const r = rig(() => bpm);
    r.scheduler.start();
    r.timers.advance(500);
    const before = r.placed.length;
    bpm = 172;
    r.timers.advance(500);
    const slow = r.placed.slice(0, before);
    const fast = r.placed.slice(before + 1);
    const gap = (list: typeof r.placed): number =>
      (list.at(-1)?.when ?? 0) - (list.at(-2)?.when ?? 0);
    expect(gap(slow)).toBeCloseTo(stepSeconds(100));
    expect(gap(fast)).toBeCloseTo(stepSeconds(172));
    expect(r.placed.map((e) => e.when)).toEqual(
      [...r.placed.map((e) => e.when)].sort((a, b) => a - b),
    );
  });

  it('REQ-089 a throttled wake-up re-syncs instead of bursting the backlog', () => {
    const r = rig();
    r.scheduler.start();
    r.timers.advance(100);
    const before = r.placed.length;
    // The page was frozen: the clock jumps with no timer ticks in between.
    r.clock.skew += 10;
    r.timers.advance(SCHEDULER_TICK_MS);
    const burst = r.placed.length - before;
    expect(burst).toBeLessThanOrEqual(Math.ceil(LOOKAHEAD_SECONDS / stepSeconds(120)) + 1);
    expect(MAX_LAG_SECONDS).toBeGreaterThan(0);
  });

  it('REQ-089 stop() cancels the timer and schedules nothing more; start() begins at the top', () => {
    const r = rig();
    r.scheduler.start();
    r.timers.advance(500);
    r.scheduler.stop();
    expect(r.scheduler.running).toBe(false);
    expect(r.timers.pending).toBe(0);
    const count = r.placed.length;
    r.timers.advance(1000);
    expect(r.placed.length).toBe(count);
    r.scheduler.start();
    expect(r.placed.at(-1)?.step).toBe(0);
  });

  it('REQ-089 start(false) carries on from the step where it stopped', () => {
    const r = rig();
    r.scheduler.start();
    r.timers.advance(500);
    const next = r.scheduler.step;
    r.scheduler.stop();
    r.scheduler.start(false);
    expect(r.placed.at(-1)?.step).toBe(next);
  });
});

// ---- the controller, against a fake Web Audio backend ----

class FakeBackend implements AudioBackend {
  state_: BackendState;
  resumes = 0;
  buses = 0;
  closed = 0;
  played: { note: Note; when: number }[] = [];
  #pendingResume: (() => void) | null = null;
  holdResume = false;
  resumeTo: BackendState = 'running';

  constructor(
    private readonly clock: () => number,
    initial: BackendState,
  ) {
    this.state_ = initial;
  }
  now(): number {
    return this.clock();
  }
  state(): BackendState {
    return this.state_;
  }
  resume(): Promise<void> {
    this.resumes += 1;
    return new Promise((resolve) => {
      const finish = (): void => {
        this.state_ = this.resumeTo;
        resolve();
      };
      if (this.holdResume) this.#pendingResume = finish;
      else finish();
    });
  }
  releaseResume(): void {
    this.#pendingResume?.();
    this.#pendingResume = null;
  }
  openBus(): void {
    this.buses += 1;
  }
  closeBus(): void {
    this.closed += 1;
  }
  play(note: Note, when: number): void {
    this.played.push({ note, when });
  }
}

function musicRig(
  options: {
    supported?: boolean;
    initial?: BackendState;
    resumeTo?: BackendState;
    hidden?: boolean;
  } = {},
) {
  const timers = new ManualTimers();
  const storage = new MemoryStorage();
  const state = { hidden: options.hidden ?? false };
  let onVisibility: (() => void) | null = null;
  const visibility: Visibility = {
    hidden: () => state.hidden,
    subscribe: (listener) => {
      onVisibility = listener;
      return () => undefined;
    },
  };
  let backend: FakeBackend | null = null;
  let created = 0;
  const host: AudioHost = {
    supported: () => options.supported ?? true,
    create: () => {
      created += 1;
      backend = new FakeBackend(() => timers.now / 1000, options.initial ?? 'running');
      backend.resumeTo = options.resumeTo ?? 'running';
      return backend;
    },
  };
  const deps: MusicDeps = { storage, host, timers, visibility };
  const music = createMusicService(deps);
  return {
    music,
    timers,
    storage,
    created: () => created,
    backend: (): FakeBackend => {
      if (backend === null) throw new Error('no backend yet');
      return backend;
    },
    setHidden: (hidden: boolean) => {
      state.hidden = hidden;
      onVisibility?.();
    },
  };
}

describe('REQ-089 autoplay: nothing sounds before a user gesture', () => {
  it('REQ-089 at startup no audio context exists, nothing is scheduled and the status is blocked', () => {
    const r = musicRig();
    expect(r.created()).toBe(0);
    expect(r.timers.pending).toBe(0);
    expect(r.music.status()).toBe('blocked');
  });

  it('REQ-089 start() before unlock() stays silent: no context, no timers, still blocked', () => {
    const r = musicRig();
    r.music.start(0);
    expect(r.created()).toBe(0);
    expect(r.timers.pending).toBe(0);
    expect(r.music.status()).toBe('blocked');
  });

  it('REQ-089 unlock() inside a gesture creates and resumes the context and reports on', async () => {
    const r = musicRig({ initial: 'suspended' });
    r.music.unlock();
    expect(r.created()).toBe(1);
    expect(r.backend().resumes).toBe(1);
    await Promise.resolve();
    expect(r.music.status()).toBe('on');
  });

  it('REQ-089 a context the browser keeps suspended leaves the status blocked', async () => {
    const r = musicRig({ initial: 'suspended', resumeTo: 'suspended' });
    r.music.unlock();
    await Promise.resolve();
    await Promise.resolve();
    expect(r.music.status()).toBe('blocked');
  });

  it('REQ-089 unlocking while a round is already live starts the music at once, from the top', () => {
    const r = musicRig();
    r.music.start(0);
    expect(r.timers.pending).toBe(0);
    r.music.unlock();
    expect(r.music.status()).toBe('on');
    expect(r.timers.pending).toBe(1);
    expect(r.backend().buses).toBe(1);
    expect(r.backend().played.length).toBeGreaterThan(0);
    expect(r.backend().played[0]?.note.voice).toBe('kick');
  });

  it('REQ-089 without Web Audio the status is unavailable and nothing throws', () => {
    const r = musicRig({ supported: false });
    expect(r.music.status()).toBe('unavailable');
    r.music.unlock();
    r.music.start(0);
    r.music.toggle();
    r.music.stop();
    expect(r.music.status()).toBe('unavailable');
    expect(r.created()).toBe(0);
  });

  it('REQ-089 a context that cannot be created reads as unavailable', () => {
    const timers = new ManualTimers();
    const music = createMusicService({
      storage: null,
      timers,
      visibility: { hidden: () => false, subscribe: () => () => undefined },
      host: {
        supported: () => true,
        create: () => {
          throw new Error('no audio device');
        },
      },
    });
    music.unlock();
    expect(music.status()).toBe('unavailable');
  });
});

describe('REQ-089 the music starts at DUEL! and follows the level', () => {
  it('REQ-089 start(level) after unlock plays the first bar immediately from the audio clock', () => {
    const r = musicRig();
    r.music.unlock();
    r.music.start(3);
    expect(r.timers.pending).toBe(1);
    expect(r.backend().played.length).toBeGreaterThan(0);
    r.timers.advance(1000);
    expect(r.backend().played.length).toBeGreaterThan(10);
  });

  it('REQ-089 the tempo follows setLevel: steps spread to 100 + 6 x level bpm', () => {
    const r = musicRig();
    r.music.unlock();
    r.music.start(0);
    r.timers.advance(2000);
    // A kick lands on every fourth step, so two kicks are one beat (four steps) apart.
    const kicks = (): number[] =>
      r
        .backend()
        .played.filter((p) => p.note.voice === 'kick')
        .map((p) => p.when);
    const slow = kicks();
    expect((slow[2] ?? NaN) - (slow[1] ?? NaN)).toBeCloseTo(4 * stepSeconds(bpmForLevel(0)));
    r.music.setLevel(12);
    r.timers.advance(2000);
    const all = kicks();
    expect((all.at(-1) ?? 0) - (all.at(-2) ?? 0)).toBeCloseTo(4 * stepSeconds(bpmForLevel(12)));
  });

  it('REQ-089 stop() halts the scheduler and fades the bus out; start() begins again from the top', () => {
    const r = musicRig();
    r.music.unlock();
    r.music.start(0);
    r.timers.advance(500);
    r.music.stop();
    expect(r.timers.pending).toBe(0);
    expect(r.backend().closed).toBe(1);
    const count = r.backend().played.length;
    r.timers.advance(1000);
    expect(r.backend().played.length).toBe(count);
    r.music.start(0);
    expect(r.backend().buses).toBe(2);
    expect(r.backend().played[count]?.note.voice).toBe('kick');
  });

  it('REQ-089 hiding the tab stops the sound; showing it again resumes if the round is still live', () => {
    const r = musicRig();
    r.music.unlock();
    r.music.start(0);
    r.timers.advance(300);
    r.setHidden(true);
    expect(r.timers.pending).toBe(0);
    expect(r.backend().closed).toBe(1);
    const count = r.backend().played.length;
    r.timers.advance(2000);
    expect(r.backend().played.length).toBe(count);
    r.setHidden(false);
    expect(r.timers.pending).toBe(1);
    r.timers.advance(500);
    expect(r.backend().played.length).toBeGreaterThan(count);
  });

  it('REQ-089 a tab hidden before DUEL! never starts it; stop() while hidden stays stopped on show', () => {
    const r = musicRig({ hidden: true });
    r.music.unlock();
    r.music.start(0);
    expect(r.timers.pending).toBe(0);
    r.music.stop();
    r.setHidden(false);
    expect(r.timers.pending).toBe(0);
  });
});

describe('REQ-089 mute button and M key', () => {
  it('REQ-089 it is on by default, with nothing stored', () => {
    expect(readPreference(new MemoryStorage())).toBe('on');
    expect(readPreference(null)).toBe('on');
    expect(musicRig().music.preference()).toBe('on');
  });

  it('REQ-089 toggle() flips the preference and persists it under MUSIC_STORAGE_KEY', () => {
    const r = musicRig();
    r.music.toggle();
    expect(r.music.status()).toBe('off');
    expect(r.music.preference()).toBe('off');
    expect(r.storage.map.get(MUSIC_STORAGE_KEY)).toBe('off');
    r.music.toggle();
    expect(r.storage.map.get(MUSIC_STORAGE_KEY)).toBe('on');
    expect(MUSIC_STORAGE_KEY).toBe('stackerist:music');
  });

  it('REQ-089 a stored off is remembered by the next page load', () => {
    const storage = new MemoryStorage();
    storage.map.set(MUSIC_STORAGE_KEY, 'off');
    const music = createMusicService({
      storage,
      timers: new ManualTimers(),
      visibility: { hidden: () => false, subscribe: () => () => undefined },
      host: { supported: () => true, create: () => new FakeBackend(() => 0, 'running') },
    });
    expect(music.status()).toBe('off');
    expect(readPreference(storage)).toBe('off');
  });

  it('REQ-089 a blocked storage still toggles for the session and never throws', () => {
    const r = musicRig();
    r.storage.failing = true;
    expect(() => {
      r.music.toggle();
    }).not.toThrow();
    expect(r.music.status()).toBe('off');
    expect(readPreference(r.storage)).toBe('on');
  });

  it('REQ-089 muting mid-round silences the music; unmuting inside the gesture resumes it', () => {
    const r = musicRig();
    r.music.unlock();
    r.music.start(0);
    r.timers.advance(300);
    r.music.toggle();
    expect(r.timers.pending).toBe(0);
    expect(r.backend().closed).toBe(1);
    const count = r.backend().played.length;
    r.music.toggle();
    expect(r.music.status()).toBe('on');
    expect(r.timers.pending).toBe(1);
    r.timers.advance(500);
    expect(r.backend().played.length).toBeGreaterThan(count);
  });

  it('REQ-089 toggling on from a key or click is itself the unlock gesture (blocked becomes on)', () => {
    const r = musicRig();
    r.music.toggle(); // off
    r.music.start(0);
    expect(r.created()).toBe(0);
    r.music.toggleByKey(); // on, in a key handler
    expect(r.created()).toBe(1);
    expect(r.music.status()).toBe('on');
    expect(r.timers.pending).toBe(1);
  });

  it('REQ-089 the M key is recorded as a key toggle; the button as a button toggle; listeners hear both', () => {
    const r = musicRig();
    let heard = 0;
    r.music.subscribe(() => {
      heard += 1;
    });
    expect(r.music.lastToggleSource()).toBeNull();
    r.music.toggleByKey();
    expect(r.music.lastToggleSource()).toBe('key');
    r.music.toggle();
    expect(r.music.lastToggleSource()).toBe('button');
    expect(heard).toBeGreaterThanOrEqual(2);
  });

  it('REQ-089 an off preference never plays even after unlock and start', () => {
    const r = musicRig();
    r.music.toggle();
    r.music.unlock();
    r.music.start(0);
    expect(r.timers.pending).toBe(0);
    expect(r.backend().played).toEqual([]);
  });
});

describe('REQ-089 the cue sheet: start at DUEL!, stop at the end', () => {
  function cues() {
    const calls: string[] = [];
    const conductor = createConductor({
      start: (level) => calls.push(`start:${String(level)}`),
      stop: () => calls.push('stop'),
      setLevel: (level) => calls.push(`level:${String(level)}`),
    });
    return { calls, conductor };
  }

  it('REQ-089 it starts on the frame where input goes live, not before', () => {
    const { calls, conductor } = cues();
    conductor.onFrame({ inputLive: false, level: 0 });
    conductor.onFrame({ inputLive: false, level: 0 });
    expect(calls).toEqual([]);
    conductor.onFrame({ inputLive: true, level: 2 });
    expect(calls).toEqual(['start:2']);
    conductor.onFrame({ inputLive: true, level: 2 });
    expect(calls).toEqual(['start:2']);
  });

  it('REQ-089 it steps the tempo when the server level changes', () => {
    const { calls, conductor } = cues();
    conductor.onFrame({ inputLive: true, level: 0 });
    conductor.onFrame({ inputLive: true, level: 1 });
    conductor.onFrame({ inputLive: true, level: 1 });
    expect(calls).toEqual(['start:0', 'level:1']);
  });

  it('REQ-089 it stops when input goes dead (pause, top-out), and restarts at the next DUEL!', () => {
    const { calls, conductor } = cues();
    conductor.onFrame({ inputLive: true, level: 0 });
    conductor.onFrame({ inputLive: false, level: 0 });
    conductor.onFrame({ inputLive: true, level: 4 });
    expect(calls).toEqual(['start:0', 'stop', 'start:4']);
  });

  it('REQ-089 it stops on game over, on a pause and on leave', () => {
    for (const state of [
      { code: 'K7QM4X', result: {}, paused: null },
      { code: 'K7QM4X', result: null, paused: {} },
      { code: null, result: null, paused: null },
    ]) {
      const { calls, conductor } = cues();
      conductor.onFrame({ inputLive: true, level: 0 });
      conductor.onState(state as Parameters<typeof conductor.onState>[0]);
      expect(calls).toEqual(['start:0', 'stop']);
    }
  });

  it('REQ-089 it stays quiet for an ordinary state change mid-round', () => {
    const { calls, conductor } = cues();
    conductor.onFrame({ inputLive: true, level: 0 });
    conductor.onState({ code: 'K7QM4X', result: null, paused: null });
    expect(calls).toEqual(['start:0']);
  });

  it('REQ-089 it stops when the arena unmounts (leave, navigation)', () => {
    const { calls, conductor } = cues();
    conductor.onFrame({ inputLive: true, level: 0 });
    conductor.onArenaGone();
    expect(calls).toEqual(['start:0', 'stop']);
  });
});

describe('REQ-093 the row-clear sound: what it is', () => {
  it('REQ-093 one to four rows give two to five notes that climb in pitch', () => {
    for (const rows of [1, 2, 3, 4]) {
      const notes = clearEffectNotes(rows);
      expect(notes, `${String(rows)} rows`).toHaveLength(rows + 1);
      const pitches = notes.map((n) => n.midi);
      expect([...pitches].sort((x, y) => x - y)).toEqual(pitches);
      expect(new Set(pitches).size).toBe(pitches.length);
    }
  });

  it('REQ-093 every note is in the music key, so the effect never clashes with the score', () => {
    for (const rows of [1, 2, 3, 4]) {
      for (const note of clearEffectNotes(rows)) {
        expect(KEY_PITCH_CLASSES.has(note.midi % 12), `midi ${String(note.midi)}`).toBe(true);
      }
    }
  });

  it('REQ-093 more rows are longer and no louder than the mix allows', () => {
    const total = (rows: number): number =>
      clearEffectNotes(rows).reduce((sum, n) => sum + n.steps, 0);
    expect(total(2)).toBeGreaterThan(total(1));
    expect(total(3)).toBeGreaterThan(total(2));
    expect(total(4)).toBeGreaterThan(total(3));
    for (const note of clearEffectNotes(4)) {
      expect(note.gain).toBeGreaterThan(0);
      expect(note.gain).toBeLessThanOrEqual(1);
      expect(note.voice).toBe('lead');
    }
  });

  it('REQ-093 the count is clamped to one to four rows and nothing sounds for no rows', () => {
    expect(clearEffectNotes(0)).toEqual([]);
    expect(clearEffectNotes(-3)).toEqual([]);
    expect(clearEffectNotes(9)).toEqual(clearEffectNotes(4));
  });
});

describe('REQ-093 the row-clear sound: when it plays', () => {
  /** A round is live and the music is sounding. */
  function playingRig(options: Parameters<typeof musicRig>[0] = {}) {
    const r = musicRig(options);
    r.music.unlock();
    r.music.start(0);
    r.timers.advance(300);
    return r;
  }
  const effectNotes = (r: ReturnType<typeof musicRig>, before: number) =>
    r.backend().played.slice(before);

  it('REQ-093 a clear places its notes on the audio clock, in order, right now', () => {
    const r = playingRig();
    const before = r.backend().played.length;
    const now = r.backend().now();
    r.music.effect?.('clear', 3);
    const fresh = effectNotes(r, before);
    expect(fresh.map((p) => p.note)).toEqual(clearEffectNotes(3));
    expect(fresh[0]?.when ?? -1).toBeGreaterThanOrEqual(now);
    expect(fresh[0]?.when ?? 99).toBeLessThan(now + 0.1);
    for (let i = 1; i < fresh.length; i += 1) {
      const gap = (fresh[i]?.when ?? 0) - (fresh[i - 1]?.when ?? 0);
      expect(gap).toBeCloseTo(CLEAR_EFFECT_STEP_SECONDS, 6);
    }
  });

  it('REQ-093 a clear sounds the same at any speed level: its length does not follow the tempo', () => {
    const slow = playingRig();
    const fast = playingRig();
    fast.music.setLevel(12);
    const a = slow.backend().played.length;
    const b = fast.backend().played.length;
    slow.music.effect?.('clear', 4);
    fast.music.effect?.('clear', 4);
    const gaps = (r: ReturnType<typeof musicRig>, from: number): number[] => {
      const list = effectNotes(r, from);
      return list.slice(1).map((p, i) => p.when - (list[i]?.when ?? 0));
    };
    expect(gaps(slow, a)).toEqual(gaps(fast, b));
  });

  it('REQ-093 nothing plays before a round is live (music not started)', () => {
    const r = musicRig();
    r.music.unlock();
    r.music.effect?.('clear', 2);
    expect(r.backend().played).toHaveLength(0);
  });

  it('REQ-093 nothing plays before the browser has unlocked audio', () => {
    const r = musicRig({ initial: 'suspended', resumeTo: 'suspended' });
    r.music.start(0);
    r.music.effect?.('clear', 2);
    expect(r.created()).toBe(0);
  });

  it('REQ-093 the mute button silences the effect together with the music, and un-muting brings it back', () => {
    const r = playingRig();
    r.music.toggle();
    const before = r.backend().played.length;
    r.music.effect?.('clear', 2);
    expect(r.backend().played).toHaveLength(before);
    r.music.toggle();
    r.music.effect?.('clear', 2);
    expect(r.backend().played.length).toBeGreaterThan(before);
  });

  it('REQ-093 the M key silences it too', () => {
    const r = playingRig();
    r.music.toggleByKey();
    const before = r.backend().played.length;
    r.music.effect?.('clear', 4);
    expect(r.backend().played).toHaveLength(before);
  });

  it('REQ-093 a hidden tab plays nothing', () => {
    const r = playingRig();
    r.setHidden(true);
    const before = r.backend().played.length;
    r.music.effect?.('clear', 1);
    expect(r.backend().played).toHaveLength(before);
  });

  it('REQ-093 after stop() (round over, pause, leave) a late clear is silent', () => {
    const r = playingRig();
    r.music.stop();
    const before = r.backend().played.length;
    r.music.effect?.('clear', 2);
    expect(r.backend().played).toHaveLength(before);
  });
});

describe('REQ-093 the row-clear sound: the cue sheet', () => {
  function cues() {
    const calls: string[] = [];
    const conductor = createConductor({
      start: (level) => calls.push(`start:${String(level)}`),
      stop: () => calls.push('stop'),
      setLevel: (level) => calls.push(`level:${String(level)}`),
      effect: (kind, rows) => calls.push(`${kind}:${String(rows)}`),
    });
    return { calls, conductor };
  }
  const flash = (rows: number[], side: 'left' | 'right' = 'left') =>
    ({ kind: 'flash', side, rows }) as const;

  it('REQ-093 a clear of your own sounds with the number of rows cleared', () => {
    const { calls, conductor } = cues();
    conductor.onFrame({ inputLive: true, level: 0 });
    conductor.onFrame({ inputLive: true, level: 0, fx: [flash([17, 18])] });
    conductor.onFrame({ inputLive: true, level: 0, fx: [flash([16, 17, 18, 19])] });
    expect(calls).toEqual(['start:0', 'clear:2', 'clear:4']);
  });

  it('REQ-093 two clears in one frame sound twice', () => {
    const { calls, conductor } = cues();
    conductor.onFrame({ inputLive: true, level: 0 });
    conductor.onFrame({ inputLive: true, level: 0, fx: [flash([19]), flash([18])] });
    expect(calls).toEqual(['start:0', 'clear:1', 'clear:1']);
  });

  it('REQ-093 an opponent clear, a nudge, a projectile and a burst make no sound', () => {
    const { calls, conductor } = cues();
    conductor.onFrame({ inputLive: true, level: 0 });
    conductor.onFrame({
      inputLive: true,
      level: 0,
      fx: [
        flash([19], 'right'),
        { kind: 'nudge', side: 'left', rows: 2 },
        { kind: 'projectile', from: 'left', rows: 2, originRow: 18 },
        { kind: 'burst', side: 'right', rows: 1 },
      ],
    });
    expect(calls).toEqual(['start:0']);
  });

  it('REQ-093 a clear on a frame where input is not live makes no sound', () => {
    const { calls, conductor } = cues();
    conductor.onFrame({ inputLive: false, level: 0, fx: [flash([19])] });
    expect(calls).toEqual([]);
  });

  it('REQ-093 a music service without the effect is fine: a clear is simply silent', () => {
    const calls: string[] = [];
    const conductor = createConductor({
      start: () => calls.push('start'),
      stop: () => calls.push('stop'),
      setLevel: () => calls.push('level'),
    });
    conductor.onFrame({ inputLive: true, level: 0 });
    conductor.onFrame({ inputLive: true, level: 0, fx: [flash([19])] });
    expect(calls).toEqual(['start']);
  });
});
