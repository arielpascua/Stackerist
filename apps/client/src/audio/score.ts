/**
 * The original Stackerist theme, as data (REQ-089). Pure: a step number in, the notes that start on it out.
 *
 * Key: A minor (A natural minor, with the G sharp of the E major chord in the last bar). DESIGN.md names no
 * key, so this is CORE's choice. Eight bars of sixteen steps loop as Am F C G | Am F G E. Voices: a
 * kick-and-hat drum line, a sawtooth bass, a pad that holds each chord, and a square lead. The synth
 * (`graph.ts`) turns a `Note` into sound; nothing here knows about Web Audio.
 */
import { STEPS_PER_BEAT } from './tempo.ts';

export type Voice = 'kick' | 'snare' | 'hat' | 'bass' | 'pad' | 'lead';

export interface Note {
  readonly voice: Voice;
  /** MIDI note number for pitched voices; unused by the drums. */
  readonly midi: number;
  /** Length in score steps. */
  readonly steps: number;
  /** 0..1 before the mix. */
  readonly gain: number;
}

export const STEPS_PER_BAR = 4 * STEPS_PER_BEAT;
export const BARS = 8;
export const LOOP_STEPS = BARS * STEPS_PER_BAR;

/** Pitch classes (0 = C) of A natural minor plus the G sharp of the E chord. */
export const KEY_PITCH_CLASSES: ReadonlySet<number> = new Set([9, 11, 0, 2, 4, 5, 7, 8]);

const BASS_ROOTS = [45, 41, 48, 43, 45, 41, 43, 40] as const;
const PADS: readonly (readonly number[])[] = [
  [57, 60, 64],
  [53, 57, 60],
  [60, 64, 67],
  [59, 62, 67],
  [57, 60, 64],
  [53, 57, 60],
  [59, 62, 67],
  [56, 59, 64],
];
/** Lead melody per bar, 16 steps each; 0 is a rest. */
const LEAD: readonly (readonly number[])[] = [
  [69, 0, 72, 0, 76, 0, 72, 0, 69, 0, 72, 76, 81, 0, 76, 0],
  [65, 0, 69, 0, 72, 0, 69, 0, 65, 0, 69, 72, 77, 0, 72, 0],
  [67, 0, 72, 0, 76, 0, 72, 0, 67, 0, 72, 76, 79, 0, 76, 0],
  [67, 0, 71, 0, 74, 0, 71, 0, 67, 0, 71, 74, 79, 0, 74, 71],
  [76, 0, 0, 74, 72, 0, 69, 0, 72, 0, 76, 0, 81, 0, 0, 0],
  [77, 0, 0, 76, 72, 0, 69, 0, 72, 0, 77, 0, 81, 0, 0, 0],
  [74, 0, 0, 71, 67, 0, 71, 0, 74, 0, 79, 0, 83, 0, 0, 0],
  [76, 0, 0, 80, 83, 0, 80, 0, 76, 0, 80, 0, 83, 0, 71, 74],
];
/** Bass pattern: 1 root, 2 octave up, 0 rest. */
const BASS_PATTERN = [1, 0, 1, 0, 1, 0, 2, 0, 1, 0, 1, 0, 1, 0, 2, 1] as const;
const OCTAVE = 12;

const MIX = {
  kick: 0.9,
  snare: 0.5,
  hatAccent: 0.32,
  hat: 0.14,
  bass: 0.5,
  pad: 0.16,
  lead: 0.2,
} as const;

/** Every note that starts on `step` (the score loops). */
export function notesAt(step: number): Note[] {
  const at = ((Math.floor(step) % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
  const bar = Math.floor(at / STEPS_PER_BAR);
  const inBar = at % STEPS_PER_BAR;
  const notes: Note[] = [];
  const drum = (voice: Voice, gain: number): void => {
    notes.push({ voice, midi: 0, steps: 1, gain });
  };

  if (inBar % STEPS_PER_BEAT === 0) drum('kick', MIX.kick);
  if (inBar === STEPS_PER_BEAT || inBar === 3 * STEPS_PER_BEAT) drum('snare', MIX.snare);
  if (inBar % 2 === 0) drum('hat', inBar % STEPS_PER_BEAT === 2 ? MIX.hatAccent : MIX.hat);

  const bassKind = BASS_PATTERN[inBar] ?? 0;
  const root = BASS_ROOTS[bar];
  if (bassKind !== 0 && root !== undefined) {
    notes.push({
      voice: 'bass',
      midi: bassKind === 2 ? root + OCTAVE : root,
      steps: 1.6,
      gain: MIX.bass,
    });
  }
  if (inBar === 0) {
    for (const midi of PADS[bar] ?? []) {
      notes.push({ voice: 'pad', midi, steps: STEPS_PER_BAR, gain: MIX.pad });
    }
  }
  const lead = LEAD[bar]?.[inBar] ?? 0;
  if (lead !== 0) notes.push({ voice: 'lead', midi: lead, steps: 1.5, gain: MIX.lead });
  return notes;
}

/** Equal-tempered frequency of a MIDI note (A4 = 69 = 440 Hz). */
export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

// ---- The row-clear sound effect (REQ-093) ----

/** E5 G5 A5 C6 E6: A minor pentatonic, so every pitch is in the key of the score above. */
const CLEAR_PITCHES = [76, 79, 81, 84, 88] as const;
/** The fixed spacing of the arpeggio. The effect does not follow the tempo: it sounds the same at every level. */
export const CLEAR_EFFECT_STEP_SECONDS = 0.055;
/** A lock clears at most four rows. */
export const MAX_CLEAR_ROWS = 4;

/**
 * The notes of the row-clear sound, in order, one `CLEAR_EFFECT_STEP_SECONDS` apart: a rising arpeggio on the
 * lead voice with one more note per row cleared, the last one ringing longer. Nothing for no rows; more than
 * four is treated as four.
 */
export function clearEffectNotes(rows: number): Note[] {
  const count = Math.min(MAX_CLEAR_ROWS, Math.floor(rows));
  if (!(count >= 1)) return [];
  const notes: Note[] = [];
  for (let i = 0; i <= count; i += 1) {
    notes.push({
      voice: 'lead',
      midi: CLEAR_PITCHES[i] ?? 88,
      steps: i === count ? 4 : 1.2,
      gain: 0.4 + 0.05 * i,
    });
  }
  return notes;
}
