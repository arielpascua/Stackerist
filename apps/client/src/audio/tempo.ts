/**
 * Tempo maths for the soundtrack (REQ-089, architecture §8.1 decision 38). Pure.
 *
 * The song speeds up with the server's speed level: bpm = 100 + 6 × level, so level 0 plays at 100 bpm and
 * the top level (12) at 172 bpm. The level comes from the server tick via the snapshot, never a local timer.
 */
import { MAX_LEVEL } from '@stackerist/engine';

export const BASE_BPM = 100;
export const BPM_PER_LEVEL = 6;
/** The score is written in sixteenth-note steps. */
export const STEPS_PER_BEAT = 4;

/** Beats per minute at a speed level (clamped to the engine's 0..MAX_LEVEL). */
export function bpmForLevel(level: number): number {
  const clamped = Math.max(0, Math.min(MAX_LEVEL, Number.isFinite(level) ? Math.floor(level) : 0));
  return BASE_BPM + BPM_PER_LEVEL * clamped;
}

/** Seconds per score step (a sixteenth note) at `bpm`. */
export function stepSeconds(bpm: number): number {
  return 60 / bpm / STEPS_PER_BEAT;
}
