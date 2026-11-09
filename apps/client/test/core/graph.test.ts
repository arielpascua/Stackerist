import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserAudioHost } from '../../src/audio/graph.ts';
import { notesAt, type Voice } from '../../src/audio/score.ts';

/** The slice of Web Audio the synth touches, recording what it is asked to build. */
class FakeParam {
  value = 0;
  calls: string[] = [];
  setValueAtTime(): void {
    this.calls.push('set');
  }
  linearRampToValueAtTime(): void {
    this.calls.push('linear');
  }
  exponentialRampToValueAtTime(): void {
    this.calls.push('exp');
  }
  cancelScheduledValues(): void {
    this.calls.push('cancel');
  }
}

class FakeNode {
  connected: unknown[] = [];
  disconnected = false;
  connect(target: unknown): void {
    this.connected.push(target);
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeOscillator extends FakeNode {
  type = '';
  frequency = new FakeParam();
  detune = new FakeParam();
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  start(at: number): void {
    this.startedAt = at;
  }
  stop(at: number): void {
    this.stoppedAt = at;
  }
}

class FakeContext {
  static last: FakeContext | null = null;
  currentTime = 1;
  sampleRate = 8000;
  state = 'suspended';
  destination = new FakeNode();
  gains: (FakeNode & { gain: FakeParam })[] = [];
  oscillators: FakeOscillator[] = [];
  sources: (FakeNode & { start(at: number): void; stop(at: number): void })[] = [];
  constructor() {
    FakeContext.last = this;
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  createGain() {
    const node = Object.assign(new FakeNode(), { gain: new FakeParam() });
    this.gains.push(node);
    return node;
  }
  createOscillator() {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: '', frequency: new FakeParam() });
  }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  createBufferSource() {
    const node = Object.assign(new FakeNode(), {
      buffer: null,
      startedAt: -1,
      start(at: number) {
        this.startedAt = at;
      },
      stop() {},
    });
    this.sources.push(node);
    return node;
  }
}

function withWebAudio() {
  vi.stubGlobal('window', { AudioContext: FakeContext });
  const backend = browserAudioHost().create();
  const ctx = FakeContext.last;
  if (ctx === null) throw new Error('no context');
  return { backend, ctx };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('REQ-089 the Web Audio layer is synthesis only', () => {
  it('REQ-089 supported() is false without window.AudioContext, true with it', () => {
    vi.stubGlobal('window', {});
    expect(browserAudioHost().supported()).toBe(false);
    vi.stubGlobal('window', { AudioContext: FakeContext });
    expect(browserAudioHost().supported()).toBe(true);
  });

  it('REQ-089 no context is created until create(), and the context starts suspended until resume()', async () => {
    vi.stubGlobal('window', { AudioContext: FakeContext });
    FakeContext.last = null;
    const host = browserAudioHost();
    expect(FakeContext.last).toBeNull();
    const backend = host.create();
    expect(backend.state()).toBe('suspended');
    await backend.resume();
    expect(backend.state()).toBe('running');
  });

  it('REQ-089 notes made before a bus is opened make no sound', () => {
    const { backend, ctx } = withWebAudio();
    const [kick] = notesAt(0);
    if (kick === undefined) throw new Error('no note');
    backend.play(kick, 2, 0.15);
    expect(ctx.oscillators).toHaveLength(0);
  });

  it('REQ-089 every voice of the score builds oscillators or noise, placed on the audio clock', () => {
    const { backend, ctx } = withWebAudio();
    backend.openBus();
    const seen = new Set<Voice>();
    for (let step = 0; step < 128; step += 1) {
      for (const note of notesAt(step)) {
        seen.add(note.voice);
        backend.play(note, 5 + step * 0.1, 0.15);
      }
    }
    expect(seen.size).toBe(6);
    expect(ctx.oscillators.length).toBeGreaterThan(100);
    expect(ctx.sources.length).toBeGreaterThan(0);
    for (const osc of ctx.oscillators) {
      expect(osc.startedAt).toBeGreaterThanOrEqual(5);
      expect(osc.stoppedAt).toBeGreaterThan(osc.startedAt ?? Infinity);
      expect(osc.connected).toHaveLength(1);
    }
  });

  it('REQ-089 closing the bus ramps it to silence and drops it; later notes go nowhere', () => {
    vi.useFakeTimers();
    try {
      const { backend, ctx } = withWebAudio();
      backend.openBus();
      const bus = ctx.gains[0];
      expect(bus?.connected).toContain(ctx.destination);
      backend.closeBus();
      expect(bus?.gain.calls).toContain('cancel');
      expect(bus?.gain.calls.at(-1)).toBe('linear');
      vi.advanceTimersByTime(1000);
      expect(bus?.disconnected).toBe(true);
      const before = ctx.oscillators.length;
      const [kick] = notesAt(0);
      if (kick !== undefined) backend.play(kick, 3, 0.15);
      expect(ctx.oscillators.length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
