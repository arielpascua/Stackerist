/**
 * The thin Web Audio layer (REQ-089): oscillators, gains and one noise buffer, no audio files. Everything
 * decided about the music lives elsewhere (score, tempo, scheduler, controller); this file only turns a
 * `Note` placed at an audio-clock time into a short-lived node graph. The controller sees it through the
 * `AudioBackend` port, so tests run it against a fake and never need a browser.
 */
import { midiToHz, type Note } from './score.ts';

export type BackendState = 'running' | 'suspended' | 'closed';

export interface AudioBackend {
  /** The audio clock, seconds. */
  now(): number;
  state(): BackendState;
  /** Must be called from inside a click or key handler for the browser to allow audio. */
  resume(): Promise<void>;
  /** Starts a fresh mix bus; notes played from now on go through it. */
  openBus(): void;
  /** Fades the bus out and drops it: notes already scheduled go silent. */
  closeBus(): void;
  /** Places `note` at `whenSeconds` on the audio clock; a score step lasts `stepSeconds`. */
  play(note: Note, whenSeconds: number, stepSeconds: number): void;
}

export interface AudioHost {
  /** False where there is no Web Audio at all. */
  supported(): boolean;
  create(): AudioBackend;
}

const MASTER_GAIN = 0.32;
const BUS_FADE_IN_SECONDS = 0.04;
const BUS_FADE_OUT_SECONDS = 0.12;
/** The floor an exponential ramp can reach (it cannot ramp to exactly 0). */
const SILENCE = 0.0001;
const NOISE_SECONDS = 1;

const KICK = { startHz: 150, endHz: 45, sweepSeconds: 0.12, decaySeconds: 0.24 } as const;
const SNARE = { noiseHz: 1800, toneHz: 190, decaySeconds: 0.15, toneDecaySeconds: 0.08 } as const;
const HAT = { highpassHz: 7000, decaySeconds: 0.05 } as const;
const BASS = { cutoffHz: 700, attackSeconds: 0.005, releaseSeconds: 0.06 } as const;
const PAD = { attackSeconds: 0.12, releaseSeconds: 0.25, detuneCents: 6 } as const;
const LEAD = { cutoffHz: 3200, attackSeconds: 0.004, releaseSeconds: 0.08 } as const;

class WebAudioBackend implements AudioBackend {
  readonly #ctx: AudioContext;
  readonly #noise: AudioBuffer;
  #bus: GainNode | null = null;

  constructor(ctx: AudioContext) {
    this.#ctx = ctx;
    this.#noise = noiseBuffer(ctx);
  }

  now(): number {
    return this.#ctx.currentTime;
  }

  state(): BackendState {
    return this.#ctx.state === 'running' || this.#ctx.state === 'closed'
      ? this.#ctx.state
      : 'suspended';
  }

  resume(): Promise<void> {
    return this.#ctx.resume();
  }

  openBus(): void {
    this.closeBus();
    const bus = this.#ctx.createGain();
    const t = this.#ctx.currentTime;
    bus.gain.setValueAtTime(0, t);
    bus.gain.linearRampToValueAtTime(MASTER_GAIN, t + BUS_FADE_IN_SECONDS);
    bus.connect(this.#ctx.destination);
    this.#bus = bus;
  }

  closeBus(): void {
    const bus = this.#bus;
    if (bus === null) return;
    this.#bus = null;
    const t = this.#ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.linearRampToValueAtTime(0, t + BUS_FADE_OUT_SECONDS);
    // Drop the node once the fade is over; its scheduled voices end on their own.
    globalThis.setTimeout(
      () => {
        bus.disconnect();
      },
      (BUS_FADE_OUT_SECONDS + BUS_FADE_IN_SECONDS) * 1000,
    );
  }

  play(note: Note, whenSeconds: number, stepSeconds: number): void {
    const bus = this.#bus;
    if (bus === null) return;
    const length = note.steps * stepSeconds;
    switch (note.voice) {
      case 'kick':
        this.#kick(bus, note.gain, whenSeconds);
        break;
      case 'snare':
        this.#snare(bus, note.gain, whenSeconds);
        break;
      case 'hat':
        this.#hat(bus, note.gain, whenSeconds);
        break;
      case 'bass':
        this.#tone(bus, 'sawtooth', note, whenSeconds, length, BASS);
        break;
      case 'lead':
        this.#tone(bus, 'square', note, whenSeconds, length, LEAD);
        break;
      case 'pad':
        this.#pad(bus, note, whenSeconds, length);
        break;
    }
  }

  #envelope(
    bus: AudioNode,
    peak: number,
    start: number,
    attack: number,
    hold: number,
    release: number,
  ): GainNode {
    const gain = this.#ctx.createGain();
    gain.gain.setValueAtTime(SILENCE, start);
    gain.gain.linearRampToValueAtTime(peak, start + attack);
    gain.gain.setValueAtTime(peak, start + Math.max(attack, hold));
    gain.gain.exponentialRampToValueAtTime(SILENCE, start + Math.max(attack, hold) + release);
    gain.connect(bus);
    return gain;
  }

  #oscillator(type: OscillatorType, hz: number, start: number, end: number): OscillatorNode {
    const osc = this.#ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(hz, start);
    osc.start(start);
    osc.stop(end);
    return osc;
  }

  #kick(bus: AudioNode, peak: number, start: number): void {
    const end = start + KICK.decaySeconds + KICK.sweepSeconds;
    const osc = this.#oscillator('sine', KICK.startHz, start, end);
    osc.frequency.exponentialRampToValueAtTime(KICK.endHz, start + KICK.sweepSeconds);
    osc.connect(this.#envelope(bus, peak, start, 0.002, 0, KICK.decaySeconds));
  }

  #noiseSource(start: number, end: number): AudioBufferSourceNode {
    const source = this.#ctx.createBufferSource();
    source.buffer = this.#noise;
    source.start(start);
    source.stop(end);
    return source;
  }

  #hat(bus: AudioNode, peak: number, start: number): void {
    const filter = this.#ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = HAT.highpassHz;
    filter.connect(this.#envelope(bus, peak, start, 0.001, 0, HAT.decaySeconds));
    this.#noiseSource(start, start + HAT.decaySeconds * 2).connect(filter);
  }

  #snare(bus: AudioNode, peak: number, start: number): void {
    const filter = this.#ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = SNARE.noiseHz;
    filter.connect(this.#envelope(bus, peak, start, 0.001, 0, SNARE.decaySeconds));
    this.#noiseSource(start, start + SNARE.decaySeconds * 2).connect(filter);
    const tone = this.#oscillator(
      'triangle',
      SNARE.toneHz,
      start,
      start + SNARE.toneDecaySeconds * 2,
    );
    tone.connect(this.#envelope(bus, peak * 0.6, start, 0.001, 0, SNARE.toneDecaySeconds));
  }

  #tone(
    bus: AudioNode,
    type: OscillatorType,
    note: Note,
    start: number,
    length: number,
    voice: { cutoffHz: number; attackSeconds: number; releaseSeconds: number },
  ): void {
    const filter = this.#ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = voice.cutoffHz;
    filter.connect(
      this.#envelope(bus, note.gain, start, voice.attackSeconds, length, voice.releaseSeconds),
    );
    this.#oscillator(
      type,
      midiToHz(note.midi),
      start,
      start + length + voice.releaseSeconds,
    ).connect(filter);
  }

  #pad(bus: AudioNode, note: Note, start: number, length: number): void {
    const envelope = this.#envelope(
      bus,
      note.gain,
      start,
      PAD.attackSeconds,
      length,
      PAD.releaseSeconds,
    );
    const end = start + length + PAD.releaseSeconds;
    for (const cents of [-PAD.detuneCents, PAD.detuneCents]) {
      const osc = this.#oscillator('triangle', midiToHz(note.midi), start, end);
      osc.detune.value = cents;
      osc.connect(envelope);
    }
  }
}

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** The real browser: `window.AudioContext`, created only when `create()` is called (from a gesture). */
export function browserAudioHost(): AudioHost {
  return {
    supported: () => typeof window !== 'undefined' && typeof window.AudioContext === 'function',
    create: () => new WebAudioBackend(new window.AudioContext()),
  };
}
