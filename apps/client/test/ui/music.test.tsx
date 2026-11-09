import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Music, MusicPreference, MusicStatus } from '../../src/game/contract.ts';
import { MusicButton } from '../../src/ui/components/MusicButton.tsx';
import { COPY } from '../../src/ui/copy.ts';

function fakeMusic(status: MusicStatus, preference: MusicPreference): Music {
  const noop = () => undefined;
  return {
    unlock: noop,
    start: noop,
    setLevel: noop,
    stop: noop,
    status: () => status,
    toggle: noop,
    subscribe: () => noop,
    preference: () => preference,
    lastToggleSource: () => null,
  };
}

const html = (status: MusicStatus, preference: MusicPreference) =>
  renderToStaticMarkup(<MusicButton music={fakeMusic(status, preference)} />);

describe('REQ-089 Music button: pressed state, blocked and unavailable hints, constant name', () => {
  it('REQ-089 on: aria-pressed true, the constant name "Music" and an M key cap', () => {
    const out = html('on', 'on');
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain('>Music<');
    expect(out).toContain('>M</kbd>');
    expect(out).not.toContain('aria-describedby');
  });

  it('REQ-089 off: aria-pressed false and the label keeps its name', () => {
    const out = html('off', 'off');
    expect(out).toContain('aria-pressed="false"');
    expect(out).toContain('>Music<');
  });

  it('REQ-089 blocked: still pressed (the preference is on), a dot badge and the start hint', () => {
    const out = html('blocked', 'on');
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain('music-btn__badge');
    expect(out).toContain('aria-describedby');
    expect(out).toContain(COPY.music.blockedHint);
    expect(COPY.music.blockedHint).toBe('Press M or click to start the music.');
  });

  it('REQ-089 unavailable: aria-disabled and the "isn’t supported" hint', () => {
    const out = html('unavailable', 'on');
    expect(out).toContain('aria-disabled="true"');
    expect(out).toContain('supported in this browser.');
    expect(COPY.music.unavailableHint).toBe("Music isn't supported in this browser.");
  });

  it('REQ-089 a polite live region exists for key toggles, and it starts empty', () => {
    const out = html('on', 'on');
    expect(out).toContain('aria-live="polite"');
    expect(COPY.music.announceOn).toBe('Music on');
    expect(COPY.music.announceOff).toBe('Music off');
  });
});
